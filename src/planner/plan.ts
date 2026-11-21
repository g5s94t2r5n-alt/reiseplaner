import type { Candidate, GeoPoint, Interest, Place, Segment, Stop, StopInfo, Trip, TripSettings } from '../types';
import { route as osrmRoute, table as osrmTable, trip as osrmTrip, type OsrmResult } from '../api/osrm';
import { reverseGeocode } from '../api/geocode';
import { findWikivoyageTitle, getPageviews, getSitelinks, getWikidataClasses, getWikipediaSummary, getWikivoyagePage, wikivoyageUrl } from '../api/wiki';
import { climateBatch, type DailySeries } from '../api/weather';
import { CLASS_INTERESTS, interestStrengths, listingProfile, seasonAdjust, strengthNotes, typeKeyFor, type ListingProfile } from './profile';
import { daylightHours, windowStats } from './season';
import { countPois } from '../api/overpass';
import { mapLimit } from '../api/http';
import { coordKey, haversineKm, splitLineAtWaypoints, splitLineByLengths } from '../lib/geo';
import { countListings, parseSightListings, parseSleepListings, stripMarkup } from '../lib/wikitext';
import { loadCandidates, rescoreCandidate, tagsFor } from './candidates';
import { selectStops, transitNightsFor } from './select';
import { fitNights, recommendNights } from './nights';
import { addDays, allTransitStops } from './itinerary';
import { AVG_NIGHTS, TRAVEL_TIME_FACTOR } from './profiles';

export type ProgressFn = (message: string) => void;

export const uid = () => Math.random().toString(36).slice(2, 10);

export function candidateToStop(c: Candidate): Stop {
  return {
    id: uid(),
    name: c.name,
    kind: c.kind,
    description: c.description,
    wvTitle: c.wvTitle,
    wikidata: c.wikidata,
    tags: c.tags,
    score: c.score,
    views: c.views,
    lat: c.lat,
    lon: c.lon,
    nights: 1,
    recommendedNights: 1,
    manualNights: false,
    reasons: [],
  };
}

export function placeToStop(p: Place): Stop {
  return {
    id: uid(),
    name: p.name,
    kind: 'custom',
    description: p.label,
    tags: [],
    score: 4,
    lat: p.lat,
    lon: p.lon,
    nights: 1,
    recommendedNights: 1,
    manualNights: false,
    reasons: [],
  };
}

/** Lädt Infos für Stops: Wikivoyage-Einträge, Unterkünfte aus "Sleep", deutsche Kurzbeschreibung. */
export async function enrichStops(stops: Stop[], onProgress?: ProgressFn): Promise<Stop[]> {
  const sitelinks = await getSitelinks(stops.map((s) => s.wikidata ?? '').filter(Boolean)).catch(
    () => ({}) as Awaited<ReturnType<typeof getSitelinks>>,
  );
  let done = 0;
  return mapLimit(stops, 3, async (stop) => {
    if (stop.info) return stop;
    const s: Stop = { ...stop };
    const info: StopInfo = { seeCount: 0, doCount: 0, articleLength: 0, sleep: [] };
    try {
      const title = s.wvTitle ?? (await findWikivoyageTitle(s.name, s).catch(() => null));
      const page = title ? await getWikivoyagePage(title).catch(() => null) : null;
      if (page) {
        s.wvTitle = page.title;
        const counts = countListings(page.wikitext);
        info.seeCount = counts.see;
        info.doCount = counts.do;
        info.articleLength = page.wikitext.length;
        info.sleep = parseSleepListings(page.wikitext);
        // Qualität statt nur Menge: bekannte Ziele (mit Wikidata-Eintrag) und UNESCO-Welterbe
        info.notableCount = parseSightListings(page.wikitext).filter((x) => x.wikidata).length;
        info.unesco = /world heritage/i.test(page.wikitext);
        if (s.views == null) {
          const pv = await getPageviews('en.wikivoyage.org', [page.title]).catch(() => ({}) as Record<string, number>);
          s.views = pv[page.title];
        }
        info.wikivoyageUrl = wikivoyageUrl(page.title);
        if (s.kind === 'custom' && s.tags.length === 0) {
          s.tags = tagsFor('custom', stripMarkup(page.wikitext.slice(0, 4000)));
        }
      }
      // OpenStreetMap nur befragen, wenn es gar keinen Wikivoyage-Artikel gibt (Overpass ist oft überlastet)
      if (!page) {
        info.poi = await countPois(s, s.kind === 'nature' ? 15 : 6).catch(() => undefined);
      }
      const sl = s.wikidata ? sitelinks[s.wikidata] : undefined;
      let summary = sl?.dewiki ? await getWikipediaSummary('de', sl.dewiki) : null;
      if (!summary && !sl) summary = await getWikipediaSummary('de', s.name);
      if (!summary && sl?.enwiki) summary = await getWikipediaSummary('en', sl.enwiki);
      info.summary = summary ?? undefined;
    } catch {
      // Infos sind optional
    }
    s.info = info;
    onProgress?.(`Infos geladen: ${++done}/${stops.length} Stops`);
    return s;
  });
}

