import { describe, expect, it } from 'vitest';
import type { DailySeries } from '../api/weather';
import {
  bestMonths,
  dayOfYear,
  daylightHours,
  forecastStats,
  formatMonths,
  monthlyNormals,
  monthsBetween,
  passWarning,
  robustMax,
  sampleLine,
  stayDates,
  stopWarnings,
  travelTimeWarnings,
  windowStats,
  type MonthNormal,
} from './season';
import { seasonStatus } from '../lib/openingHours';

/** Künstliche Zeitreihe: 2 Jahre, Temperatur folgt dem Monat, Regen im Winter. */
function fakeSeries(): DailySeries {
  const s: DailySeries = { time: [], tmax: [], tmin: [], precip: [], snow: [] };
  for (const year of [2024, 2025]) {
    const d = new Date(Date.UTC(year, 0, 1));
    while (d.getUTCFullYear() === year) {
      const m = d.getUTCMonth();
      const summer = 1 - Math.abs(m - 6) / 6; // 0 im Januar, 1 im Juli
      s.time.push(d.toISOString().slice(0, 10));
      s.tmax.push(2 + summer * 20);
      s.tmin.push(-4 + summer * 14);
      s.precip.push(summer < 0.3 ? 5 : d.getUTCDate() % 4 === 0 ? 2 : 0);
      s.snow.push(m === 0 || m === 11 ? 2 : 0);
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  return s;
}

describe('Datum', () => {
  it('Tag im Jahr', () => {
    expect(dayOfYear('2026-01-01')).toBe(0);
    expect(dayOfYear('2024-12-31')).toBe(364);
    expect(dayOfYear('2024-02-29')).toBe(dayOfYear('2025-02-28'));
  });
  it('Aufenthaltstage', () => {
    expect(stayDates('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
    expect(stayDates('2026-07-01', '2026-07-01')).toEqual(['2026-07-01']);
  });
  it('Monate zwischen zwei Daten (auch über Jahreswechsel)', () => {
    expect(monthsBetween('2026-12-20', '2027-01-05')).toEqual([11, 0]);
    expect(monthsBetween('2026-07-01', '2026-07-20')).toEqual([6]);
  });
});

describe('Tageslicht', () => {
  it('Oslo im Dezember ca. 6 h, im Juni ca. 19 h', () => {
    expect(daylightHours(59.9, '2026-12-21')).toBeGreaterThan(5.5);
    expect(daylightHours(59.9, '2026-12-21')).toBeLessThan(6.5);
    expect(daylightHours(59.9, '2026-06-21')).toBeGreaterThan(18.5);
  });
  it('Polarnacht und Mitternachtssonne in Tromsø', () => {
    expect(daylightHours(69.65, '2026-12-21')).toBe(0);
    expect(daylightHours(69.65, '2026-06-21')).toBe(24);
  });
  it('Äquator ca. 12 h', () => {
    expect(daylightHours(0, '2026-03-20')).toBeCloseTo(12.1, 0);
  });
});

describe('Wetter-Statistik', () => {
  const s = fakeSeries();
  it('typisches Wetter im Juli', () => {
    const w = windowStats(s, '2026-07-10', '2026-07-13')!;
    expect(w.tmax).toBeCloseTo(22, 0);
    expect(w.rainShare).toBeLessThan(0.4);
    expect(w.snowShare).toBe(0);
    expect(w.source).toBe('climate');
  });
  it('Fenster über den Jahreswechsel', () => {
    const w = windowStats(s, '2026-12-30', '2027-01-02')!;
    expect(w.tmax).toBeLessThan(6);
    expect(w.snowShare).toBe(1);
    // 3 Tage + 2×3 Puffertage = 9 Kalendertage × 2 Jahre
    expect(w.days).toBe(18);
  });
  it('Vorhersage nur, wenn alle Tage abgedeckt sind', () => {
    expect(forecastStats(s, '2025-12-30', '2026-01-02')).toBeNull();
    expect(forecastStats(s, '2025-07-01', '2025-07-03')?.days).toBe(2);
  });
  it('Monatswerte und beste Reisezeit', () => {
    const n = monthlyNormals(s);
    expect(n).toHaveLength(12);
    expect(n[6].tmax).toBeCloseTo(22, 0);
    const best = bestMonths(n, []);
    expect(best).toContain(6);
    expect(best).not.toContain(0);
  });
});

describe('Monate formatieren', () => {
  it('Bereiche, auch über den Jahreswechsel', () => {
    expect(formatMonths([5, 6, 7])).toBe('Jun–Aug');
    expect(formatMonths([11, 0, 1])).toBe('Dez–Feb');
    expect(formatMonths([4, 8])).toBe('Mai, Sep');
    expect(formatMonths([...Array(12).keys()])).toBe('ganzjährig');
  });
});

describe('Hinweise', () => {
  const winter = { tmax: 1, tmin: -6, rainShare: 0.6, snowShare: 0.4, days: 10, source: 'climate' as const };
  const summer = { tmax: 22, tmin: 12, rainShare: 0.2, snowShare: 0, days: 10, source: 'climate' as const };

  it('Winter mit Zelt: Frost, Schnee, Regen, kurze Tage', () => {
    const w = stopWarnings({ stats: winter, daylightH: 5, style: 'tent', kind: 'nature', elevation: 1500 });
    const text = w.map((x) => x.text).join(' | ');
    expect(text).toContain('Zelten nur mit Winterausrüstung');
    expect(text).toContain('Schneefall');
    expect(text).toContain('Regen');
    expect(text).toContain('Tageslicht');
    expect(text).toContain('1.500 m');
    expect(text).toContain('Wanderwege');
  });

  it('Sommer: keine Warnungen, Mitternachtssonne als Pluspunkt', () => {
    const w = stopWarnings({ stats: summer, daylightH: 24, style: 'camper', kind: 'city' });
    expect(w).toEqual([expect.objectContaining({ level: 'good' })]);
  });

  it('Pass-Hinweis nur bei Kälte und Höhe', () => {
    expect(passWarning(1450, [winter])?.text).toContain('1.450 m');
    expect(passWarning(1450, [summer])).toBeNull();
    expect(passWarning(400, [winter])).toBeNull();
    expect(passWarning(1450, [null])).toBeNull();
  });

  it('Reisezeit-Bewertung', () => {
    const normals: MonthNormal[] = Array.from({ length: 12 }, (_, m) => ({
      month: m,
      tmax: m >= 5 && m <= 7 ? 22 : 3,
      tmin: 0,
      rainShare: 0.3,
      snowShare: m === 11 ? 0.3 : 0,
    }));
    const dec = travelTimeWarnings(normals, [11], [], 'camper');
    expect(dec.best).toEqual([5, 6, 7]);
    expect(dec.warnings[0].text).toContain('Jun–Aug');
    expect(dec.warnings.some((w) => w.text.includes('Campingplätze'))).toBe(true);
    const jul = travelTimeWarnings(normals, [6], [], 'camper');
    expect(jul.warnings[0].level).toBe('good');
  });

  it('Routenpunkte und robuster Höchstwert', () => {
    const pts = sampleLine(
      [
        [0, 0],
        [0, 1],
        [0, 2],
      ],
      100,
    );
    expect(pts.length).toBe(3);
    expect(robustMax([100, 2000, 900, 850])).toBe(900);
    expect(robustMax([500, 700])).toBe(700);
  });
});

describe('Öffnungszeiten (Saison)', () => {
  it('Saisonbereiche', () => {
    expect(seasonStatus('May-Sep', '2026-07-10')).toBe('open');
    expect(seasonStatus('May-Sep', '2026-12-10')).toBe('closed');
    expect(seasonStatus('Apr 15-Oct 15 08:00-22:00', '2026-04-20')).toBe('open');
    expect(seasonStatus('Apr 15-Oct 15 08:00-22:00', '2026-04-10')).toBe('closed');
    expect(seasonStatus('Jun 01-30', '2026-06-15')).toBe('open');
  });
  it('über den Jahreswechsel', () => {
    expect(seasonStatus('Nov-Mar', '2026-01-10')).toBe('open');
    expect(seasonStatus('Nov-Mar', '2026-07-10')).toBe('closed');
  });
  it('allgemeine Zeiten mit Schließzeit', () => {
    expect(seasonStatus('Mo-Su 08:00-20:00; Nov-Mar off', '2026-12-01')).toBe('closed');
    expect(seasonStatus('Mo-Su 08:00-20:00; Nov-Mar off', '2026-08-01')).toBe('open');
    expect(seasonStatus('24/7', '2026-12-01')).toBe('open');
    expect(seasonStatus('Mo-Fr 09:00-17:00', '2026-12-01')).toBe('open');
  });
  it('Uhrzeiten werden nicht als Tage gelesen', () => {
    expect(seasonStatus('May 08:00-20:00', '2026-05-20')).toBe('open');
  });
  it('unbekannt ohne Angabe', () => {
    expect(seasonStatus(undefined, '2026-12-01')).toBe('unknown');
    expect(seasonStatus('by appointment', '2026-12-01')).toBe('open');
  });
  it('letzte Nacht außerhalb der Saison', () => {
    expect(seasonStatus('May-Sep', '2026-09-29', '2026-10-02')).toBe('closed');
  });
});

describe('Aufenthaltsort für Klimadaten', () => {
  it('nimmt den Straßenpunkt der Ankunft statt Gipfel-Koordinate', async () => {
    const { stayPoint } = await import('./seasonReport');
    const stop = { id: 'a', name: 'Gipfel', lat: 61.6, lon: 8.3 } as never;
    const trip = {
      stops: [stop],
      segments: [
        { distanceKm: 100, durationH: 2, geometry: [[60, 8], [61.5, 8.2]] },
        { distanceKm: 100, durationH: 2, geometry: [[61.5, 8.2], [60, 8]] },
      ],
    } as never;
    expect(stayPoint(trip, 0)).toEqual({ lat: 61.5, lon: 8.2 });
    // Straßenpunkt zu weit weg (z. B. Insel ohne Straße) → Stop-Koordinate
    const far = { stops: [stop], segments: [{ geometry: [[50, 8]] }, { geometry: [] }] } as never;
    expect(stayPoint(far, 0)).toBe(stop);
  });
});
