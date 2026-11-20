import { useEffect, useState } from 'react';
import { decodeTrip, settingsFromShared, sharedStops, type SharedTrip } from '../lib/share';
import { rebuildSharedTrip } from '../planner/importTrip';
import { addDays, formatDate } from '../planner/itinerary';
import { STYLE_LABELS } from '../planner/profiles';
import { useTrips } from '../store';
import { navigate } from '../nav';
import { Progress } from './Progress';

/** Wird geöffnet, wenn jemand einen Teilen-Link bzw. QR-Code aufruft. */
export function ImportView({ data }: { data: string }) {
  const trips = useTrips((s) => s.trips);
  const saveTrip = useTrips((s) => s.saveTrip);
  const [shared, setShared] = useState<SharedTrip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[] | null>(null);

  useEffect(() => {
    decodeTrip(data).then(setShared, (e) => setError((e as Error).message));
  }, [data]);

  const run = async (asCopy: boolean) => {
    if (!shared) return;
    setProgress(['Übernehme Trip …']);
    setError(null);
    try {
      const trip = await rebuildSharedTrip(shared, (m) => setProgress((p) => [...(p ?? []), m]), { asCopy });
      saveTrip(trip);
      // replace: Zurück-Taste soll nicht erneut den Import öffnen
      navigate({ name: 'trip', id: trip.id }, true);
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
    }
  };

  if (progress) {
    return (
      <main className="page narrow">
        <Progress title="Trip wird übernommen" steps={progress} />
      </main>
    );
  }

  if (!shared) {
    return (
      <main className="page narrow">
        {error ? (
          <div className="alert error">
            {error} <a href="#/">Zur Übersicht</a>
          </div>
        ) : (
          <div className="center-msg">Lese Trip aus dem Link …</div>
        )}
      </main>
    );
  }

  const s = settingsFromShared(shared);
  const stops = sharedStops(shared);
  const existing = trips[shared.i];

  return (
    <main className="page narrow">
      <div className="card import-card">
        <div className="muted small">Geteilter Trip</div>
        <h1>{shared.n}</h1>
        <div className="muted">
          {STYLE_LABELS[s.style].icon} {STYLE_LABELS[s.style].label} · {formatDate(s.startDate)} –{' '}
          {formatDate(addDays(s.startDate, s.nights))} · {s.nights} Nächte
        </div>
        <ol className="import-stops">
          <li>🏁 {s.start.name}</li>
          {stops.map((st, i) => (
            <li key={i}>
              {st.name} <span className="muted small">· {st.nights} {st.nights === 1 ? 'Nacht' : 'Nächte'}</span>
            </li>
          ))}
          <li>🎯 {(s.end ?? s.start).name}</li>
        </ol>
        {existing && (
          <div className="alert warn small">
            Dieser Trip ist auf diesem Gerät schon gespeichert. „Ersetzen“ überschreibt ihn mit dem geteilten Stand.
          </div>
        )}
        {error && <div className="alert error">{error}</div>}
        <div className="import-actions">
          <button className="btn btn-primary" onClick={() => run(false)}>
            {existing ? 'Ersetzen' : 'Trip übernehmen'}
          </button>
          {existing && (
            <button className="btn" onClick={() => run(true)}>
              Als Kopie speichern
            </button>
          )}
          <a className="btn btn-ghost" href="#/">
            Abbrechen
          </a>
        </div>
        <p className="muted small">
          Route, Infos und Unterkünfte werden auf diesem Gerät neu geladen – das dauert ein paar Sekunden. Der Trip wird nur
          hier im Browser gespeichert.
        </p>
      </div>
    </main>
  );
}
