import type { Interest, Pace, PoiCounts, StopInfo, StopKind } from '../types';
import { formatHours } from '../lib/geo';
import { INTEREST_LABELS, PACE_NIGHT_FACTOR } from './profiles';

export interface NightsInput {
  kind: StopKind;
  tags: Interest[];
  info?: Pick<StopInfo, 'seeCount' | 'doCount' | 'poi' | 'notableCount' | 'unesco'> & { articleLength?: number };
  /** Aufrufe des Wikivoyage-Artikels (60 Tage) – Beliebtheit bei Reisenden */
  views?: number;
  interests: Interest[];
  pace: Pace;
  /** Fahrzeit des letzten Tagesabschnitts vor der Ankunft (h) */
  arrivalDriveH?: number;
  maxDriveH: number;
}

export interface NightsRecommendation {
  nights: number;
  reasons: string[];
}

function poiActivity(p: PoiCounts): number {
  return (
    p.attractions +
    p.museums * 1.5 +
    p.viewpoints * 0.5 +
    p.historic * 0.3 +
    p.beaches +
    p.nature * 0.3 +
    p.hiking
  );
}

/**
 * Empfiehlt die Aufenthaltsdauer anhand dessen, wie viel es vor Ort zu tun gibt
 * (Wikivoyage-Einträge bzw. OSM-Sehenswürdigkeiten), der Interessen, des Tempos
 * und der Anreise.
 */
export function recommendNights(input: NightsInput): NightsRecommendation {
  const reasons: string[] = [];
  let activity: number;
  const info = input.info;
  if (info && info.seeCount + info.doCount > 0) {
    // Qualität statt nur Menge: bekannte Ziele (mit Wikidata-Eintrag) zählen doppelt
    const notable = Math.min(info.notableCount ?? 0, info.seeCount + info.doCount);
    activity = info.seeCount + info.doCount + notable;
    reasons.push(
      `${info.seeCount} ${info.seeCount === 1 ? 'Sehenswürdigkeit' : 'Sehenswürdigkeiten'} und ` +
        `${info.doCount} ${info.doCount === 1 ? 'Aktivität' : 'Aktivitäten'} laut Wikivoyage` +
        (notable > 0 ? `, davon ${notable} bekannte` : ''),
    );
  } else if (info?.poi && poiActivity(info.poi) > 0) {
    activity = poiActivity(info.poi);
    const p = info.poi;
    const parts = [
      p.attractions && `${p.attractions} Sehenswürdigkeiten`,
      p.museums && `${p.museums} Museen`,
      p.viewpoints && `${p.viewpoints} Aussichtspunkte`,
      p.beaches && `${p.beaches} Strände`,
      p.hiking && `${p.hiking} Wanderrouten`,
    ].filter(Boolean);
    reasons.push(`In der Umgebung (OpenStreetMap): ${parts.join(', ') || 'einige Ziele'}`);
  } else if (info?.articleLength && info.articleLength > 3000) {
    // Artikel ohne strukturierte Einträge: Länge als grobes Maß (~2,5 kB Text pro Programmpunkt)
    activity = Math.min(40, info.articleLength / 2500);
    reasons.push(
      `Wikivoyage-Artikel mit ${Math.round(info.articleLength / 1000)} kB Reisetipps (keine einzeln erfassten Sehenswürdigkeiten)`,
    );
  } else {
    activity = input.kind === 'nature' ? 6 : 3;
    reasons.push('Wenige Infos verfügbar – Standardwert');
  }

  // 3 Einträge → 1 Nacht, ~15 → 2, ~30 → 3, 100+ → 4
  let raw = 0.5 + Math.log2(1 + activity) / 2.2;

  const matches = input.tags.filter((t) => input.interests.includes(t));
  if (matches.length > 0) {
    raw *= Math.min(1.3, 1 + 0.12 * matches.length);
    reasons.push(`Passt zu deinen Interessen: ${matches.map((m) => INTEREST_LABELS[m].label).join(', ')}`);
  } else if (input.interests.length > 0) {
    raw *= 0.85;
  }
  if (input.kind === 'nature' && matches.some((m) => m === 'nature' || m === 'hiking')) raw += 0.3;

  // Beliebtheit bei Reisenden und Welterbe: etwas mehr Zeit
  const perMonth = Math.round((input.views ?? 0) / 2);
  if (perMonth >= 750) {
    raw += 0.4;
    reasons.push(`Sehr beliebtes Reiseziel (ca. ${perMonth.toLocaleString('de-DE')} Aufrufe/Monat auf Wikivoyage)`);
  } else if (perMonth >= 150) {
    raw += 0.2;
    reasons.push(`Beliebtes Reiseziel (ca. ${perMonth.toLocaleString('de-DE')} Aufrufe/Monat auf Wikivoyage)`);
  }
  if (info?.unesco) {
    raw += 0.2;
    reasons.push('UNESCO-Welterbe vor Ort oder in der Nähe');
  }

  raw *= PACE_NIGHT_FACTOR[input.pace];
  if (input.pace === 'relaxed') reasons.push('Entspanntes Tempo: etwas mehr Zeit eingeplant');
  if (input.pace === 'fast') reasons.push('Tempo „Viel sehen“: kürzer gehalten');

  let nights = Math.max(1, Math.min(6, Math.round(raw)));

  const arrival = input.arrivalDriveH ?? 0;
  if (nights === 1 && input.pace !== 'fast' && arrival > input.maxDriveH * 0.75) {
    nights = 2;
    reasons.push(`Nach ${formatHours(arrival)} Fahrt: ein Tag zum Ankommen`);
  }
  return { nights, reasons };
}

export interface FitItem {
  recommended: number;
  score: number;
  manual: boolean;
  nights: number;
}

/**
 * Verteilt die verfügbaren Nächte auf die Stops: ausgehend von den Empfehlungen,
 * proportional gekürzt oder verlängert. Manuell gesetzte Werte bleiben unverändert.
 * Mindestens 1 Nacht pro Stop.
 */
export function fitNights(items: FitItem[], available: number): { nights: number[]; overflow: number } {
  const n = items.map((it) => (it.manual ? it.nights : Math.max(1, it.recommended)));
  const free = items.map((it, i) => (it.manual ? -1 : i)).filter((i) => i >= 0);
  const sum = () => n.reduce((a, b) => a + b, 0);
  const ratio = (i: number) => n[i] / Math.max(1, items[i].recommended);

  let guard = 0;
  while (sum() > available && guard++ < 1000) {
    const reducible = free.filter((i) => n[i] > 1);
    if (reducible.length === 0) break;
    reducible.sort((a, b) => ratio(b) - ratio(a) || items[a].score - items[b].score);
    n[reducible[0]]--;
  }
  guard = 0;
  while (sum() < available && free.length > 0 && guard++ < 1000) {
    const sorted = [...free].sort((a, b) => ratio(a) - ratio(b) || items[b].score - items[a].score);
    n[sorted[0]]++;
  }
  return { nights: n, overflow: Math.max(0, sum() - available) };
}
