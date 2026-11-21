import type { PublicHoliday, SchoolHolidayEntry } from '../api/holidays';

/** Feiertage, die in einen Aufenthalt fallen (Anreise bis Abreisetag einschließlich). */
export function holidaysDuring(holidays: PublicHoliday[], arrive: string, depart: string): PublicHoliday[] {
  const seen = new Set<string>();
  return holidays
    .filter((h) => h.date >= arrive && h.date <= depart)
    .filter((h) => {
      // gleiche Feiertage für mehrere Regionen nur einmal
      const key = `${h.date}:${h.localName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export interface SchoolHolidayRange {
  start: string;
  end: string;
  /** nur in einzelnen Regionen bzw. gestaffelt */
  regional: boolean;
}

/**
 * Fasst Schulferien zu einem Zeitraum zusammen, der die Reise überlappt.
 * Ignoriert Einzeltage ("Unterrichtsende", bewegliche Ferientage) und kleine Überseegebiete
 * (nur eine Region und nicht landesweit), sofern es größere Einträge gibt.
 */
export function mergeSchoolHolidays(entries: SchoolHolidayEntry[], from: string, to: string): SchoolHolidayRange | null {
  const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000 + 1;
  const relevant = entries
    .filter((e) => !/unterrichtsende|beweglich/i.test(e.name))
    .filter((e) => days(e.startDate, e.endDate) >= 5)
    .filter((e) => e.startDate <= to && e.endDate >= from);
  // Nur landesweite Ferien oder solche in mehreren Regionen – einzelne Überseegebiete
  // (z. B. Réunion mit Südwinterferien) würden sonst als „Schulferien in Frankreich“ erscheinen.
  const use = relevant.filter((e) => e.nationwide || e.regions >= 2);
  if (use.length === 0) return null;
  return {
    start: use.reduce((m, e) => (e.startDate < m ? e.startDate : m), use[0].startDate),
    end: use.reduce((m, e) => (e.endDate > m ? e.endDate : m), use[0].endDate),
    regional: !use.some((e) => e.nationwide) || new Set(use.map((e) => `${e.startDate}:${e.endDate}`)).size > 1,
  };
}
