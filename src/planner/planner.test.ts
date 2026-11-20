import { describe, expect, it } from 'vitest';
import type { Candidate, Segment, Stop, Trip, TripSettings } from '../types';
import { haversineKm, pointAtFraction, splitLineByLengths } from '../lib/geo';
import { selectStops, transitNightsFor, twoOpt } from './select';
import { fitNights, recommendNights } from './nights';
import { addDays, buildItinerary, transitPointsFor } from './itinerary';
import { applyNights } from './plan';
import { scoreCandidate, tagsFor } from './candidates';

const cand = (name: string, lat: number, lon: number, score = 5): Candidate => ({
  id: name,
  name,
  kind: 'city',
  lat,
  lon,
  tags: [],
  score,
});

describe('geo', () => {
  it('Haversine Oslo–Bergen ≈ 305 km', () => {
    expect(haversineKm({ lat: 59.91, lon: 10.75 }, { lat: 60.39, lon: 5.32 })).toBeGreaterThan(295);
    expect(haversineKm({ lat: 59.91, lon: 10.75 }, { lat: 60.39, lon: 5.32 })).toBeLessThan(315);
  });

  it('Punkt in der Mitte einer Linie', () => {
    const p = pointAtFraction(
      [
        [0, 0],
        [0, 1],
        [0, 2],
      ],
      0.75,
    );
    expect(p.lat).toBeCloseTo(0);
    expect(p.lon).toBeCloseTo(1.5);
  });

  it('teilt eine Linie nach Teillängen', () => {
    const line: [number, number][] = [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ];
    const parts = splitLineByLengths(line, [100, 200]);
    expect(parts).toHaveLength(2);
    expect(parts[0][0]).toEqual([0, 0]);
    expect(parts[0][parts[0].length - 1]).toEqual(parts[1][0]);
    expect(parts[1][parts[1].length - 1]).toEqual([0, 3]);
  });
});

describe('Zwischenstopps', () => {
  it('teilt nur Etappen, die deutlich über der Tagesfahrzeit liegen', () => {
    expect(transitNightsFor(4, 5)).toBe(0);
    expect(transitNightsFor(5.5, 5)).toBe(0);
    expect(transitNightsFor(6, 5)).toBe(1);
    expect(transitNightsFor(12, 5)).toBe(2);
  });

  it('verteilt Zwischenstopps entlang der Geometrie', () => {
    const seg: Segment = {
      distanceKm: 1000,
      durationH: 12,
      geometry: [
        [0, 0],
        [0, 9],
      ],
    };
    const pts = transitPointsFor(seg, 5);
    expect(pts).toHaveLength(2);
    expect(pts[0].lon).toBeCloseTo(3);
    expect(pts[1].lon).toBeCloseTo(6);
  });
});

