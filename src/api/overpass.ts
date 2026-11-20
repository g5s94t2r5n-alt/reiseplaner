import type { Accommodation, GeoPoint, PoiCounts, TravelStyle } from '../types';
import { haversineKm } from '../lib/geo';
import { cached, createLimiter, DAY, HttpError } from './http';

/**
 * Overpass API (OpenStreetMap-Daten). Die öffentlichen Server sind oft ausgelastet,
 * deshalb probieren wir mehrere Spiegel-Server nacheinander.
 */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
let preferred = 0;
/** Sind alle Server ausgefallen, eine Weile keine automatischen Anfragen mehr stellen. */
let downUntil = 0;
const limit = createLimiter(500, 2);

/** Antwortet ein Server nicht innerhalb dieser Zeit, wird zusätzlich der nächste gefragt. */
const HEDGE_MS = 5000;

/**
 * Fragt zuerst den zuletzt funktionierenden Server. Kommt keine schnelle Antwort,
 * wird gestaffelt der nächste Spiegel-Server dazugenommen; die erste Antwort gewinnt.
 */
function runQuery<T>(ql: string, timeoutMs: number, force: boolean): Promise<T> {
  if (!force && Date.now() < downUntil) {
    return Promise.reject(new Error('OpenStreetMap-Server (Overpass) sind gerade ausgelastet.'));
  }
  return new Promise<T>((resolve, reject) => {
    const n = ENDPOINTS.length;
    const first = preferred;
    const ctrls: AbortController[] = [];
    const hedges: ReturnType<typeof setTimeout>[] = [];
    let started = 0;
    let failed = 0;
    let settled = false;
    let lastErr: unknown;

    const finish = () => {
      settled = true;
      hedges.forEach(clearTimeout);
      ctrls.forEach((c) => c.abort());
    };

    const startNext = () => {
      if (settled || started >= n) return;
      const idx = (first + started++) % n;
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      fetch(ENDPOINTS[idx], { method: 'POST', body: new URLSearchParams({ data: ql }), signal: ctrl.signal })
        .then((res) => {
          if (!res.ok) throw new HttpError(`Overpass ${res.status}`, res.status);
          return res.json() as Promise<T>;
        })
        .then((json) => {
          if (settled) return;
          preferred = idx;
          downUntil = 0;
          finish();
          resolve(json);
        })
        .catch((e) => {
          if (settled) return;
          lastErr = e;
          if (++failed >= n) {
            finish();
            downUntil = Date.now() + 3 * 60 * 1000;
            const detail =
              (lastErr as Error)?.name === 'AbortError' ? 'Zeitüberschreitung' : String((lastErr as Error)?.message ?? lastErr);
            reject(
              new Error(
                `OpenStreetMap-Server (Overpass) sind gerade nicht erreichbar oder ausgelastet. Bitte später erneut versuchen. (${detail})`,
              ),
            );
          } else {
            startNext();
          }
        })
        .finally(() => clearTimeout(timer));
      if (started < n) hedges.push(setTimeout(startNext, HEDGE_MS));
    };
    startNext();
  });
}

export function overpass<T>(
  ql: string,
  cacheKey: string,
  opts: { ttlMs?: number; timeoutMs?: number; force?: boolean } = {},
): Promise<T> {
  return cached(`ovp:${cacheKey}`, opts.ttlMs ?? 7 * DAY, () =>
    limit(() => runQuery<T>(ql, opts.timeoutMs ?? 20000, opts.force ?? false)),
  );
}

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/* ---------------- Unterkünfte ---------------- */

export const ACCOMMODATION_RADIUS_KM: Record<TravelStyle, number> = {
  camper: 20,
  tent: 20,
  backpacker: 8,
  car: 10,
};

function accommodationFilters(style: TravelStyle, around: string): string {
  switch (style) {
    case 'camper':
      return `nwr${around}[tourism=caravan_site];nwr${around}[tourism=camp_site][caravans!=no][motorhome!=no];`;
    case 'tent':
      return `nwr${around}[tourism=camp_site][tents!=no];nwr${around}[tourism=wilderness_hut];`;
    case 'backpacker':
      return `nwr${around}[tourism=hostel];nwr${around}[tourism=guest_house];nwr${around}[tourism=camp_site][tents!=no];`;
    case 'car':
      return `nwr${around}[tourism~"^(hotel|motel|guest_house|hostel|apartment|chalet)$"];`;
  }
}

