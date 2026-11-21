import { describe, expect, it } from 'vitest';
import type { Candidate, Trip } from '../types';
import { interestStrengths, listingProfile, seasonAdjust } from './profile';
import { rescoreCandidate } from './candidates';
import { alternativesFor } from './alternatives';

const PAGE = `==See==
* {{see| name=Old Church | content=A medieval stave church. }}
* {{see| name=Viewpoint Dalsnibba | content=Great view over the fjord. }}
==Do==
* {{do| name=Hike to Skageflå | content=Steep trail with summit views. }}
* {{do| name=Kayak tour | content=Paddle on the fjord. }}
* {{do| name=Glacier walk | content=Guided walk on the glacier. }}
==Drink==
* {{drink| name=Pub A }}
* {{drink| name=Pub B }}`;

describe('Interessen genauer erkennen', () => {
  it('zählt passende Wikivoyage-Einträge pro Interesse', () => {
    const p = listingProfile(PAGE);
    expect(p.hiking).toBe(3); // Wanderung, Kajak, Gletscher
    expect(p.culture).toBe(1);
    expect(p.nature).toBeGreaterThanOrEqual(3);
    expect(p.city).toBe(1); // 2 Bars → 1
    expect(p.beach).toBe(0);
  });

  it('Stärke aus Anteil der Einträge, Ortsart und Beschreibung (max. 3)', () => {
    const s = interestStrengths({ profile: listingProfile(PAGE), classes: ['Q45776'], descTags: ['nature'] });
    expect(s.nature).toBe(3);
    expect(s.hiking).toBe(2.5); // 3 von 5 Einträgen
    expect(s.beach).toBe(0);
    // Nationalpark ohne Einträge: Ortsart allein zählt
    expect(interestStrengths({ classes: ['Q46169'], descTags: [] }).hiking).toBe(1.5);
  });

  it('Große Stadt mit vielen Einträgen gilt nicht als Natur-/Wanderziel', () => {
    // 60 Einträge, davon 8 Natur und 6 Wandern (Stadtpark, Spaziergänge …)
    const cityProfile = { nature: 8, hiking: 6, beach: 0, culture: 30, city: 10, total: 60 };
    const parkProfile = { nature: 6, hiking: 8, beach: 0, culture: 1, city: 0, total: 10 };
    const city = interestStrengths({ profile: cityProfile, descTags: ['city'], kind: 'city' });
    const park = interestStrengths({ profile: parkProfile, descTags: ['nature'], kind: 'nature' });
    expect(city.nature + city.hiking).toBeLessThan(2);
    expect(park.nature + park.hiking).toBeGreaterThan(5);
    expect(city.culture).toBe(2.5);
  });

  it('Bewertung mit Stärken: Wanderziel schlägt Stadt für Wanderer', () => {
    const base = { id: 'x', lat: 0, lon: 0, depth: 0, rank: 3, score: 0 };
    const hikingSpot: Candidate = { ...base, name: 'Trolltunga', kind: 'nature', tags: [], strengths: { hiking: 3, nature: 3 } };
    const city: Candidate = { ...base, name: 'Stavanger', kind: 'city', tags: [], strengths: { city: 2.5, culture: 2 } };
    expect(rescoreCandidate(hikingSpot, ['hiking'])).toBeGreaterThan(rescoreCandidate(city, ['hiking']));
  });
});

