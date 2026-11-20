import type { Interest } from '../types';
import type { SeasonReport, StopSeason } from '../planner/seasonReport';
import { formatMonths, monthScore, MONTH_NAMES, type SeasonWarning } from '../planner/season';

const levelRank = (l: SeasonWarning['level']) => ({ good: 0, info: 1, warn: 2, bad: 3 })[l];

export function WarningList({ warnings, compact }: { warnings: SeasonWarning[]; compact?: boolean }) {
  if (warnings.length === 0) return null;
  return (
    <ul className={`warnings ${compact ? 'compact' : ''}`}>
      {warnings.map((w) => (
        <li key={w.text} className={`w-${w.level}`}>
          <span aria-hidden>{w.icon}</span> {w.text}
        </li>
      ))}
    </ul>
  );
}

interface Props {
  report: SeasonReport | null;
  loading: boolean;
  error: string | null;
  interests: Interest[];
  stopNames: Record<string, string>;
  segmentLabels: Record<number, string>;
}

export function SeasonPanel({ report, loading, error, interests, stopNames, segmentLabels }: Props) {
  if (!report) {
    return (
      <div className="card season">
        <div className="season-head">
          <strong>Saison & Wetter</strong>
          <span className="muted small">{error ? `nicht verfügbar: ${error}` : 'Lade Klimadaten …'}</span>
        </div>
      </div>
    );
  }

  // Gleichartige Hinweise zusammenfassen: eine Zeile pro Art, mit allen betroffenen Orten/Etappen
  const groups = new Map<string, { w: SeasonWarning; where: string[] }>();
  const addTo = (w: SeasonWarning, where: string) => {
    const g = groups.get(w.key) ?? { w, where: [] };
    if (w.level === 'bad') g.w = w;
    g.where.push(where);
    groups.set(w.key, g);
  };
  Object.entries(report.segments).forEach(([i, s]) => {
    if (s.warning) addTo(s.warning, `${segmentLabels[Number(i)]} (${(Math.round(s.maxElevation / 50) * 50).toLocaleString('de-DE')} m)`);
  });
  Object.entries(report.stops).forEach(([id, s]) =>
    s.warnings.forEach((w) => {
      if (w.level === 'warn' || w.level === 'bad' || w.level === 'good') addTo(w, stopNames[id]);
    }),
  );
  const grouped = [...groups.values()].sort((a, b) => levelRank(b.w.level) - levelRank(a.w.level));
  const issues = grouped.filter((g) => g.w.level === 'warn' || g.w.level === 'bad').length;
  const scores = report.normals?.map((n) => monthScore(n, interests)) ?? [];
  const max = Math.max(...scores);

  return (
    <details className="card season" open={issues > 0 || undefined}>
      <summary className="season-head">
        <strong>Saison & Wetter</strong>
        <span className={`season-badge ${issues > 0 ? 'warn' : 'good'}`}>
          {issues > 0 ? `${issues} ${issues === 1 ? 'Hinweis' : 'Hinweise'}` : 'keine Probleme'}
        </span>
        {loading && <span className="muted small">aktualisiere …</span>}
      </summary>

      {report.normals && (
        <div className="months" role="img" aria-label={`Klima entlang der Route. Beste Reisezeit: ${formatMonths(report.best)}`}>
          {report.normals.map((n, m) => {
            const s = scores[m];
            const cls = s >= max - 0.75 ? 'good' : s >= max - 2 ? 'ok' : 'poor';
            return (
              <div
                key={m}
                className={`m-cell ${cls} ${report.travel.includes(m) ? 'travel' : ''}`}
                title={`${MONTH_NAMES[m]}: Ø ${Math.round(n.tmax)}°/${Math.round(n.tmin)}°, Regen an ${Math.round(n.rainShare * 30)} Tagen`}
              >
                <span className="m-name">{MONTH_NAMES[m]}</span>
                <span className="m-temp">{Math.round(n.tmax)}°</span>
                <span className="m-rain">{Math.round(n.rainShare * 30)}</span>
              </div>
            );
          })}
        </div>
      )}
      {report.normals && (
        <div className="muted small legend">
          Ø Tageshöchstwert · Regentage pro Monat · <span className="legend-travel">Reisemonat</span> · grün = beste Zeit
        </div>
      )}

      <WarningList warnings={report.tripWarnings} />
      {grouped.length > 0 && (
        <ul className="warnings">
          {grouped.map(({ w, where }) => (
            <li key={w.key} className={`w-${w.level}`}>
              <span aria-hidden>{w.icon}</span> {w.general ?? w.text}
              <div className="where">{where.join(' · ')}</div>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Klima: Durchschnitt der letzten drei Jahre (Open-Meteo/ERA5) für deine Reisetage. Ab ca. 2 Wochen vor Abreise wird
        die Wettervorhersage verwendet.
      </p>
    </details>
  );
}

/** Kurze Wetterzeile in der Stop-Karte. */
export function StopWeather({ season }: { season?: StopSeason }) {
  if (!season) return null;
  const s = season.stats;
  const daylight =
    season.daylightH === 0 ? 'Polarnacht' : season.daylightH >= 24 ? 'Mitternachtssonne' : `${Math.round(season.daylightH)} h Tageslicht`;
  return (
    <div className="stop-weather">
      <div className="small">
        {s ? (
          <>
            <span className="pill">{s.source === 'forecast' ? 'Vorhersage' : 'typisch'}</span> 🌡 {Math.round(s.tmin)} bis{' '}
            {Math.round(s.tmax)} °C · 🌧 Regen an {Math.round(s.rainShare * 10)} von 10 Tagen
            {s.snowShare >= 0.1 && ` · ❄ Schnee an ${Math.round(s.snowShare * 10)} von 10`} · ☀ {daylight}
          </>
        ) : (
          <>☀ {daylight}</>
        )}
      </div>
      <WarningList warnings={season.warnings} compact />
    </div>
  );
}
