import type { GeoPoint } from '../types';
import {
  findWikivoyageTitle,
  getNearbyWikipedia,
  getPageviews,
  getSitelinks,
  getWikivoyagePage,
  type NearbyArticle,
} from '../api/wiki';
import { parseSightListings, type ParsedSight } from '../lib/wikitext';
import { haversineKm } from '../lib/geo';

/* ---------------- Wikivoyage: Sehenswürdigkeiten & Aktivitäten ---------------- */

export interface Sight extends ParsedSight {
  id: string;
  distanceKm?: number;
  /** Aufrufe des zugehörigen Wikipedia-Artikels (60 Tage) – Bekanntheit */
  views?: number;
  score: number;
}

/**
 * Wikivoyage listet Einträge nach Stadtvierteln, nicht nach Bedeutung.
 * Qualität: Bekanntheit (Wikipedia-Aufrufe über den Wikidata-Verweis) zählt am meisten,
 * dazu Bild, ausführliche Beschreibung und Koordinaten.
 * `views` ist nach Wikidata-ID geschlüsselt.
 */
export function rankSights(items: ParsedSight[], center: GeoPoint, views: Record<string, number> = {}): Sight[] {
  return items
    .map((s, i) => {
      const hasPos = s.lat != null && s.lon != null;
      const distanceKm = hasPos ? haversineKm(center, { lat: s.lat!, lon: s.lon! }) : undefined;
      const v = s.wikidata ? views[s.wikidata] : undefined;
      const score =
        (v != null ? 1.2 * Math.log10(1 + v) : 0) +
        (s.wikidata ? 2 : 0) +
        (s.wikipedia ? 0.5 : 0) +
        (s.image ? 0.5 : 0) +
        Math.min(1.5, (s.description?.length ?? 0) / 200) +
        (hasPos ? 0.3 : 0) +
        (s.url ? 0.2 : 0) -
        i * 0.01; // bei Gleichstand Reihenfolge des Artikels
      return { ...s, id: `wv-${s.kind}-${i}`, distanceKm, views: v, score };
    })
    .sort((a, b) => b.score - a.score);
}

/** Einstufung der Bekanntheit für die Anzeige (keine Bewertung!) */
export function fameLabel(views?: number): string | null {
  if (views == null) return null;
  if (views >= 10000) return 'sehr bekannt';
  if (views >= 2000) return 'bekannt';
  return null;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);

/**
 * Passt der Wikipedia-Titel zum Namen des Eintrags? Wikivoyage verweist gelegentlich auf
 * falsche Wikidata-Einträge (z. B. eine Galerie auf ihren Besitzer) – dann zählen die Aufrufe nicht.
 */
export function titleMatches(listingName: string, wikiTitle: string): boolean {
  const a = new Set(words(listingName));
  const b = words(wikiTitle);
  if (a.size === 0 || b.length === 0) return false;
  return b.some((w) => a.has(w) || [...a].some((x) => x.startsWith(w) || w.startsWith(x)));
}

/* ---------------- Wikipedia: was ist in der Nähe sehenswert? ---------------- */

/** Was Reisende interessiert (Beschreibung des Wikipedia-Artikels) */
const INTERESTING =
  /museum|denkmal|monument|kirche|dom\b|kathedrale|kapelle|kloster|abtei|burg|schloss|festung|ruine|palast|park\b|garten|see\b|stausee|berg|gipfel|massiv|gebirge|wasserfall|brücke|turm|leuchtturm|platz|altstadt|skulptur|statue|aussicht|gletscher|insel|fjord|nationalpark|naturschutz|naturdenkmal|höhle|strand|bucht|schlucht|tal\b|bauwerk|gebäude|theater|oper|konzert|markt|hafen|welterbe|unesco|stabkirche|zoo|aquarium|galerie|kunsthalle|archäolog|ausgrabung|therme|rathaus|tor\b|mühle|pass\b|halbinsel|landschaft|wanderweg|straße\b.*panorama|aussichtspunkt/i;

/** Was eher nicht (Organisationen, Verwaltung, Verkehr, Personen …) */
const BORING =
  /zeitung|universität|hochschule|schule|gymnasium|unternehmen|verein|stiftung|partei|fußball|sportverein|bahnhof|haltepunkt|haltestelle|flughafen|gemeinde|ortsteil|stadtteil|ortschaft|dorf|wahlkreis|bezirk|kommune|tettsted|bebaute fläche|kraftwerk|umspannwerk|krankenhaus|gefängnis|behörde|botschaft|bistum|pfarrei|friedhof|siedlung|weiler|straße in|autobahn|tunnel|rundfunk|sender|band\b|rapper|politiker|schauspieler|unternehmer|sänger/i;

