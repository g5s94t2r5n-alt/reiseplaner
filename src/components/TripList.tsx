import { useTrips } from '../store';
import { formatDate } from '../planner/itinerary';
import { STYLE_LABELS } from '../planner/profiles';
import { buildItinerary } from '../planner/itinerary';
import { formatKm } from '../lib/geo';

export function TripList() {
  const trips = useTrips((s) => s.trips);
  const deleteTrip = useTrips((s) => s.deleteTrip);
  const list = Object.values(trips).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <main className="page">
      <div className="hero">
        <h1>Roadtrips, Backpacking und Camping mit mehreren Stops</h1>
        <p className="muted">
          Land oder Region wählen, Zeitraum angeben: Der Planer schlägt eine Route mit sinnvollen Etappen vor, empfiehlt,
          wie lange du wo bleibst, und zeigt passende Unterkünfte, vom Stellplatz bis zum Hostel.
        </p>
        <a href="#/new" className="btn btn-primary">
          Neuen Trip planen
        </a>
      </div>

      {list.length > 0 && (
        <>
          <h2>Meine Trips</h2>
          <div className="trip-grid">
            {list.map((t) => {
              const sum = buildItinerary(t);
              return (
                <article key={t.id} className="card trip-card">
                  <a href={`#/trip/${t.id}`} className="trip-card-link">
                    <div className="trip-card-icon">{STYLE_LABELS[t.settings.style].icon}</div>
                    <div>
                      <h3>{t.name}</h3>
                      <div className="muted small">
                        {formatDate(t.settings.startDate, false)} – {formatDate(sum.endDate, false)} · {t.stops.length}{' '}
                        Stops · {formatKm(sum.totalKm)}
                      </div>
                      <div className="small">{t.stops.map((s) => s.name).join(' → ')}</div>
                    </div>
                  </a>
                  <button
                    className="icon-btn"
                    title="Trip löschen"
                    aria-label={`Trip ${t.name} löschen`}
                    onClick={() => {
                      if (confirm(`„${t.name}“ wirklich löschen?`)) deleteTrip(t.id);
                    }}
                  >
                    🗑
                  </button>
                </article>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
