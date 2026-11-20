import { describe, expect, it } from 'vitest';
import type { Trip } from '../types';
import { decodeTrip, encodeTrip, settingsFromShared, shareBase, sharedStops, shareUrl, PUBLIC_URL } from './share';

const stop = (name: string, i: number, extra: Partial<Trip['stops'][number]> = {}): Trip['stops'][number] => ({
  id: `s${i}`,
  name,
  kind: 'city',
  lat: 60 + i * 0.123456789,
  lon: 5 + i * 0.987654321,
  wvTitle: name,
  wikidata: 'Q1',
  description: 'A long description that should not be part of the link '.repeat(4),
  tags: ['nature'],
  score: 7,
  nights: 2,
  recommendedNights: 2,
  manualNights: false,
  reasons: ['x'],
  info: { seeCount: 40, doCount: 10, articleLength: 100000, sleep: [] },
  ...extra,
});

const trip: Trip = {
  id: 'abc123',
  name: 'Norwegen · 14 Nächte',
  createdAt: 1,
  updatedAt: 2,
  settings: {
    region: {
      name: 'Norwegen',
      label: 'Norwegen',
      osmType: 'R',
      osmId: 2978650,
      countryCode: 'NO',
      bbox: [-9.68462, -54.654, 34.68891, 81.02801],
      center: { lat: 61.152938, lon: 8.787665 },
      wikidata: 'Q20',
      wikivoyageTitle: 'Norway',
    },
    start: { name: 'Oslo', label: 'Oslo, Norwegen', lat: 59.9133, lon: 10.739 },
    end: null,
    startDate: '2027-07-02',
    nights: 14,
    style: 'camper',
    pace: 'normal',
    maxDriveHours: 4,
    interests: ['nature', 'hiking'],
    wildCamping: true,
    travelers: 3,
  },
  candidates: [],
  stops: [
    stop('Jotunheimen', 0, { kind: 'nature', nights: 3, manualNights: true }),
    stop('Bergen', 1),
    stop('Geiranger', 2, { kind: 'custom', wvTitle: 'Geirangerfjord' }),
    stop('Bergen (Norway)', 3, { wvTitle: 'Bergen (Norway)' }),
  ],
  segments: [{ distanceKm: 100, durationH: 2, geometry: Array.from({ length: 2000 }, (_, i) => [60 + i / 1000, 5]) }],
  transitNames: { a: 'b' },
  warnings: [],
};

describe('Trip per Link teilen', () => {
  it('kodiert und dekodiert verlustfrei (für die nötigen Felder)', async () => {
    const data = await encodeTrip(trip);
    expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
    const sh = await decodeTrip(data);
    expect(sh.i).toBe('abc123');
    expect(sh.n).toBe('Norwegen · 14 Nächte');
    const s = settingsFromShared(sh);
    expect(s.region.wikivoyageTitle).toBe('Norway');
    expect(s.start.name).toBe('Oslo');
    expect(s.end).toBeNull();
    expect(s.travelers).toBe(3);
    expect(s.interests).toEqual(['nature', 'hiking']);
    const stops = sharedStops(sh);
    expect(stops.map((x) => x.name)).toEqual(['Jotunheimen', 'Bergen', 'Geiranger', 'Bergen (Norway)']);
    expect(stops[0]).toMatchObject({ kind: 'nature', nights: 3, manualNights: true, wvTitle: 'Jotunheimen' });
    expect(stops[2]).toMatchObject({ kind: 'custom', wvTitle: 'Geirangerfjord' });
    expect(stops[1].lat).toBeCloseTo(60.12346, 5);
  });

  it('bleibt kurz genug für einen gut scannbaren QR-Code', async () => {
    const url = await shareUrl(trip, PUBLIC_URL);
    // Geometrie, Beschreibungen und Infos gehören nicht in den Link
    expect(url.length).toBeLessThan(900);
  });

  it('lehnt kaputte Links verständlich ab', async () => {
    await expect(decodeTrip('kaputt!!')).rejects.toThrow(/unvollständig|beschädigt/);
    const bad = await encodeTrip({ ...trip });
    await expect(decodeTrip(bad.slice(0, 20))).rejects.toThrow();
  });

  it('Links vom Entwicklungsrechner zeigen auf die Online-Version', () => {
    expect(shareBase({ hostname: 'localhost', origin: 'http://localhost:5173', pathname: '/' })).toBe(PUBLIC_URL);
    expect(
      shareBase({ hostname: 'g5s94t2r5n-alt.github.io', origin: 'https://g5s94t2r5n-alt.github.io', pathname: '/reiseplaner/' }),
    ).toBe('https://g5s94t2r5n-alt.github.io/reiseplaner/');
  });
});