const FEATURE_TAGS: [string, (v: string) => boolean, string][] = [
  ['fee', (v) => v === 'no', 'kostenlos'],
  ['shower', (v) => v !== 'no', 'Duschen'],
  ['toilets', (v) => v !== 'no', 'WC'],
  ['drinking_water', (v) => v !== 'no', 'Trinkwasser'],
  ['power_supply', (v) => v !== 'no', 'Strom'],
  ['sanitary_dump_station', (v) => v !== 'no', 'Entsorgung'],
  ['internet_access', (v) => v !== 'no', 'WLAN'],
  ['dog', (v) => v === 'yes' || v === 'leashed', 'Hunde ok'],
  ['swimming_pool', (v) => v !== 'no', 'Pool'],
  ['kitchen', (v) => v !== 'no', 'Küche'],
  ['backcountry', (v) => v === 'yes', 'Naturplatz'],
];

function describeTags(tags: Record<string, string>): string[] {
  const features: string[] = [];
  if (tags.stars) features.push(`${tags.stars}★`);
  for (const [key, ok, label] of FEATURE_TAGS) {
    const v = tags[key];
    if (v && ok(v)) features.push(label);
  }
  if (tags.capacity) features.push(`${tags.capacity} Plätze`);
  if (tags.reservation === 'required') features.push('Reservierung nötig');
  return features;
}

export async function findAccommodations(center: GeoPoint, style: TravelStyle): Promise<Accommodation[]> {
  const radiusKm = ACCOMMODATION_RADIUS_KM[style];
  const around = `(around:${radiusKm * 1000},${center.lat.toFixed(4)},${center.lon.toFixed(4)})`;
  const ql = `[out:json][timeout:25];(${accommodationFilters(style, around)});out center tags 120;`;
  // vom Nutzer angefordert → auch bei kürzlich ausgefallenen Servern erneut versuchen
  const data = await overpass<{ elements: OsmElement[] }>(
    ql,
    `acc:${style}:${center.lat.toFixed(3)},${center.lon.toFixed(3)}`,
    { force: true, timeoutMs: 20000 },
  );
  const result: Accommodation[] = [];
  for (const el of data.elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const tags = el.tags ?? {};
    if (lat == null || lon == null) continue;
    const distanceKm = haversineKm(center, { lat, lon });
    const website = tags.website ?? tags['contact:website'] ?? tags.url;
    const phone = tags.phone ?? tags['contact:phone'];
    const features = describeTags(tags);
    const name = tags.name ?? tags['name:de'] ?? tags['name:en'];
    const quality =
      (name ? 2 : 0) +
      (website ? 2 : 0) +
      (phone ? 1 : 0) +
      (tags.opening_hours ? 0.5 : 0) +
      (tags.wikidata ? 1.5 : 0) +
      features.length * 0.5 -
      (distanceKm / radiusKm) * 3;
    result.push({
      id: `osm-${el.type}-${el.id}`,
      name: name ?? `${accommodationTypeLabel(tags.tourism ?? '')} (ohne Namen)`,
      type: tags.tourism ?? 'other',
      source: 'osm',
      lat,
      lon,
      distanceKm,
      website: website && /^https?:\/\//.test(website) ? website : website ? `https://${website}` : undefined,
      phone,
      openingHours: tags.opening_hours,
      seasonal: tags.seasonal,
      price: tags.charge,
      description: tags.description,
      features,
      osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      quality,
    });
  }
  return result.sort((a, b) => b.quality - a.quality);
}

/**
 * Kostenlose Übernachtungsplätze außerhalb klassischer Campingplätze.
 * `designated` = ausgewiesene Plätze (überall legal), `wild` = Rast-/Parkplätze,
 * die nur dort sinnvoll sind, wo Freistehen erlaubt oder geduldet ist.
 */
