/**
 * Kleiner Parser für Wikivoyage-Wikitext: Abschnitte, Vorlagen ({{marker}}, {{see}}, {{sleep}} …)
 * und Ziel-Listen ("Cities", "Other destinations").
 */

export interface Template {
  name: string;
  params: Record<string, string>;
  /** Position im Text */
  start: number;
  end: number;
}

/** Inhalt eines Abschnitts der Ebene 2 (== Name ==) bis zum nächsten Ebene-2-Abschnitt. */
export function getSection(wikitext: string, names: string[]): string | null {
  const lines = wikitext.split('\n');
  const wanted = names.map((n) => n.toLowerCase());
  let collecting = false;
  const out: string[] = [];
  for (const line of lines) {
    const m = /^==\s*([^=].*?)\s*==\s*$/.exec(line);
    if (m) {
      if (collecting) break;
      if (wanted.includes(m[1].toLowerCase())) {
        collecting = true;
        continue;
      }
    }
    if (collecting) out.push(line);
  }
  return collecting ? out.join('\n') : null;
}

/** Findet alle Vorlagen auf oberster Ebene im Text, optional gefiltert nach Namen. */
export function parseTemplates(text: string, names?: string[]): Template[] {
  const wanted = names?.map((n) => n.toLowerCase());
  const result: Template[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{{', i);
    if (open === -1) break;
    const close = findTemplateEnd(text, open);
    if (close === -1) break;
    const inner = text.slice(open + 2, close);
    const parts = splitParams(inner);
    const name = (parts[0] ?? '').trim().toLowerCase();
    if (!wanted || wanted.includes(name)) {
      const params: Record<string, string> = {};
      let positional = 1;
      for (const part of parts.slice(1)) {
        const eq = indexOfTopLevelEquals(part);
        if (eq === -1) {
          params[String(positional++)] = part.trim();
        } else {
          params[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
        }
      }
      result.push({ name, params, start: open, end: close + 2 });
    }
    i = close + 2;
  }
  return result;
}

function findTemplateEnd(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length - 1; i++) {
    if (text[i] === '{' && text[i + 1] === '{') {
      depth++;
      i++;
    } else if (text[i] === '}' && text[i + 1] === '}') {
      depth--;
      if (depth === 0) return i;
      i++;
    }
  }
  return -1;
}

function splitParams(inner: string): string[] {
  const parts: string[] = [];
  let tpl = 0;
  let link = 0;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const two = inner.slice(i, i + 2);
    if (two === '{{') {
      tpl++;
      cur += two;
      i++;
    } else if (two === '}}') {
      tpl--;
      cur += two;
      i++;
    } else if (two === '[[') {
      link++;
      cur += two;
      i++;
    } else if (two === ']]') {
      link--;
      cur += two;
      i++;
    } else if (inner[i] === '|' && tpl === 0 && link === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += inner[i];
    }
  }
  parts.push(cur);
  return parts;
}

function indexOfTopLevelEquals(part: string): number {
  let depth = 0;
  for (let i = 0; i < part.length; i++) {
    const two = part.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      depth++;
      i++;
    } else if (two === '}}' || two === ']]') {
      depth--;
      i++;
    } else if (part[i] === '=' && depth === 0) {
      return i;
    }
  }
  return -1;
}

