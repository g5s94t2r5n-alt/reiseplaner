import type { Candidate, Interest, Region, StopKind } from '../types';
import { getPageviews, getSitelinks, getWikidataHighlights, getWikivoyageCoordinates, getWikivoyagePage, type WikidataHighlight } from '../api/wiki';
import { lookupWikidata } from '../api/geocode';
import { getSection, parseDestinationList, parseRegionTitles, type DestinationItem } from '../lib/wikitext';
import { haversineKm } from '../lib/geo';

const KEYWORDS: Record<Interest, RegExp> = {
  nature:
    /national park|nature|glacier|mountain|fjord|lake|forest|waterfall|scenic|landscape|valley|canyon|wildlife|volcan|island|gorge|cliff/i,
  hiking: /hik|trek|trail|walk|climb|ski|kayak|outdoor|mountain|summit|peak/i,
  beach: /beach|coast|seaside|sea |surf|bay|lagoon|snorkel|dive|diving|sand|harbour|harbor|riviera/i,
  culture:
    /museum|histor|castle|old town|cathedral|church|unesco|heritage|medieval|palace|temple|monaster|ruins|architect|roman|art/i,
  city: /capital|largest city|nightlife|shopping|vibrant|lively|metropol|bars|restaurants|cosmopolitan/i,
};

export function tagsFor(kind: StopKind, text: string): Interest[] {
  const tags = (Object.keys(KEYWORDS) as Interest[]).filter((k) => KEYWORDS[k].test(text));
  if (kind === 'city' && !tags.includes('city')) tags.push('city');
  if (kind === 'nature' && !tags.includes('nature')) tags.push('nature');
  return tags;
}

/**
 * Bewertet einen Kandidaten passend zu den Interessen (höher = besser).
 * depth 0 = steht direkt im Artikel der gewählten Region (kuratierte Highlights, max. ~9 pro Liste),
 * depth 1 = stammt aus einer Unterregion.
 */
export function scoreCandidate(
  c: { kind: StopKind; tags: Interest[]; rank: number; depth: number; strengths?: Partial<Record<Interest, number>> },
  interests: Interest[],
): number {
  let score = 3;
  // Highlights der Region klar vor Orten aus Unterregionen – sonst gewinnen bei
  // reinen Natur-Interessen kleine Dörfer gegen Siena oder Pisa (Wikivoyage listet
  // Naturziele oft nur in den Unterregionen).
  if (c.depth === 0) score += 4;
  // Erster Listeneintrag ist meist die Hauptstadt bzw. das wichtigste Ziel; der Rest ist alphabetisch
  if (c.rank === 0) score += 0.5;
  let matches: number;
  if (c.strengths) {
    // genaue Stärke je Interesse (Wikivoyage-Einträge, Ortsart, Beschreibung), 0–3 Punkte
    matches = interests.filter((i) => (c.strengths![i] ?? 0) >= 1).length;
    score += interests.reduce((sum, i) => sum + (c.strengths![i] ?? 0), 0);
    // passt zu keinem Interesse richtig gut → deutlicher Abzug (kein "Lückenfüller")
    const best = Math.max(0, ...interests.map((i) => c.strengths![i] ?? 0));
    if (interests.length > 0 && matches > 0 && best < 1.5) score -= 1.5;
  } else {
    matches = c.tags.filter((t) => interests.includes(t)).length;
    score += matches * 2;
  }
  if (interests.length > 0 && matches === 0) score -= 0.75;
  if (c.kind === 'city' && interests.length > 0 && !interests.includes('city') && !interests.includes('culture')) {
    score -= 0.5;
  }
  return Math.round(score * 10) / 10;
}

export interface CandidateLoadResult {
  candidates: Candidate[];
  wikivoyageTitle?: string;
  warnings: string[];
}

