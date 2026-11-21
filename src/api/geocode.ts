import type { GeoPoint, Place, Region, TravelStyle } from '../types';
import { cached, createLimiter, DAY, fetchJson } from './http';

/* ---------------- Photon (Suche während des Tippens, basiert auf OpenStreetMap) ---------------- */

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    osm_type: 'N' | 'W' | 'R';
    osm_id: number;
    osm_key?: string;
    osm_value?: string;
    type?: string;
    country?: string;
    state?: string;
    county?: string;
    city?: string;
    countrycode?: string;
    /** [west, north, east, south] */
    extent?: [number, number, number, number];
  };
}

export interface SearchResult extends Place {
  osmType: 'N' | 'W' | 'R';
  osmId: number;
  type: string;
  countryCode?: string;
  bbox?: [number, number, number, number];
}

const TYPE_LABELS: Record<string, string> = {
  country: 'Land',
  state: 'Region',
  county: 'Kreis/Bezirk',
  city: 'Stadt',
  district: 'Stadtteil',
  locality: 'Ort',
  other: 'Gebiet',
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

const photonLimit = createLimiter(250, 2);

/** Zu kleine Orte für eine Reiseregion */
const NOT_A_REGION = new Set([
  'isolated_dwelling',
  'hamlet',
  'neighbourhood',
  'house',
  'farm',
  'locality',
  'quarter',
  'suburb',
  'plot',
  'square',
  'city_block',
]);

export async function searchPlaces(
  query: string,
  opts: { regionsOnly?: boolean; limit?: number; bias?: GeoPoint } = {},
): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const params = new URLSearchParams({ q, lang: 'de', limit: String(opts.limit ?? 7) });
  if (opts.regionsOnly) {
    params.append('osm_tag', 'place');
    params.append('osm_tag', 'boundary');
    params.set('limit', '12');
  }
  if (opts.bias) {
    params.set('lat', String(opts.bias.lat));
    params.set('lon', String(opts.bias.lon));
  }
  const url = `https://photon.komoot.io/api/?${params}`;
  const data = await cached(`photon:${url}`, 7 * DAY, () =>
    photonLimit(() => fetchJson<{ features: PhotonFeature[] }>(url)),
  );
  const seen = new Set<string>();
  return data.features
    .filter((f) => f.properties.name)
    .filter((f) => !opts.regionsOnly || !NOT_A_REGION.has(f.properties.osm_value ?? ''))
    .filter((f) => {
      const key = `${f.properties.osm_type}${f.properties.osm_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, opts.limit ?? 7)
    .map((f) => {
      const p = f.properties;
      const parts = [p.name, p.city, p.county, p.state, p.country].filter(
        (x, i, arr): x is string => !!x && arr.indexOf(x) === i,
      );
      const e = p.extent;
      return {
        name: p.name!,
        label: parts.join(', '),
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        osmType: p.osm_type,
        osmId: p.osm_id,
        type: p.type ?? p.osm_value ?? 'other',
        countryCode: p.countrycode,
        bbox: e ? [e[0], e[3], e[2], e[1]] : undefined,
      } satisfies SearchResult;
    });
}

/* ---------------- Unterkünfte über Photon (schnelle Ausweichquelle, wenn Overpass überlastet ist) ---------------- */

/** Suchbegriff + OSM-Kategorie. Photon findet nur Treffer, deren Name zum Begriff passt. */
const PHOTON_ACCOMMODATION: Record<TravelStyle, [string, string][]> = {
  camper: [
    ['camping', 'tourism:caravan_site'],
    ['camping', 'tourism:camp_site'],
    ['camper', 'tourism:caravan_site'],
    ['stellplatz', 'tourism:caravan_site'],
    ['bobil', 'tourism:caravan_site'],
    ['aire', 'tourism:caravan_site'],
  ],
  tent: [
    ['camping', 'tourism:camp_site'],
    ['camp', 'tourism:camp_site'],
    ['campground', 'tourism:camp_site'],
  ],
  backpacker: [
    ['hostel', 'tourism:hostel'],
    ['backpackers', 'tourism:hostel'],
    ['guest', 'tourism:guest_house'],
    ['camping', 'tourism:camp_site'],
  ],
  car: [
    ['hotel', 'tourism:hotel'],
    ['guest', 'tourism:guest_house'],
    ['motel', 'tourism:motel'],
    ['apartment', 'tourism:apartment'],
  ],
};

export interface PhotonPoi extends GeoPoint {
  name: string;
  type: string;
  osmUrl: string;
}

/** Schutzhütten/Unterstände tragen oft lokale Namen – damit findet Photon zumindest die benannten. */
const PHOTON_SHELTERS: [string, string][] = [
  ['gapahuk', 'amenity:shelter'],
  ['vindskydd', 'amenity:shelter'],
  ['laavu', 'amenity:shelter'],
  ['bothy', 'amenity:shelter'],
  ['shelter', 'amenity:shelter'],
  ['schutzhütte', 'amenity:shelter'],
];

export async function findAccommodationsPhoton(
  center: GeoPoint,
  style: TravelStyle,
  radiusKm: number,
  includeShelters = false,
): Promise<PhotonPoi[]> {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
  const bbox = [center.lon - dLon, center.lat - dLat, center.lon + dLon, center.lat + dLat].map((v) => v.toFixed(4)).join(',');
  const osmPath = { N: 'node', W: 'way', R: 'relation' } as const;
  const queries = [...PHOTON_ACCOMMODATION[style], ...(includeShelters && style === 'tent' ? PHOTON_SHELTERS : [])];
  const results = await Promise.all(
    queries.map(async ([q, tag]) => {
      const params = new URLSearchParams({ q, osm_tag: tag, bbox, limit: '30', lang: 'de' });
      const url = `https://photon.komoot.io/api/?${params}`;
      try {
        const data = await cached(`photon:${url}`, 7 * DAY, () =>
          photonLimit(() => fetchJson<{ features: PhotonFeature[] }>(url)),
        );
        return data.features;
      } catch {
        return [];
      }
    }),
  );
  const seen = new Set<string>();
  const out: PhotonPoi[] = [];
  for (const f of results.flat()) {
    const p = f.properties;
    const key = `${p.osm_type}${p.osm_id}`;
    if (!p.name || seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: p.name,
      type: p.osm_value ?? 'other',
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      osmUrl: `https://www.openstreetmap.org/${osmPath[p.osm_type]}/${p.osm_id}`,
    });
  }
  return out;
}

