import { useState } from 'react';
import type { DiscoverData } from '../planner/discover';
import { fameLabel } from '../planner/discover';
import type { MapPoi } from './MapView';

export interface DiscoverState {
  loading: boolean;
  data?: DiscoverData;
  error?: string;
}

const km = (d?: number) => (d == null ? '' : d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1).replace('.', ',')} km`);

/** Punkte für die Karte aus den Entdecken-Daten */
export function discoverPois(data?: DiscoverData): MapPoi[] {
  if (!data) return [];
  const pois: MapPoi[] = [];
  for (const s of data.sights.slice(0, 15)) {
    if (s.lat == null || s.lon == null) continue;
    pois.push({ id: s.id, lat: s.lat, lon: s.lon, icon: s.kind === 'see' ? '🏛️' : '🥾', title: s.name, subtitle: s.description?.slice(0, 120), url: s.url });
  }
  for (const n of data.nearby.slice(0, 10)) {
    pois.push({ id: `wp-${n.title}`, lat: n.lat, lon: n.lon, icon: '📖', title: n.title, subtitle: n.description, url: n.url });
  }
  return pois;
}

/** Sehenswürdigkeiten (Wikivoyage) und Wissenswertes in der Nähe (Wikipedia) für einen Ort */
export function DiscoverPanel({ state }: { state: DiscoverState }) {
  const [allSights, setAllSights] = useState(false);
  const d = state.data;
  if (state.loading && !d) return <div className="discover muted small">Suche Sehenswürdigkeiten …</div>;
  if (state.error && !d) return <div className="discover alert warn small">{state.error}</div>;
  if (!d) return null;

  const sights = allSights ? d.sights : d.sights.slice(0, 6);

  return (
    <div className="discover" onClick={(e) => e.stopPropagation()}>
      {d.wikivoyageDeUrl && (
        <a className="pill-link" href={d.wikivoyageDeUrl} target="_blank" rel="noreferrer">
          Reiseführer auf Deutsch (Wikivoyage) ↗
        </a>
      )}

      {d.sights.length > 0 && (
        <section>
          <h4>
            Sehenswürdigkeiten & Aktivitäten <span className="muted small">· Wikivoyage, englisch</span>
          </h4>
          <ul className="sight-list">
            {sights.map((s) => {
              const fame = fameLabel(s.views);
              return (
                <li key={s.id} className="sight">
                  <div className="sight-head">
                    <span aria-hidden>{s.kind === 'see' ? '🏛️' : '🥾'}</span>
                    <strong>{s.name}</strong>
                    {fame && (
                      <span className="pill pill-accent" title={`ca. ${Math.round(s.views! / 2).toLocaleString('de-DE')} Wikipedia-Aufrufe pro Monat`}>
                        {fame}
                      </span>
                    )}
                    {s.distanceKm != null && <span className="muted small">{km(s.distanceKm)}</span>}
                  </div>
                  {s.description && <p className="small sight-desc">{s.description}</p>}
                  <div className="muted small sight-meta">
                    {s.hours && <span>🕘 {s.hours}</span>}
                    {s.price && <span>💶 {s.price}</span>}
                  </div>
                  <div className="acc-actions small">
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noreferrer">
                        Website ↗
                      </a>
                    )}
                    {s.lat != null && s.lon != null && (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.name} ${s.lat},${s.lon}`)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        ⭐ Bewertungen (Google) ↗
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {d.sights.length > 6 && (
            <button className="btn btn-ghost btn-small" onClick={() => setAllSights((v) => !v)}>
              {allSights ? 'Weniger anzeigen' : `Alle ${d.sights.length} anzeigen`}
            </button>
          )}
        </section>
      )}

      {d.nearby.length > 0 && (
        <section>
          <h4>
            In der Nähe <span className="muted small">· Wikipedia, nach Beliebtheit</span>
          </h4>
          <ul className="nearby-grid">
            {d.nearby.map((n) => (
              <li key={n.title}>
                <a href={n.url} target="_blank" rel="noreferrer" className="nearby-card">
                  {n.thumbnail ? <img src={n.thumbnail} alt="" loading="lazy" /> : <div className="nearby-noimg">📖</div>}
                  <div>
                    <strong>{n.title}</strong>
                    <div className="muted small">
                      {n.description}
                      {n.description ? ' · ' : ''}
                      {km(n.distanceKm)}
                    </div>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {d.nearbyError && <div className="muted small">Wikipedia: {d.nearbyError}</div>}

      {d.sights.length === 0 && d.nearby.length === 0 && !d.nearbyError && (
        <div className="muted small">Keine Einträge in Wikivoyage oder Wikipedia gefunden.</div>
      )}
      <p className="muted small">
        Sortiert nach Bekanntheit (Aufrufzahlen bei Wikipedia/Wikivoyage) – echte Gästebewertungen gibt es über den
        Google-Link.
      </p>
    </div>
  );
}
