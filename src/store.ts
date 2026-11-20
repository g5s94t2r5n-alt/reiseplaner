import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { del, get, set } from 'idb-keyval';
import type { Trip } from './types';

interface TripState {
  trips: Record<string, Trip>;
  saveTrip: (trip: Trip) => void;
  deleteTrip: (id: string) => void;
}

/** Alle Trips werden lokal im Browser (IndexedDB) gespeichert – kein Konto, kein Server. */
export const useTrips = create<TripState>()(
  persist(
    (setState) => ({
      trips: {},
      saveTrip: (trip) => setState((s) => ({ trips: { ...s.trips, [trip.id]: trip } })),
      deleteTrip: (id) =>
        setState((s) => {
          const trips = { ...s.trips };
          delete trips[id];
          return { trips };
        }),
    }),
    {
      name: 'reiseplaner-trips',
      version: 1,
      storage: createJSONStorage(() => ({
        getItem: async (k) => ((await get(k)) as string | undefined) ?? null,
        setItem: (k, v) => set(k, v),
        removeItem: (k) => del(k),
      })),
    },
  ),
);
