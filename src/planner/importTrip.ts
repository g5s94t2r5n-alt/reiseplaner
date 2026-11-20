import type { Stop, Trip } from '../types';
import { settingsFromShared, sharedStops, type SharedTrip } from '../lib/share';
import { loadCandidates } from './candidates';
import { enrichStops, recalcTrip, uid, type ProgressFn } from './plan';
import { AVG_NIGHTS } from './profiles';

/**
 * Baut einen geteilten Trip auf diesem Gerät wieder vollständig auf:
 * Kandidaten der Region, Infos zu den Stops, Route und Zwischenstopps.
 * Die Nächte pro Stop werden exakt so übernommen, wie sie geteilt wurden.
 */
export async function rebuildSharedTrip(sh: SharedTrip, onProgress: ProgressFn, opts: { asCopy?: boolean } = {}): Promise<Trip> {
  const settings = settingsFromShared(sh);
  const shared = sharedStops(sh);

  onProgress('Lade Ziele der Region …');
  // gleiche Kandidatenmenge wie bei der ursprünglichen Planung
  const wanted = Math.ceil(settings.nights / AVG_NIGHTS[settings.pace]);
  const load = await loadCandidates(settings.region, settings.interests, wanted).catch(() => ({
    candidates: [],
    warnings: [] as string[],
    wikivoyageTitle: undefined,
  }));
  const byTitle = new Map(load.candidates.map((c) => [c.wvTitle ?? c.name, c]));

  let stops: Stop[] = shared.map((s) => {
    const c = s.wvTitle ? byTitle.get(s.wvTitle) : undefined;
    return {
      id: uid(),
      name: s.name,
      kind: s.kind,
      lat: s.lat,
      lon: s.lon,
      wvTitle: s.wvTitle,
      description: c?.description,
      wikidata: c?.wikidata,
      tags: c?.tags ?? [],
      score: c?.score ?? 4,
      nights: s.nights,
      recommendedNights: s.nights,
      manualNights: s.manualNights,
      reasons: [],
    };
  });

  onProgress('Lade Infos zu den Stops …');
  stops = await enrichStops(stops, onProgress);

  const now = Date.now();
  let trip: Trip = {
    id: opts.asCopy ? uid() : sh.i,
    name: opts.asCopy ? `${sh.n} (Kopie)` : sh.n,
    createdAt: now,
    updatedAt: now,
    settings,
    candidates: load.candidates,
    stops,
    segments: [],
    transitNames: {},
    warnings: load.warnings,
  };
  trip = await recalcTrip(trip, { onProgress });

  // Genau die Nächte übernehmen, die auf dem anderen Gerät eingestellt waren
  return { ...trip, stops: trip.stops.map((s, i) => ({ ...s, nights: shared[i]?.nights ?? s.nights })) };
}