export interface NearbyPlace extends NearbyArticle {
  distanceKm: number;
}

export function pickNearby(articles: NearbyArticle[], center: GeoPoint, limit = 12): NearbyPlace[] {
  return articles
    .filter((a) => {
      const d = a.description ?? '';
      if (BORING.test(d) || BORING.test(a.title)) return false;
      return INTERESTING.test(d) || INTERESTING.test(a.title);
    })
    .map((a) => ({ ...a, distanceKm: haversineKm(center, a) }))
    // Beliebtheit (Aufrufe) vor Artikellänge, Bild und Nähe
    .sort((a, b) => nearbyScore(b) - nearbyScore(a))
    .slice(0, limit);
}

function nearbyScore(a: NearbyArticle & { distanceKm: number }): number {
  return (
    1.5 * Math.log10(1 + (a.views ?? 0)) +
    0.3 * Math.log10(1 + a.length) +
    (a.thumbnail ? 0.5 : 0) -
    a.distanceKm * 0.05
  );
}

/** Bekanntheit der Sehenswürdigkeiten: Wikidata → Wikipedia-Titel → Aufrufe (nach Wikidata-ID) */
async function sightViews(items: ParsedSight[]): Promise<Record<string, number>> {
  const qids = [...new Set(items.map((s) => s.wikidata).filter((q): q is string => !!q && /^Q\d+$/.test(q)))].slice(0, 100);
  if (qids.length === 0) return {};
  try {
    const links = await getSitelinks(qids);
    const names: Record<string, string[]> = {};
    for (const s of items) if (s.wikidata) (names[s.wikidata] ??= []).push(s.name, s.wikipedia ?? '');
    const plausible = (q: string, title: string) => names[q]?.some((n) => n && titleMatches(n, title));
    const en: Record<string, string> = {};
    const de: Record<string, string> = {};
    for (const q of qids) {
      const l = links[q];
      if (l?.enwiki && plausible(q, l.enwiki)) en[l.enwiki] = q;
      else if (l?.dewiki && plausible(q, l.dewiki)) de[l.dewiki] = q;
    }
    const [enViews, deViews] = await Promise.all([
      getPageviews('en.wikipedia.org', Object.keys(en)),
      getPageviews('de.wikipedia.org', Object.keys(de)),
    ]);
    const out: Record<string, number> = {};
    for (const [t, v] of Object.entries(enViews)) out[en[t]] = v;
    // deutsche Wikipedia hat ~1/4 der Aufrufe der englischen – grob angleichen
    for (const [t, v] of Object.entries(deViews)) out[de[t]] = v * 4;
    return out;
  } catch {
    return {};
  }
}

/* ---------------- Alles für einen Stop laden ---------------- */

export interface DiscoverData {
  sights: Sight[];
  nearby: NearbyPlace[];
  nearbyError?: string;
  wikivoyageDeUrl?: string;
}

export async function loadDiscover(
  place: GeoPoint & { name: string; wvTitle?: string; wikidata?: string },
): Promise<DiscoverData> {
  const sightsP = (async () => {
    const title = place.wvTitle ?? (await findWikivoyageTitle(place.name, place).catch(() => null));
    const page = title ? await getWikivoyagePage(title).catch(() => null) : null;
    if (!page) return [];
    const items = parseSightListings(page.wikitext);
    return rankSights(items, place, await sightViews(items));
  })();
  const nearbyP = getNearbyWikipedia(place).then(
    (a) => ({ nearby: pickNearby(a, place) }),
    (e: Error) => ({ nearby: [] as NearbyPlace[], nearbyError: e.message }),
  );
  const deP = place.wikidata
    ? getSitelinks([place.wikidata])
        .then((sl) => sl[place.wikidata!]?.dewikivoyage)
        .catch(() => undefined)
    : Promise.resolve(undefined);

  const [sights, near, deTitle] = await Promise.all([sightsP, nearbyP, deP]);
  return {
    sights,
    ...near,
    wikivoyageDeUrl: deTitle ? `https://de.wikivoyage.org/wiki/${encodeURIComponent(deTitle.replace(/ /g, '_'))}` : undefined,
  };
}
