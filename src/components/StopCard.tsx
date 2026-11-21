import type { Stop, TravelStyle } from '../types';
import { formatDate } from '../planner/itinerary';
import { INTEREST_LABELS } from '../planner/profiles';
import { AccommodationList, type AccState, type WildInfo } from './AccommodationList';
import { StopWeather } from './SeasonPanel';
import type { StopSeason } from '../planner/seasonReport';
import type { PublicHoliday } from '../api/holidays';
import { DiscoverPanel, type DiscoverState } from './DiscoverPanel';
import type { Alternative } from '../planner/alternatives';
import { formatHours } from '../lib/geo';

interface Props {
  stop: Stop;
  index: number;
  count: number;
  arrive: string;
  depart: string;
  selected: boolean;
  style: TravelStyle;
  season?: StopSeason;
  wild?: WildInfo;
  travelers?: number;
  country?: string;
  acc?: AccState;
  accOpen: boolean;
  disabled: boolean;
  onSelect: () => void;
  onNights: (delta: number) => void;
  onResetNights: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onToggleAcc: () => void;
  discover?: DiscoverState;
  discoverOpen: boolean;
  onToggleDiscover: () => void;
  holidays: PublicHoliday[];
  onTogglePin: () => void;
  altOpen: boolean;
  alternatives?: Alternative[];
  onToggleAlternatives: () => void;
  onSwap: (alt: Alternative) => void;
  onExclude: () => void;
}

const KIND_LABEL = { city: 'Ort', nature: 'Naturziel', custom: 'Eigener Stop' };

/** Beliebtheit bei Reisenden (Wikivoyage-Aufrufe, 60 Tage) – keine Bewertung */
function popularity(views?: number): string | null {
  const perMonth = (views ?? 0) / 2;
  if (perMonth >= 750) return '🔥 Sehr beliebt';
  if (perMonth >= 150) return '⭐ Beliebt';
  return null;
}