export interface CountryInfo {
  countryCode?: string;
  country?: string;
  state?: string;
}

/** Land (und Landesteil) zu einem Punkt – über Photon, ein Jahr gecacht. */
export async function reverseCountry(p: GeoPoint): Promise<CountryInfo> {
  const lat = p.lat.toFixed(3);
  const lon = p.lon.toFixed(3);
  const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=de&limit=1`;
  return cached(`photon-rev:${lat},${lon}`, 365 * DAY, async () => {
    const data = await photonLimit(() => fetchJson<{ features: PhotonFeature[] }>(url));
    const props = data.features[0]?.properties;
    return { countryCode: props?.countrycode?.toUpperCase(), country: props?.country, state: props?.state };
  });
}

/* ---------------- Nominatim (Detail-Lookups und Rückwärtssuche, max. 1 Anfrage/s) ---------------- */

const nominatimLimit = createLimiter(1100, 1);

export async function lookupWikidata(osmType: string, osmId: number): Promise<string | undefined> {
  const url = `https://nominatim.openstreetmap.org/lookup?osm_ids=${osmType}${osmId}&format=json&extratags=1`;
  const data = await cached(`nom-lookup:${osmType}${osmId}`, 30 * DAY, () =>
    nominatimLimit(() => fetchJson<{ extratags?: Record<string, string> }[]>(url)),
  );
  return data[0]?.extratags?.wikidata;
}

export async function reverseGeocode(p: GeoPoint): Promise<string | undefined> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}&format=json&zoom=10&accept-language=de`;
  const data = await cached(`nom-rev:${p.lat.toFixed(3)},${p.lon.toFixed(3)}`, 30 * DAY, () =>
    nominatimLimit(() =>
      fetchJson<{ name?: string; address?: Record<string, string> }>(url).catch(() => ({}) as { name?: string }),
    ),
  );
  const a = (data as { address?: Record<string, string> }).address ?? {};
  return a.town ?? a.city ?? a.village ?? a.municipality ?? a.county ?? data.name;
}

export function toRegion(r: SearchResult): Region {
  return {
    name: r.name,
    label: r.label ?? r.name,
    osmType: r.osmType,
    osmId: r.osmId,
    countryCode: r.countryCode,
    bbox: r.bbox,
    center: { lat: r.lat, lon: r.lon },
    type: r.type,
  };
}
