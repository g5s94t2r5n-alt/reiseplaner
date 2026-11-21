import { cached, createLimiter, DAY, fetchJson, HttpError } from './http';

const limit = createLimiter(200, 2);

export interface PublicHoliday {
  date: string;
  localName: string;
  name: string;
  /** false = nur in einzelnen Regionen */
  global: boolean;
}

/** Gesetzliche Feiertage (Nager.Date, kostenlos, über 100 Länder). Unbekannte Länder → []. */
export async function publicHolidays(year: number, countryCode: string): Promise<PublicHoliday[]> {
  const cc = countryCode.toUpperCase();
  return cached(`holidays:${year}:${cc}`, 30 * DAY, async () => {
    try {
      const d = await limit(() =>
        fetchJson<PublicHoliday[]>(`https://date.nager.at/api/v3/PublicHolidays/${year}/${cc}`),
      );
      return Array.isArray(d) ? d.map((h) => ({ date: h.date, localName: h.localName, name: h.name, global: h.global })) : [];
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return [];
      throw e;
    }
  });
}

export interface SchoolHolidayEntry {
  startDate: string;
  endDate: string;
  name: string;
  nationwide: boolean;
  regions: number;
}

/** Schulferien (OpenHolidays, v. a. Europa). Für nicht abgedeckte Länder leere Liste. */
export async function schoolHolidays(countryCode: string, from: string, to: string): Promise<SchoolHolidayEntry[]> {
  const cc = countryCode.toUpperCase();
  const url = `https://openholidaysapi.org/SchoolHolidays?countryIsoCode=${cc}&languageIsoCode=DE&validFrom=${from}&validTo=${to}`;
  return cached(`school:${cc}:${from}:${to}`, 30 * DAY, async () => {
    try {
      const d = await limit(() =>
        fetchJson<
          {
            startDate: string;
            endDate: string;
            name?: { language: string; text: string }[];
            nationwide?: boolean;
            subdivisions?: unknown[];
          }[]
        >(url),
      );
      return (Array.isArray(d) ? d : []).map((x) => ({
        startDate: x.startDate,
        endDate: x.endDate,
        name: x.name?.[0]?.text ?? 'Ferien',
        nationwide: !!x.nationwide,
        regions: x.subdivisions?.length ?? 0,
      }));
    } catch (e) {
      // 400/404 = Land wird nicht unterstützt
      if (e instanceof HttpError && e.status < 500) return [];
      throw e;
    }
  });
}
