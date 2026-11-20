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