export function StopCard(p: Props) {
  const { stop } = p;
  const summary = stop.info?.summary;
  const text = summary?.text ?? stop.description;
  const stopClick = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <article className={`card stop-card ${p.selected ? 'selected' : ''}`} onClick={p.onSelect}>
      <div className="stop-head">
        <span className="stop-num" aria-hidden>
          {p.index + 1}
        </span>
        <div className="stop-title">
          <h3>
            {stop.pinned && (
              <span className="pin-badge" title="Muss rein – bleibt beim Neu-Vorschlagen erhalten">
                📌{' '}
              </span>
            )}
            {stop.name}
          </h3>
          <div className="muted small">
            {formatDate(p.arrive)} – {formatDate(p.depart)} · {KIND_LABEL[stop.kind]}
          </div>
        </div>
        <div className="stepper" onClick={(e) => e.stopPropagation()}>
          <button
            className="icon-btn"
            aria-label="Eine Nacht weniger"
            disabled={p.disabled || stop.nights <= 1}
            onClick={() => p.onNights(-1)}
          >
            −
          </button>
          <div className="stepper-val">
            <strong>{stop.nights}</strong>
            <span className="small">{stop.nights === 1 ? 'Nacht' : 'Nächte'}</span>
          </div>
          <button className="icon-btn" aria-label="Eine Nacht mehr" disabled={p.disabled} onClick={() => p.onNights(1)}>
            +
          </button>
        </div>
      </div>

      {summary?.image && <img className="stop-img" src={summary.image} alt="" loading="lazy" />}
      {text && <p className="stop-desc">{text.length > 320 ? `${text.slice(0, 320).replace(/\s\S*$/, '')} …` : text}</p>}

      <StopWeather season={p.season} />

      {stop.selectionNotes && stop.selectionNotes.length > 0 && (
        <details className="why" onClick={(e) => e.stopPropagation()}>
          <summary>Warum dieser Stop?</summary>
          <ul>
            {stop.selectionNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}

      <details className="why" onClick={(e) => e.stopPropagation()}>
        <summary>
          Empfehlung: {stop.recommendedNights} {stop.recommendedNights === 1 ? 'Nacht' : 'Nächte'}
          {stop.nights !== stop.recommendedNights && !stop.manualNights && ' (an dein Budget angepasst)'}
        </summary>
        <ul>
          {stop.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>
      {stop.manualNights && (
        <button className="link small" onClick={stopClick(p.onResetNights)} disabled={p.disabled}>
          Manuell festgelegt · auf automatische Verteilung zurücksetzen
        </button>
      )}

      {p.holidays.length > 0 && (
        <div className="small holiday-line">
          🎉 {p.holidays.map((h) => `${formatDate(h.date)}: ${h.localName}`).join(' · ')} – Feiertag, Geschäfte oft zu
        </div>
      )}

      {(stop.tags.length > 0 || popularity(stop.views) || stop.info?.unesco) && (
        <div className="tags">
          {popularity(stop.views) && (
            <span className="tag tag-pop" title={`ca. ${Math.round((stop.views ?? 0) / 2).toLocaleString('de-DE')} Aufrufe/Monat auf Wikivoyage`}>
              {popularity(stop.views)}
            </span>
          )}
          {stop.info?.unesco && <span className="tag tag-pop">🏛️ UNESCO-Welterbe</span>}
          {stop.tags.map((t) => (
            <span key={t} className="tag">
              {INTEREST_LABELS[t].icon} {INTEREST_LABELS[t].label}
            </span>
          ))}
        </div>
      )}

      <div className="stop-actions">
        <button className={`btn btn-small ${p.accOpen ? 'btn-primary' : ''}`} onClick={stopClick(p.onToggleAcc)}>
          🛏 Unterkünfte
        </button>
        <button className={`btn btn-small ${p.discoverOpen ? 'btn-primary' : ''}`} onClick={stopClick(p.onToggleDiscover)}>
          🔎 Entdecken
        </button>
        <button className={`btn btn-small ${p.altOpen ? 'btn-primary' : ''}`} onClick={stopClick(p.onToggleAlternatives)} disabled={p.disabled}>
          ⇄ Alternativen
        </button>
        <button
          className={`btn btn-small ${stop.pinned ? 'btn-primary' : ''}`}
          aria-pressed={!!stop.pinned}
          title="Muss rein: bleibt beim „Neu vorschlagen“ erhalten"
          onClick={stopClick(p.onTogglePin)}
          disabled={p.disabled}
        >
          📌 {stop.pinned ? 'Muss rein' : 'Behalten'}
        </button>
        {stop.info?.wikivoyageUrl && (
          <a className="btn btn-small btn-ghost" href={stop.info.wikivoyageUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            Wikivoyage ↗
          </a>
        )}
        {summary?.url && (
          <a className="btn btn-small btn-ghost" href={summary.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            Wikipedia ↗
          </a>
        )}
        <span className="spacer" />
        <button className="icon-btn" title="Nach vorne" aria-label="Stop nach vorne verschieben" disabled={p.disabled || p.index === 0} onClick={stopClick(() => p.onMove(-1))}>
          ↑
        </button>
        <button className="icon-btn" title="Nach hinten" aria-label="Stop nach hinten verschieben" disabled={p.disabled || p.index === p.count - 1} onClick={stopClick(() => p.onMove(1))}>
          ↓
        </button>
        <button className="icon-btn danger" title="Stop entfernen" aria-label="Stop entfernen" disabled={p.disabled} onClick={stopClick(p.onRemove)}>
          ✕
        </button>
      </div>

      {p.altOpen && (
        <div className="alternatives" onClick={(e) => e.stopPropagation()}>
          <h4>Statt {stop.name} …</h4>
          {(p.alternatives ?? []).length === 0 && (
            <div className="muted small">Keine passenden Alternativen in der Nähe der Route gefunden.</div>
          )}
          <ul className="sight-list">
            {(p.alternatives ?? []).map((a) => (
              <li key={a.candidate.id} className="sight">
                <div className="sight-head">
                  <strong>{a.candidate.name}</strong>
                  <span className="pill">{a.candidate.kind === 'nature' ? 'Naturziel' : 'Ort'}</span>
                  <span className={`small ${a.extraH > 0.25 ? 'fact-warn' : 'muted'}`}>
                    {Math.abs(a.extraH) < 0.25
                      ? 'gleiche Fahrzeit'
                      : a.extraH > 0
                        ? `ca. +${formatHours(a.extraH)} Fahrt`
                        : `ca. −${formatHours(-a.extraH)} Fahrt`}
                  </span>
                </div>
                {(a.candidate.notes?.length ? a.candidate.notes.slice(0, 2) : [a.candidate.description ?? '']).map(
                  (n) => n && (
                    <p key={n} className="small sight-desc">
                      {n}
                    </p>
                  ),
                )}
                <button className="btn btn-small" onClick={() => p.onSwap(a)} disabled={p.disabled}>
                  ⇄ Tauschen
                </button>
              </li>
            ))}
          </ul>
          <button className="btn btn-small btn-ghost danger-text" onClick={p.onExclude} disabled={p.disabled}>
            🚫 {stop.name} entfernen und nicht mehr vorschlagen
          </button>
        </div>
      )}

      {p.discoverOpen && p.discover && <DiscoverPanel state={p.discover} />}

      {p.accOpen && p.acc && (
        <AccommodationList
          state={p.acc}
          style={p.style}
          place={stop}
          arrive={p.arrive}
          depart={p.depart}
          wild={p.wild}
          travelers={p.travelers}
          country={p.country}
        />
      )}
    </article>
  );
}
