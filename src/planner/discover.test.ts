import { describe, expect, it } from 'vitest';
import { parseSightListings } from '../lib/wikitext';
import { pickNearby, rankSights } from './discover';
import { holidaysDuring, mergeSchoolHolidays } from './holidays';
import { factsFor, currencyName } from '../data/countries';
import type { NearbyArticle } from '../api/wiki';

const PAGE = `Intro
==See==
* {{see| name=Small shop | content=Nice. }}
* {{see| name=Bryggen | wikidata=Q11234 | image=Bryggen.jpg | lat=60.397 | long=5.324 | hours=Daily 10-18 | price=Free | url=https://bryggen.example | content=The old Hanseatic wharf, a UNESCO World Heritage site with colourful wooden houses along the harbour. One of the most photographed places in Norway, best visited early in the morning. }}
==Do==
* {{do| name=Fløibanen | lat=60.396 | long=5.328 | content=Funicular up Mount Fløyen with great views. }}
==Sleep==
* {{sleep| name=Hostel }}`;

describe('Wikivoyage-Sehenswürdigkeiten', () => {
  it('liest See/Do-Einträge mit Details, ohne Unterkünfte', () => {
    const s = parseSightListings(PAGE);
    expect(s.map((x) => x.name)).toEqual(['Small shop', 'Bryggen', 'Fløibanen']);
    expect(s[1]).toMatchObject({ kind: 'see', hours: 'Daily 10-18', price: 'Free', wikidata: 'Q11234', lat: 60.397 });
    expect(s[2].kind).toBe('do');
  });

  it('sortiert bekannte Ziele nach vorne und berechnet Entfernungen', () => {
    const ranked = rankSights(parseSightListings(PAGE), { lat: 60.39, lon: 5.32 });
    expect(ranked[0].name).toBe('Bryggen');
    expect(ranked[0].distanceKm).toBeLessThan(2);
    expect(ranked.at(-1)!.name).toBe('Small shop');
  });
});

describe('Wikipedia in der Nähe', () => {
  const a = (title: string, description: string, length: number, km = 1): NearbyArticle => ({
    title,
    description,
    length,
    lat: 60.39 + km / 111,
    lon: 5.32,
    url: 'x',
  });
  it('behält Sehenswertes, verwirft Organisationen und Verwaltung', () => {
    const picked = pickNearby(
      [
        a('Universität Bergen', 'Universität in Norwegen', 6000),
        a('Bergens Tidende', 'Tageszeitung in Bergen', 3000),
        a('Schifffahrtsmuseum Bergen', 'Schifffahrtsmuseum in Bergen', 3800),
        a('Bergen (Tettsted)', 'zusammenhängende bebaute Fläche', 11000),
        a('Grieghalle', 'Konzerthalle in Bergen', 2100),
        a('Fløyen', 'Berg in Bergen', 5000, 3),
      ],
      { lat: 60.39, lon: 5.32 },
    );
    expect(picked.map((p) => p.title).sort()).toEqual(['Fløyen', 'Grieghalle', 'Schifffahrtsmuseum Bergen']);
    expect(picked.find((p) => p.title === 'Fløyen')!.distanceKm).toBeCloseTo(3, 0);
  });
});

describe('Feiertage und Ferien', () => {
  it('findet Feiertage im Aufenthalt, ohne Doppelte', () => {
    const h = [
      { date: '2027-05-17', localName: 'Grunnlovsdag', name: 'Constitution Day', global: true },
      { date: '2027-05-17', localName: 'Grunnlovsdag', name: 'Constitution Day', global: true },
      { date: '2027-12-25', localName: 'Juledag', name: 'Christmas', global: true },
    ];
    expect(holidaysDuring(h, '2027-05-15', '2027-05-18')).toHaveLength(1);
    expect(holidaysDuring(h, '2027-06-01', '2027-06-05')).toHaveLength(0);
  });

  it('fasst Schulferien zusammen und ignoriert Einzeltage und Überseegebiete', () => {
    const r = mergeSchoolHolidays(
      [
        { startDate: '2026-07-04', endDate: '2026-08-21', name: 'Unterrichtsende', nationwide: false, regions: 1 },
        { startDate: '2026-07-05', endDate: '2026-08-31', name: 'Sommerferien', nationwide: false, regions: 4 },
        { startDate: '2026-07-05', endDate: '2026-08-17', name: 'Südwinterferien', nationwide: false, regions: 1 },
        { startDate: '2026-06-01', endDate: '2026-06-01', name: 'beweglicher Ferientag', nationwide: false, regions: 9 },
      ],
      '2026-07-10',
      '2026-07-20',
    );
    expect(r).toEqual({ start: '2026-07-05', end: '2026-08-31', regional: true });
    expect(mergeSchoolHolidays([], '2026-07-10', '2026-07-20')).toBeNull();
    // Nur ein Überseegebiet bekannt (Daten fürs Mutterland fehlen noch) → lieber nichts anzeigen
    expect(
      mergeSchoolHolidays(
        [{ startDate: '2027-07-11', endDate: '2027-08-15', name: 'Südwinterferien', nationwide: false, regions: 1 }],
        '2027-08-10',
        '2027-08-20',
      ),
    ).toBeNull();
  });
});

