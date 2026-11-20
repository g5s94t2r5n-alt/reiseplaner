import { describe, expect, it } from 'vitest';
import { accommodationSeason, seasonFromText } from '../lib/openingHours';
import { WILD_RULES, flag, wildRuleFor, wildStatusFor } from '../data/wildCamping';
import { mergeAccommodations } from './accommodation';
import type { Accommodation } from '../types';

describe('Saison aus Beschreibungstext', () => {
  it('englisch und deutsch', () => {
    expect(seasonFromText('Open from May to September. Nice views.')).toBe('May-Sep');
    expect(seasonFromText('Geöffnet April bis Oktober')).toBe('Apr-Oct');
    expect(seasonFromText('Season: Jun 15 – Aug 31')).toBe('Jun 15-Aug 31');
    expect(seasonFromText('Open mid-May through Sept.')).toBe('May-Sep');
  });
  it('Schließzeiten', () => {
    expect(seasonFromText('Closed November to March')).toBe('Nov-Mar off');
  });
  it('ignoriert Sätze ohne Bezug zu Öffnung und Wörter, die nur wie Monate beginnen', () => {
    expect(seasonFromText('Busy in July-August, book ahead')).toBeNull();
    expect(seasonFromText('Open all year, at the junction to marina road')).toBeNull();
    expect(seasonFromText(undefined)).toBeNull();
  });
});

describe('Saisonstatus von Unterkünften', () => {
  const base = { lat: 60 };
  it('opening_hours hat Vorrang', () => {
    expect(accommodationSeason({ ...base, openingHours: 'May-Sep', seasonal: 'no' }, '2026-12-01').status).toBe('closed');
  });
  it('OSM-Tag seasonal', () => {
    expect(accommodationSeason({ ...base, seasonal: 'no' }, '2026-12-01')).toMatchObject({ status: 'open', source: 'seasonal' });
    expect(accommodationSeason({ ...base, seasonal: 'summer' }, '2026-12-01').status).toBe('closed');
    expect(accommodationSeason({ ...base, seasonal: 'summer' }, '2026-07-01').status).toBe('open');
    // Südhalbkugel: Sommer = Dez–Mär
    expect(accommodationSeason({ lat: -40, seasonal: 'summer' }, '2027-01-10').status).toBe('open');
    expect(accommodationSeason({ ...base, seasonal: 'yes' }, '2026-07-01')).toMatchObject({
      status: 'unknown',
      seasonalUnknown: true,
    });
  });
  it('Beschreibung als letzte Quelle, sonst unbekannt', () => {
    expect(accommodationSeason({ ...base, description: 'Open May to September' }, '2026-12-01')).toMatchObject({
      status: 'closed',
      source: 'text',
    });
    expect(accommodationSeason({ ...base }, '2026-12-01')).toMatchObject({ status: 'unknown', source: 'none' });
  });
});

describe('Wildcamping-Regeln', () => {
  it('Länder und Landesteile', () => {
    expect(wildStatusFor(wildRuleFor('NO'), 'tent')).toBe('allowed');
    expect(wildStatusFor(wildRuleFor('NO'), 'camper')).toBe('tolerated');
    expect(wildStatusFor(wildRuleFor('HR'), 'camper')).toBe('forbidden');
    expect(wildStatusFor(wildRuleFor('GB', 'Schottland'), 'tent')).toBe('allowed');
    expect(wildStatusFor(wildRuleFor('GB', 'England'), 'tent')).toBe('forbidden');
    expect(wildStatusFor(wildRuleFor('IS'), 'camper')).toBe('forbidden');
    expect(wildStatusFor(wildRuleFor('XX'), 'tent')).toBe('unknown');
    expect(wildStatusFor(wildRuleFor('NO'), 'car')).toBe('unknown');
  });
  it('jede Regel hat eine Erklärung', () => {
    for (const [cc, r] of Object.entries(WILD_RULES)) {
      expect(r.note.length, cc).toBeGreaterThan(20);
    }
  });
  it('Flaggen', () => {
    expect(flag('NO')).toBe('🇳🇴');
    expect(flag(undefined)).toBe('🏳️');
  });
});

describe('Unterkünfte zusammenführen', () => {
  const acc = (id: string, name: string, lat: number, extra: Partial<Accommodation> = {}): Accommodation => ({
    id,
    name,
    type: 'rest_area',
    source: 'osm',
    lat,
    lon: 10,
    distanceKm: 1,
    features: [],
    quality: 1,
    ...extra,
  });
  it('mehrere Plätze ohne Namen bleiben erhalten', () => {
    const merged = mergeAccommodations([], [acc('a', 'Rastplatz (ohne Namen)', 60), acc('b', 'Rastplatz (ohne Namen)', 60.1)]);
    expect(merged).toHaveLength(2);
  });
  it('gleiches OSM-Objekt aus zwei Quellen nur einmal', () => {
    const merged = mergeAccommodations(
      [acc('a', 'Lone Camping', 60, { osmUrl: 'x' })],
      [acc('b', 'Lone Camping AS', 60.2, { osmUrl: 'y' }), acc('c', 'Другое', 61, { osmUrl: 'x' })],
    );
    expect(merged.map((m) => m.id)).toEqual(['a']);
  });
  it('nicht-lateinische Namen werden nicht pauschal als Dublette erkannt', () => {
    const merged = mergeAccommodations([acc('a', 'Кемпинг', 60)], [acc('b', 'Хижина', 61)]);
    expect(merged).toHaveLength(2);
  });
});
