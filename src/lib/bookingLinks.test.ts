import { describe, expect, it } from 'vitest';
import { airbnbUrl, bookingUrl, externalSearchLinks, websiteSearchUrl, type SearchContext } from './bookingLinks';

const ctx: SearchContext = {
  name: 'Bergen',
  country: 'Norwegen',
  lat: 60.39,
  lon: 5.32,
  arrive: '2027-07-12',
  depart: '2027-07-15',
  travelers: 3,
  style: 'car',
};

describe('Buchungs-Links', () => {
  it('Airbnb mit Ort, Daten und Personen', () => {
    const u = new URL(airbnbUrl(ctx));
    expect(u.host).toBe('www.airbnb.de');
    expect(u.pathname).toBe('/s/Bergen--Norwegen/homes');
    expect(u.searchParams.get('checkin')).toBe('2027-07-12');
    expect(u.searchParams.get('checkout')).toBe('2027-07-15');
    expect(u.searchParams.get('adults')).toBe('3');
  });

  it('Booking.com mit Personen', () => {
    const u = new URL(bookingUrl(ctx));
    expect(u.searchParams.get('ss')).toBe('Bergen, Norwegen');
    expect(u.searchParams.get('group_adults')).toBe('3');
  });

  it('Airbnb für alle Reisearten, Booking nur ohne Camping', () => {
    const labels = (style: SearchContext['style']) => externalSearchLinks({ ...ctx, style }).map((l) => l.label);
    expect(labels('camper')).toContain('Airbnb');
    expect(labels('camper')).not.toContain('Booking.com');
    expect(labels('backpacker')).toEqual(expect.arrayContaining(['Airbnb', 'Booking.com']));
  });

  it('Websuche nach eigener Website', () => {
    const u = new URL(websiteSearchUrl('Lone Camping', 'Bergen Norwegen'));
    expect(u.searchParams.get('q')).toBe('"Lone Camping" Bergen Norwegen');
  });

  it('Ort ohne Land, mit Leerzeichen, Sonderzeichen und Klammerzusatz', () => {
    expect(new URL(airbnbUrl({ ...ctx, country: undefined })).pathname).toBe('/s/Bergen/homes');
    const u = new URL(airbnbUrl({ ...ctx, name: 'Bergen (Norway)', country: 'Vereinigte Staaten' }));
    expect(u.pathname).toBe('/s/Bergen--Vereinigte-Staaten/homes');
    expect(decodeURIComponent(new URL(airbnbUrl({ ...ctx, name: 'Tromsø' })).pathname)).toBe('/s/Tromsø--Norwegen/homes');
    expect(new URL(bookingUrl({ ...ctx, name: 'Bergen (Norway)' })).searchParams.get('ss')).toBe('Bergen, Norwegen');
  });
});
