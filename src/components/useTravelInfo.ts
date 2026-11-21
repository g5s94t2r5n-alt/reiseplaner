import { useEffect, useState } from 'react';
import { publicHolidays, schoolHolidays, type PublicHoliday, type SchoolHolidayEntry } from '../api/holidays';
import { holidaysDuring, mergeSchoolHolidays, type SchoolHolidayRange } from '../planner/holidays';

export interface CountryStay {
  /** Ländercode, bei Schottland "GB" mit Landesteil */
  countryCode: string;
  places: { id: string; name: string; arrive: string; depart: string }[];
}

export interface CountryTravelInfo {
  countryCode: string;
  holidaysByPlace: { id: string; name: string; holidays: PublicHoliday[] }[];
  school: SchoolHolidayRange | null;
  from: string;
  to: string;
}

/** Lädt Feiertage (Nager.Date) und Schulferien (OpenHolidays) für die Länder auf der Route. */
export function useTravelInfo(stays: CountryStay[]): { info: CountryTravelInfo[]; loading: boolean } {
  const [raw, setRaw] = useState<Record<string, { holidays: PublicHoliday[]; school: SchoolHolidayEntry[] }>>({});
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify(stays.map((s) => [s.countryCode, s.places.map((p) => [p.arrive, p.depart])]));

  useEffect(() => {
    let cancelled = false;
    if (stays.length === 0) return;
    setLoading(true);
    Promise.all(
      stays.map(async (s) => {
        const from = s.places.reduce((m, p) => (p.arrive < m ? p.arrive : m), s.places[0].arrive);
        const to = s.places.reduce((m, p) => (p.depart > m ? p.depart : m), s.places[0].depart);
        const years = [...new Set([from.slice(0, 4), to.slice(0, 4)])].map(Number);
        const [hol, school] = await Promise.all([
          Promise.all(years.map((y) => publicHolidays(y, s.countryCode).catch(() => [] as PublicHoliday[]))).then((l) => l.flat()),
          schoolHolidays(s.countryCode, from, to).catch(() => [] as SchoolHolidayEntry[]),
        ]);
        return [s.countryCode, { holidays: hol, school }] as const;
      }),
    )
      .then((pairs) => !cancelled && setRaw(Object.fromEntries(pairs)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [key]);

  const info = stays.map((s) => {
    const from = s.places.reduce((m, p) => (p.arrive < m ? p.arrive : m), s.places[0].arrive);
    const to = s.places.reduce((m, p) => (p.depart > m ? p.depart : m), s.places[0].depart);
    const r = raw[s.countryCode];
    return {
      countryCode: s.countryCode,
      from,
      to,
      holidaysByPlace: s.places.map((p) => ({
        id: p.id,
        name: p.name,
        holidays: r ? holidaysDuring(r.holidays.filter((h) => h.global), p.arrive, p.depart) : [],
      })),
      school: r ? mergeSchoolHolidays(r.school, from, to) : null,
    };
  });
  return { info, loading };
}
