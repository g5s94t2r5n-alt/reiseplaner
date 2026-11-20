import { useEffect, useMemo, useState } from 'react';
import type { Trip } from '../types';
import type { ItinerarySummary } from '../planner/itinerary';
import { buildSeasonReport, loadSeasonData, type SeasonData, type SeasonReport } from '../planner/seasonReport';

/**
 * Lädt Klima-, Vorhersage- und Höhendaten, sobald sich Orte oder Route ändern.
 * Änderungen an Nächten/Datum werden ohne neue Anfragen sofort neu ausgewertet.
 */
export function useSeason(trip: Trip | undefined, summary: ItinerarySummary | null) {
  const [data, setData] = useState<SeasonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const placesKey =
    trip && summary
      ? JSON.stringify([
          trip.stops.map((s) => [s.id, s.lat.toFixed(2), s.lon.toFixed(2)]),
          trip.segments.map((s) => {
            const last = s.geometry.at(-1);
            return [Math.round(s.distanceKm), last?.[0].toFixed(2), last?.[1].toFixed(2)];
          }),
          trip.settings.startDate,
          summary.endDate.slice(0, 7),
        ])
      : '';

  useEffect(() => {
    if (!trip || !summary) return;
    let cancelled = false;
    setLoading(true);
    loadSeasonData(trip, summary)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Nur bei neuen Orten/Route neu laden – trip/summary selbst ändern sich bei jeder Bearbeitung
  }, [placesKey]);

  const report: SeasonReport | null = useMemo(
    () => (trip && summary && data ? buildSeasonReport(trip, summary, data) : null),
    [data, trip, summary],
  );

  return { report, loading, error };
}
