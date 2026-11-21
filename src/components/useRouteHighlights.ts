import { useEffect, useState } from 'react';
import type { GeoPoint, Trip } from '../types';
import { loadSegmentHighlights, type RouteHighlight } from '../planner/routeHighlights';

/**
 * Lädt Unterwegs-Highlights für alle Etappen nacheinander (gecacht) und zeigt sie,
 * sobald sie da sind. Neu geladen wird nur, wenn sich die Route ändert.
 */
export function useRouteHighlights(trip: Trip | undefined): { bySegment: Record<number, RouteHighlight[]>; loading: boolean } {
  const [bySegment, setBySegment] = useState<Record<number, RouteHighlight[]>>({});
  const [loading, setLoading] = useState(false);
  const key = trip
    ? JSON.stringify([
        trip.segments.map((s) => [Math.round(s.distanceKm), s.end?.[0].toFixed(2), s.end?.[1].toFixed(2)]),
        trip.stops.map((s) => [s.lat.toFixed(2), s.lon.toFixed(2)]),
      ])
    : '';

  useEffect(() => {
    if (!trip) return;
    let cancelled = false;
    const avoid: GeoPoint[] = [trip.settings.start, ...(trip.settings.end ? [trip.settings.end] : []), ...trip.stops];
    setBySegment({});
    setLoading(true);
    (async () => {
      for (let i = 0; i < trip.segments.length; i++) {
        const list = await loadSegmentHighlights(trip.segments[i], avoid).catch(() => [] as RouteHighlight[]);
        if (cancelled) return;
        setBySegment((b) => ({ ...b, [i]: list }));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // nur bei geänderter Route neu laden
  }, [key]);

  return { bySegment, loading };
}
