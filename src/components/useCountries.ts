import { useEffect, useState } from 'react';
import type { GeoPoint } from '../types';
import { reverseCountry, type CountryInfo } from '../api/geocode';
import { mapLimit } from '../api/http';
import { coordKey } from '../lib/geo';

/** Land (und Landesteil) für eine Liste von Punkten, Schlüssel = coordKey. */
export function useCountries(points: GeoPoint[]): Record<string, CountryInfo> {
  const [countries, setCountries] = useState<Record<string, CountryInfo>>({});
  const keys = points.map(coordKey);
  const signature = keys.join('|');

  useEffect(() => {
    let cancelled = false;
    const missing = points.filter((p) => !countries[coordKey(p)]);
    if (missing.length === 0) return;
    mapLimit(missing, 2, async (p) => [coordKey(p), await reverseCountry(p).catch(() => ({}) as CountryInfo)] as const).then(
      (pairs) => {
        if (!cancelled) setCountries((c) => ({ ...c, ...Object.fromEntries(pairs) }));
      },
    );
    return () => {
      cancelled = true;
    };
    // Nur neu laden, wenn sich die Punkte ändern
  }, [signature]);

  return countries;
}