describe('Jahreszeit in der Auswahl', () => {
  const stats = (tmax: number, tmin: number, snow = 0, rain = 0.3) => ({
    tmax,
    tmin,
    snowShare: snow,
    rainShare: rain,
    days: 20,
    source: 'climate' as const,
  });
  it('Naturziel im Winter klar abgewertet, Stadt kaum', () => {
    const nature = seasonAdjust({ kind: 'nature', tags: ['nature'], interests: ['nature'], stats: stats(0, -8, 0.5), elevation: 1100 });
    const city = seasonAdjust({ kind: 'city', tags: ['city'], interests: ['nature'], stats: stats(0, -8, 0.5) });
    expect(nature.delta).toBeLessThanOrEqual(-4.5);
    expect(nature.notes.join(' ')).toContain('winterlich');
    expect(city.delta).toBe(-0.5);
  });
  it('Strandziele: kühl abgewertet, warm aufgewertet', () => {
    const cold = seasonAdjust({ kind: 'nature', tags: ['beach'], interests: ['beach'], stats: stats(15, 8) });
    const warm = seasonAdjust({ kind: 'nature', tags: ['beach'], interests: ['beach'], stats: stats(27, 19, 0, 0.1) });
    expect(cold.delta).toBe(-2);
    expect(warm.delta).toBe(1);
  });
  it('Polarnacht und Dauerregen', () => {
    const r = seasonAdjust({ kind: 'nature', tags: [], interests: [], stats: stats(5, 1, 0, 0.7), daylightH: 2 });
    expect(r.delta).toBe(-1.5);
  });
  it('ohne Klimadaten keine Änderung', () => {
    expect(seasonAdjust({ kind: 'nature', tags: [], interests: [], stats: null }).delta).toBe(0);
  });
});

describe('Alternativen pro Stop', () => {
  const cand = (name: string, lon: number, score: number): Candidate => ({ id: name, name, wvTitle: name, kind: 'city', lat: 0, lon, tags: [], score });
  const trip = {
    settings: { start: { name: 'S', lat: 0, lon: 0 }, end: { name: 'E', lat: 0, lon: 4 } },
    stops: [{ id: 's1', name: 'B', wvTitle: 'B', lat: 0, lon: 2 }],
    candidates: [cand('B', 2, 5), cand('Nah', 2.2, 6), cand('Umweg', 2, 9), cand('Weg', 2, 9), cand('Gesperrt', 1.9, 9)],
    excluded: ['Gesperrt'],
  } as unknown as Trip;
  // "Umweg" liegt weit abseits
  trip.candidates[2].lat = 3;

  it('ohne aktuelle, ausgeschlossene und zu weit entfernte Orte', () => {
    const alts = alternativesFor(trip, 0);
    const names = alts.map((a) => a.candidate.name);
    expect(names).not.toContain('B');
    expect(names).not.toContain('Gesperrt');
    expect(names).not.toContain('Umweg');
    expect(names).toContain('Nah');
  });
});

describe('Keine Lückenfüller', () => {
  it('schwache Orte werden trotz freier Nächte nicht gewählt', async () => {
    const { selectStops } = await import('./select');
    const { haversineKm } = await import('../lib/geo');
    const c = (name: string, lon: number, score: number): Candidate => ({ id: name, name, kind: 'city', lat: 0, lon, tags: [], score });
    const cands = [c('Highlight', 1, 10), c('Filler', 0.3, 4)];
    const pts = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0 }, ...cands];
    const res = selectStops({
      candidates: cands,
      duration: (a, b) => haversineKm(pts[a], pts[b]) / 60,
      nights: 14,
      pace: 'normal',
      maxDriveH: 5,
      travelFactor: 1,
    });
    expect(res.order.map((i) => cands[i].name)).toEqual(['Highlight']);
  });
});

