import { useMemo, useState } from 'react';
import type { Accommodation, GeoPoint, TravelStyle } from '../types';
import { accommodationTypeLabel } from '../api/overpass';
import { accommodationSeason, type AccommodationSeason, type SeasonStatus } from '../lib/openingHours';
import { addDays, formatDateShort } from '../planner/itinerary';
import { externalSearchLinks, websiteSearchUrl, type SearchContext } from '../lib/bookingLinks';
import { WILD_LABEL, flag, type WildRule, type WildStatus } from '../data/wildCamping';

export interface AccState {
  loading: boolean;
  items: Accommodation[];
  error?: string;
}

export interface WildInfo {
  enabled: boolean;
  status: WildStatus;
  rule: WildRule | null;
  countryCode?: string;
  country?: string;
}

interface Props {
  state: AccState;
  style: TravelStyle;
  place: GeoPoint & { name: string };
  arrive: string;
  depart: string;
  wild?: WildInfo;
  /** Personen für Buchungs-Links (Standard 2) */
  travelers?: number;
  /** Landesname für eindeutigere Suchen ("Bergen, Norwegen") */
  country?: string;
}

const CAMPING_TYPES = new Set(['camp_site', 'caravan_site', 'camping']);
const FREE_TYPES = new Set(['shelter', 'rest_area', 'motorhome_parking']);


const SEASON_ORDER: Record<SeasonStatus, number> = { open: 0, unknown: 1, closed: 2 };
const SOURCE_LABEL: Record<AccommodationSeason['source'], string> = {
  opening_hours: 'laut Öffnungszeiten in OpenStreetMap',
  seasonal: 'laut Saison-Angabe in OpenStreetMap',
  text: 'laut Beschreibung',
  none: '',
};

type Filter = 'all' | 'camping' | 'free';

