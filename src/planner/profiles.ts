import type { Interest, Pace, TravelStyle } from '../types';

export const STYLE_LABELS: Record<TravelStyle, { label: string; icon: string; hint: string }> = {
  camper: { label: 'Camper / Wohnmobil', icon: '🚐', hint: 'Stellplätze & Campingplätze für Wohnmobile' },
  tent: { label: 'Zelt', icon: '⛺', hint: 'Campingplätze mit Zeltwiese' },
  backpacker: { label: 'Backpacker', icon: '🎒', hint: 'Hostels & Pensionen, Reisezeit mit Bus/Bahn geschätzt' },
  car: { label: 'Auto + Unterkunft', icon: '🚗', hint: 'Hotels, Pensionen, Ferienwohnungen' },
};

export const PACE_LABELS: Record<Pace, { label: string; hint: string }> = {
  relaxed: { label: 'Entspannt', hint: 'Weniger Stops, mehr Zeit pro Ort' },
  normal: { label: 'Ausgewogen', hint: 'Gute Mischung aus Fahren und Bleiben' },
  fast: { label: 'Viel sehen', hint: 'Mehr Stops, kürzere Aufenthalte' },
};

export const INTEREST_LABELS: Record<Interest, { label: string; icon: string }> = {
  nature: { label: 'Natur & Landschaft', icon: '🏔️' },
  hiking: { label: 'Wandern & Outdoor', icon: '🥾' },
  beach: { label: 'Strand & Küste', icon: '🏖️' },
  culture: { label: 'Kultur & Geschichte', icon: '🏛️' },
  city: { label: 'Städte & Nightlife', icon: '🌆' },
};

/** Durchschnittliche Nächte pro Stop – Grundlage für die Anzahl der Stops. */
export const AVG_NIGHTS: Record<Pace, number> = { relaxed: 3, normal: 2, fast: 1.5 };

/** Faktor auf die empfohlene Aufenthaltsdauer. */
export const PACE_NIGHT_FACTOR: Record<Pace, number> = { relaxed: 1.3, normal: 1, fast: 0.75 };

/** Standard für maximale Fahrzeit pro Tag (Stunden). */
export const DEFAULT_MAX_DRIVE: Record<TravelStyle, number> = { camper: 4, tent: 5, backpacker: 6, car: 5 };

/** Backpacker: Autozeit × Faktor als grobe Schätzung für Bus/Bahn. */
export const TRAVEL_TIME_FACTOR: Record<TravelStyle, number> = { camper: 1.15, tent: 1, backpacker: 1.4, car: 1 };

/** Geschätzte Durchschnittsgeschwindigkeit (km/h Luftlinie) für Vorabschätzungen. */
export const EST_SPEED_KMH = 55;
