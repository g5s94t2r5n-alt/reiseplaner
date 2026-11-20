import type { TravelStyle } from '../types';

/**
 * Wildcampen / Freistehen nach Ländern – vereinfachte Übersicht (Stand 2026, ohne Gewähr).
 * Regeln ändern sich, sind oft regional verschieden und Schilder vor Ort gehen immer vor.
 *
 * tent    = mit Zelt außerhalb von Campingplätzen übernachten
 * vehicle = im Wohnmobil/Van außerhalb von Camping- und Stellplätzen übernachten
 */

export type WildStatus = 'allowed' | 'tolerated' | 'forbidden' | 'unknown';

export interface WildRule {
  tent: WildStatus;
  vehicle: WildStatus;
  /** Kurze Erklärung auf Deutsch */
  note: string;
}

const R = (tent: WildStatus, vehicle: WildStatus, note: string): WildRule => ({ tent, vehicle, note });

export const WILD_RULES: Record<string, WildRule> = {
  // Skandinavien & Baltikum – Jedermannsrecht
  NO: R('allowed', 'tolerated', 'Jedermannsrecht (allemannsretten): Zelten auf unbewirtschaftetem Land, mind. 150 m von Häusern, max. 2 Nächte am selben Ort. Im Wohnmobil auf Park- und Rastplätzen meist erlaubt, sofern nicht beschildert – nicht auf Privatwegen.'),
  SE: R('allowed', 'tolerated', 'Jedermannsrecht (allemansrätten): 1–2 Nächte zelten, außer Sichtweite von Häusern, nicht auf Feldern. Gilt nicht für Fahrzeuge – Übernachten auf Park-/Rastplätzen ist meist für eine Nacht geduldet, Schilder beachten.'),
  FI: R('allowed', 'tolerated', 'Jedermannsrecht (jokamiehenoikeus): kurzzeitig zelten, ausreichend Abstand zu Häusern. Im Fahrzeug auf Park- und Rastplätzen meist geduldet, wenn nicht verboten.'),
  EE: R('allowed', 'tolerated', 'Jedermannsrecht: Zelten für eine Nacht erlaubt, viele kostenlose RMK-Waldlagerplätze. Im Fahrzeug auf Parkplätzen meist geduldet.'),
  LV: R('tolerated', 'tolerated', 'Zelten außerhalb von Schutzgebieten meist geduldet, auf Privatland Erlaubnis einholen. Im Fahrzeug auf Parkplätzen meist geduldet.'),
  LT: R('tolerated', 'tolerated', 'Zelten außerhalb von Schutzgebieten meist geduldet, auf Privatland Erlaubnis einholen. Viele kostenlose Waldlagerplätze.'),
  IS: R('tolerated', 'forbidden', 'Zelten für eine Nacht auf unbewirtschaftetem Land erlaubt, wenn kein Campingplatz in der Nähe ist und nicht verboten. Wohnmobile, Campervans und Zeltanhänger müssen auf Campingplätze.'),
  DK: R('forbidden', 'forbidden', 'Wildcampen und Übernachten im Wohnmobil außerhalb von Plätzen verboten. Ausnahme: ausgewiesene Shelter- und Naturlagerplätze und „fri teltning“-Gebiete in Staatswäldern (oft kostenlos).'),

  // Britische Inseln
  'GB-SCT': R('allowed', 'tolerated', 'Scottish Outdoor Access Code: Zelten in kleinen Gruppen für 2–3 Nächte erlaubt (Ausnahme: Camping-Management-Zonen im Loch Lomond & Trossachs NP März–Sep nur mit Genehmigung). Gilt nicht für Fahrzeuge – Übernachten in Haltebuchten oft eingeschränkt.'),
  GB: R('forbidden', 'tolerated', 'In England, Wales und Nordirland Zelten nur mit Erlaubnis des Landbesitzers (Ausnahme: Teile des Dartmoor). Übernachten im Fahrzeug nur, wo nicht ausdrücklich verboten – häufig Verbotsschilder.'),
  IE: R('tolerated', 'tolerated', 'Kein allgemeines Recht, in abgelegenen Bergregionen meist geduldet; auf Privatland fragen. Im Fahrzeug auf Parkplätzen oft beschildert verboten.'),

  // Mitteleuropa
  DE: R('forbidden', 'tolerated', 'Zelten außerhalb von Campingplätzen verboten (Ausnahme: ausgewiesene Trekkingplätze). Eine Nacht im Fahrzeug „zur Wiederherstellung der Fahrtüchtigkeit“ auf Parkplätzen meist geduldet – kein Camping-Verhalten (Stühle, Markise).'),
  AT: R('forbidden', 'tolerated', 'Wildcampen in den meisten Bundesländern verboten, teils hohe Strafen (z. B. Tirol). Übernachten im Fahrzeug je nach Bundesland/Gemeinde – oft verboten, eine Nacht auf Parkplätzen manchmal geduldet.'),
  CH: R('tolerated', 'tolerated', 'Je nach Kanton und Gemeinde. Oberhalb der Baumgrenze für eine Nacht meist geduldet, in Schutzgebieten verboten. Übernachten im Fahrzeug vielerorts verboten.'),
  NL: R('forbidden', 'forbidden', 'Wildcampen und Übernachten im Wohnmobil außerhalb von Plätzen verboten. Ausnahme: ausgewiesene „Paalkampeerplätze“ (kostenlos, meist nur Zelt).'),
  BE: R('forbidden', 'tolerated', 'Zelten außerhalb von Plätzen verboten (Ausnahme: Biwakzonen/„Paalkamperen“ in Flandern und Wallonien). Im Fahrzeug je nach Gemeinde.'),
  LU: R('forbidden', 'forbidden', 'Wildcampen und Übernachten im Wohnmobil außerhalb von Plätzen verboten.'),
  PL: R('tolerated', 'tolerated', 'Zelten in Wäldern nur in ausgewiesenen Gebieten (Programm „Zanocuj w lesie“), in Nationalparks verboten. Im Fahrzeug auf Parkplätzen meist geduldet.'),
  CZ: R('tolerated', 'tolerated', 'Außerhalb von Nationalparks und Schutzgebieten meist geduldet (eine Nacht, kein Feuer). Im Fahrzeug auf Parkplätzen meist geduldet.'),
  SK: R('tolerated', 'tolerated', 'Außerhalb von Schutzgebieten meist geduldet, in Nationalparks verboten. Im Fahrzeug auf Parkplätzen meist geduldet.'),
  HU: R('forbidden', 'tolerated', 'Wildcampen verboten. Übernachten im Fahrzeug auf Parkplätzen meist geduldet, wenn nicht beschildert.'),
  SI: R('forbidden', 'forbidden', 'Wildcampen und Übernachten im Wohnmobil außerhalb von Plätzen verboten, es wird kontrolliert.'),

  // Westeuropa & Mittelmeer
  FR: R('tolerated', 'tolerated', 'Mit Erlaubnis des Besitzers erlaubt; verboten an Küsten, in Naturschutzgebieten und nahe Sehenswürdigkeiten. Biwak in den Bergen meist von abends bis morgens erlaubt. Im Fahrzeug grundsätzlich erlaubt, wo Parken erlaubt ist – viele Gemeinden verbieten es, zahlreiche günstige „Aires de camping-car“.'),
  ES: R('forbidden', 'tolerated', 'Zelten außerhalb von Plätzen fast überall verboten (regional geregelt). Im Fahrzeug übernachten meist erlaubt, solange kein Camping-Verhalten – an Küsten und in Schutzgebieten oft verboten.'),
  PT: R('forbidden', 'forbidden', 'Wildcampen verboten. Wohnmobile dürfen nur auf ausgewiesenen Stellplätzen übernachten (max. 48 h), in Schutzgebieten und an der Küste streng verboten.'),
  IT: R('forbidden', 'tolerated', 'Zelten meist verboten (regional verschieden, im Gebirge Biwak teils geduldet). Im Fahrzeug parken und schlafen meist erlaubt, kein Camping-Verhalten; an Küsten oft verboten.'),
  GR: R('forbidden', 'tolerated', 'Offiziell verboten, abseits touristischer Orte oft geduldet. Im Fahrzeug meist geduldet, an beliebten Stränden kontrolliert.'),
  HR: R('forbidden', 'forbidden', 'Wildcampen und Freistehen streng verboten, häufige Kontrollen und hohe Bußgelder.'),
  ME: R('forbidden', 'tolerated', 'Offiziell verboten, abseits der Küste oft geduldet.'),
  AL: R('tolerated', 'tolerated', 'Weit verbreitet und meist geduldet – Rücksicht auf Anwohner, an Stränden in der Saison eingeschränkt.'),
  BA: R('tolerated', 'tolerated', 'Meist geduldet. ACHTUNG: In manchen Gebieten Minengefahr – nur auf befestigten Wegen und bekannten Plätzen bleiben.'),
  RS: R('tolerated', 'tolerated', 'Außerhalb von Schutzgebieten meist geduldet.'),
  MK: R('tolerated', 'tolerated', 'Außerhalb von Schutzgebieten meist geduldet.'),
  BG: R('tolerated', 'tolerated', 'Offiziell nur auf Plätzen, in der Praxis abseits von Stränden und Schutzgebieten meist geduldet.'),
  RO: R('tolerated', 'tolerated', 'Außerhalb von Schutzgebieten meist geduldet. Bären: Lebensmittel sicher verstauen.'),
  TR: R('tolerated', 'tolerated', 'Meist geduldet, in Nationalparks und an Stränden mit Verboten rechnen.'),
  GE: R('tolerated', 'tolerated', 'Weit verbreitet und akzeptiert, in Schutzgebieten Regeln beachten.'),
  AM: R('tolerated', 'tolerated', 'Weit verbreitet und akzeptiert.'),
  MA: R('tolerated', 'tolerated', 'Im Fahrzeug meist geduldet, oft bewachte Parkplätze gegen kleine Gebühr. Zelten besser mit Erlaubnis von Anwohnern.'),

  // Weitere Länder
  US: R('allowed', 'allowed', 'Dispersed Camping auf BLM-Land und in National Forests meist bis 14 Tage erlaubt. In Nationalparks nur auf Plätzen bzw. mit Backcountry-Permit.'),
  CA: R('tolerated', 'tolerated', 'Auf Crown Land für Einwohner meist erlaubt, Nicht-Einwohner brauchen teils eine Genehmigung (z. B. Ontario). Regeln je Provinz.'),
  AU: R('tolerated', 'tolerated', 'Viele ausgewiesene „Free Camps“. Regeln je Bundesstaat und Gemeinde, an Küsten oft verboten.'),
  NZ: R('tolerated', 'tolerated', 'Freedom Camping nur in erlaubten Gebieten; Fahrzeuge brauchen dafür meist eine „Self-Contained“-Zertifizierung. Viele Gemeinden mit Verbotszonen.'),
  CL: R('tolerated', 'tolerated', 'Außerhalb von Schutzgebieten meist geduldet, auf Privatland fragen.'),
  AR: R('tolerated', 'tolerated', 'Außerhalb von Schutzgebieten meist geduldet, auf Privatland fragen.'),
  MN: R('allowed', 'allowed', 'Freies Campen weitgehend möglich – Abstand zu Jurten und Herden halten.'),
  KG: R('allowed', 'allowed', 'Freies Campen weitgehend möglich.'),
  KZ: R('tolerated', 'tolerated', 'Außerhalb von Schutzgebieten meist geduldet.'),
};