/** Empfiehlt Nächte pro Stop und verteilt das Budget. */
export function applyNights(trip: Trip): Trip {
  const { settings } = trip;
  const transits = allTransitStops(trip);
  const recs = trip.stops.map((stop, i) => {
    const seg = trip.segments[i];
    const arrival = seg ? seg.durationH / (transitNightsFor(seg.durationH, settings.maxDriveHours) + 1) : 0;
    return recommendNights({
      kind: stop.kind,
      tags: stop.tags,
      info: stop.info,
      views: stop.views,
      interests: settings.interests,
      pace: settings.pace,
      arrivalDriveH: arrival,
      maxDriveH: settings.maxDriveHours,
    });
  });
  const available = settings.nights - transits.length;
  const fit = fitNights(
    trip.stops.map((s, i) => ({ recommended: recs[i].nights, score: s.score, manual: s.manualNights, nights: s.nights })),
    available,
  );
  return {
    ...trip,
    stops: trip.stops.map((s, i) => ({
      ...s,
      recommendedNights: recs[i].nights,
      reasons: recs[i].reasons,
      nights: fit.nights[i],
    })),
  };
}

export function segmentsFrom(res: OsrmResult, factor: number): Segment[] {
  const legsKm = res.legs.map((l) => l.distanceKm);
  const wp = res.waypoints;
  // route/trip mit Ziel: Wegpunkte = Etappen + 1; Rundreise per trip: Start wird nicht wiederholt
  const ends =
    wp.length === res.legs.length + 1 ? wp.slice(1) : wp.length === res.legs.length ? [...wp.slice(1), wp[0]] : [];
  const parts =
    ends.length === res.legs.length
      ? splitLineAtWaypoints(res.geometry, legsKm, ends.slice(0, -1))
      : splitLineByLengths(res.geometry, legsKm);
  return res.legs.map((l, i) => ({
    distanceKm: l.distanceKm,
    durationH: l.durationH * factor,
    geometry: parts[i] ?? [],
    end: ends[i],
  }));
}

/** Berechnet Route, Zwischenstopps und Nächte neu (z. B. nach Änderungen an den Stops). */
export async function recalcTrip(
  trip: Trip,
  opts: { optimize?: boolean; onProgress?: ProgressFn } = {},
): Promise<Trip> {
  const { settings } = trip;
  const roundtrip = !settings.end;
  const end = settings.end ?? settings.start;
  const factor = TRAVEL_TIME_FACTOR[settings.style];
  let stops = trip.stops;
  let segments: Segment[];

  opts.onProgress?.('Berechne Route …');
  if (stops.length === 0 && roundtrip) {
    segments = [{ distanceKm: 0, durationH: 0, geometry: [[settings.start.lat, settings.start.lon]] }];
  } else if (opts.optimize && stops.length >= 2) {
    const pts = roundtrip ? [settings.start, ...stops] : [settings.start, ...stops, end];
    const res = await osrmTrip(pts, roundtrip);
    stops = res.order.filter((i) => i !== 0 && (roundtrip || i !== pts.length - 1)).map((i) => stops[i - 1]);
    segments = segmentsFrom(res, factor);
  } else {
    const res = await osrmRoute([settings.start, ...stops, end]);
    segments = segmentsFrom(res, factor);
  }

  const names = { ...trip.transitNames };
  const transits = allTransitStops({ segments, settings, transitNames: names });
  const missing = transits.filter((t) => !names[coordKey(t)]);
  if (missing.length) opts.onProgress?.('Suche Orte für Zwischenstopps …');
  for (const t of missing) {
    const name = await reverseGeocode(t).catch(() => undefined);
    if (name) names[coordKey(t)] = name;
  }

  return applyNights({ ...trip, stops, segments, transitNames: names, updatedAt: Date.now() });
}

