/**
 * Minimale Auswertung von OSM-opening_hours für Saisonzeiten,
 * z. B. "May-Sep", "Apr 15-Oct 15 08:00-22:00", "Mo-Su 08:00-20:00; Nov-Mar off".
 * Uhrzeiten und Wochentage werden ignoriert – es geht nur darum, ob der Platz
 * im Reisezeitraum überhaupt geöffnet hat.
 */

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export type SeasonStatus = 'open' | 'closed' | 'unknown';

type Range = [number, number]; // Tag im Jahr, Anfang/Ende inklusive, ggf. über den Jahreswechsel

const M = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?![a-z])';
const DAY = '(?:\\s*(\\d{1,2})(?![\\d:]))';
/** Monat [Tag] [- [Monat] [Tag]] – Tageszahlen direkt vor ":" sind Uhrzeiten und zählen nicht. */
const RANGE_RE = new RegExp(`\\b${M}${DAY}?(?:\\s*-\\s*(?:${M})?${DAY}?)?`, 'gi');

function doy(month: number, day: number): number {
  return CUM[month] + Math.min(day, MONTH_DAYS[month]) - 1;
}

function parseRanges(rule: string): Range[] {
  const ranges: Range[] = [];
  for (const m of rule.matchAll(RANGE_RE)) {
    const m1 = MONTHS[m[1].toLowerCase()];
    const d1 = m[2] ? Number(m[2]) : 1;
    const hasDash = m[0].includes('-');
    const m2 = m[3] ? MONTHS[m[3].toLowerCase()] : m1;
    const d2 = m[4] ? Number(m[4]) : !hasDash && m[2] ? d1 : MONTH_DAYS[m2];
    ranges.push([doy(m1, d1), doy(m2, d2)]);
  }
  return ranges;
}

const inRange = (d: number, [a, b]: Range) => (a <= b ? d >= a && d <= b : d >= a || d <= b);

function isoDoy(iso: string): number {
  return doy(Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

const TEXT_MONTHS: [RegExp, string][] = [
  [/\b(january|januar|jänner)\b/gi, 'Jan'],
  [/\b(february|februar)\b/gi, 'Feb'],
  [/\b(march|märz|maerz)\b/gi, 'Mar'],
  [/\b(april)\b/gi, 'Apr'],
  [/\b(mai)\b/gi, 'May'],
  [/\b(june|juni)\b/gi, 'Jun'],
  [/\b(july|juli)\b/gi, 'Jul'],
  [/\b(august)\b/gi, 'Aug'],
  [/\b(september)\b/gi, 'Sep'],
  [/\b(october|oktober)\b/gi, 'Oct'],
  [/\b(november)\b/gi, 'Nov'],
  [/\b(december|dezember)\b/gi, 'Dec'],
];
const SHORT = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)';
/** Monatskürzel als eigenes Wort ("Jun", "Sept.", aber nicht "Junction") */
const TOKEN = `\\b(${SHORT})t?\\.?(?![a-z])`;
const MONTH = `${SHORT}(?![a-z])`;
const TEXT_RANGE = new RegExp(`\\b${MONTH}(?:\\s*\\d{1,2})?\\s*-\\s*${MONTH}(?:\\s*\\d{1,2})?`, 'gi');

/**
 * Liest Saisonzeiten aus Freitext, z. B. "Open from May to September" oder
 * "geöffnet April–Oktober". Liefert eine opening_hours-artige Angabe oder null.
 * Nur Sätze mit "open/geöffnet/season/closed …" und einem Monatsbereich zählen.
 */
export function seasonFromText(text: string | undefined): string | null {
  if (!text) return null;
  const rules: string[] = [];
  for (const sentence of text.split(/[.;!?\n]/)) {
    const open = /\b(open|opens|geöffnet|season|saison|operat)/i.test(sentence);
    const closed = /\b(closed|geschlossen)\b/i.test(sentence);
    if (!open && !closed) continue;
    let s = sentence;
    for (const [re, short] of TEXT_MONTHS) s = s.replace(re, short);
    s = s.replace(new RegExp(TOKEN, 'gi'), '$1');
    s = s.replace(
      new RegExp(`\\b(${MONTH}(?:\\s*\\d{1,2})?)\\s*(?:to|until|till|through|thru|bis|–|—|-)\\s*(${MONTH})`, 'gi'),
      '$1-$2',
    );
    const ranges = s.match(TEXT_RANGE);
    if (!ranges) continue;
    rules.push(...ranges.map((r) => (closed && !open ? `${r} off` : r)));
  }
  return rules.length ? rules.join('; ') : null;
}

export interface AccommodationSeason {
  status: SeasonStatus;
  /** woher die Angabe stammt */
  source: 'opening_hours' | 'seasonal' | 'text' | 'none';
  /** OSM seasonal=yes ohne nähere Angabe */
  seasonalUnknown?: boolean;
}

/**
 * Saisonstatus einer Unterkunft aus allen verfügbaren Angaben:
 * opening_hours → OSM-Tag seasonal → Beschreibungstext.
 */
export function accommodationSeason(
  a: { openingHours?: string; seasonal?: string; description?: string; lat: number },
  arrive: string,
  lastNight: string = arrive,
): AccommodationSeason {
  if (a.openingHours) {
    const status = seasonStatus(a.openingHours, arrive, lastNight);
    if (status !== 'unknown') return { status, source: 'opening_hours' };
  }
  const seasonal = a.seasonal?.toLowerCase();
  if (seasonal === 'no') return { status: 'open', source: 'seasonal' };
  if (seasonal === 'summer' || seasonal === 'winter') {
    const south = a.lat < 0;
    const isSummerTag = (seasonal === 'summer') !== south;
    // Nordhalbkugel: Sommer = Mai–Sep, Winter = Dez–Mär
    const oh = isSummerTag ? 'May-Sep' : 'Dec-Mar';
    return { status: seasonStatus(oh, arrive, lastNight), source: 'seasonal' };
  }
  const fromText = seasonFromText(a.description);
  if (fromText) {
    const status = seasonStatus(fromText, arrive, lastNight);
    if (status !== 'unknown') return { status, source: 'text' };
  }
  return { status: 'unknown', source: 'none', seasonalUnknown: seasonal === 'yes' };
}

/** Hat die Unterkunft am Anreisetag und in der letzten Nacht geöffnet? */
export function seasonStatus(openingHours: string | undefined, arrive: string, lastNight: string = arrive): SeasonStatus {
  if (!openingHours) return 'unknown';
  const oh = openingHours.trim();
  if (/^24\/7$/.test(oh)) return 'open';
  const days = [isoDoy(arrive), isoDoy(lastNight)];
  const open: Range[] = [];
  const closed: Range[] = [];
  let general = false;
  for (const raw of oh.split(/;|\|\|/)) {
    const rule = raw.trim();
    if (!rule) continue;
    const off = /\b(off|closed)\b/i.test(rule);
    const ranges = parseRanges(rule);
    if (ranges.length === 0) {
      if (!off) general = true;
      continue;
    }
    (off ? closed : open).push(...ranges);
  }
  if (days.some((d) => closed.some((r) => inRange(d, r)))) return 'closed';
  if (open.length > 0) return days.every((d) => open.some((r) => inRange(d, r))) ? 'open' : 'closed';
  if (closed.length > 0 || general) return 'open';
  return 'unknown';
}