export async function findFreeSpots(
  center: GeoPoint,
  style: 'camper' | 'tent',
  includeWild: boolean,
): Promise<Accommodation[]> {
  const radiusKm = 20;
  const a = `(around:${radiusKm * 1000},${center.lat.toFixed(4)},${center.lon.toFixed(4)})`;
  const parts =
    style === 'camper'
      ? [`nwr${a}[amenity=parking][motorhome=designated];`, includeWild && `nwr${a}[highway=rest_area];nwr${a}[amenity=parking][motorhome=yes];`]
      : [
          `nwr${a}[amenity=shelter][shelter_type~"^(lean_to|basic_hut)$"];nwr${a}[tourism=camp_site][backcountry=yes];nwr${a}[tourism=camp_site][fee=no];`,
        ];
  const ql = `[out:json][timeout:25];(${parts.filter(Boolean).join('')});out center tags 80;`;
  const data = await overpass<{ elements: OsmElement[] }>(
    ql,
    `free:${style}:${includeWild}:${center.lat.toFixed(3)},${center.lon.toFixed(3)}`,
    { force: true, timeoutMs: 20000 },
  );
  const out: Accommodation[] = [];
  for (const el of data.elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const tags = el.tags ?? {};
    if (lat == null || lon == null) continue;
    const type =
      tags.amenity === 'shelter'
        ? 'shelter'
        : tags.highway === 'rest_area'
          ? 'rest_area'
          : tags.amenity === 'parking'
            ? 'motorhome_parking'
            : (tags.tourism ?? 'other');
    const wild = type === 'rest_area' || (type === 'motorhome_parking' && tags.motorhome === 'yes');
    const distanceKm = haversineKm(center, { lat, lon });
    const features = describeTags(tags);
    // Schutzhütten und Rastplätze sind praktisch immer kostenlos
    if (!tags.fee && (type === 'shelter' || type === 'rest_area')) features.unshift('kostenlos');
    const name = tags.name ?? tags['name:de'] ?? tags['name:en'];
    out.push({
      id: `free-${el.type}-${el.id}`,
      name: name ?? `${accommodationTypeLabel(type)} (ohne Namen)`,
      type,
      source: 'osm',
      lat,
      lon,
      distanceKm,
      openingHours: tags.opening_hours,
      seasonal: tags.seasonal,
      description: tags.description,
      features,
      wild,
      osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      quality: 1 + (name ? 1 : 0) + features.length * 0.3 - (distanceKm / radiusKm) * 3,
    });
  }
  return out;
}

export function accommodationTypeLabel(type: string): string {
  return (
    {
      camp_site: 'Campingplatz',
      caravan_site: 'Wohnmobil-Stellplatz',
      wilderness_hut: 'Hütte',
      hostel: 'Hostel',
      guest_house: 'Pension',
      hotel: 'Hotel',
      motel: 'Motel',
      apartment: 'Ferienwohnung',
      chalet: 'Ferienhaus',
      budget: 'Budget-Unterkunft',
      mid: 'Mittelklasse',
      splurge: 'Gehoben',
      camping: 'Camping',
      shelter: 'Schutzhütte / Unterstand',
      rest_area: 'Rastplatz',
      motorhome_parking: 'Wohnmobil-Parkplatz',
    }[type] ?? 'Unterkunft'
  );
}

/* ---------------- Sehenswürdigkeiten zählen (für Orte ohne Wikivoyage-Artikel) ---------------- */

export async function countPois(center: GeoPoint, radiusKm: number): Promise<PoiCounts> {
  const a = `(around:${radiusKm * 1000},${center.lat.toFixed(4)},${center.lon.toFixed(4)})`;
  const ql =
    `[out:json][timeout:25];` +
    `nwr${a}[tourism=attraction];out count;` +
    `nwr${a}[tourism~"^(museum|gallery)$"];out count;` +
    `nwr${a}[tourism=viewpoint];out count;` +
    `nwr${a}[historic~"^(castle|monument|ruins|archaeological_site|fort)$"];out count;` +
    `nwr${a}[natural=beach];out count;` +
    `nwr${a}[natural~"^(peak|waterfall|cave_entrance|glacier)$"];out count;` +
    `rel${a}[route=hiking];out count;`;
  const data = await overpass<{ elements: { tags?: { total?: string } }[] }>(
    ql,
    `poi:${radiusKm}:${center.lat.toFixed(3)},${center.lon.toFixed(3)}`,
    { ttlMs: 30 * DAY, timeoutMs: 12000 },
  );
  const n = (i: number) => parseInt(data.elements[i]?.tags?.total ?? '0', 10) || 0;
  return {
    attractions: n(0),
    museums: n(1),
    viewpoints: n(2),
    historic: n(3),
    beaches: n(4),
    nature: n(5),
    hiking: n(6),
  };
}
