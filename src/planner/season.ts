import type { GeoPoint, Interest, StopKind, TravelStyle } from '../types';
import type { DailySeries } from '../api/weather';
import { cumulativeKm } from '../lib/geo';

/* ---------------- Datums-Helfer ---------------- */

const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** Tag im Jahr 0..364 (Schaltjahr ignoriert, 29.2. → 28.2.). */
export function dayOfYear(iso: string): number {
  const m = Number(iso.slice(5, 7)) - 1;
  const d = Math.min(Number(iso.slice(8, 10)), m === 1 ? 28 : 31);
  return CUM_DAYS[m] + d - 1;
}

/** Alle Tage von `arrive` bis zum Tag vor `depart` (mindestens `arrive`). */
export function stayDates(arrive: string, depart: string): string[] {
  const out = [arrive];
  const d = new Date(`${arrive}T00:00:00Z`);
  const end = new Date(`${depart}T00:00:00Z`).getTime();
  for (;;) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getTime() >= end) break;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export const MONTH_NAMES = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/* ---------------- Tageslicht ---------------- */

/** Stunden zwischen Sonnenauf- und -untergang (0 = Polarnacht, 24 = Mitternachtssonne). */
export function daylightHours(lat: number, iso: string): number {
  const n = dayOfYear(iso) + 1;
  const decl = (-23.44 * Math.cos(((2 * Math.PI) / 365) * (n + 10)) * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const h0 = (-0.833 * Math.PI) / 180;
  const cosW = (Math.sin(h0) - Math.sin(phi) * Math.sin(decl)) / (Math.cos(phi) * Math.cos(decl));
  if (cosW <= -1) return 24;
  if (cosW >= 1) return 0;
  return (2 * ((Math.acos(cosW) * 180) / Math.PI)) / 15;
}

/* ---------------- Wetter-Statistik ---------------- */

export interface WindowStats {
  /** Ø Tageshöchst- / Tiefsttemperatur °C */
  tmax: number;
  tmin: number;
  /** Anteil Tage mit ≥ 1 mm Niederschlag */
  rainShare: number;
  /** Anteil Tage mit ≥ 1 cm Neuschnee */
  snowShare: number;
  days: number;
  source: 'climate' | 'forecast';
}

function aggregate(series: DailySeries, idx: number[], source: WindowStats['source']): WindowStats | null {
  let tmax = 0;
  let tmin = 0;
  let rain = 0;
  let snow = 0;
  let n = 0;
  for (const i of idx) {
    const a = series.tmax[i];
    const b = series.tmin[i];
    if (a == null || b == null) continue;
    tmax += a;
    tmin += b;
    if ((series.precip[i] ?? 0) >= 1) rain++;
    if ((series.snow[i] ?? 0) >= 1) snow++;
    n++;
  }
  if (n === 0) return null;
  return { tmax: tmax / n, tmin: tmin / n, rainShare: rain / n, snowShare: snow / n, days: n, source };
}

/**
 * Typisches Wetter im Aufenthaltszeitraum: alle Tage der Vorjahre, deren Kalendertag
 * im Zeitraum (± `padDays`) liegt – auch über den Jahreswechsel hinweg.
 */
export function windowStats(series: DailySeries, arrive: string, depart: string, padDays = 3): WindowStats | null {
  const wanted = new Set<number>();
  for (const d of stayDates(arrive, depart)) {
    const doy = dayOfYear(d);
    for (let k = -padDays; k <= padDays; k++) wanted.add((doy + k + 365) % 365);
  }
  const idx: number[] = [];
  series.time.forEach((t, i) => {
    if (wanted.has(dayOfYear(t))) idx.push(i);
  });
  return aggregate(series, idx, 'climate');
}

/** Vorhersage für genau die Aufenthaltstage – nur wenn alle Tage abgedeckt sind. */
export function forecastStats(series: DailySeries, arrive: string, depart: string): WindowStats | null {
  const idx: number[] = [];
  for (const d of stayDates(arrive, depart)) {
    const i = series.time.indexOf(d);
    if (i === -1) return null;
    idx.push(i);
  }
  return aggregate(series, idx, 'forecast');
}

export interface MonthNormal {
  month: number;
  tmax: number;
  tmin: number;
  rainShare: number;
  snowShare: number;
}

export function monthlyNormals(series: DailySeries): MonthNormal[] {
  const buckets: number[][] = Array.from({ length: 12 }, () => []);
  series.time.forEach((t, i) => buckets[Number(t.slice(5, 7)) - 1].push(i));
  return buckets.map((idx, month) => {
    const s = aggregate(series, idx, 'climate');
    return {
      month,
      tmax: s?.tmax ?? NaN,
      tmin: s?.tmin ?? NaN,
      rainShare: s?.rainShare ?? NaN,
      snowShare: s?.snowShare ?? NaN,
    };
  });
}

export function averageNormals(list: MonthNormal[][]): MonthNormal[] | null {
  const valid = list.filter((l) => l.length === 12);
  if (valid.length === 0) return null;
  return Array.from({ length: 12 }, (_, m) => {
    const avg = (k: keyof MonthNormal) => valid.reduce((a, l) => a + (l[m][k] as number), 0) / valid.length;
    return { month: m, tmax: avg('tmax'), tmin: avg('tmin'), rainShare: avg('rainShare'), snowShare: avg('snowShare') };
  });
}

/* ---------------- Beste Reisezeit ---------------- */

/** Wie angenehm ist ein Monat für eine Rundreise? (höher = besser) */
export function monthScore(n: MonthNormal, interests: Interest[]): number {
  const [lo, hi] = interests.includes('beach') ? [24, 32] : [17, 27];
  let s = 3;
  if (n.tmax < lo) s -= (lo - n.tmax) * 0.25;
  else if (n.tmax > hi) s -= (n.tmax - hi) * 0.35;
  s -= n.rainShare * 3;
  s -= n.snowShare * 2;
  return s;
}

export function bestMonths(normals: MonthNormal[], interests: Interest[]): number[] {
  const scores = normals.map((n) => monthScore(n, interests));
  const max = Math.max(...scores);
  return scores.map((s, m) => (s >= max - 0.75 ? m : -1)).filter((m) => m >= 0);
}

/** Monate als lesbare Bereiche, z. B. [5,6,7] → "Jun–Aug", [11,0,1] → "Dez–Feb". */
export function formatMonths(months: number[]): string {
  const set = new Set(months);
  if (set.size === 0) return '';
  if (set.size === 12) return 'ganzjährig';
  let start = 0;
  while (set.has(start)) start++;
  const runs: number[][] = [];
  let cur: number[] = [];
  for (let k = 1; k <= 12; k++) {
    const m = (start + k) % 12;
    if (set.has(m)) cur.push(m);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs
    .map((r) => (r.length === 1 ? MONTH_NAMES[r[0]] : `${MONTH_NAMES[r[0]]}–${MONTH_NAMES[r[r.length - 1]]}`))
    .join(', ');
}

export function monthsBetween(startIso: string, endIso: string): number[] {
  const out: number[] = [];
  let y = Number(startIso.slice(0, 4));
  let m = Number(startIso.slice(5, 7)) - 1;
  const endY = Number(endIso.slice(0, 4));
  const endM = Number(endIso.slice(5, 7)) - 1;
  while ((y < endY || (y === endY && m <= endM)) && out.length < 12) {
    out.push(m);
    m++;
    if (m === 12) {
      m = 0;
      y++;
    }
  }
  return out;
}

/* ---------------- Hinweise ---------------- */

export interface SeasonWarning {
  /** Art des Hinweises – gleiche Arten werden in der Übersicht zusammengefasst */
  key: string;
  level: 'good' | 'info' | 'warn' | 'bad';
  icon: string;
  /** konkreter Text (mit Werten) für die Stop-Karte */
  text: string;
  /** allgemeiner Text für die zusammengefasste Übersicht */
  general?: string;
}

const deg = (v: number) => `${Math.round(v)} °C`;

export function stopWarnings(a: {
  stats: WindowStats | null;
  daylightH: number;
  style: TravelStyle;
  kind: StopKind;
  elevation?: number;
}): SeasonWarning[] {
  const w: SeasonWarning[] = [];
  const add = (key: string, level: SeasonWarning['level'], icon: string, text: string, general: string) =>
    w.push({ key, level, icon, text, general });
  const s = a.stats;
  if (a.daylightH === 0) {
    add('polar', 'warn', '🌑', 'Polarnacht: Die Sonne geht nicht auf – nur Dämmerlicht für wenige Stunden.', 'Polarnacht – die Sonne geht nicht auf.');
  } else if (a.daylightH < 7) {
    add(
      'daylight',
      'warn',
      '🌒',
      `Nur ca. ${Math.round(a.daylightH)} h Tageslicht – Fahrten und Wanderungen kurz halten.`,
      'Kurze Tage (unter 7 h Tageslicht) – Fahrten und Wanderungen kurz halten.',
    );
  } else if (a.daylightH >= 24) {
    add('midnight-sun', 'good', '☀️', 'Mitternachtssonne: Es wird nicht dunkel.', 'Mitternachtssonne – es wird nicht dunkel.');
  }
  if (!s) return w;

  if (a.style === 'tent' && s.tmin < 0) {
    add('frost-tent', 'bad', '🥶', `Nachtfrost (Ø ${deg(s.tmin)}) – Zelten nur mit Winterausrüstung.`, 'Nachtfrost – Zelten nur mit Winterausrüstung.');
  } else if (a.style === 'tent' && s.tmin < 6) {
    add('cold-tent', 'warn', '🌡️', `Kalte Nächte (Ø ${deg(s.tmin)}) – warmen Schlafsack einpacken.`, 'Kalte Nächte – warmen Schlafsack einpacken.');
  } else if (a.style === 'camper' && s.tmin < -3) {
    add(
      'frost-camper',
      'warn',
      '🥶',
      `Starker Frost (Ø ${deg(s.tmin)}) – Wassertank und Leitungen frostfrei halten.`,
      'Starker Frost – Wassertank und Leitungen frostfrei halten.',
    );
  } else if (s.tmin < 0) {
    add('frost', 'warn', '🥶', `Nachtfrost wahrscheinlich (Ø ${deg(s.tmin)}).`, 'Nachtfrost wahrscheinlich.');
  }
  if (s.tmax >= 34) {
    add('heat', 'warn', '🔥', `Hitze (Ø ${deg(s.tmax)} tagsüber) – Mittagspause einplanen, viel trinken.`, 'Hitze – Mittagspause einplanen, viel trinken.');
  }
  if (s.snowShare >= 0.2) {
    add(
      'snow',
      'bad',
      '❄️',
      `Schneefall an ca. ${Math.round(s.snowShare * 10)} von 10 Tagen – Winterreifen/Schneeketten nötig.`,
      'Häufig Schneefall – Winterreifen/Schneeketten nötig.',
    );
  }
  if (s.rainShare >= 0.55) {
    add('rain', 'warn', '🌧️', `Häufig Regen (an ca. ${Math.round(s.rainShare * 10)} von 10 Tagen).`, 'Häufig Regen – Regenkleidung und Alternativprogramm einplanen.');
  }
  if (a.elevation != null && a.elevation >= 1200 && s.tmin < 0) {
    add(
      'elevation',
      'warn',
      '⛰️',
      `Liegt auf ca. ${Math.round(a.elevation).toLocaleString('de-DE')} m – Zufahrten können verschneit oder gesperrt sein.`,
      'Hoch gelegen – Zufahrten können verschneit oder gesperrt sein.',
    );
  }
  if (a.kind === 'nature' && s.tmax < 3) {
    add(
      'winter-nature',
      'warn',
      '🚧',
      'Winter: Viele Wanderwege, Bergstraßen und Besucherzentren sind geschlossen.',
      'Im Winter sind viele Wanderwege, Bergstraßen und Besucherzentren geschlossen.',
    );
  }
  return w;
}

/** Hinweis für eine Etappe durch Bergland in der kalten Jahreszeit. */
export function passWarning(maxElevation: number, stats: (WindowStats | null)[]): SeasonWarning | null {
  const known = stats.filter((s): s is WindowStats => !!s);
  if (known.length === 0 || maxElevation < 900) return null;
  const tmin = Math.min(...known.map((s) => s.tmin));
  const tmax = Math.min(...known.map((s) => s.tmax));
  const snow = Math.max(...known.map((s) => s.snowShare));
  if (tmin >= 1 && snow < 0.1) return null;
  const m = Math.round(maxElevation / 50) * 50;
  return {
    key: 'pass',
    general: 'Etappen durch Bergland (evtl. Tunnel) – im Winter sind Passstraßen oft gesperrt. Straßenzustand vor der Fahrt prüfen.',
    level: maxElevation >= 1300 && tmax < 5 ? 'bad' : 'warn',
    icon: '⛰️',
    text: `Strecke führt durch Bergland (Gelände bis ca. ${m.toLocaleString('de-DE')} m, evtl. Tunnel). Im Winter sind Passstraßen oft gesperrt – Straßenzustand vor der Fahrt prüfen.`,
  };
}

/** Punkte entlang einer Linie im Abstand von `everyKm` (inkl. Anfang und Ende). */
export function sampleLine(line: [number, number][], everyKm: number): GeoPoint[] {
  if (line.length === 0) return [];
  const cum = cumulativeKm(line);
  const total = cum[cum.length - 1];
  const out: GeoPoint[] = [];
  let next = 0;
  for (let i = 0; i < line.length; i++) {
    if (cum[i] >= next || i === line.length - 1) {
      out.push({ lat: line[i][0], lon: line[i][1] });
      next = cum[i] + everyKm;
    }
  }
  if (total === 0) return out.slice(0, 1);
  return out;
}

/** Zweithöchster Wert – robuster gegen einzelne Ausreißer (Brücken, Tunnel, Kartenfehler). */
export function robustMax(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => b - a);
  return sorted.length >= 3 ? sorted[1] : sorted[0];
}

/** Gesamtbewertung der Reisezeit für die Region. */
export function travelTimeWarnings(
  normals: MonthNormal[] | null,
  travel: number[],
  interests: Interest[],
  style: TravelStyle,
): { best: number[]; warnings: SeasonWarning[] } {
  if (!normals) return { best: [], warnings: [] };
  const best = bestMonths(normals, interests);
  const scores = normals.map((n) => monthScore(n, interests));
  const bestScore = Math.max(...scores);
  const travelScore = Math.min(...travel.map((m) => scores[m]));
  const warnings: SeasonWarning[] = [];
  if (travel.every((m) => best.includes(m))) {
    warnings.push({ key: 'travel-good', level: 'good', icon: '✅', text: 'Klimatisch eine der besten Reisezeiten für diese Route.' });
  } else if (travelScore < bestScore - 1.5) {
    const t = travel.map((m) => normals[m]);
    const cold = t.some((n) => n.tmax < 10);
    const wet = t.some((n) => n.rainShare > 0.5);
    const why = [cold && 'kalt', wet && 'nass'].filter(Boolean).join(' und ') || 'weniger angenehm';
    warnings.push({
      key: 'travel-poor',
      level: 'warn',
      icon: '📅',
      text: `Deine Reisezeit ist für diese Route eher ungünstig (${why}). Klimatisch am besten: ${formatMonths(best)}.`,
    });
  } else {
    warnings.push({ key: 'travel-ok', level: 'info', icon: '📅', text: `Ordentliche Reisezeit. Klimatisch am besten: ${formatMonths(best)}.` });
  }
  const avgMax = travel.reduce((a, m) => a + normals[m].tmax, 0) / travel.length;
  if ((style === 'camper' || style === 'tent') && avgMax < 10) {
    warnings.push({
      key: 'offseason-camping',
      level: 'warn',
      icon: '🏕️',
      text: 'Nebensaison: Viele Campingplätze haben geschlossen. Achte bei den Unterkünften auf die Öffnungszeiten.',
    });
  }
  return { best, warnings };
}
