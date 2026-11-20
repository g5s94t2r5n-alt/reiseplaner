import type { Accommodation, GeoPoint, SleepListing, Stop, Trip, TravelStyle } from '../types';
import { ACCOMMODATION_RADIUS_KM, findAccommodations, findFreeSpots } from '../api/overpass';
import type { WildStatus } from '../data/wildCamping';
import { findAccommodationsPhoton } from '../api/geocode';
import { haversineKm } from '../lib/geo';

function fitsStyle(l: SleepListing, style: TravelStyle): boolean {
  const camp = l.category === 'camping' || /camp|caravan|motorhome|wohnmobil/i.test(`${l.name} ${l.description ?? ''}`);
  switch (style) {
    case 'camper':
    case 'tent':
      return camp;
    case 'backpacker':
      return camp || l.category === 'budget' || /hostel|dorm/i.test(`${l.name} ${l.description ?? ''}`);
    case 'car':
      return !camp;
  }
}

export function sleepToAccommodations(center: GeoPoint, listings: SleepListing[], style: TravelStyle): Accommodation[] {
  return listings
    .filter((l) => fitsStyle(l, style))
    .map((l, i) => {
      const hasPos = l.lat != null && l.lon != null;
      const pos = hasPos ? { lat: l.lat!, lon: l.lon! } : center;
      return {
        id: `wv-${i}-${l.name}`,
        name: l.name,
        type: l.category ?? 'listing',
        source: 'wikivoyage' as const,
        lat: pos.lat,
        lon: pos.lon,
        distanceKm: hasPos ? haversineKm(center, pos) : undefined,
        website: l.url,
        price: l.price,
        description: l.description,
        features: [],
        quality: 4 + (l.price ? 1 : 0) + (l.url ? 1 : 0),
      };
    });
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');

/**
 * Unterkünfte für einen Ort: Wikivoyage-Empfehlungen sofort (über `onPartial`),
 * danach ergänzt um OpenStreetMap, ohne Dubletten.
 */
export async function loadAccommodations(
  center: GeoPoint,
  style: TravelStyle,
  sleep: SleepListing[] = [],
  onPartial?: (items: Accommodation[]) => void,
  wild?: { enabled: boolean; status: WildStatus },
): Promise<{ items: Accommodation[]; error?: string }> {
  const wv = sleepToAccommodations(center, sleep, style);
  onPartial?.(wv);
  const radiusKm = ACCOMMODATION_RADIUS_KM[style];

  // Freie Plätze (Schutzhütten, kostenlose Plätze, Freistehen) parallel laden
  const free =
    wild?.enabled && (style === 'camper' || style === 'tent')
      ? findFreeSpots(center, style, wild.status === 'allowed' || wild.status === 'tolerated').catch(
          () => [] as Accommodation[],
        )
      : Promise.resolve([] as Accommodation[]);

  // Photon antwortet schnell (nur Name/Typ/Lage), Overpass liefert Details, ist aber oft überlastet
  let quick: Accommodation[] = [];
  let detailedDone = false;
  const photon = findAccommodationsPhoton(center, style, radiusKm, !!wild?.enabled).then((pois) => {
    quick = pois
      .map((p, i) => {
        const distanceKm = haversineKm(center, p);
        return {
          id: `ph-${i}-${p.name}`,
          name: p.name,
          type: p.type,
          source: 'osm' as const,
          lat: p.lat,
          lon: p.lon,
          distanceKm,
          features: p.type === 'shelter' ? ['kostenlos'] : [],
          osmUrl: p.osmUrl,
          quality: 1 - (distanceKm / radiusKm) * 3,
        };
      })
      .filter((a) => a.distanceKm <= radiusKm * 1.2);
    if (!detailedDone) onPartial?.(mergeAccommodations(wv, quick));
  });

  let detailed: Accommodation[] = [];
  let error: string | undefined;
  try {
    detailed = await findAccommodations(center, style);
  } catch (e) {
    error = (e as Error).message;
  }
  detailedDone = true;
  await photon.catch(() => undefined);
  const freeSpots = await free;

  const items = mergeAccommodations(wv, mergeAccommodations(mergeAccommodations(detailed, quick), freeSpots));
  if (error && items.length > 0) {
    error = 'Details wie Ausstattung und Website sind gerade nicht verfügbar (OpenStreetMap-Server ausgelastet).';
  }
  return { items, error };
}

export function mergeAccommodations(wv: Accommodation[], osm: Accommodation[]): Accommodation[] {
  const merged = [...wv];
  // Generische Namen ("Rastplatz (ohne Namen)") und nicht-lateinische Namen nicht per Name vergleichen
  const key = (a: Accommodation) => (a.name.endsWith('(ohne Namen)') ? '' : norm(a.name));
  for (const o of osm) {
    const ok = key(o);
    const dup = merged.some((m) => {
      if (m.osmUrl && m.osmUrl === o.osmUrl) return true;
      const mk = key(m);
      if (mk.length > 3 && ok.length > 3 && (mk.includes(ok) || ok.includes(mk))) return true;
      return m.distanceKm != null && haversineKm(m, o) < 0.1;
    });
    if (!dup) merged.push(o);
  }
  return merged.sort((a, b) => b.quality - a.quality);
}

/** Fügt einen Stop an der Stelle ein, die den kleinsten Umweg verursacht (Luftlinie). */
export function insertAtBestPosition(trip: Trip, stop: Stop): Stop[] {
  const { settings, stops } = trip;
  const pts: GeoPoint[] = [settings.start, ...stops, settings.end ?? settings.start];
  let best = stops.length;
  let bestAdd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const add = haversineKm(pts[i], stop) + haversineKm(stop, pts[i + 1]) - haversineKm(pts[i], pts[i + 1]);
    if (add < bestAdd) {
      bestAdd = add;
      best = i;
    }
  }
  return [...stops.slice(0, best), stop, ...stops.slice(best)];
}
