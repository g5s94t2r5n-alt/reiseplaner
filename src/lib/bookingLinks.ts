import type { TravelStyle } from '../types';

/**
 * Links zu externen Buchungs- und Suchseiten. Die App liest dort keine Daten,
 * sie füllt nur Ort, Reisedaten und Personenzahl in der Suche vor.
 */

export interface SearchContext {
  name: string;
  country?: string;
  lat: number;
  lon: number;
  /** YYYY-MM-DD */
  arrive: string;
  depart: string;
  travelers: number;
  style: TravelStyle;
}

export interface ExternalLink {
  label: string;
  href: string;
}

/** Name ohne Klammerzusatz: "Bergen (Norway)" → "Bergen" */
const cleanName = (name: string) => name.replace(/\s*\([^)]*\)/g, '').trim();
const location = (c: SearchContext) => (c.country ? `${cleanName(c.name)}, ${c.country}` : cleanName(c.name));

/**
 * Airbnb erwartet den Ort als Pfad-Slug: Teile mit "--" getrennt, Leerzeichen als "-"
 * ("Bergen, Norwegen" → "Bergen--Norwegen"). Ein kodiertes Komma versteht die Suche nicht.
 */
export function airbnbUrl(c: SearchContext): string {
  const slug = [cleanName(c.name), c.country]
    .filter((s): s is string => !!s)
    .map((s) => s.trim().replace(/\s+/g, '-'))
    .join('--');
  const params = new URLSearchParams({ checkin: c.arrive, checkout: c.depart, adults: String(c.travelers) });
  return `https://www.airbnb.de/s/${encodeURIComponent(slug)}/homes?${params}`;
}

export function bookingUrl(c: SearchContext): string {
  const params = new URLSearchParams({
    ss: location(c),
    checkin: c.arrive,
    checkout: c.depart,
    group_adults: String(c.travelers),
    no_rooms: '1',
  });
  return `https://www.booking.com/searchresults.de.html?${params}`;
}

export function mapsSearchUrl(term: string, lat: number, lon: number): string {
  return `https://www.google.com/maps/search/${encodeURIComponent(term)}/@${lat.toFixed(4)},${lon.toFixed(4)},12z`;
}

/** Websuche nach der eigenen Website einer Unterkunft (wenn keine in OpenStreetMap steht). */
export function websiteSearchUrl(name: string, place: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`"${name}" ${place}`)}`;
}

export function externalSearchLinks(c: SearchContext): ExternalLink[] {
  const links: ExternalLink[] = [];
  if (c.style === 'camper' || c.style === 'tent') {
    links.push({
      label: c.style === 'camper' ? 'Stellplätze in Google Maps' : 'Campingplätze in Google Maps',
      href: mapsSearchUrl(c.style === 'camper' ? 'Wohnmobilstellplatz' : 'Campingplatz', c.lat, c.lon),
    });
    links.push({ label: 'Airbnb', href: airbnbUrl(c) });
  } else {
    links.push({ label: 'Airbnb', href: airbnbUrl(c) });
    links.push({ label: 'Booking.com', href: bookingUrl(c) });
    links.push({
      label: c.style === 'backpacker' ? 'Hostels in Google Maps' : 'Hotels in Google Maps',
      href: mapsSearchUrl(c.style === 'backpacker' ? 'Hostel' : 'Hotel', c.lat, c.lon),
    });
  }
  return links;
}