/** Komplette automatische Planung aus den Einstellungen. */
/** Schlüssel für "Nicht vorschlagen" / Abgleich mit Kandidaten */
export const placeKey = (p: { wvTitle?: string; name: string }) => p.wvTitle ?? p.name;

export interface PlanOptions {
  /** "Muss rein": werden in jedem Fall eingeplant */
  pinned?: Stop[];
  /** "Nicht vorschlagen": Schlüssel (placeKey) */
  excluded?: string[];
}

/**
 * Verfeinert die Kandidaten: Interessen genauer (Wikivoyage-Einträge der besten 40 + Ortsart aus
 * Wikidata) und Jahreszeit (Klima am nächsten Straßenpunkt im Reisezeitraum). Ändert die Objekte direkt.
 */
export async function refineCandidates(
  cands: Candidate[],
  settings: TripSettings,
  snapped: GeoPoint[] | null,
  onProgress?: ProgressFn,
): Promise<void> {
  const interests = settings.interests;

  // 1) Ortsart aus Wikidata (eine Abfrage für alle)
  onProgress?.('Prüfe Ortsart der Ziele (Wikidata) …');
  const classes = await getWikidataClasses(
    cands.map((c) => c.wikidata ?? '').filter(Boolean),
    Object.keys(CLASS_INTERESTS).filter((q) => q !== 'Q9259'),
  ).catch(() => ({}) as Record<string, string[]>);

  // 2) Was gibt es vor Ort? Wikivoyage-Einträge der vielversprechendsten Ziele
  onProgress?.('Prüfe Angebot vor Ort (Wikivoyage) …');
  const best = [...cands].sort((a, b) => b.score - a.score).slice(0, 40);
  const profiles = new Map<Candidate, ListingProfile>();
  await mapLimit(best, 4, async (c) => {
    const page = c.wvTitle ? await getWikivoyagePage(c.wvTitle).catch(() => null) : null;
    if (page) profiles.set(c, listingProfile(page.wikitext));
  });

  // 3) Jahreszeit: Klima am Straßenpunkt für das Reisefenster (gleiche Tage im Vorjahr)
  let climate: { series: DailySeries; elevation: number }[] | null = null;
  const arrive = settings.startDate;
  const depart = addDays(settings.startDate, Math.min(settings.nights, 45));
  if (snapped) {
    onProgress?.('Prüfe Wetter im Reisezeitraum …');
    const lastYear = new Date().getUTCFullYear() - 1;
    const from = `${lastYear}${arrive.slice(4)}`;
    const toDate = addDays(from, Math.min(settings.nights, 45) + 3);
    climate = await climateBatch(snapped, addDays(from, -3), toDate).catch(() => null);
  }

  cands.forEach((c, i) => {
    const descTags = c.tags;
    const profile = profiles.get(c);
    const cls = c.wikidata ? classes[c.wikidata] : undefined;
    c.strengths = interestStrengths({ profile, classes: cls, descTags, kind: c.kind });
    c.typeKey = typeKeyFor(c.kind, cls, c.strengths);
    c.tags = (Object.keys(c.strengths) as Interest[]).filter((k) => (c.strengths![k] ?? 0) >= 1 || descTags.includes(k));
    const notes = [...(c.notes ?? []).filter((n) => n.startsWith('Zusätzlich aus Wikidata')), ...strengthNotes(interests, profile, cls)];
    if ((c.views ?? 0) >= 300) notes.push(`Beliebt bei Reisenden (ca. ${Math.round(c.views! / 2).toLocaleString('de-DE')} Aufrufe/Monat)`);
    const cl = climate?.[i];
    if (cl) {
      const adj = seasonAdjust({
        kind: c.kind,
        tags: c.tags,
        interests,
        stats: windowStats(cl.series, arrive, depart),
        elevation: cl.elevation,
        daylightH: daylightHours(c.lat, arrive),
      });
      c.seasonDelta = adj.delta;
      notes.push(...adj.notes);
    }
    c.notes = notes;
    rescoreCandidate(c, interests);
  });
}