/** Regel für ein Land (bei Großbritannien je nach Landesteil). */
export function wildRuleFor(countryCode?: string, state?: string): WildRule | null {
  if (!countryCode) return null;
  const cc = countryCode.toUpperCase();
  if (cc === 'GB' && state && /scotland|schottland/i.test(state)) return WILD_RULES['GB-SCT'];
  return WILD_RULES[cc] ?? null;
}

/** Status passend zur Reiseart (Zelt → Zeltregel, Camper → Fahrzeugregel). */
export function wildStatusFor(rule: WildRule | null, style: TravelStyle): WildStatus {
  if (!rule) return 'unknown';
  if (style === 'tent') return rule.tent;
  if (style === 'camper') return rule.vehicle;
  return 'unknown';
}

export const WILD_LABEL: Record<WildStatus, { label: string; icon: string }> = {
  allowed: { label: 'erlaubt', icon: '✅' },
  tolerated: { label: 'eingeschränkt / geduldet', icon: '⚠️' },
  forbidden: { label: 'verboten', icon: '⛔' },
  unknown: { label: 'keine Angaben', icon: '❔' },
};

/** Deutscher Ländername aus Ländercode */
export function countryName(countryCode?: string): string | undefined {
  if (!countryCode) return undefined;
  try {
    return new Intl.DisplayNames(['de'], { type: 'region' }).of(countryCode.toUpperCase());
  } catch {
    return countryCode;
  }
}

/** Kurzer Hinweis für einen Übernachtungsort */
export function wildHint(status: WildStatus, style: TravelStyle): string {
  const what = style === 'tent' ? 'Wildcampen' : 'Freistehen';
  switch (status) {
    case 'allowed':
      return `${what} hier erlaubt – ein Platz ist nicht zwingend nötig.`;
    case 'tolerated':
      return `${what} hier meist geduldet (Schilder beachten) – Campingplatz als Alternative einplanen.`;
    case 'forbidden':
      return `${what} hier verboten – Camping- oder Stellplatz nötig.`;
    default:
      return `Keine Regeln für ${what} hinterlegt.`;
  }
}

/** Flaggen-Emoji aus Ländercode */
export function flag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...countryCode.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