/** Ermittelt den Wikivoyage-Artikel einer Region über Wikidata. */
export async function resolveRegionTitle(region: Region): Promise<string | undefined> {
  if (region.wikivoyageTitle) return region.wikivoyageTitle;
  const qid = region.wikidata ?? (await lookupWikidata(region.osmType, region.osmId).catch(() => undefined));
  if (qid) {
    region.wikidata = qid;
    const sl = await getSitelinks([qid]).catch(() => ({}) as Record<string, { enwikivoyage?: string }>);
    if (sl[qid]?.enwikivoyage) return sl[qid].enwikivoyage;
  }
  return undefined;
}

/**
 * Lädt Stop-Kandidaten aus Wikivoyage: die Abschnitte "Cities" und "Other destinations"
 * der Region und – falls das zu wenige sind – ihrer Unterregionen.
 */
export async function loadCandidates(
  region: Region,
  interests: Interest[],
  wanted: number,
  fallbackTitle?: string,
): Promise<CandidateLoadResult> {
  const warnings: string[] = [];
  let title = await resolveRegionTitle(region);
  if (!title && fallbackTitle) title = fallbackTitle;
  if (!title) title = region.name;
  const page = await getWikivoyagePage(title);
  if (!page) {
    return {
      candidates: [],
      warnings: [`Für „${region.name}“ wurde kein Wikivoyage-Artikel gefunden. Füge Stops bitte manuell hinzu.`],
    };
  }

  type Raw = DestinationItem & { kind: StopKind; rank: number; depth: number };
  const raws: Raw[] = [];
  const collect = (wikitext: string, depth: number) => {
    const cities = getSection(wikitext, ['Cities', 'Towns', 'Cities and towns']);
    const others = getSection(wikitext, ['Other destinations']);
    if (cities) parseDestinationList(cities).forEach((d, i) => raws.push({ ...d, kind: 'city', rank: i, depth }));
    if (others) parseDestinationList(others).forEach((d, i) => raws.push({ ...d, kind: 'nature', rank: i, depth }));
    return !!(cities || others);
  };

  const hasLists = collect(page.wikitext, 0);
  if (!hasLists) {
    // Region ist selbst ein Ort → Ort + "Go next"-Ziele
    const goNext = getSection(page.wikitext, ['Go next']);
    raws.push({ title: page.title, description: '', kind: 'city', rank: 0, depth: 0 });
    if (goNext) parseDestinationList(goNext).forEach((d, i) => raws.push({ ...d, kind: 'city', rank: i, depth: 1 }));
  }

  // Zu wenige Kandidaten → Unterregionen einbeziehen
  if (raws.length < Math.max(12, wanted * 2.5)) {
    const regions = parseRegionTitles(getSection(page.wikitext, ['Regions']) ?? '').slice(0, 14);
    const pages = await Promise.all(regions.map((t) => getWikivoyagePage(t).catch(() => null)));
    for (const p of pages) if (p) collect(p.wikitext, 1);
  }

  // Duplikate entfernen
  const seen = new Set<string>();
  const unique = raws.filter((r) => {
    const key = r.wikidata ?? r.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Fehlende Koordinaten nachladen
  const missing = unique.filter((r) => r.lat == null || r.lon == null).map((r) => r.title);
  if (missing.length) {
    const coords = await getWikivoyageCoordinates(missing).catch(() => ({}) as Record<string, { lat: number; lon: number }>);
    for (const r of unique) {
      const c = coords[r.title];
      if (c && (r.lat == null || r.lon == null)) {
        r.lat = c.lat;
        r.lon = c.lon;
      }
    }
  }

  const candidates: Candidate[] = unique
    .filter((r) => r.lat != null && r.lon != null)
    .filter((r) => inRegion(region, { lat: r.lat!, lon: r.lon! }))
    .map((r) => {
      const tags = tagsFor(r.kind, `${r.title} ${r.description}`);
      return {
        id: `wv:${r.title}`,
        name: r.title,
        kind: r.kind,
        description: r.description,
        wvTitle: r.title,
        wikidata: r.wikidata,
        lat: r.lat!,
        lon: r.lon!,
        tags,
        rank: r.rank,
        depth: r.depth,
        score: scoreCandidate({ kind: r.kind, tags, rank: r.rank, depth: r.depth }, interests),
      };
    });

  // Zusätzliche Kandidaten aus Wikidata: Nationalparks und UNESCO-Welterbe der Region
  if (region.wikidata) {
    const big = region.bbox ? region.bbox[2] - region.bbox[0] > 5 || region.bbox[3] - region.bbox[1] > 5 : false;
    const scope = region.type ? (region.type === 'country' ? 'country' : 'admin') : big ? 'country' : 'admin';
    const extra = await getWikidataHighlights(region.wikidata, scope).catch(() => [] as WikidataHighlight[]);
    const added = wikidataCandidates(extra, candidates, region, interests);
    // Bekanntheit über die Aufrufe des englischen Wikipedia-Artikels (Sprachversionen sind durch Bots verzerrt)
    const wpViews = await getPageviews(
      'en.wikipedia.org',
      added.map((c) => c.enTitle ?? '').filter(Boolean),
    ).catch(() => ({}) as Record<string, number>);
    for (const c of added) if (c.enTitle && wpViews[c.enTitle] != null) c.wikiViews = wpViews[c.enTitle];
    candidates.push(...added);
  }

  // Beliebtheit bei Reisenden (Aufrufe der Wikivoyage-Artikel) als Qualitätsmerkmal
  if (candidates.length) {
    const views = await getPageviews(
      'en.wikivoyage.org',
      candidates.map((c) => c.wvTitle!),
    ).catch(() => ({}) as Record<string, number>);
    applyPopularity(candidates, views);
  }

  if (candidates.length === 0) warnings.push('Keine Ziele mit Koordinaten gefunden – füge Stops manuell hinzu.');
  return { candidates, wikivoyageTitle: page.title, warnings };
}

/**
 * Bonus von bis zu +3 Punkten je nach Beliebtheit – logarithmisch und relativ zum
 * beliebtesten Ziel der Region (sonst hätten kleine Regionen nie bekannte Orte).
 */
export function popularityBonus(views: number | undefined, maxViews: number): number {
  if (!views || maxViews <= 0) return 0;
  return (3 * Math.log10(1 + views)) / Math.log10(1 + maxViews);
}

const CORE_STOP = /^(national|nationalpark|park|nasjonalpark|parco|nazionale|parque|parc|the|und|and|der|die|das)$/;
/** Teilen zwei Namen ein markantes Wort (ohne "Nationalpark" usw.)? */
export function sameCoreName(a: string, b: string): boolean {
  const words = (s: string) =>
    s
      .toLowerCase()
      .split(/[^a-zäöüåæøéèàìòù]+/)
      .filter((w) => w.length >= 5 && !CORE_STOP.test(w));
  const wa = new Set(words(a));
  return words(b).some((w) => wa.has(w));
}

const NATURE_NAME =
  /fjord|national|park|natur|mountain|gebirge|glacier|gletscher|island|insel|coast|küste|valley|\btal\b|\bval\b|lake|\bsee\b|wald|forest|dolomit|alpen|schären|archipel|felsen|landschaft/i;

/** Nationalparks/UNESCO-Welterbe als zusätzliche Kandidaten – ohne Dubletten zu Wikivoyage-Zielen. */
export function wikidataCandidates(
  extra: WikidataHighlight[],
  existing: Candidate[],
  region: Region,
  interests: Interest[],
): Candidate[] {
  const out: Candidate[] = [];
  for (const h of extra) {
    if (!inRegion(region, h)) continue;
    const dup = [...existing, ...out].some(
      (c) =>
        (c.wikidata && c.wikidata === h.qid) ||
        (!!h.wvTitle && c.wvTitle === h.wvTitle) ||
        haversineKm(c, h) < 8 ||
        // gleicher Kernname ("Dovrefjell" ↔ "Dovrefjell-Sunndalsfjella-Nationalpark") im Umkreis von 60 km
        (haversineKm(c, h) < 60 && sameCoreName(c.name, h.label)),
    );
    if (dup) continue;
    const nature = h.nationalPark || NATURE_NAME.test(h.label);
    const kind: StopKind = nature ? 'nature' : 'city';
    const tags: Interest[] = h.nationalPark ? ['nature', 'hiking'] : nature ? ['nature', 'culture'] : ['culture'];
    out.push({
      id: `wd:${h.qid}`,
      name: h.label,
      kind,
      description: h.nationalPark ? 'Nationalpark' : 'UNESCO-Welterbe',
      wvTitle: h.wvTitle,
      wikidata: h.qid,
      lat: h.lat,
      lon: h.lon,
      tags,
      rank: 99,
      depth: 1,
      sitelinks: h.sitelinks,
      enTitle: h.enTitle,
      notes: [`Zusätzlich aus Wikidata: ${h.nationalPark ? 'Nationalpark' : 'UNESCO-Welterbe'}`],
      score: scoreCandidate({ kind, tags, rank: 99, depth: 1 }, interests),
    });
  }
  return out;
}

/** Wikipedia hat grob 15× so viele Aufrufe wie Wikivoyage – zum Vergleichen umrechnen */
const WP_TO_WV = 15;

export function applyPopularity(candidates: Candidate[], views: Record<string, number>): void {
  const viewsOf = (c: Candidate) => views[c.wvTitle ?? c.name] ?? (c.wikiViews != null ? c.wikiViews / WP_TO_WV : undefined);
  const max = Math.max(0, ...candidates.map((c) => viewsOf(c) ?? 0));
  for (const c of candidates) {
    const fromWv = views[c.wvTitle ?? c.name];
    if (fromWv == null && c.wikiViews != null) {
      c.popBonus = popularityBonus(c.wikiViews / WP_TO_WV, max);
      c.score = Math.round((c.score + c.popBonus) * 10) / 10;
      continue;
    }
    const v = fromWv;
    if (v == null && c.sitelinks) {
      // ohne Wikivoyage-Artikel: Bekanntheit über die Zahl der Wikipedia-Sprachversionen (max. +2)
      c.popBonus = Math.min(2, (3 * Math.log10(1 + c.sitelinks)) / Math.log10(151));
      c.score = Math.round((c.score + c.popBonus) * 10) / 10;
      continue;
    }
    if (v == null) continue;
    c.views = v;
    c.popBonus = popularityBonus(v, max);
    c.score = Math.round((c.score + c.popBonus) * 10) / 10;
  }
}

/** Gesamtbewertung aus allen Bausteinen neu berechnen (nach Verfeinerung durch Interessen/Jahreszeit). */
export function rescoreCandidate(c: Candidate, interests: Interest[]): number {
  const base = scoreCandidate(
    { kind: c.kind, tags: c.tags, rank: c.rank ?? 5, depth: c.depth ?? 1, strengths: c.strengths },
    interests,
  );
  c.score = Math.round((base + (c.popBonus ?? 0) + (c.seasonDelta ?? 0)) * 10) / 10;
  return c.score;
}

/** Grobe Prüfung, ob ein Punkt in der Region liegt (Bounding-Box mit etwas Puffer). */
function inRegion(region: Region, p: { lat: number; lon: number }): boolean {
  if (!region.bbox) return haversineKm(region.center, p) < 1500;
  const [w, s, e, n] = region.bbox;
  const padLat = Math.max(0.3, (n - s) * 0.1);
  const padLon = Math.max(0.3, (e - w) * 0.1);
  if (w > e) {
    // über die Datumsgrenze
    return p.lat >= s - padLat && p.lat <= n + padLat && (p.lon >= w - padLon || p.lon <= e + padLon);
  }
  return p.lat >= s - padLat && p.lat <= n + padLat && p.lon >= w - padLon && p.lon <= e + padLon;
}
