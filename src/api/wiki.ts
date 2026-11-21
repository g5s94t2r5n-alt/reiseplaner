import type { GeoPoint } from '../types';
import { cached, createLimiter, DAY, fetchJson } from './http';

const wikiLimit = createLimiter(100, 4);

/* ---------------- Wikidata ---------------- */

export interface Sitelinks {
  enwikivoyage?: string;
  dewikivoyage?: string;
  dewiki?: string;
  enwiki?: string;
}

export async function getSitelinks(ids: string[]): Promise<Record<string, Sitelinks>> {
  const out: Record<string, Sitelinks> = {};
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const url =
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${chunk.join('|')}` +
      `&props=sitelinks&sitefilter=enwikivoyage|dewikivoyage|dewiki|enwiki&format=json&origin=*`;
    const data = await cached(`wd-sl:${chunk.join('|')}`, 30 * DAY, () =>
      wikiLimit(() =>
        fetchJson<{ entities: Record<string, { sitelinks?: Record<string, { title: string }> }> }>(url),
      ),
    );
    for (const [id, ent] of Object.entries(data.entities ?? {})) {
      const sl = ent.sitelinks ?? {};
      out[id] = {
        enwikivoyage: sl.enwikivoyage?.title,
        dewikivoyage: sl.dewikivoyage?.title,
        dewiki: sl.dewiki?.title,
        enwiki: sl.enwiki?.title,
      };
    }
  }
  return out;
}

/* ---------------- Wikivoyage (englisch – am vollständigsten und einheitlich strukturiert) ---------------- */

const WV = 'https://en.wikivoyage.org/w/api.php';

export interface WikiPage {
  title: string;
  wikitext: string;
}

export async function getWikivoyagePage(title: string): Promise<WikiPage | null> {
  const url = `${WV}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&redirects=1&format=json&formatversion=2&origin=*`;
  return cached(`wv-page:${title}`, 14 * DAY, async () => {
    const data = await wikiLimit(() =>
      fetchJson<{ parse?: { title: string; wikitext: string }; error?: unknown }>(url),
    );
    if (!data.parse) return null;
    return { title: data.parse.title, wikitext: data.parse.wikitext };
  });
}

/** Koordinaten für mehrere Wikivoyage-Seiten (Titel → Punkt). */
export async function getWikivoyageCoordinates(titles: string[]): Promise<Record<string, GeoPoint>> {
  const out: Record<string, GeoPoint> = {};
  const unique = [...new Set(titles)];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const url = `${WV}?action=query&prop=coordinates&titles=${encodeURIComponent(chunk.join('|'))}&redirects=1&format=json&formatversion=2&origin=*`;
    const data = await cached(`wv-coords:${chunk.join('|')}`, 30 * DAY, () =>
      wikiLimit(() =>
        fetchJson<{
          query?: {
            pages?: { title: string; coordinates?: { lat: number; lon: number }[] }[];
            redirects?: { from: string; to: string }[];
            normalized?: { from: string; to: string }[];
          };
        }>(url),
      ),
    );
    const q = data.query ?? {};
    const byTitle: Record<string, GeoPoint> = {};
    for (const p of q.pages ?? []) {
      const c = p.coordinates?.[0];
      if (c) byTitle[p.title] = { lat: c.lat, lon: c.lon };
    }
    const resolve = (t: string) => {
      let cur = t;
      for (const n of q.normalized ?? []) if (n.from === cur) cur = n.to;
      for (const r of q.redirects ?? []) if (r.from === cur) cur = r.to;
      return cur;
    };
    for (const t of chunk) {
      const p = byTitle[resolve(t)];
      if (p) out[t] = p;
    }
  }
  return out;
}

/** Sucht einen Wikivoyage-Artikel per Name, optional nahe an einem Punkt. */
export async function findWikivoyageTitle(name: string, near?: GeoPoint): Promise<string | null> {
  const url = `${WV}?action=query&list=search&srsearch=${encodeURIComponent(name)}&srlimit=5&srnamespace=0&format=json&formatversion=2&origin=*`;
  const data = await cached(`wv-search:${name}`, 14 * DAY, () =>
    wikiLimit(() => fetchJson<{ query?: { search?: { title: string }[] } }>(url)),
  );
  const titles = (data.query?.search ?? []).map((s) => s.title);
  if (titles.length === 0) return null;
  if (!near) return titles[0];
  const coords = await getWikivoyageCoordinates(titles);
  for (const t of titles) {
    const c = coords[t];
    if (c && Math.abs(c.lat - near.lat) < 0.4 && Math.abs(c.lon - near.lon) < 0.6) return t;
  }
  return null;
}

export function wikivoyageUrl(title: string): string {
  return `https://en.wikivoyage.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/* ---------------- Wikidata: Ortsart (Nationalpark, Fjord, Großstadt …) ---------------- */

/**
 * Für welche der Klassen `classIds` ist ein Ort eine Instanz (auch über Unterklassen)?
 * Zusätzlich UNESCO-Welterbe über die Denkmal-Eigenschaft (P1435). Ergebnis: QID → Klassen-QIDs.
 */
export async function getWikidataClasses(qids: string[], classIds: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const unique = [...new Set(qids.filter((q) => /^Q\d+$/.test(q)))];
  for (let i = 0; i < unique.length; i += 80) {
    const chunk = unique.slice(i, i + 80);
    const query =
      `SELECT ?item ?cls WHERE { VALUES ?item { ${chunk.map((q) => `wd:${q}`).join(' ')} } ` +
      `{ VALUES ?cls { ${classIds.map((q) => `wd:${q}`).join(' ')} } ?item wdt:P31/wdt:P279* ?cls . } ` +
      `UNION { ?item wdt:P1435 wd:Q9259 . BIND(wd:Q9259 AS ?cls) } }`;
    const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
    const data = await cached(`wd-cls:${chunk.join(',')}:${classIds.length}`, 30 * DAY, () =>
      wikiLimit(() =>
        fetchJson<{ results: { bindings: { item: { value: string }; cls: { value: string } }[] } }>(
          url,
          { headers: { Accept: 'application/sparql-results+json' } },
          40000,
        ),
      ),
    );
    for (const b of data.results.bindings) {
      const q = b.item.value.split('/').pop()!;
      const c = b.cls.value.split('/').pop()!;
      (out[q] ??= []).includes(c) || out[q].push(c);
    }
  }
  return out;
}

/* ---------------- Beliebtheit: Aufrufzahlen (Ersatz für Bewertungen) ---------------- */

export type WikiSite = 'en.wikivoyage.org' | 'en.wikipedia.org' | 'de.wikipedia.org';

/**
 * Summe der Seitenaufrufe der letzten `days` Tage (max. 60) je Titel – wie viele Menschen
 * sich für einen Ort interessieren. Bis zu 50 Titel pro Anfrage, Weiterleitungen werden aufgelöst.
 */
export async function getPageviews(site: WikiSite, titles: string[], days = 60): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const unique = [...new Set(titles.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const res = await cached(`pv:${site}:${days}:${chunk.join('|')}`, 7 * DAY, async () => {
      const views: Record<string, number> = {};
      const map: Record<string, string> = {};
      let cont: Record<string, string> = {};
      for (let guard = 0; guard < 10; guard++) {
        const params = new URLSearchParams({
          action: 'query',
          prop: 'pageviews',
          pvipdays: String(days),
          titles: chunk.join('|'),
          redirects: '1',
          format: 'json',
          formatversion: '2',
          origin: '*',
          ...cont,
        });
        const d = await wikiLimit(() =>
          fetchJson<{
            continue?: Record<string, string>;
            query?: {
              pages?: { title: string; pageviews?: Record<string, number | null> }[];
              normalized?: { from: string; to: string }[];
              redirects?: { from: string; to: string }[];
            };
          }>(`https://${site}/w/api.php?${params}`),
        );
        for (const n of d.query?.normalized ?? []) map[n.from] = n.to;
        for (const r of d.query?.redirects ?? []) map[r.from] = r.to;
        for (const p of d.query?.pages ?? []) {
          if (p.pageviews) views[p.title] = Object.values(p.pageviews).reduce<number>((a, b) => a + (b ?? 0), 0);
        }
        if (!d.continue) break;
        cont = d.continue;
      }
      const resolved: Record<string, number> = {};
      for (const t of chunk) {
        let cur = t;
        for (let k = 0; k < 3 && map[cur]; k++) cur = map[cur];
        if (views[cur] != null) resolved[t] = views[cur];
      }
      return resolved;
    });
    Object.assign(out, res);
  }
  return out;
}

/* ---------------- Wikipedia: Artikel in der Nähe (deutsch) ---------------- */

export interface NearbyArticle {
  title: string;
  description?: string;
  lat: number;
  lon: number;
  /** Artikellänge in Bytes – grobes Maß für Bedeutung */
  length: number;
  /** Aufrufe der letzten 30 Tage */
  views?: number;
  thumbnail?: string;
  url: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wikipedia-Artikel mit Koordinaten im Umkreis (max. 10 km).
 * Die Geo-Suche ist manchmal kurz überlastet ("too busy") → bis zu 3 Versuche.
 */
export async function getNearbyWikipedia(p: GeoPoint, radiusM = 10000): Promise<NearbyArticle[]> {
  const lat = p.lat.toFixed(4);
  const lon = p.lon.toFixed(4);
  const url =
    `https://de.wikipedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lat}%7C${lon}` +
    `&ggsradius=${Math.min(10000, radiusM)}&ggslimit=50&prop=coordinates%7Cpageimages%7Cdescription%7Cinfo%7Cpageviews` +
    `&piprop=thumbnail&pithumbsize=240&pvipdays=30&format=json&formatversion=2&origin=*`;
  return cached(`wp-near2:${lat},${lon}:${radiusM}`, 14 * DAY, async () => {
    let lastErr = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(1500 * attempt);
      const d = await wikiLimit(() =>
        fetchJson<{
          error?: { code: string };
          query?: {
            pages?: {
              title: string;
              description?: string;
              length?: number;
              coordinates?: { lat: number; lon: number }[];
              thumbnail?: { source: string };
              pageviews?: Record<string, number | null>;
            }[];
          };
        }>(url),
      );
      if (d.error) {
        lastErr = d.error.code;
        continue;
      }
      return (d.query?.pages ?? [])
        .filter((pg) => pg.coordinates?.[0])
        .map((pg) => ({
          title: pg.title,
          description: pg.description,
          lat: pg.coordinates![0].lat,
          lon: pg.coordinates![0].lon,
          length: pg.length ?? 0,
          views: pg.pageviews ? Object.values(pg.pageviews).reduce<number>((s, v) => s + (v ?? 0), 0) : undefined,
          thumbnail: pg.thumbnail?.source,
          url: `https://de.wikipedia.org/wiki/${encodeURIComponent(pg.title.replace(/ /g, '_'))}`,
        }));
    }
    throw new Error(`Wikipedia ist gerade ausgelastet (${lastErr}). Bitte später erneut versuchen.`);
  });
}

/* ---------------- Wikipedia-Zusammenfassung (deutsch, mit Bild) ---------------- */

export interface Summary {
  text: string;
  image?: string;
  url?: string;
}

export async function getWikipediaSummary(lang: 'de' | 'en', title: string): Promise<Summary | null> {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  return cached(`wp-sum2:${lang}:${title}`, 30 * DAY, async () => {
    try {
      const d = await wikiLimit(() =>
        fetchJson<{
          type?: string;
          title?: string;
          extract?: string;
          thumbnail?: { source: string };
          content_urls?: { desktop?: { page?: string } };
        }>(url),
      );
      if (!d.extract || d.type === 'disambiguation') return null;
      let text = d.extract.trim();
      // Die API lässt bei manchen Artikeln das Subjekt weg ("ist eine Kommune …")
      if (/^[a-zäöü]/.test(text) && d.title) text = `${d.title.replace(/\s*\(.*\)$/, '')} ${text}`;
      // Wappen, Flaggen und Karten (meist SVG) sind keine schönen Vorschaubilder
      const image = d.thumbnail?.source;
      const usable = image && !/\.svg/i.test(image) && !/wappen|coat_of_arms|flag|locator|karte|map/i.test(image);
      return { text, image: usable ? image : undefined, url: d.content_urls?.desktop?.page };
    } catch {
      return null;
    }
  });
}
