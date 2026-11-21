export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface Place extends GeoPoint {
  name: string;
  /** Längere Beschreibung, z. B. "Bergen, Vestland, Norwegen" */
  label?: string;
}

export interface Region {
  name: string;
  label: string;
  osmType: 'N' | 'W' | 'R';
  osmId: number;
  countryCode?: string;
  /** [west, south, east, north] */
  bbox?: [number, number, number, number];
  center: GeoPoint;
  wikidata?: string;
  wikivoyageTitle?: string;
  /** Photon-Typ, z. B. "country" oder "state" */
  type?: string;
}

export type TravelStyle = 'camper' | 'tent' | 'backpacker' | 'car';
export type Pace = 'relaxed' | 'normal' | 'fast';
export type Interest = 'nature' | 'city' | 'culture' | 'beach' | 'hiking';

export interface TripSettings {
  region: Region;
  start: Place;
  /** null = Rundreise (zurück zum Start) */
  end: Place | null;
  /** ISO-Datum YYYY-MM-DD */
  startDate: string;
  nights: number;
  style: TravelStyle;
  pace: Pace;
  maxDriveHours: number;
  interests: Interest[];
  /** Wildcampen/Freistehen einbeziehen (nur Camper/Zelt). Fehlt der Wert, gilt: an. */
  wildCamping?: boolean;
  /** Anzahl Reisende für Buchungs-Links (Standard 2) */
  travelers?: number;
}

export type StopKind = 'city' | 'nature' | 'custom';

/** Ein möglicher Stop aus Wikivoyage ("Cities" / "Other destinations"). */
export interface Candidate extends GeoPoint {
  id: string;
  name: string;
  kind: StopKind;
  description?: string;
  wvTitle?: string;
  wikidata?: string;
  tags: Interest[];
  /** Attraktivität für dieses Reiseprofil (höher = besser) */
  score: number;
  /** Aufrufe des Wikivoyage-Artikels (60 Tage) – Beliebtheit bei Reisenden */
  views?: number;
  /** Anzahl Wikipedia-Sprachversionen (Bekanntheit, für Ziele ohne Wikivoyage-Artikel) */
  sitelinks?: number;
  /** Englischer Wikipedia-Artikel und dessen Aufrufe (60 Tage) – Bekanntheit ohne Wikivoyage-Artikel */
  enTitle?: string;
  wikiViews?: number;
  /** Art des Orts für Abwechslung (z. B. "Fjord", "Gletscher", "Stadt") */
  typeKey?: string;
  /** Bausteine der Bewertung, damit sie neu berechnet werden kann */
  rank?: number;
  depth?: number;
  popBonus?: number;
  seasonDelta?: number;
  /** Wie gut passt der Ort zu jedem Interesse (0–3) */
  strengths?: Partial<Record<Interest, number>>;
  /** Begründungen für die Auswahl ("Warum dieser Stop?") */
  notes?: string[];
}

export interface SleepListing extends Partial<GeoPoint> {
  name: string;
  category?: 'budget' | 'mid' | 'splurge' | 'camping';
  price?: string;
  url?: string;
  description?: string;
  address?: string;
}

export interface PoiCounts {
  attractions: number;
  museums: number;
  viewpoints: number;
  historic: number;
  beaches: number;
  nature: number;
  hiking: number;
}

export interface Accommodation extends GeoPoint {
  id: string;
  name: string;
  /** OSM-Typ (camp_site, hostel …) oder Wikivoyage-Kategorie */
  type: string;
  source: 'osm' | 'wikivoyage';
  distanceKm?: number;
  website?: string;
  phone?: string;
  price?: string;
  description?: string;
  openingHours?: string;
  /** OSM-Tag seasonal (yes/no/summer/winter) */
  seasonal?: string;
  /** Kostenloser Platz zum Freistehen/Übernachten (kein klassischer Campingplatz) */
  wild?: boolean;
  features: string[];
  osmUrl?: string;
  quality: number;
}

export interface StopInfo {
  seeCount: number;
  doCount: number;
  articleLength: number;
  sleep: SleepListing[];
  poi?: PoiCounts;
  summary?: { text: string; image?: string; url?: string };
  wikivoyageUrl?: string;
  /** Sehenswürdigkeiten mit Wikidata-Eintrag (= bekannte Ziele) */
  notableCount?: number;
  /** Artikel erwähnt UNESCO-Welterbe */
  unesco?: boolean;
}

export interface Stop extends GeoPoint {
  id: string;
  name: string;
  kind: StopKind;
  description?: string;
  wvTitle?: string;
  wikidata?: string;
  tags: Interest[];
  score: number;
  /** Aufrufe des Wikivoyage-Artikels (60 Tage) */
  views?: number;
  /** "Muss rein": bleibt beim Neu-Vorschlagen erhalten */
  pinned?: boolean;
  /** Warum dieser Ort ausgewählt wurde */
  selectionNotes?: string[];
  nights: number;
  recommendedNights: number;
  /** vom Nutzer festgelegt – wird bei der automatischen Verteilung nicht verändert */
  manualNights: boolean;
  reasons: string[];
  info?: StopInfo;
}

/** Eine Etappe zwischen zwei Routenpunkten (Start, Stops, Ziel) laut OSRM. */
export interface Segment {
  distanceKm: number;
  /** Reisezeit in Stunden (bei Backpackern bereits mit ÖPNV-Faktor) */
  durationH: number;
  /** [lat, lon] */
  geometry: [number, number][];
  /** Ankunftspunkt auf der Straße [lat, lon] (von OSRM eingerastet) */
  end?: [number, number];
}

export interface TransitStop extends GeoPoint {
  id: string;
  name: string;
  /** Index des Segments, in dem der Zwischenstopp liegt */
  segmentIndex: number;
}

export interface Trip {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: TripSettings;
  candidates: Candidate[];
  stops: Stop[];
  /** segments[i] verbindet Punkt i mit Punkt i+1 in [start, ...stops, end] */
  segments: Segment[];
  /** Namen von Zwischenstopps, Schlüssel = gerundete Koordinate */
  transitNames: Record<string, string>;
  warnings: string[];
  /** "Nicht vorschlagen": Wikivoyage-Titel bzw. Namen */
  excluded?: string[];
}
