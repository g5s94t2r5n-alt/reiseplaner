import type { Candidate, Pace } from '../types';
import { haversineKm } from '../lib/geo';
import { AVG_NIGHTS } from './profiles';

/** Anzahl Zwischenübernachtungen, wenn eine Etappe länger als die maximale Tagesfahrzeit ist. */
export function transitNightsFor(durationH: number, maxDriveH: number): number {
  if (durationH <= maxDriveH * 1.15) return 0;
  return Math.ceil(durationH / maxDriveH) - 1;
}

export interface SelectInput {
  candidates: Candidate[];
  /**
   * Fahrzeit in Stunden zwischen Knoten. Knoten 0 = Start, 1 = Ziel,
   * 2 + i = candidates[i]. null = nicht erreichbar.
   */
  duration: (a: number, b: number) => number | null;
  nights: number;
  pace: Pace;
  maxDriveH: number;
  /** Faktor auf die Fahrzeit (z. B. Backpacker mit Bus/Bahn) */
  travelFactor: number;
  minSpacingKm?: number;
  /** Bereits feststehende Stops (Indizes in candidates), in Reihenfolge */
  fixed?: number[];
  /**
   * Mindestbewertung relativ zum besten Kandidaten (0–1). Schwächere Orte werden nicht als
   * Lückenfüller gewählt – übrige Nächte gehen dann an die gewählten Stops. Standard 0,55.
   */
  minRelScore?: number;
  /** Mindestabstand zwischen zwei Stops als Fahrzeit in Stunden (Standard 0,5) */
  minSpacingH?: number;
  /** Faktor je weiterem Stop derselben Ortsart (Abwechslung), Standard 0,8 */
  diversity?: number;
}

export interface SelectResult {
  /** Indizes in candidates, in Reiseroute-Reihenfolge */
  order: number[];
  estimatedNights: number;
}

/**
 * Greedy-Einfügeverfahren: Fügt so lange den Kandidaten mit dem besten Verhältnis
 * "Attraktivität pro verbrauchtem Reisetag" an der günstigsten Stelle ein,
 * bis das Nächte-Budget ausgeschöpft ist. Danach wird die Reihenfolge per 2-opt verbessert.
 */
export function selectStops(input: SelectInput): SelectResult {
  const { candidates, nights, pace, maxDriveH, travelFactor } = input;
  const minSpacing = input.minSpacingKm ?? 15;
  const minSpacingH = input.minSpacingH ?? 0.5;
  const diversity = input.diversity ?? 0.8;
  const avg = AVG_NIGHTS[pace];
  const node = (ci: number) => ci + 2;
  const dur = (a: number, b: number) => {
    if (a === b) return 0;
    const d = input.duration(a, b);
    return d == null ? null : d * travelFactor;
  };

  const route: number[] = [0, ...(input.fixed ?? []).map(node), 1];
  const chosen = new Set<number>(input.fixed ?? []);
  const fixedSet = new Set(input.fixed ?? []);
  const bestScore = Math.max(0, ...candidates.filter((_, i) => !fixedSet.has(i)).map((c) => c.score));
  const minScore = bestScore * (input.minRelScore ?? 0.55);

  const nightsOf = (r: number[]) => {
    let total = (r.length - 2) * avg;
    for (let i = 1; i < r.length; i++) {
      const d = dur(r[i - 1], r[i]);
      if (d == null) return Infinity;
      total += transitNightsFor(d, maxDriveH);
    }
    return total;
  };

  for (;;) {
    let best: { ci: number; pos: number; value: number } | null = null;
    for (let ci = 0; ci < candidates.length; ci++) {
      if (chosen.has(ci)) continue;
      const c = candidates[ci];
      if (c.score < minScore) continue;
      if ([...chosen].some((o) => haversineKm(candidates[o], c) < minSpacing)) continue;
      // zu nah an einem gewählten Stop (Fahrzeit) → lieber als Ausflug von dort
      if (
        [...chosen].some((o) => {
          const d = input.duration(node(ci), node(o)) ?? input.duration(node(o), node(ci));
          return d != null && d < minSpacingH;
        })
      )
        continue;
      let bestPos = -1;
      let bestAdd = Infinity;
      for (let pos = 1; pos < route.length; pos++) {
        const a = route[pos - 1];
        const b = route[pos];
        const da = dur(a, node(ci));
        const db = dur(node(ci), b);
        const ab = dur(a, b);
        if (da == null || db == null || ab == null) continue;
        const add = da + db - ab;
        if (add < bestAdd) {
          bestAdd = add;
          bestPos = pos;
        }
      }
      if (bestPos === -1) continue;
      const trial = [...route.slice(0, bestPos), node(ci), ...route.slice(bestPos)];
      if (nightsOf(trial) > nights) continue;
      const daysUsed = avg + Math.max(0, bestAdd) / maxDriveH;
      // Quadrat: Highlights sind einen Umweg wert, mittelmäßige Orte nicht
      // Abwechslung: jeder weitere Stop derselben Ortsart (z. B. dritter Fjord) zählt weniger
      const sameType = c.typeKey ? [...chosen].filter((o) => candidates[o].typeKey === c.typeKey).length : 0;
      const value = (Math.max(0.1, c.score) ** 2 / daysUsed) * diversity ** sameType;
      if (!best || value > best.value) best = { ci, pos: bestPos, value };
    }
    if (!best) break;
    route.splice(best.pos, 0, node(best.ci));
    chosen.add(best.ci);
  }

  const improved = twoOpt(route, (a, b) => dur(a, b) ?? 1e6);
  return { order: improved.slice(1, -1).map((n) => n - 2), estimatedNights: nightsOf(improved) };
}

/** 2-opt-Verbesserung bei festem Anfang und Ende. */
export function twoOpt(route: number[], cost: (a: number, b: number) => number): number[] {
  const r = [...route];
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 1; i < r.length - 2; i++) {
      for (let k = i + 1; k < r.length - 1; k++) {
        const before = cost(r[i - 1], r[i]) + cost(r[k], r[k + 1]);
        const after = cost(r[i - 1], r[k]) + cost(r[i], r[k + 1]);
        if (after + 1e-9 < before) {
          const mid = r.slice(i, k + 1).reverse();
          r.splice(i, mid.length, ...mid);
          improved = true;
        }
      }
    }
  }
  return r;
}
