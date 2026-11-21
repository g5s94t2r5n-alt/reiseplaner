import type { Candidate, GeoPoint, Trip } from '../types';
import { haversineKm } from '../lib/geo';
import { placeKey } from './plan';

export interface Alternative {
  candidate: Candidate;
  /** zusätzliche (positiv) bzw. eingesparte (negativ) Fahrzeit gegenüber dem jetzigen Stop, Stunden (Schätzung) */
  extraH: number;
}

/** Grobe Fahrzeit aus Luftlinie (Straßenfaktor 1,3, Ø 70 km/h) */
const estH = (a: GeoPoint, b: GeoPoint) => (haversineKm(a, b) * 1.3) / 70;

/**
 * Alternativen für Stop `index`: Orte, die zwischen Vorgänger und Nachfolger passen,
 * sortiert nach Bewertung abzüglich Umweg. Bereits geplante und ausgeschlossene Orte fehlen.
 */
export function alternativesFor(trip: Trip, index: number, limit = 4, maxExtraH = 2.5): Alternative[] {
  const { settings, stops } = trip;
  const cur = stops[index];
  if (!cur) return [];
  const prev: GeoPoint = index === 0 ? settings.start : stops[index - 1];
  const next: GeoPoint = index === stops.length - 1 ? (settings.end ?? settings.start) : stops[index + 1];
  const detour = (p: GeoPoint) => estH(prev, p) + estH(p, next);
  const curDetour = detour(cur);
  const taken = new Set(stops.map(placeKey));
  const excluded = new Set(trip.excluded ?? []);

  return trip.candidates
    .filter((c) => !taken.has(placeKey(c)) && !excluded.has(placeKey(c)))
    .filter((c) => haversineKm(c, cur) > 5)
    .map((c) => ({ candidate: c, extraH: detour(c) - curDetour }))
    .filter((a) => a.extraH <= maxExtraH)
    .sort((a, b) => b.candidate.score - Math.max(0, b.extraH) * 1.5 - (a.candidate.score - Math.max(0, a.extraH) * 1.5))
    .slice(0, limit);
}
