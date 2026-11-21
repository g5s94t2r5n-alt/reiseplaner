import type { Interest, StopKind } from '../types';
import { getSection, parseTemplates, stripMarkup } from '../lib/wikitext';
import { INTEREST_LABELS } from './profiles';
import type { WindowStats } from './season';

/* ---------------- Was gibt es vor Ort? (Wikivoyage-Einträge) ---------------- */

const LISTING_KEYWORDS: Record<Interest, RegExp> = {
  hiking: /\bhik|trail|\btrek|\bwalk|climb|summit|\bpeak|via ferrata|mountain|glacier|ski\b|skiing|kayak|rafting|canoe/i,
  beach: /beach|\bswim|bathing|lido|surf|snorkel|\bdiv(e|ing)\b|sand|\bbay\b|cove/i,
  culture: /museum|church|cathedral|chapel|castle|fort(ress)?\b|palace|gallery|historic|ruin|monaster|abbey|old town|heritage|monument|stave|temple|archaeolog/i,
  nature: /\bpark\b|national park|lake|waterfall|\bfalls\b|fjord|viewpoint|view point|nature|wildlife|island|forest|glacier|valley|canyon|gorge|cave|bird/i,
  city: /\bbar\b|\bpub\b|club|nightlife|market|shopping|theatre|theater|concert|opera|festival|street food|food hall|brewery/i,
};

export type ListingProfile = Record<Interest, number> & { total: number };

/** Zählt pro Interesse, wie viele Sehenswürdigkeiten/Aktivitäten (und Bars) dazu passen. */
export function listingProfile(wikitext: string): ListingProfile {
  const profile: ListingProfile = { nature: 0, hiking: 0, beach: 0, culture: 0, city: 0, total: 0 };
  for (const section of ['See', 'Do']) {
    const text = getSection(wikitext, [section]);
    if (!text) continue;
    for (const t of parseTemplates(text, ['see', 'do', 'listing', 'marker', 'vcard'])) {
      const s = `${stripMarkup(t.params.name ?? '')} ${stripMarkup(t.params.content ?? '')}`;
      profile.total++;
      for (const i of Object.keys(LISTING_KEYWORDS) as Interest[]) if (LISTING_KEYWORDS[i].test(s)) profile[i]++;
    }
  }
  // Nachtleben: Einträge im Abschnitt "Drink"
  const drink = getSection(wikitext, ['Drink']);
  if (drink) profile.city += Math.round(parseTemplates(drink, ['drink', 'listing']).length / 2);
  return profile;
}

/* ---------------- Ortsart aus Wikidata ---------------- */

export const CLASS_INTERESTS: Record<string, { label: string; interests: Interest[] }> = {
  Q46169: { label: 'Nationalpark', interests: ['nature', 'hiking'] },
  Q179049: { label: 'Naturschutzgebiet', interests: ['nature'] },
  Q473972: { label: 'Schutzgebiet', interests: ['nature'] },
  Q35666: { label: 'Gletscher', interests: ['nature', 'hiking'] },
  Q8502: { label: 'Berg', interests: ['nature', 'hiking'] },
  Q46831: { label: 'Gebirge', interests: ['nature', 'hiking'] },
  Q45776: { label: 'Fjord', interests: ['nature'] },
  Q23397: { label: 'See', interests: ['nature'] },
  Q34038: { label: 'Wasserfall', interests: ['nature'] },
  Q23442: { label: 'Insel', interests: ['nature', 'beach'] },
  Q33837: { label: 'Inselgruppe', interests: ['nature', 'beach'] },
  Q40080: { label: 'Strand', interests: ['beach'] },
  Q39594: { label: 'Bucht', interests: ['beach'] },
  Q200023: { label: 'Seebad', interests: ['beach'] },
  Q130003: { label: 'Skigebiet', interests: ['hiking'] },
  Q515: { label: 'Stadt', interests: ['city'] },
  Q1549591: { label: 'Großstadt', interests: ['city', 'culture'] },
  Q5119: { label: 'Hauptstadt', interests: ['city', 'culture'] },
  Q676050: { label: 'Altstadt', interests: ['culture'] },
  Q23413: { label: 'Burg', interests: ['culture'] },
  Q839954: { label: 'Archäologische Stätte', interests: ['culture'] },
  Q9259: { label: 'UNESCO-Welterbe', interests: ['culture'] },
};

/** Ortsart für Abwechslung: spezifische Wikidata-Klasse, sonst Art + stärkstes Interesse. */
const TYPE_PRIORITY = [
  'Q35666', // Gletscher
  'Q45776', // Fjord
  'Q34038', // Wasserfall
  'Q46169', // Nationalpark
  'Q46831', // Gebirge
  'Q8502', // Berg
  'Q33837', // Inselgruppe
  'Q23442', // Insel
  'Q40080', // Strand
  'Q200023', // Seebad
  'Q23397', // See
  'Q676050', // Altstadt
  'Q5119', // Hauptstadt
  'Q1549591', // Großstadt
  'Q515', // Stadt
];

export function typeKeyFor(kind: StopKind, classes: string[] | undefined, strengths?: Partial<Record<Interest, number>>): string {
  const cls = TYPE_PRIORITY.find((q) => classes?.includes(q));
  if (cls) return CLASS_INTERESTS[cls].label;
  const top = strengths
    ? (Object.entries(strengths) as [Interest, number][]).sort((a, b) => b[1] - a[1])[0]?.[0]
    : undefined;
  return `${kind}:${top ?? '-'}`;
}