export function AccommodationList({ state, style, place, arrive, depart, wild, travelers = 2, country }: Props) {
  const ctx: SearchContext = {
    name: place.name,
    country,
    lat: place.lat,
    lon: place.lon,
    arrive,
    depart: depart > arrive ? depart : addDays(arrive, 1),
    travelers,
    style,
  };
  const placeLabel = country ? `${place.name} ${country}` : place.name;
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const lastNight = depart > arrive ? addDays(depart, -1) : arrive;

  const withStatus = useMemo(
    () =>
      state.items
        .map((a) => ({ a, season: accommodationSeason(a, arrive, lastNight) }))
        // stabil: geschlossene ans Ende, sonst Reihenfolge nach Qualität beibehalten
        .sort((x, y) => SEASON_ORDER[x.season.status] - SEASON_ORDER[y.season.status]),
    [state.items, arrive, lastNight],
  );
  const isFree = (a: Accommodation) => FREE_TYPES.has(a.type) || a.features.includes('kostenlos');
  const hasFree = withStatus.some(({ a }) => isFree(a));
  const filtered = withStatus.filter(({ a }) =>
    filter === 'all' ? true : filter === 'camping' ? CAMPING_TYPES.has(a.type) : isFree(a),
  );
  const closedCount = filtered.filter((x) => x.season.status === 'closed').length;
  const items = showAll ? filtered : filtered.slice(0, 8);
  const camping = style === 'camper' || style === 'tent';

  return (
    <div className="acc" onClick={(e) => e.stopPropagation()}>
      {camping && wild?.enabled && wild.status !== 'unknown' && wild.rule && (
        <div className={`wild-box wild-${wild.status}`}>
          <strong>
            {flag(wild.countryCode)} {style === 'tent' ? 'Wildcampen' : 'Freistehen'} {wild.country ? `in ${wild.country}` : ''}:{' '}
            {WILD_LABEL[wild.status].label}
          </strong>
          <div className="small">{wild.rule.note}</div>
          {(wild.status === 'allowed' || wild.status === 'tolerated') && style === 'tent' && (
            <div className="small">
              Du brauchst hier nicht zwingend einen Platz – unten stehen zusätzlich kostenlose Schutzhütten und Naturlagerplätze.
            </div>
          )}
        </div>
      )}
      <div className="acc-links">
        <span className="muted small">
          Suchen ({travelers} {travelers === 1 ? 'Person' : 'Personen'}, {formatDateShort(ctx.arrive)}–{formatDateShort(ctx.depart)}):
        </span>
        {externalSearchLinks(ctx).map((l) => (
          <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="pill-link">
            {l.label} ↗
          </a>
        ))}
      </div>
      {camping && hasFree && (
        <div className="segmented acc-filter" role="group" aria-label="Unterkünfte filtern">
          {(
            [
              ['all', 'Alle'],
              ['camping', 'Campingplätze'],
              ['free', 'Frei & kostenlos'],
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <button key={f} className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {state.loading && <div className="muted small">Suche Unterkünfte in OpenStreetMap und Wikivoyage …</div>}
      {state.error && <div className="alert warn small">{state.error}</div>}
      {!state.loading && filtered.length === 0 && !state.error && (
        <div className="muted small">Keine passenden Unterkünfte in den offenen Daten gefunden. Nutze die Links oben.</div>
      )}
      {closedCount > 0 && (
        <div className="muted small">
          {closedCount} {closedCount === 1 ? 'Unterkunft hat' : 'Unterkünfte haben'} im Reisezeitraum geschlossen (unten
          einsortiert).
        </div>
      )}
      <ul className="acc-list">
        {items.map(({ a, season }) => (
          <li key={a.id} className={`acc-item ${season.status === 'closed' ? 'closed' : ''}`}>
            <div className="acc-head">
              <strong>{a.name}</strong>
              <span className="pill">{accommodationTypeLabel(a.type)}</span>
              {a.source === 'wikivoyage' && (
                <span className="pill pill-accent" title="Von Reisenden auf Wikivoyage empfohlen">
                  Empfehlung
                </span>
              )}
              {a.wild && (
                <span className="pill pill-accent" title="Kein Campingplatz – nur wo Freistehen erlaubt/geduldet ist">
                  Freistehen
                </span>
              )}
              <SeasonPill season={season} camping={CAMPING_TYPES.has(a.type)} />
            </div>
            <div className="muted small">
              {a.distanceKm != null ? `${a.distanceKm.toFixed(1).replace('.', ',')} km entfernt` : 'im Ort'}
              {a.price ? ` · Preis: ${a.price}` : ''}
              {a.openingHours ? ` · Öffnungszeiten: ${a.openingHours}` : ''}
            </div>
            {a.features.length > 0 && (
              <div className="feature-list">
                {a.features.map((f) => (
                  <span key={f} className="feature">
                    {f}
                  </span>
                ))}
              </div>
            )}
            {a.description && <p className="small acc-desc">{a.description.slice(0, 220)}</p>}
            <div className="acc-actions small">
              {a.website ? (
                <a href={a.website} target="_blank" rel="noreferrer">
                  Website ↗
                </a>
              ) : (
                !a.name.endsWith('(ohne Namen)') && (
                  <a href={websiteSearchUrl(a.name, placeLabel)} target="_blank" rel="noreferrer" title="Keine Website in den offenen Daten – im Web suchen">
                    Website suchen ↗
                  </a>
                )
              )}
              {a.phone && <a href={`tel:${a.phone.replace(/\s/g, '')}`}>{a.phone}</a>}
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a.name} ${a.lat},${a.lon}`)}`}
                target="_blank"
                rel="noreferrer"
              >
                Google Maps ↗
              </a>
              {a.osmUrl && (
                <a href={a.osmUrl} target="_blank" rel="noreferrer">
                  OSM ↗
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
      {filtered.length > 8 && (
        <button className="btn btn-ghost btn-small" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Weniger anzeigen' : `Alle ${filtered.length} anzeigen`}
        </button>
      )}
    </div>
  );
}

function SeasonPill({ season, camping }: { season: AccommodationSeason; camping: boolean }) {
  const why = SOURCE_LABEL[season.source];
  if (season.status === 'open' && season.source !== 'none') {
    return (
      <span className="pill pill-good" title={why}>
        im Zeitraum geöffnet
      </span>
    );
  }
  if (season.status === 'closed') {
    return (
      <span className="pill pill-bad" title={why}>
        im Zeitraum geschlossen
      </span>
    );
  }
  if (!camping) return null;
  return (
    <span className="pill" title="In OpenStreetMap sind keine Öffnungszeiten hinterlegt – vorher anrufen oder auf der Website prüfen.">
      {season.seasonalUnknown ? 'nur saisonal geöffnet' : 'Öffnungszeiten unbekannt'}
    </span>
  );
}
