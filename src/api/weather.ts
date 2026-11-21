import type { GeoPoint } from '../types';
import { cached, createLimiter, DAY, fetchJson } from './http';

/**
 * Open-Meteo (kostenlos für private Nutzung, kein Key):
 * - Archiv (ERA5) der letzten drei Jahre als "typisches Wetter"
 * - 16-Tage-Vorhersage, wenn die Reise bald beginnt
 * - Geländehöhe (Copernicus DEM)
 */
const limit = createLimiter(200, 2);

export interface DailySeries {
  time: string[];
  tmax: (number | null)[];
  tmin: (number | null)[];
  precip: (number | null)[];
  snow: (number | null)[];
  /** nur Vorhersage */
  precipProb?: (number | null)[];
}

interface OpenMeteoDaily {
  daily?: {
    time: string[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    precipitation_sum: (number | null)[];
    snowfall_sum: (number | null)[];
    precipitation_probability_max?: (number | null)[];
  };
  reason?: string;
}

function toSeries(d: OpenMeteoDaily): DailySeries {
  if (!d.daily) throw new Error(`Wetterdaten nicht verfügbar${d.reason ? ` (${d.reason})` : ''}`);
  return {
    time: d.daily.time,
    tmax: d.daily.temperature_2m_max,
    tmin: d.daily.temperature_2m_min,
    precip: d.daily.precipitation_sum,
    snow: d.daily.snowfall_sum,
    precipProb: d.daily.precipitation_probability_max,
  };
}

/** Klima an einem Ort grob gerundet (0,1°), damit benachbarte Stops den Cache teilen. */
const round = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

/** Tägliche Werte der letzten drei vollen Jahre. */
export async function climateHistory(p: GeoPoint, today = new Date()): Promise<DailySeries> {
  const lastYear = today.getUTCFullYear() - 1;
  const lat = round(p.lat);
  const lon = round(p.lon);
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${lastYear - 2}-01-01&end_date=${lastYear}-12-31` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum&timezone=GMT`;
  return cached(`om-archive:${lat},${lon}:${lastYear}`, 180 * DAY, () =>
    limit(() => fetchJson<OpenMeteoDaily>(url, {}, 30000)).then(toSeries),
  );
}

/**
 * Klima vieler Orte für einen Zeitraum in einer Anfrage (Open-Meteo unterstützt Koordinatenlisten).
 * Liefert je Ort die Tageswerte und die Geländehöhe des Punkts.
 */
export async function climateBatch(
  points: GeoPoint[],
  from: string,
  to: string,
): Promise<{ series: DailySeries; elevation: number }[]> {
  const out: { series: DailySeries; elevation: number }[] = [];
  for (let i = 0; i < points.length; i += 50) {
    const chunk = points.slice(i, i + 50);
    const lats = chunk.map((p) => round(p.lat)).join(',');
    const lons = chunk.map((p) => round(p.lon)).join(',');
    const url =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}` +
      `&start_date=${from}&end_date=${to}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum&timezone=GMT`;
    const data = await cached(`om-batch:${from}:${to}:${lats}:${lons}`, 180 * DAY, () =>
      limit(() => fetchJson<(OpenMeteoDaily & { elevation?: number })[] | (OpenMeteoDaily & { elevation?: number })>(url, {}, 40000)),
    );
    const list = Array.isArray(data) ? data : [data];
    for (const d of list) out.push({ series: toSeries(d), elevation: d.elevation ?? 0 });
  }
  return out;
}

/** Vorhersage für die nächsten 16 Tage (3 Stunden gecacht). */
export async function forecast(p: GeoPoint): Promise<DailySeries> {
  const lat = round(p.lat);
  const lon = round(p.lon);
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,precipitation_probability_max` +
    `&timezone=GMT&forecast_days=16`;
  return cached(`om-forecast:${lat},${lon}`, DAY / 8, () =>
    limit(() => fetchJson<OpenMeteoDaily>(url, {}, 20000)).then(toSeries),
  );
}

/** Geländehöhe in Metern für bis zu beliebig viele Punkte (in Paketen à 100). */
export async function elevations(points: GeoPoint[]): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    const lats = chunk.map((p) => p.lat.toFixed(3)).join(',');
    const lons = chunk.map((p) => p.lon.toFixed(3)).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
    const data = await cached(`om-elev:${lats}:${lons}`, 365 * DAY, () =>
      limit(() => fetchJson<{ elevation: number[] }>(url, {}, 20000)),
    );
    out.push(...data.elevation);
  }
  return out;
}