/** Komplette automatische Planung aus den Einstellungen. */
export async function planTrip(settings: TripSettings, onProgress: ProgressFn, opts: PlanOptions = {}): Promise<Trip> {
  const warnings: string[] = [];
  const end = settings.end ?? settings.start;
  const wanted = Math.ceil(settings.nights / AVG_NIGHTS[settings.pace]);
  const excluded = new Set(opts.excluded ?? []);
  const pinned = opts.pinned ?? [];

  onProgress('Suche sehenswerte Ziele in der Region (Wikivoyage) …');
  const load = await loadCandidates(settings.region, settings.interests, wanted);
  warnings.push(...load.warnings);
  settings.region.wikivoyageTitle = load.wikivoyageTitle;
  // Orte direkt am Start/Ziel nicht automatisch als Stop wählen (z. B. die eigene Heimatstadt);
  // auf der Karte bleiben sie als Vorschlag sichtbar. Ausgeschlossene Orte nie.
  const nearEnds = (c: { lat: number; lon: number }) =>
    haversineKm(c, settings.start) < 15 || (!!settings.end && haversineKm(c, settings.end) < 15);
  const pinnedKeys = new Set(pinned.map(placeKey));
  const top = [...load.candidates]
    .filter((c) => !excluded.has(placeKey(c)) && !pinnedKeys.has(placeKey(c)) && !nearEnds(c))
    .sort((a, b) => b.score - a.score)
    .slice(0, 70);
  // "Muss rein"-Stops als Kandidaten vorne anstellen (mit hoher Bewertung)
  const pinnedCands: Candidate[] = pinned.map((p) => ({
    id: `pin:${p.id}`,
    name: p.name,
    kind: p.kind,
    description: p.description,
    wvTitle: p.wvTitle,
    wikidata: p.wikidata,
    lat: p.lat,
    lon: p.lon,
    tags: p.tags,
    score: Math.max(p.score, 10),
    views: p.views,
  }));
  const pool = [...pinnedCands, ...top];

  let order: number[] = [];
  if (pool.length > 0) {
    onProgress(`Berechne Fahrzeiten zwischen ${pool.length} möglichen Zielen …`);
    const nodes = [settings.start, end, ...pool];
    let duration: (a: number, b: number) => number | null;
    let snapped: GeoPoint[] | null = null;
    try {
      const m = await osrmTable(nodes);
      duration = (a, b) => m.hours[a]?.[b] ?? null;
      snapped = m.snapped.slice(2);
    } catch {
      warnings.push('Fahrzeiten-Server nicht erreichbar – Auswahl basiert auf geschätzten Entfernungen.');
      duration = (a, b) => (haversineKm(nodes[a], nodes[b]) * 1.3) / 70;
    }

    await refineCandidates(top, settings, snapped ? snapped.slice(pinnedCands.length) : null, onProgress);

    onProgress('Wähle Stops passend zu Zeit, Tempo, Interessen und Jahreszeit …');
    order = selectStops({
      candidates: pool,
      duration,
      nights: settings.nights,
      pace: settings.pace,
      maxDriveH: settings.maxDriveHours,
      travelFactor: TRAVEL_TIME_FACTOR[settings.style],
      fixed: pinnedCands.map((_, i) => i),
    }).order;
    if (order.length === 0) {
      warnings.push(
        'Mit dem Nächte-Budget passt kein Ziel in die Route (Anreise zu lang?). Erhöhe die Nächte oder die Fahrzeit pro Tag.',
      );
    }
  }

  onProgress('Lade Infos zu den Stops …');
  const chosen = order.map((i) => {
    if (i < pinnedCands.length) return { ...pinned[i], pinned: true };
    const c = pool[i];
    return { ...candidateToStop(c), selectionNotes: c.notes };
  });
  const stops = await enrichStops(chosen, onProgress);

  const now = Date.now();
  let trip: Trip = {
    id: uid(),
    name: `${settings.region.name} · ${settings.nights} Nächte`,
    createdAt: now,
    updatedAt: now,
    settings,
    candidates: load.candidates,
    stops,
    segments: [],
    transitNames: {},
    warnings,
    excluded: [...excluded],
  };
  trip = await recalcTrip(trip, { onProgress });

  // Passt die echte Route nicht ins Budget, die schwächsten Stops entfernen ("Muss rein" bleibt)
  for (let k = 0; k < 6; k++) {
    const transitCount = allTransitStops(trip).length;
    if (trip.stops.length === 0 || trip.stops.length + transitCount <= settings.nights) break;
    const weakest = [...trip.stops].filter((s) => !s.pinned).sort((a, b) => a.score - b.score)[0];
    if (!weakest) break;
    onProgress(`Route zu lang – entferne ${weakest.name} …`);
    trip = await recalcTrip({ ...trip, stops: trip.stops.filter((s) => s.id !== weakest.id) }, { onProgress });
  }
  return trip;
}