describe('Stop-Auswahl', () => {
  // Kandidaten auf einer Linie, Fahrzeit = Luftlinie / 60 km/h
  const cands = [cand('A', 0, 1, 6), cand('B', 0, 2, 5), cand('C', 0, 3, 7), cand('D', 0, 20, 9)];
  const pts = [{ lat: 0, lon: 0 }, { lat: 0, lon: 4 }, ...cands];
  const duration = (a: number, b: number) => haversineKm(pts[a], pts[b]) / 60;

  it('bleibt im Nächte-Budget und meidet weite Umwege', () => {
    const res = selectStops({ candidates: cands, duration, nights: 6, pace: 'normal', maxDriveH: 5, travelFactor: 1 });
    expect(res.estimatedNights).toBeLessThanOrEqual(6);
    expect(res.order.map((i) => cands[i].name)).toEqual(['A', 'B', 'C']);
  });

  it('wählt bei kleinem Budget weniger Stops', () => {
    const res = selectStops({ candidates: cands, duration, nights: 2, pace: 'normal', maxDriveH: 5, travelFactor: 1 });
    expect(res.order).toHaveLength(1);
  });

  it('ignoriert unerreichbare Ziele', () => {
    const res = selectStops({
      candidates: cands,
      // Knoten 4 = Kandidat C (0 = Start, 1 = Ziel, 2 + i = Kandidat i)
      duration: (a, b) => (a === 4 || b === 4 ? null : duration(a, b)),
      nights: 30,
      pace: 'normal',
      maxDriveH: 5,
      travelFactor: 1,
    });
    expect(res.order.map((i) => cands[i].name)).not.toContain('C');
  });

  it('2-opt entknotet eine Route', () => {
    const p = [0, 3, 2, 1, 4];
    const cost = (a: number, b: number) => Math.abs(a - b);
    expect(twoOpt(p, cost)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('Aufenthaltsdauer', () => {
  const base = { kind: 'city' as const, tags: [], interests: [], pace: 'normal' as const, maxDriveH: 5 };

  it('mehr Programm → mehr Nächte', () => {
    const small = recommendNights({ ...base, info: { seeCount: 2, doCount: 1 } });
    const big = recommendNights({ ...base, info: { seeCount: 40, doCount: 16 } });
    expect(small.nights).toBe(1);
    expect(big.nights).toBeGreaterThanOrEqual(3);
    expect(big.reasons[0]).toContain('40 Sehenswürdigkeiten');
  });

  it('Tempo beeinflusst die Dauer', () => {
    const info = { seeCount: 20, doCount: 10 };
    const relaxed = recommendNights({ ...base, info, pace: 'relaxed' }).nights;
    const fast = recommendNights({ ...base, info, pace: 'fast' }).nights;
    expect(relaxed).toBeGreaterThan(fast);
  });

  it('Ruhetag nach langer Fahrt', () => {
    const r = recommendNights({ ...base, info: { seeCount: 1, doCount: 0 }, arrivalDriveH: 4.5 });
    expect(r.nights).toBe(2);
    expect(r.reasons.at(-1)).toContain('Fahrt');
  });

  it('verteilt das Nächte-Budget und respektiert manuelle Werte', () => {
    const items = [
      { recommended: 3, score: 5, manual: false, nights: 0 },
      { recommended: 1, score: 3, manual: false, nights: 0 },
      { recommended: 2, score: 4, manual: true, nights: 4 },
    ];
    const down = fitNights(items, 7);
    expect(down.nights.reduce((a, b) => a + b, 0)).toBe(7);
    expect(down.nights[2]).toBe(4);
    const up = fitNights(items, 12);
    expect(up.nights.reduce((a, b) => a + b, 0)).toBe(12);
    expect(up.nights[0]).toBeGreaterThan(up.nights[1]);
    const tooFew = fitNights(items, 5);
    expect(tooFew.nights).toEqual([1, 1, 4]);
    expect(tooFew.overflow).toBe(1);
  });
});

describe('Kandidaten-Bewertung', () => {
  it('erkennt Themen aus der Beschreibung', () => {
    expect(tagsFor('nature', 'Largest glacier with great hiking trails')).toEqual(
      expect.arrayContaining(['nature', 'hiking']),
    );
    expect(tagsFor('city', 'Old town with a medieval cathedral')).toEqual(expect.arrayContaining(['culture', 'city']));
  });

  it('bevorzugt passende Interessen', () => {
    const nature = scoreCandidate({ kind: 'nature', tags: ['nature', 'hiking'], rank: 3, depth: 0 }, ['nature', 'hiking']);
    const city = scoreCandidate({ kind: 'city', tags: ['city'], rank: 0, depth: 0 }, ['nature', 'hiking']);
    expect(nature).toBeGreaterThan(city);
  });

  it('Highlights der Region schlagen Orte aus Unterregionen', () => {
    const top = scoreCandidate({ kind: 'nature', tags: ['nature'], rank: 5, depth: 0 }, ['nature']);
    const sub = scoreCandidate({ kind: 'nature', tags: ['nature'], rank: 0, depth: 1 }, ['nature']);
    expect(top).toBeGreaterThan(sub + 2);
  });
});

describe('Reiseablauf', () => {
  const settings: TripSettings = {
    region: { name: 'Test', label: 'Test', osmType: 'R', osmId: 1, center: { lat: 0, lon: 0 } },
    start: { name: 'Start', lat: 0, lon: 0 },
    end: null,
    startDate: '2026-07-01',
    nights: 8,
    style: 'camper',
    pace: 'normal',
    maxDriveHours: 5,
    interests: [],
  };
  const stop = (name: string, lon: number, seeCount: number): Stop => ({
    id: name,
    name,
    kind: 'city',
    tags: [],
    score: 5,
    lat: 0,
    lon,
    nights: 1,
    recommendedNights: 1,
    manualNights: false,
    reasons: [],
    info: { seeCount, doCount: 0, articleLength: 0, sleep: [] },
  });
  const seg = (fromLon: number, toLon: number, h: number): Segment => ({
    distanceKm: h * 80,
    durationH: h,
    geometry: [
      [0, fromLon],
      [0, toLon],
    ],
  });

  const trip: Trip = {
    id: 't',
    name: 't',
    createdAt: 0,
    updatedAt: 0,
    settings,
    candidates: [],
    stops: [stop('A', 1, 30), stop('B', 2, 3)],
    segments: [seg(0, 1, 11), seg(1, 2, 2), seg(2, 0, 3)],
    transitNames: {},
    warnings: [],
  };

  it('verplant genau das Nächte-Budget inkl. Zwischenstopps', () => {
    const planned = applyNights(trip);
    const summary = buildItinerary(planned);
    expect(summary.transitNights).toBe(2);
    expect(summary.nightsUsed).toBe(8);
    expect(summary.endDate).toBe(addDays('2026-07-01', 8));
    expect(planned.stops[0].nights).toBeGreaterThan(planned.stops[1].nights);
  });

  it('liefert Datum pro Stop', () => {
    const summary = buildItinerary(applyNights(trip));
    const stops = summary.items.filter((i) => i.type === 'stop');
    expect(stops[0].type === 'stop' && stops[0].arrive).toBe('2026-07-03');
    const types = summary.items.map((i) => i.type);
    expect(types).toEqual(['start', 'drive', 'transit', 'drive', 'transit', 'drive', 'stop', 'drive', 'stop', 'drive', 'end']);
  });
});

describe('Route an Wegpunkten teilen', () => {
  it('schneidet am nächstgelegenen Punkt statt nach Streckenanteil', async () => {
    const { splitLineAtWaypoints } = await import('../lib/geo');
    // Linie 0→10° Länge; Wegpunkt bei 7°, obwohl die Etappenlängen 50:50 sagen
    const line: [number, number][] = Array.from({ length: 11 }, (_, i) => [0, i]);
    const parts = splitLineAtWaypoints(line, [500, 500], [[0.01, 7]]);
    expect(parts).toHaveLength(2);
    expect(parts[0].at(-1)).toEqual([0.01, 7]);
    expect(parts[1][0]).toEqual([0.01, 7]);
    expect(parts[1].at(-1)).toEqual([0, 10]);
  });

  it('Rundreise: Wegpunkt nahe Start wird nicht am Anfang geschnitten', async () => {
    const { splitLineAtWaypoints } = await import('../lib/geo');
    // Hin über Breite 0, zurück über Breite 0.05 (fast gleicher Weg)
    const out: [number, number][] = Array.from({ length: 11 }, (_, i) => [0, i]);
    const back: [number, number][] = Array.from({ length: 11 }, (_, i) => [0.05, 10 - i]);
    const line = [...out, ...back];
    // Wegpunkt B liegt auf dem Rückweg, ist aber näher an der Hinfahrt ([0,1]) als an [0.05,1]
    const parts = splitLineAtWaypoints(line, [111, 2003, 111], [
      [0, 1],
      [0.02, 1],
    ]);
    expect(parts).toHaveLength(3);
    expect(parts[0].length).toBeLessThan(5);
    expect(parts[1].length).toBeGreaterThan(15);
    expect(parts[2].length).toBeLessThan(5);
  });

  it('Etappen aus OSRM-Ergebnis mit Ankunftspunkten (auch Rundreise)', async () => {
    const { segmentsFrom } = await import('./plan');
    const res = {
      order: [0, 1],
      legs: [
        { distanceKm: 100, durationH: 1 },
        { distanceKm: 100, durationH: 1 },
      ],
      geometry: [
        [0, 0],
        [0, 1],
        [0, 0],
      ] as [number, number][],
      waypoints: [
        [0, 0],
        [0, 1],
      ] as [number, number][],
    };
    const segs = segmentsFrom(res, 1.5);
    expect(segs).toHaveLength(2);
    expect(segs[0].end).toEqual([0, 1]);
    expect(segs[1].end).toEqual([0, 0]);
    expect(segs[0].durationH).toBe(1.5);
  });
});