describe('Länderinfos', () => {
  it('Linksverkehr, Währung, Notruf', () => {
    expect(factsFor('gb')).toMatchObject({ left: true, currency: 'GBP' });
    expect(factsFor('NO')?.left).toBeFalsy();
    expect(factsFor('XX')).toBeNull();
    expect(currencyName('NOK')).toMatch(/Krone/);
  });
});

describe('Qualität statt nur Menge', () => {
  it('bekannte Sehenswürdigkeiten (viele Wikipedia-Aufrufe) stehen vorne', async () => {
    const { rankSights } = await import('./discover');
    const items = [
      { kind: 'see' as const, name: 'Kleines Museum', wikidata: 'Q1', description: 'x'.repeat(400) },
      { kind: 'see' as const, name: 'Berühmte Festung', wikidata: 'Q2', description: 'kurz' },
    ];
    const ranked = rankSights(items, { lat: 0, lon: 0 }, { Q1: 50, Q2: 60000 });
    expect(ranked[0].name).toBe('Berühmte Festung');
    expect(ranked[0].views).toBe(60000);
  });

  it('„In der Nähe“: Beliebtheit schlägt Artikellänge', async () => {
    const { pickNearby } = await import('./discover');
    const near = (title: string, length: number, views: number) => ({ title, description: 'Museum', length, views, lat: 0.01, lon: 0, url: 'x' });
    const picked = pickNearby([near('Langes Nischenmuseum', 40000, 20), near('Beliebtes Museum', 3000, 9000)], { lat: 0, lon: 0 });
    expect(picked[0].title).toBe('Beliebtes Museum');
  });

  it('Stop-Auswahl: beliebte Ziele bekommen bis zu +3 Punkte', async () => {
    const { applyPopularity, popularityBonus } = await import('./candidates');
    expect(popularityBonus(2521, 2521)).toBeCloseTo(3);
    expect(popularityBonus(0, 2521)).toBe(0);
    const cands: import('../types').Candidate[] = [
      { id: 'a', name: 'Florence', wvTitle: 'Florence', kind: 'city' as const, lat: 0, lon: 0, tags: [], score: 5 },
      { id: 'b', name: 'Incisa', wvTitle: 'Incisa', kind: 'nature' as const, lat: 0, lon: 0, tags: [], score: 5 },
    ];
    applyPopularity(cands, { Florence: 2521, Incisa: 0 });
    expect(cands[0].score).toBe(8);
    expect(cands[0].views).toBe(2521);
    expect(cands[1].score).toBe(5);
  });

  it('Aufenthaltsdauer: bekannte Ziele, Beliebtheit und Welterbe mit Begründung', async () => {
    const { recommendNights } = await import('./nights');
    const base = { kind: 'city' as const, tags: [], interests: [], pace: 'normal' as const, maxDriveH: 5 };
    const plain = recommendNights({ ...base, info: { seeCount: 8, doCount: 2 } });
    const quality = recommendNights({ ...base, info: { seeCount: 8, doCount: 2, notableCount: 6, unesco: true }, views: 3400 });
    expect(quality.nights).toBeGreaterThan(plain.nights);
    const text = quality.reasons.join(' | ');
    expect(text).toContain('davon 6 bekannte');
    expect(text).toContain('Sehr beliebtes Reiseziel');
    expect(text).toContain('UNESCO');
  });
});

describe('Plausibilität von Wikidata-Verweisen', () => {
  it('erkennt passende und falsche Verweise', async () => {
    const { titleMatches } = await import('./discover');
    expect(titleMatches('Bergenhus fortress', 'Bergenhus Fortress')).toBe(true);
    expect(titleMatches('Fantoft Stave Church', 'Fantoft Stave Church')).toBe(true);
    expect(titleMatches('Akershus fortress', 'Festung Akershus')).toBe(true);
    expect(titleMatches('Royal Palace', 'Royal Palace, Oslo')).toBe(true);
    expect(titleMatches('Fløibanen', 'Fløibanen')).toBe(true);
    // Galerie verweist fälschlich auf ihren Besitzer
    expect(titleMatches('Galleri Fjalar', 'Gaahl')).toBe(false);
  });
});