describe('Abwechslung und Abstand', () => {
  it('Ortsart aus Wikidata, sonst Art + stärkstes Interesse', async () => {
    const { typeKeyFor } = await import('./profile');
    expect(typeKeyFor('nature', ['Q45776', 'Q23397'])).toBe('Fjord');
    expect(typeKeyFor('city', ['Q515', 'Q1549591'])).toBe('Großstadt');
    expect(typeKeyFor('nature', [], { hiking: 3, nature: 2 })).toBe('nature:hiking');
  });

  it('dritter Fjord verliert gegen einen etwas schwächeren Gletscher', async () => {
    const { selectStops } = await import('./select');
    const c = (name: string, lon: number, score: number, typeKey: string): Candidate => ({ id: name, name, kind: 'nature', lat: 0, lon, tags: [], score, typeKey });
    const cands = [c('Fjord A', 1, 10, 'Fjord'), c('Fjord B', 2, 10, 'Fjord'), c('Fjord C', 3, 10, 'Fjord'), c('Gletscher', 3.5, 9, 'Gletscher')];
    const pts = [{ lat: 0, lon: 0 }, { lat: 0, lon: 4 }, ...cands];
    const res = selectStops({
      candidates: cands,
      duration: (a, b) => {
        const dx = Math.abs(pts[a].lon - pts[b].lon);
        return dx * 1.2;
      },
      nights: 6,
      pace: 'normal',
      maxDriveH: 6,
      travelFactor: 1,
    });
    const names = res.order.map((i) => cands[i].name);
    expect(names).toContain('Gletscher');
    expect(names.filter((n) => n.startsWith('Fjord')).length).toBeLessThan(3);
  });

  it('Orte unter 30 min Fahrt voneinander werden nicht beide Stops', async () => {
    const { selectStops } = await import('./select');
    const c = (name: string, lon: number, score: number): Candidate => ({ id: name, name, kind: 'city', lat: 0, lon, tags: [], score });
    const cands = [c('Siena', 1, 10), c('Nachbarort', 1.3, 9.5)]; // ~33 km, aber nur 20 min
    const pts = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0 }, ...cands];
    const res = selectStops({
      candidates: cands,
      duration: (a, b) => (a === b ? 0 : (a >= 2 && b >= 2 ? 0.33 : Math.abs(pts[a].lon - pts[b].lon))),
      nights: 10,
      pace: 'normal',
      maxDriveH: 5,
      travelFactor: 1,
    });
    expect(res.order).toHaveLength(1);
  });
});

describe('Kandidaten aus Wikidata', () => {
  it('erkennt Dubletten am Kernnamen', async () => {
    const { sameCoreName } = await import('./candidates');
    expect(sameCoreName('Dovrefjell', 'Dovrefjell-Sunndalsfjella-Nationalpark')).toBe(true);
    expect(sameCoreName('Jotunheimen', 'Jotunheimen-Nationalpark')).toBe(true);
    expect(sameCoreName('Hardangervidda', 'Hardangervidda-Nationalpark')).toBe(true);
    expect(sameCoreName('Rondane National Park', 'Dovrefjell-Nationalpark')).toBe(false);
  });

  it('übernimmt nur neue Orte und bewertet Bekanntheit über Wikipedia-Aufrufe', async () => {
    const { wikidataCandidates, applyPopularity } = await import('./candidates');
    const region = { name: 'N', label: 'N', osmType: 'R' as const, osmId: 1, center: { lat: 61, lon: 9 } };
    const existing: Candidate[] = [{ id: 'wv:Dovrefjell', name: 'Dovrefjell', wvTitle: 'Dovrefjell', kind: 'nature', lat: 62.2, lon: 9.5, tags: [], score: 10 }];
    const added = wikidataCandidates(
      [
        { qid: 'Q1', label: 'Dovrefjell-Sunndalsfjella-Nationalpark', lat: 62.5, lon: 9.0, sitelinks: 40, nationalPark: true, enTitle: 'Dovrefjell–Sunndalsfjella National Park' },
        { qid: 'Q2', label: 'Rondane-Nationalpark', lat: 61.9, lon: 9.8, sitelinks: 40, nationalPark: true, enTitle: 'Rondane National Park' },
        { qid: 'Q3', label: 'Ormtjernkampen-Nationalpark', lat: 61.2, lon: 9.7, sitelinks: 40, nationalPark: true, enTitle: 'Ormtjernkampen National Park' },
      ],
      existing,
      region,
      ['nature'],
    );
    expect(added.map((c) => c.name)).toEqual(['Rondane-Nationalpark', 'Ormtjernkampen-Nationalpark']);
    added[0].wikiViews = 15000;
    added[1].wikiViews = 300;
    applyPopularity([...existing, ...added], { Dovrefjell: 1000 });
    expect(added[0].popBonus!).toBeGreaterThan(added[1].popBonus! + 1);
  });
});
