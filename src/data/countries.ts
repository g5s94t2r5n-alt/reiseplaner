/**
 * Praktische Länderinfos für unterwegs (Stand 2026, ohne Gewähr).
 * currency = ISO-4217-Code, emergency = allgemeiner Notruf, left = Linksverkehr.
 */
export interface CountryFacts {
  currency: string;
  emergency: string;
  left?: boolean;
  /** Kurzer Hinweis für Roadtrips */
  note?: string;
}

const EU112 = '112';
const C = (currency: string, emergency = EU112, extra: Partial<CountryFacts> = {}): CountryFacts => ({
  currency,
  emergency,
  ...extra,
});

export const COUNTRY_FACTS: Record<string, CountryFacts> = {
  // Europa (Euro)
  DE: C('EUR'),
  AT: C('EUR', EU112, { note: 'Autobahn-Vignette (digital oder Klebe-Vignette) nötig.' }),
  FR: C('EUR', EU112, { note: 'Viele Autobahnen mautpflichtig (Péage). In einigen Städten Umweltplakette Crit’Air nötig.' }),
  IT: C('EUR', EU112, { note: 'Autobahnmaut; Innenstädte oft „ZTL“-Zonen mit Fahrverbot – Kameraüberwachung.' }),
  ES: C('EUR'),
  PT: C('EUR', EU112, { note: 'Teils elektronische Maut ohne Kassenhäuschen – vorher registrieren.' }),
  NL: C('EUR'),
  BE: C('EUR'),
  LU: C('EUR'),
  IE: C('EUR', EU112, { left: true }),
  FI: C('EUR'),
  EE: C('EUR'),
  LV: C('EUR'),
  LT: C('EUR'),
  SK: C('EUR', EU112, { note: 'Autobahn-Vignette (digital) nötig.' }),
  SI: C('EUR', EU112, { note: 'Autobahn-Vignette (digital) nötig.' }),
  HR: C('EUR', EU112, { note: 'Autobahnmaut an Mautstellen.' }),
  GR: C('EUR'),
  CY: C('EUR', EU112, { left: true }),
  MT: C('EUR', EU112, { left: true }),
  ME: C('EUR', EU112),
  AD: C('EUR'),
  // Europa (andere Währungen)
  CH: C('CHF', EU112, { note: 'Autobahn-Vignette (digital oder Klebe-Vignette) nötig.' }),
  LI: C('CHF'),
  NO: C('NOK', EU112, { note: 'Viele Mautstraßen und Fähren – automatische Abrechnung per Kennzeichen (AutoPASS/EPASS24).' }),
  SE: C('SEK'),
  DK: C('DKK', EU112, { note: 'Große Brücken (Storebælt, Øresund) kostenpflichtig.' }),
  IS: C('ISK', EU112, { note: 'F-Straßen (Hochland) nur mit Allrad und meist erst ab Ende Juni offen.' }),
  GB: C('GBP', '999 oder 112', { left: true }),
  PL: C('PLN'),
  CZ: C('CZK', EU112, { note: 'Autobahn-Vignette (digital) nötig.' }),
  HU: C('HUF', EU112, { note: 'Autobahn-Vignette (digital) nötig.' }),
  RO: C('RON', EU112, { note: 'Straßenvignette (Rovinieta) nötig.' }),
  BG: C('BGN', EU112, { note: 'Digitale Vignette nötig.' }),
  RS: C('RSD', '112'),
  BA: C('BAM', '112'),
  MK: C('MKD', '112'),
  AL: C('ALL', '112'),
  TR: C('TRY', '112'),
  GE: C('GEL', '112'),
  AM: C('AMD', '112'),
  // Weitere
  US: C('USD', '911'),
  CA: C('CAD', '911'),
  MX: C('MXN', '911'),
  AU: C('AUD', '000', { left: true }),
  NZ: C('NZD', '111', { left: true }),
  ZA: C('ZAR', '112 (Handy) / 10111', { left: true }),
  NA: C('NAD', '112 (Handy) / 10111', { left: true }),
  JP: C('JPY', '110 (Polizei) / 119 (Rettung)', { left: true }),
  TH: C('THB', '191 (Polizei) / 1669 (Rettung)', { left: true }),
  IN: C('INR', '112', { left: true }),
  LK: C('LKR', '119 (Polizei) / 1990 (Rettung)', { left: true }),
  ID: C('IDR', '112', { left: true }),
  MY: C('MYR', '999', { left: true }),
  VN: C('VND', '113 (Polizei) / 115 (Rettung)'),
  MA: C('MAD', '19 (Polizei) / 15 (Rettung)'),
  CL: C('CLP', '133 (Polizei) / 131 (Rettung)'),
  AR: C('ARS', '911'),
  PE: C('PEN', '105'),
  BR: C('BRL', '190 (Polizei) / 192 (Rettung)'),
  CR: C('CRC', '911'),
  MN: C('MNT', '102 (Polizei) / 103 (Rettung)'),
  KG: C('KGS', '102 (Polizei) / 103 (Rettung)'),
  KZ: C('KZT', '112'),
};

export function factsFor(countryCode?: string): CountryFacts | null {
  return countryCode ? (COUNTRY_FACTS[countryCode.toUpperCase()] ?? null) : null;
}

export function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(['de'], { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}
