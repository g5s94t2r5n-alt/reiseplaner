import type { GeoPoint, Place, Segment, Stop, TransitStop, Trip } from '../types';
import { coordKey, pointAtFraction } from '../lib/geo';
import { transitNightsFor } from './select';

/** Zwischenstopps innerhalb einer Etappe, gleichmäßig nach Strecke verteilt. */
export function transitPointsFor(segment: Segment, maxDriveH: number): GeoPoint[] {
  const k = transitNightsFor(segment.durationH, maxDriveH);
  const pts: GeoPoint[] = [];
  for (let i = 1; i <= k; i++) pts.push(pointAtFraction(segment.geometry, i / (k + 1)));
  return pts;
}

export function allTransitStops(trip: Pick<Trip, 'segments' | 'settings' | 'transitNames'>): TransitStop[] {
  const out: TransitStop[] = [];
  trip.segments.forEach((seg, si) => {
    transitPointsFor(seg, trip.settings.maxDriveHours).forEach((p, k) => {
      out.push({
        ...p,
        id: `t-${si}-${k}`,
        segmentIndex: si,
        name: trip.transitNames[coordKey(p)] ?? 'Zwischenstopp',
      });
    });
  });
  return out;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function formatDate(iso: string, withWeekday = true): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('de-DE', {
    weekday: withWeekday ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** Kurzform "4.12." */
export function formatDateShort(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}.${m}.`;
}

export type ItineraryItem =
  | { type: 'start'; place: Place; date: string }
  | {
      type: 'drive';
      distanceKm: number;
      durationH: number;
      date: string;
      segmentIndex: number;
      long: boolean;
      /** Teilstück der Etappe (bei Zwischenstopps), 0-basiert, und Anzahl der Teilstücke */
      part: number;
      parts: number;
    }
  | { type: 'transit'; transit: TransitStop; arrive: string; depart: string }
  | { type: 'stop'; stop: Stop; index: number; arrive: string; depart: string }
  | { type: 'end'; place: Place; date: string };

export interface ItinerarySummary {
  items: ItineraryItem[];
  totalKm: number;
  totalDriveH: number;
  nightsUsed: number;
  transitNights: number;
  endDate: string;
  longestDayH: number;
}

/** Baut den Tagesablauf: Start → (Fahrt, Zwischenstopps) → Stop → … → Ziel. */
export function buildItinerary(trip: Trip): ItinerarySummary {
  const { settings, stops, segments } = trip;
  const items: ItineraryItem[] = [];
  let date = settings.startDate;
  items.push({ type: 'start', place: settings.start, date });
  const transits = allTransitStops(trip);
  let totalKm = 0;
  let totalDriveH = 0;
  let longestDayH = 0;
  let transitNights = 0;
  const valid = segments.length === stops.length + 1;

  for (let si = 0; si <= stops.length; si++) {
    const seg = valid ? segments[si] : undefined;
    if (seg && seg.distanceKm > 0.5) {
      const segTransits = transits.filter((t) => t.segmentIndex === si);
      const parts = segTransits.length + 1;
      const partH = seg.durationH / parts;
      const partKm = seg.distanceKm / parts;
      totalKm += seg.distanceKm;
      totalDriveH += seg.durationH;
      longestDayH = Math.max(longestDayH, partH);
      for (let p = 0; p < parts; p++) {
        items.push({
          type: 'drive',
          distanceKm: partKm,
          durationH: partH,
          date,
          segmentIndex: si,
          long: partH > settings.maxDriveHours * 1.15,
          part: p,
          parts,
        });
        if (p < segTransits.length) {
          items.push({ type: 'transit', transit: segTransits[p], arrive: date, depart: addDays(date, 1) });
          date = addDays(date, 1);
          transitNights++;
        }
      }
    }
    if (si < stops.length) {
      const stop = stops[si];
      const depart = addDays(date, stop.nights);
      items.push({ type: 'stop', stop, index: si, arrive: date, depart });
      date = depart;
    }
  }
  const end = settings.end ?? settings.start;
  items.push({ type: 'end', place: end, date });
  return {
    items,
    totalKm,
    totalDriveH,
    nightsUsed: stops.reduce((a, s) => a + s.nights, 0) + transitNights,
    transitNights,
    endDate: date,
    longestDayH,
  };
}
