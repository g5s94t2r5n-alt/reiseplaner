import type { GeoPoint, Trip } from '../types';
import { haversineKm } from '../lib/geo';
import { climateHistory, elevations, forecast, type DailySeries } from '../api/weather';
import { mapLimit } from '../api/http';
import type { ItinerarySummary } from './itinerary';
import {
  averageNormals,
  daylightHours,
  forecastStats,
  monthlyNormals,
  monthsBetween,
  passWarning,
  robustMax,
  sampleLine,
  stopWarnings,
  travelTimeWarnings,
  windowStats,
  type MonthNormal,
  type SeasonWarning,
  type WindowStats,
} from './season';

export interface StopSeason {
  stats: WindowStats | null;
  daylightH: number;
  elevation?: number;
  warnings: SeasonWarning[];
}

export interface SeasonReport {
  stops: Record<string, StopSeason>;
  segments: Record<number, { maxElevation: number; warning: SeasonWarning | null }>;
  normals: MonthNormal[] | null;
  best: number[];
  travel: number[];
  tripWarnings: SeasonWarning[];
}

export interface SeasonData {
  climate: Record<string, DailySeries | null>;
  forecasts: Record<string, DailySeries | null>;
  stopElevation: Record<string, number>;
  segmentElevations: Record<number, number[]>;
}

/** Wie viele Tage im Voraus die Vorhersage genutzt wird (Open-Meteo liefert 16). */
const FORECAST_DAYS = 15;

function daysUntil(iso: string, today: Date): number {
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return (new Date(`${iso}T00:00:00Z`).getTime() - t) / 86400000;
}

/**
 * Ort, an dem man bei einem Stop tatsächlich ist: der Straßenpunkt, an dem die Route ankommt.
 * Naturziele haben in Wikivoyage oft die Koordinate des Gipfels oder Gletschers – dort
 * übernachtet niemand, und das Klima dort wäre irreführend.
 */
export function stayPoint(trip: Trip, i: number): GeoPoint {
  const stop = trip.stops[i];
  if (trip.segments.length !== trip.stops.length + 1) return stop;
  const last = trip.segments[i]?.end ?? trip.segments[i]?.geometry.at(-1);
  if (!last) return stop;
  const p = { lat: last[0], lon: last[1] };
  return haversineKm(p, stop) <= 40 ? p : stop;
}

/** Lädt alle Wetter- und Höhendaten für einen Trip (alles gecacht). */
export async function loadSeasonData(trip: Trip, summary: ItinerarySummary, today = new Date()): Promise<SeasonData> {
  const stops = trip.stops;
  const points = stops.map((_, i) => stayPoint(trip, i));
  const climateList = await mapLimit(points, 2, (p) => climateHistory(p, today).catch(() => null));
  const soon = daysUntil(trip.settings.startDate, today) <= FORECAST_DAYS && daysUntil(summary.endDate, today) >= 0;
  const forecastList = soon ? await mapLimit(points, 2, (p) => forecast(p).catch(() => null)) : [];

  const stopElevList = await elevations(points).catch(() => [] as number[]);

  // Routenpunkte für Höhenprofil: höchstens ~300 Punkte insgesamt
  const totalKm = trip.segments.reduce((a, s) => a + s.distanceKm, 0);
  const everyKm = Math.max(8, totalKm / 300);
  const samples = trip.segments.map((seg) => (seg.distanceKm > 20 ? sampleLine(seg.geometry, everyKm) : []));
  const flat = samples.flat();
  const flatElev = flat.length ? await elevations(flat).catch(() => null) : null;

  const segmentElevations: Record<number, number[]> = {};
  if (flatElev) {
    let k = 0;
    samples.forEach((pts, i) => {
      segmentElevations[i] = flatElev.slice(k, k + pts.length);
      k += pts.length;
    });
  }

  const data: SeasonData = { climate: {}, forecasts: {}, stopElevation: {}, segmentElevations };
  stops.forEach((s, i) => {
    data.climate[s.id] = climateList[i];
    data.forecasts[s.id] = forecastList[i] ?? null;
    if (stopElevList[i] != null) data.stopElevation[s.id] = stopElevList[i];
  });
  return data;
}

/** Wertet die geladenen Daten für die aktuellen Reisedaten aus (rein, ohne Netz). */
export function buildSeasonReport(trip: Trip, summary: ItinerarySummary, data: SeasonData): SeasonReport {
  const { settings } = trip;
  const stops: Record<string, StopSeason> = {};

  for (const item of summary.items) {
    if (item.type !== 'stop') continue;
    const s = item.stop;
    const fc = data.forecasts[s.id];
    const cl = data.climate[s.id];
    const stats = (fc && forecastStats(fc, item.arrive, item.depart)) || (cl && windowStats(cl, item.arrive, item.depart)) || null;
    const daylightH = daylightHours(s.lat, item.arrive);
    const elevation = data.stopElevation[s.id];
    stops[s.id] = {
      stats,
      daylightH,
      elevation,
      warnings: stopWarnings({ stats, daylightH, style: settings.style, kind: s.kind, elevation }),
    };
  }

  const segments: SeasonReport['segments'] = {};
  trip.segments.forEach((_, i) => {
    const elev = data.segmentElevations[i];
    if (!elev || elev.length === 0) return;
    const maxElevation = robustMax(elev);
    // Segment i führt von Punkt i (Start oder Stop i-1) zu Stop i (bzw. Ziel)
    const near = [trip.stops[i - 1], trip.stops[i]].filter(Boolean).map((s) => stops[s.id]?.stats ?? null);
    segments[i] = { maxElevation, warning: passWarning(maxElevation, near) };
  });

  const normals = averageNormals(
    trip.stops.map((s) => data.climate[s.id]).filter((c): c is DailySeries => !!c).map(monthlyNormals),
  );
  const travel = monthsBetween(settings.startDate, summary.endDate);
  const { best, warnings } = travelTimeWarnings(normals, travel, settings.interests, settings.style);

  return { stops, segments, normals, best, travel, tripWarnings: warnings };
}
