import type { GeoPoint } from '../types';
import { cached, createLimiter, DAY, fetchJson } from './http';

/** Öffentlicher OSRM-Demo-Server (kostenlos, nur Auto-Routing, fair use). */
const OSRM = 'https://router.project-osrm.org';
const limit = createLimiter(1000, 1);

export interface OsrmResult {
  /** Reihenfolge der Eingabepunkte (nur bei trip) */
  order: number[];
  legs: { distanceKm: number; durationH: number }[];
  /** [lat, lon] */
  geometry: [number, number][];
  /** Auf die Straße eingerastete Wegpunkte [lat, lon] in Routen-Reihenfolge (ohne Wiederholung des Starts) */
  waypoints: [number, number][];
}

interface OsrmRoute {
  geometry: { coordinates: [number, number][] };
  legs: { distance: number; duration: number }[];
}

interface OsrmWaypoint {
  location: [number, number];
  waypoint_index?: number;
}

const coordStr = (pts: GeoPoint[]) => pts.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');

function toResult(route: OsrmRoute, order: number[], waypoints: OsrmWaypoint[]): OsrmResult {
  return {
    order,
    legs: route.legs.map((l) => ({ distanceKm: l.distance / 1000, durationH: l.duration / 3600 })),
    geometry: route.geometry.coordinates.map(([lon, lat]) => [+lat.toFixed(5), +lon.toFixed(5)]),
    waypoints: waypoints.map((w) => [+w.location[1].toFixed(5), +w.location[0].toFixed(5)]),
  };
}

/** Fahrzeit-Matrix in Stunden (null = nicht per Straße/Fähre erreichbar). Max. 100 Punkte. */
export async function table(points: GeoPoint[]): Promise<(number | null)[][]> {
  const url = `${OSRM}/table/v1/driving/${coordStr(points)}?annotations=duration`;
  const data = await cached(`osrm-table:${coordStr(points)}`, 7 * DAY, () =>
    limit(() => fetchJson<{ code: string; durations?: (number | null)[][]; message?: string }>(url, {}, 45000)),
  );
  if (data.code !== 'Ok' || !data.durations) {
    throw new Error(`Fahrzeiten konnten nicht berechnet werden (${data.message ?? data.code}).`);
  }
  return data.durations.map((row) => row.map((s) => (s == null ? null : s / 3600)));
}

/** Route durch die Punkte in der gegebenen Reihenfolge. */
export async function route(points: GeoPoint[]): Promise<OsrmResult> {
  const url = `${OSRM}/route/v1/driving/${coordStr(points)}?overview=simplified&geometries=geojson&steps=false`;
  const data = await cached(`osrm-route:${coordStr(points)}`, 7 * DAY, () =>
    limit(() =>
      fetchJson<{ code: string; routes?: OsrmRoute[]; waypoints?: OsrmWaypoint[]; message?: string }>(url, {}, 30000),
    ),
  );
  if (data.code !== 'Ok' || !data.routes?.[0]) {
    throw new Error(`Route konnte nicht berechnet werden (${data.message ?? data.code}). Liegen alle Orte auf demselben Straßennetz?`);
  }
  return toResult(
    data.routes[0],
    points.map((_, i) => i),
    data.waypoints ?? [],
  );
}

/**
 * Optimiert die Reihenfolge (Rundreiseproblem). Erster Punkt bleibt Start;
 * bei `roundtrip=false` bleibt der letzte Punkt das Ziel.
 */
export async function trip(points: GeoPoint[], roundtrip: boolean): Promise<OsrmResult> {
  if (points.length < 3) return route(roundtrip ? [...points, points[0]] : points);
  const qs = roundtrip
    ? 'roundtrip=true&source=first'
    : 'roundtrip=false&source=first&destination=last';
  const url = `${OSRM}/trip/v1/driving/${coordStr(points)}?${qs}&overview=simplified&geometries=geojson&steps=false`;
  const data = await cached(`osrm-trip:${qs}:${coordStr(points)}`, 7 * DAY, () =>
    limit(() =>
      fetchJson<{
        code: string;
        trips?: OsrmRoute[];
        waypoints?: OsrmWaypoint[];
        message?: string;
      }>(url, {}, 30000),
    ),
  );
  if (data.code !== 'Ok' || !data.trips?.[0] || !data.waypoints) {
    throw new Error(`Reihenfolge konnte nicht optimiert werden (${data.message ?? data.code}).`);
  }
  // waypoints[i].waypoint_index = Position von Eingabepunkt i in der Tour
  const order = new Array<number>(points.length);
  const ordered = new Array<OsrmWaypoint>(points.length);
  data.waypoints.forEach((w, i) => {
    order[w.waypoint_index!] = i;
    ordered[w.waypoint_index!] = w;
  });
  return toResult(data.trips[0], order, ordered);
}