/** Entfernt Wiki-Markup und liefert lesbaren Text. */
export function stripMarkup(s: string): string {
  let t = s;
  t = t.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[\s\S]*?<\/ref>/gi, '');
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  // Vorlagen entfernen (von innen nach außen)
  for (let k = 0; k < 5 && t.includes('{{'); k++) t = t.replace(/\{\{[^{}]*\}\}/g, '');
  t = t.replace(/\[\[(?:File|Image|Datei):[^\]]*\]\]/gi, '');
  t = t.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2');
  t = t.replace(/\[\[([^\]]*)\]\]/g, '$1');
  t = t.replace(/\[https?:\/\/\S+\s([^\]]+)\]/g, '$1');
  t = t.replace(/\[https?:\/\/\S+\]/g, '');
  t = t.replace(/'''?/g, '');
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&amp;/g, '&');
  return t.replace(/\s+/g, ' ').trim();
}

/** Erster interner Link [[Titel|Text]] → Titel */
export function firstLinkTitle(s: string): string | null {
  const m = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/.exec(s);
  return m ? m[1].trim() : null;
}

export interface DestinationItem {
  title: string;
  lat?: number;
  lon?: number;
  wikidata?: string;
  description: string;
}

/** Liest die Aufzählung eines "Cities"- oder "Other destinations"-Abschnitts. */
export function parseDestinationList(section: string): DestinationItem[] {
  const items: DestinationItem[] = [];
  for (const raw of section.split('\n')) {
    const line = raw.trim();
    if (!/^\*+/.test(line)) continue;
    const body = line.replace(/^\*+\s*/, '');
    const [marker] = parseTemplates(body, ['marker', 'listing', 'go', 'city', 'vicinity']);
    let title: string | null = null;
    let lat: number | undefined;
    let lon: number | undefined;
    let wikidata: string | undefined;
    let rest = body;
    if (marker) {
      title = firstLinkTitle(marker.params.name ?? '') ?? (stripMarkup(marker.params.name ?? '') || null);
      lat = num(marker.params.lat);
      lon = num(marker.params.long ?? marker.params.lon);
      wikidata = marker.params.wikidata || undefined;
      rest = body.slice(0, marker.start) + body.slice(marker.end);
    } else {
      title = firstLinkTitle(body);
      if (title) rest = body.replace(/\[\[[^\]]*\]\]/, '');
    }
    if (!title) continue;
    const description = stripMarkup(rest).replace(/^[\s–—\-:,]+/, '');
    items.push({ title, lat, lon, wikidata, description });
  }
  return items;
}

/** Unterregionen aus dem "Regions"-Abschnitt. */
export function parseRegionTitles(section: string): string[] {
  const titles = new Set<string>();
  for (const t of parseTemplates(section, ['mapshape', 'regionlist'])) {
    for (const [k, v] of Object.entries(t.params)) {
      if (k === 'title' || /^region\d+name$/.test(k)) {
        const title = firstLinkTitle(v);
        if (title) titles.add(title);
      }
    }
  }
  for (const raw of section.split('\n')) {
    if (/^\*/.test(raw.trim())) {
      const title = firstLinkTitle(raw);
      if (title) titles.add(title);
    }
  }
  return [...titles];
}

function num(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

export interface ListingCounts {
  see: number;
  do: number;
}

/** Zählt Sehenswürdigkeiten und Aktivitäten (Vorlagen in den Abschnitten See/Do). */
export function countListings(wikitext: string): ListingCounts {
  const see = getSection(wikitext, ['See']) ?? '';
  const doSec = getSection(wikitext, ['Do']) ?? '';
  const countIn = (s: string) => parseTemplates(s, ['see', 'do', 'listing', 'marker', 'vcard']).length;
  return { see: countIn(see), do: countIn(doSec) };
}

export interface ParsedSight {
  kind: 'see' | 'do';
  name: string;
  description?: string;
  url?: string;
  hours?: string;
  price?: string;
  address?: string;
  lat?: number;
  lon?: number;
  wikidata?: string;
  wikipedia?: string;
  image?: string;
}

/** Sehenswürdigkeiten ("See") und Aktivitäten ("Do") eines Wikivoyage-Artikels. */
export function parseSightListings(wikitext: string): ParsedSight[] {
  const out: ParsedSight[] = [];
  for (const [section, kind] of [
    ['See', 'see'],
    ['Do', 'do'],
  ] as const) {
    const text = getSection(wikitext, [section]);
    if (!text) continue;
    for (const t of parseTemplates(text, ['see', 'do', 'listing', 'marker', 'vcard'])) {
      const name = stripMarkup(t.params.name ?? '');
      if (!name) continue;
      const url = (t.params.url ?? '').trim();
      out.push({
        kind,
        name,
        description: stripMarkup(t.params.content ?? '') || undefined,
        url: /^https?:\/\//.test(url) ? url : undefined,
        hours: stripMarkup(t.params.hours ?? '') || undefined,
        price: stripMarkup(t.params.price ?? '') || undefined,
        address: stripMarkup(t.params.address ?? '') || undefined,
        lat: num(t.params.lat),
        lon: num(t.params.long ?? t.params.lon),
        wikidata: t.params.wikidata || undefined,
        wikipedia: t.params.wikipedia || undefined,
        image: t.params.image || undefined,
      });
    }
  }
  return out;
}

export interface ParsedSleep {
  name: string;
  category?: 'budget' | 'mid' | 'splurge' | 'camping';
  price?: string;
  url?: string;
  description?: string;
  address?: string;
  lat?: number;
  lon?: number;
}

/** Unterkünfte aus dem Abschnitt "Sleep" inkl. Preiskategorie (Budget/Mid-range/Splurge). */
export function parseSleepListings(wikitext: string): ParsedSleep[] {
  const section = getSection(wikitext, ['Sleep']);
  if (!section) return [];
  const out: ParsedSleep[] = [];
  let category: ParsedSleep['category'];
  let offset = 0;
  const lines = section.split('\n');
  // Kategorie je Position bestimmen
  const catAt: { pos: number; cat: ParsedSleep['category'] }[] = [];
  for (const line of lines) {
    const m = /^===+\s*(.*?)\s*===+\s*$/.exec(line);
    if (m) {
      const h = m[1].toLowerCase();
      category = /budget|cheap|hostel/.test(h)
        ? 'budget'
        : /mid/.test(h)
          ? 'mid'
          : /splurge|luxury|upscale|expensive/.test(h)
            ? 'splurge'
            : /camp/.test(h)
              ? 'camping'
              : undefined;
      catAt.push({ pos: offset, cat: category });
    }
    offset += line.length + 1;
  }
  for (const t of parseTemplates(section, ['sleep', 'listing', 'vcard'])) {
    const name = stripMarkup(t.params.name ?? '');
    if (!name) continue;
    let cat: ParsedSleep['category'];
    for (const c of catAt) if (c.pos <= t.start) cat = c.cat;
    const text = `${name} ${t.params.content ?? ''}`.toLowerCase();
    if (!cat && /camp/.test(text)) cat = 'camping';
    const url = (t.params.url ?? '').trim();
    out.push({
      name,
      category: cat,
      price: stripMarkup(t.params.price ?? '') || undefined,
      url: /^https?:\/\//.test(url) ? url : undefined,
      description: stripMarkup(t.params.content ?? '') || undefined,
      address: stripMarkup(t.params.address ?? '') || undefined,
      lat: num(t.params.lat),
      lon: num(t.params.long ?? t.params.lon),
    });
  }
  return out;
}