/* ---------------- Interessen-Stärke ---------------- */

/**
 * Wie gut passt ein Ort zu jedem Interesse (0–3)?
 * Entscheidend ist der ANTEIL passender Wikivoyage-Einträge (ein Nationalpark mit 8 von 10 Wanderungen
 * passt besser zu „Wandern“ als eine Großstadt mit 8 von 60 Einträgen), dazu Ortsart (Wikidata) und
 * Stichwörter der Kurzbeschreibung. Städte erreichen bei Natur/Wandern höchstens 1,5.
 */
export function interestStrengths(a: {
  profile?: ListingProfile;
  classes?: string[];
  descTags: Interest[];
  kind?: StopKind;
}): Record<Interest, number> {
  const out = { nature: 0, hiking: 0, beach: 0, culture: 0, city: 0 } as Record<Interest, number>;
  const fromClasses = new Set((a.classes ?? []).flatMap((c) => CLASS_INTERESTS[c]?.interests ?? []));
  const total = a.profile?.total ?? 0;
  for (const i of Object.keys(out) as Interest[]) {
    const n = a.profile?.[i] ?? 0;
    let s = total >= 4 ? Math.min(2.5, (n / total) * 5) : n >= 1 ? 1 : 0;
    if (fromClasses.has(i)) s += 1.5;
    if (a.descTags.includes(i)) s += 0.75;
    if (a.kind === 'city' && (i === 'nature' || i === 'hiking')) s = Math.min(1.5, s);
    out[i] = Math.round(Math.min(3, s) * 100) / 100;
  }
  return out;
}

export function strengthNotes(
  interests: Interest[],
  profile: ListingProfile | undefined,
  classes: string[] | undefined,
): string[] {
  const notes: string[] = [];
  const labels = [...new Set((classes ?? []).map((c) => CLASS_INTERESTS[c]?.label).filter(Boolean))];
  if (labels.length) notes.push(`Ortsart: ${labels.slice(0, 3).join(', ')} (Wikidata)`);
  if (profile) {
    const parts = interests
      .filter((i) => profile[i] > 0)
      .map((i) => `${INTEREST_LABELS[i].label} ${profile[i]} von ${profile.total}`);
    if (parts.length) notes.push(`Passende Einträge bei Wikivoyage: ${parts.join(', ')}`);
  }
  return notes;
}

/* ---------------- Jahreszeit ---------------- */

/**
 * Auf- oder Abwertung eines Orts für die Reisezeit:
 * winterliche Naturziele, hoch gelegene Orte bei Frost, Strandziele bei Kälte, Polarnacht, Dauerregen.
 */
export function seasonAdjust(a: {
  kind: StopKind;
  tags: Interest[];
  interests: Interest[];
  stats: WindowStats | null;
  elevation?: number;
  daylightH?: number;
}): { delta: number; notes: string[] } {
  const s = a.stats;
  const notes: string[] = [];
  let delta = 0;
  if (!s) return { delta, notes };
  const t = (v: number) => `${Math.round(v)} °C`;
  const winterish = s.tmax < 3 || s.snowShare >= 0.3;
  if (winterish && a.kind !== 'city') {
    delta -= 3;
    notes.push(`Im Reisezeitraum winterlich (Ø ${t(s.tmax)}${s.snowShare >= 0.3 ? ', oft Schnee' : ''}) – Wege und Zufahrten oft gesperrt`);
  } else if (winterish) {
    delta -= 0.5;
    notes.push(`Im Reisezeitraum kalt (Ø ${t(s.tmax)})`);
  }
  const high = a.kind !== 'city' && (a.elevation ?? 0) >= 900;
  const elev = `ca. ${Math.round(a.elevation ?? 0).toLocaleString('de-DE')} m`;
  if (high && winterish && s.snowShare >= 0.3) {
    // Straße hoch oben mit häufigem Schnee: Passstraßen sind dann meist gesperrt
    delta -= 5;
    notes.push(`Hoch gelegen (${elev}) mit Schnee – Passstraßen im Winter meist gesperrt`);
  } else if (high && s.tmin < -2) {
    delta -= 1.5;
    notes.push(`Hoch gelegen (${elev}) bei Nachtfrost`);
  }
  if (a.interests.includes('beach') && a.tags.includes('beach')) {
    if (s.tmax < 18) {
      delta -= 2;
      notes.push(`Für Strand zu kühl (Ø ${t(s.tmax)})`);
    } else if (s.tmax >= 24 && s.rainShare < 0.4) {
      delta += 1;
      notes.push(`Gutes Strandwetter (Ø ${t(s.tmax)})`);
    }
  }
  if (a.kind !== 'city' && a.daylightH != null && a.daylightH < 5) {
    delta -= 1;
    notes.push(`Nur ca. ${Math.round(a.daylightH)} h Tageslicht`);
  }
  if (s.rainShare >= 0.6) {
    delta -= 0.5;
    notes.push(`Sehr regnerisch (an ${Math.round(s.rainShare * 10)} von 10 Tagen)`);
  }
  if (!winterish && s.tmax >= 18 && s.tmax <= 28 && s.rainShare < 0.35 && delta === 0) {
    delta += 0.5;
    notes.push(`Angenehmes Wetter im Reisezeitraum (Ø ${t(s.tmax)})`);
  }
  return { delta, notes };
}
