import type { Interest, Pace, Place, StopKind, TravelStyle, Trip, TripSettings } from '../types';

/**
 * Trips per Link übertragen (z. B. Mac → Handy): Der Trip wird auf das Nötigste reduziert
 * (Einstellungen, Orte, Nächte), komprimiert und in den Teil der URL nach "#" gepackt.
 * Dieser Teil wird nie an einen Server geschickt. Route, Infos und Unterkünfte baut das
 * Zielgerät selbst neu auf.
 */

/** Adresse der Online-Version – Links, die am lokalen Entwicklungsrechner entstehen, zeigen dorthin. */
export const PUBLIC_URL = 'https://g5s94t2r5n-alt.github.io/reiseplaner/';

type P = [name: string, lat: number, lon: number];
type S = [name: string, lat: number, lon: number, kind: 'c' | 'n' | 'u', nights: number, manual: 0 | 1, wvTitle?: string];

export interface SharedTrip {
  v: 1;
  /** Trip-ID, damit ein erneut geteilter Trip den vorhandenen ersetzen kann */
  i: string;
  n: string;
  r: {
    n: string;
    t: 'N' | 'W' | 'R';
    o: number;
    c?: string;
    b?: [number, number, number, number];
    m: [number, number];
    w?: string;
    wv?: string;
  };
  a: P;
  e: P | null;
  d: string;
  nt: number;
  sy: TravelStyle;
  p: Pace;
  md: number;
  in: Interest[];
  wc?: boolean;
  tr?: number;
  s: S[];
}

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
const r3 = (v: number) => Math.round(v * 1e3) / 1e3;
const KIND_TO: Record<StopKind, S[3]> = { city: 'c', nature: 'n', custom: 'u' };
const KIND_FROM: Record<S[3], StopKind> = { c: 'city', n: 'nature', u: 'custom' };

export function toShared(trip: Trip): SharedTrip {
  const s = trip.settings;
  const place = (p: Place): P => [p.name, r5(p.lat), r5(p.lon)];
  return {
    v: 1,
    i: trip.id,
    n: trip.name,
    r: {
      n: s.region.name,
      t: s.region.osmType,
      o: s.region.osmId,
      c: s.region.countryCode,
      b: s.region.bbox?.map(r3) as SharedTrip['r']['b'],
      m: [r3(s.region.center.lat), r3(s.region.center.lon)],
      w: s.region.wikidata,
      wv: s.region.wikivoyageTitle,
    },
    a: place(s.start),
    e: s.end ? place(s.end) : null,
    d: s.startDate,
    nt: s.nights,
    sy: s.style,
    p: s.pace,
    md: s.maxDriveHours,
    in: s.interests,
    wc: s.wildCamping,
    tr: s.travelers,
    s: trip.stops.map((st) => {
      const row: S = [st.name, r5(st.lat), r5(st.lon), KIND_TO[st.kind], st.nights, st.manualNights ? 1 : 0];
      // Wikivoyage-Titel nur mitschicken, wenn er sich nicht aus dem Namen ergibt
      if (st.wvTitle && (st.wvTitle !== st.name || st.kind === 'custom')) row.push(st.wvTitle);
      return row;
    }),
  };
}

export function settingsFromShared(sh: SharedTrip): TripSettings {
  const place = (p: P): Place => ({ name: p[0], lat: p[1], lon: p[2] });
  return {
    region: {
      name: sh.r.n,
      label: sh.r.n,
      osmType: sh.r.t,
      osmId: sh.r.o,
      countryCode: sh.r.c,
      bbox: sh.r.b,
      center: { lat: sh.r.m[0], lon: sh.r.m[1] },
      wikidata: sh.r.w,
      wikivoyageTitle: sh.r.wv,
    },
    start: place(sh.a),
    end: sh.e ? place(sh.e) : null,
    startDate: sh.d,
    nights: sh.nt,
    style: sh.sy,
    pace: sh.p,
    maxDriveHours: sh.md,
    interests: sh.in,
    wildCamping: sh.wc,
    travelers: sh.tr,
  };
}

export function sharedStops(sh: SharedTrip) {
  return sh.s.map(([name, lat, lon, k, nights, manual, wvTitle]) => ({
    name,
    lat,
    lon,
    kind: KIND_FROM[k],
    nights,
    manualNights: manual === 1,
    wvTitle: wvTitle ?? (k !== 'u' ? name : undefined),
  }));
}

/* ---------------- Kodierung: JSON → deflate → base64url ---------------- */

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function encodeTrip(trip: Trip): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(toShared(trip)));
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeTrip(data: string): Promise<SharedTrip> {
  let parsed: unknown;
  try {
    const bytes = await pipe(fromBase64Url(data), new DecompressionStream('deflate-raw'));
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Der Link ist unvollständig oder beschädigt. Bitte den ganzen Link kopieren bzw. den QR-Code erneut scannen.');
  }
  const sh = parsed as SharedTrip;
  if (!sh || sh.v !== 1 || !Array.isArray(sh.s) || !sh.r || !Array.isArray(sh.a) || typeof sh.d !== 'string') {
    throw new Error('Dieser Link enthält keinen gültigen Trip (evtl. aus einer neueren Version der App).');
  }
  return sh;
}

/** Basisadresse für Links: lokal → Online-Version, sonst die aktuelle Adresse. */
export function shareBase(loc: Pick<Location, 'hostname' | 'origin' | 'pathname'> = location): string {
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(loc.hostname)) return PUBLIC_URL;
  return loc.origin + loc.pathname;
}

export async function shareUrl(trip: Trip, base = shareBase()): Promise<string> {
  return `${base}#/import/${await encodeTrip(trip)}`;
}
