import type { GeoPoint } from '../types';

const R = 6371; // Erdradius in km
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Kumulierte Distanzen (km) entlang einer Linie aus [lat, lon]-Paaren. */
export function cumulativeKm(line: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) {
    const [aLat, aLon] = line[i - 1];
    const [bLat, bLon] = line[i];
    out.push(out[i - 1] + haversineKm({ lat: aLat, lon: aLon }, { lat: bLat, lon: bLon }));
  }
  return out;
}

/** Punkt bei einem Anteil (0..1) der Gesamtlänge einer Linie. */
export function pointAtFraction(line: [number, number][], fraction: number): GeoPoint {
  if (line.length === 0) throw new Error('leere Linie');
  if (line.length === 1) return { lat: line[0][0], lon: line[0][1] };
  const cum = cumulativeKm(line);
  const total = cum[cum.length - 1];
  const target = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 1; i < cum.length; i++) {
    if (cum[i] >= target) {
      const segLen = cum[i] - cum[i - 1];
      const t = segLen === 0 ? 0 : (target - cum[i - 1]) / segLen;
      return {
        lat: line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
        lon: line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t,
      };
    }
  }
  const last = line[line.length - 1];
  return { lat: last[0], lon: last[1] };
}

/** Teilt eine Linie anhand von Teillängen (km) in Abschnitte auf. */
export function splitLineByLengths(line: [number, number][], lengthsKm: number[]): [number, number][][] {
  const cum = cumulativeKm(line);
  const total = cum[cum.length - 1] || 1;
  const sum = lengthsKm.reduce((a, b) => a + b, 0) || 1;
  const scale = total / sum;
  const parts: [number, number][][] = [];
  let startIdx = 0;
  let acc = 0;
  for (let p = 0; p < lengthsKm.length; p++) {
    acc += lengthsKm[p] * scale;
    let endIdx = startIdx;
    if (p === lengthsKm.length - 1) {
      endIdx = line.length - 1;
    } else {
      while (endIdx < line.length - 1 && cum[endIdx] < acc) endIdx++;
    }
    parts.push(line.slice(startIdx, endIdx + 1));
    startIdx = endIdx;
  }
  return parts;
}

/**
 * Teilt eine Linie an Wegpunkten: Für jeden Zwischenpunkt wird der nächstgelegene
 * Linienpunkt gesucht – nur in der Nähe der erwarteten Position (anhand der Etappenlängen),
 * damit Rundreisen, die an einem Ort zweimal vorbeiführen, nicht falsch geschnitten werden.
 * Die Teile beginnen/enden exakt am Wegpunkt.
 */
export function splitLineAtWaypoints(
  line: [number, number][],
  lengthsKm: number[],
  cuts: [number, number][],
): [number, number][][] {
  if (cuts.length !== lengthsKm.length - 1 || line.length < 2) return splitLineByLengths(line, lengthsKm);
  const cum = cumulativeKm(line);
  const total = cum[cum.length - 1] || 1;
  const sum = lengthsKm.reduce((a, b) => a + b, 0) || 1;
  const scale = total / sum;
  const tol = total * 0.15 + 20;
  const parts: [number, number][][] = [];
  let start = 0;
  let prefix: [number, number] | null = null;
  let acc = 0;
  for (let k = 0; k < cuts.length; k++) {
    acc += lengthsKm[k] * scale;
    const cut = cuts[k];
    let best = -1;
    let bestD = Infinity;
    for (let i = start; i < line.length; i++) {
      if (cum[i] < acc - tol) continue;
      if (cum[i] > acc + tol) break;
      const d = haversineKm({ lat: line[i][0], lon: line[i][1] }, { lat: cut[0], lon: cut[1] });
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best === -1) best = Math.min(line.length - 1, Math.max(start, cum.findIndex((c) => c >= acc)));
    parts.push([...(prefix ? [prefix] : []), ...line.slice(start, best), cut]);
    prefix = cut;
    start = best;
  }
  parts.push([...(prefix ? [prefix] : []), ...line.slice(start)]);
  return parts;
}

export function coordKey(p: GeoPoint): string {
  return `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
}

export function formatKm(km: number): string {
  return `${Math.round(km).toLocaleString('de-DE')} km`;
}

export function formatHours(h: number): string {
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  if (hh === 0) return `${mm} min`;
  return mm === 0 ? `${hh} h` : `${hh} h ${String(mm).padStart(2, '0')} min`;
}
