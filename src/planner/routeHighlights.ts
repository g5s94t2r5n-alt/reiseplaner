import type { GeoPoint, Segment } from '../types';
import { getNearbyWikipedia, getPageviews, type NearbyArticle } from '../api/wiki';
import { mapLimit } from '../api/http';
import { cumulativeKm, haversineKm, pointAtFraction } from '../lib/geo';
import { BORING, headOf } from './discover';

/** Was sich für eine Pause unterwegs lohnt (Beschreibung/Titel des Wikipedia-Artikels) */
const ROUTE_INTERESTING =
  /wasserfall|aussicht|panorama|passstraße|\bpass\b|touristen-strecke|landschaftsroute|touristenstraße|stabkirche|hängebrücke|brücke|schlucht|klamm|canyon|gletscher|burg\b|schloss|festung|ruine|kloster|abtei|\bdom\b|kathedrale|leuchtturm|nationalpark|welterbe|unesco|felsformation|felsen|höhle|naturdenkmal|sehenswürdigkeit|altstadt|vulkan|geysir|fjord/i;

/** Bahnanlagen sind für Autofahrer selten ein Pausenziel */
const RAIL = /eisenbahn|jernbane|railway|bahnstrecke|bahnhof/i;

export interface RouteHighlight extends GeoPoint {
  title: string;
  description?: string;
  url: string;
  thumbnail?: string;
  views?: number;
  /** Entfernung zur Strecke (km) */
  offRouteKm: number;
  /** Position entlang der Etappe (0 = Start, 1 = Ziel) */
  fraction: number;
  icon: string;
}

export function iconFor(text: string): string {
  if (/wasserfall/i.test(text)) return '💧';
  if (/pass|strecke|straße|route/i.test(text)) return '🛣️';
  if (/kirche|kloster|abtei|\bdom\b|kathedrale/i.test(text)) return '⛪';
  if (/brücke/i.test(text)) return '🌉';
  if (/burg|schloss|festung|ruine/i.test(text)) return '🏰';
  if (/gletscher/i.test(text)) return '🧊';
  if (/schlucht|klamm|canyon|nationalpark|fjord|höhle/i.test(text)) return '🏞️';
  if (/leuchtturm/i.test(text)) return '🗼';
  if (/aussicht|panorama/i.test(text)) return '👁️';
  return '⭐';
}

/** Abstand eines Punkts zur Linie (km) und Position entlang der Linie (0–1), lokal eben genähert. */
export function distanceToLine(p: GeoPoint, line: [number, number][]): { km: number; fraction: number } {
  if (line.length === 0) return { km: Infinity, fraction: 0 };
  const cum = cumulativeKm(line);
  const total = cum[cum.length - 1] || 1;
  const kx = 111.32 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110.57;
  let best = { km: Infinity, along: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const ax = (line[i][1] - p.lon) * kx;
    const ay = (line[i][0] - p.lat) * ky;
    const bx = (line[i + 1][1] - p.lon) * kx;
    const by = (line[i + 1][0] - p.lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.km) best = { km: d, along: cum[i] + t * (cum[i + 1] - cum[i]) };
  }
  if (line.length === 1) best = { km: haversineKm(p, { lat: line[0][0], lon: line[0][1] }), along: 0 };
  return { km: best.km, fraction: best.along / total };
}

/**
 * Wählt Unterwegs-Highlights aus Wikipedia-Artikeln: sehenswert, höchstens `maxOffKm` von der
 * Strecke, nicht direkt an einem Stop (dort gibt es „Entdecken“), nach Beliebtheit sortiert.
 */
export function pickRouteHighlights(
  articles: NearbyArticle[],
  line: [number, number][],
  avoid: GeoPoint[],
  views: Record<string, number>,
  limit = 3,
  maxOffKm = 5,
  avoidKm = 12,
): RouteHighlight[] {
  const seen = new Set<string>();
  const out: RouteHighlight[] = [];
  for (const a of articles) {
    if (seen.has(a.title)) continue;
    seen.add(a.title);
    const head = headOf(a.description);
    const text = `${a.title} ${head}`;
    if (BORING.test(head) || BORING.test(a.title) || RAIL.test(text) || !ROUTE_INTERESTING.test(text)) continue;
    if (avoid.some((s) => haversineKm(s, a) < avoidKm)) continue;
    const { km, fraction } = distanceToLine(a, line);
    if (km > maxOffKm) continue;
    out.push({
      title: a.title,
      description: a.description,
      url: a.url,
      thumbnail: a.thumbnail,
      lat: a.lat,
      lon: a.lon,
      views: views[a.title] ?? a.views,
      offRouteKm: km,
      fraction,
      icon: iconFor(text),
    });
  }
  const score = (h: RouteHighlight) => Math.log10(1 + (h.views ?? 0)) + (h.thumbnail ? 0.3 : 0) - h.offRouteKm * 0.08;
  return out.sort((x, y) => score(y) - score(x)).slice(0, limit);
}

/** Punkte entlang der Etappe im Abstand `everyKm`, ohne die ersten/letzten `skipKm`. */
export function samplesAlong(line: [number, number][], everyKm = 35, skipKm = 15): GeoPoint[] {
  const cum = cumulativeKm(line);
  const total = cum[cum.length - 1] ?? 0;
  const pts: GeoPoint[] = [];
  for (let d = skipKm; d <= total - skipKm; d += everyKm) pts.push(pointAtFraction(line, d / total));
  return pts;
}

/** Lädt die Highlights für eine Etappe (Wikipedia-Geosuche entlang der Strecke, gecacht). */
export async function loadSegmentHighlights(segment: Segment, avoid: GeoPoint[], limit = 3): Promise<RouteHighlight[]> {
  if (segment.distanceKm < 60 || segment.geometry.length < 2) return [];
  const samples = samplesAlong(segment.geometry);
  const lists = await mapLimit(samples, 3, (p) => getNearbyWikipedia(p).catch(() => [] as NearbyArticle[]));
  const articles = lists.flat();
  // vorfiltern, dann zuverlässige Aufrufzahlen nur für die Kandidaten laden
  const pre = pickRouteHighlights(articles, segment.geometry, avoid, {}, 15);
  const views = await getPageviews(
    'de.wikipedia.org',
    pre.map((h) => h.title),
    30,
  ).catch(() => ({}) as Record<string, number>);
  return pickRouteHighlights(articles, segment.geometry, avoid, views, limit);
}
