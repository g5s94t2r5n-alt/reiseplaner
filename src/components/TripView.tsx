import { useMemo, useState } from 'react';
import type { Candidate, GeoPoint, Pace, Stop, TransitStop, Trip, TravelStyle } from '../types';
import { useTrips } from '../store';
import { allTransitStops, buildItinerary, formatDate, formatDateShort } from '../planner/itinerary';
import { applyNights, candidateToStop, enrichStops, placeToStop, planTrip, recalcTrip } from '../planner/plan';
import { insertAtBestPosition, loadAccommodations } from '../planner/accommodation';
import { PACE_LABELS, STYLE_LABELS } from '../planner/profiles';
import { formatHours, formatKm } from '../lib/geo';
import type { CountryInfo } from '../api/geocode';
import { MapView } from './MapView';
import { StopCard } from './StopCard';
import { PlaceSearch } from './PlaceSearch';
import { AccommodationList, type AccState } from './AccommodationList';
import { Progress } from './Progress';
import { SeasonPanel } from './SeasonPanel';
import { useSeason } from './useSeason';
import { useCountries } from './useCountries';
import { WildCampingCard } from './WildCampingCard';
import { ShareCard } from './ShareCard';
import { NumberField } from './NumberField';
import { useIsMobile } from './useMediaQuery';
import { DiscoverPanel, discoverPois, type DiscoverState } from './DiscoverPanel';
import type { PublicHoliday } from '../api/holidays';
import { CountryInfoCard } from './CountryInfoCard';
import { useTravelInfo, type CountryStay } from './useTravelInfo';
import { loadDiscover } from '../planner/discover';
import { type WildInfo } from './AccommodationList';
import { coordKey } from '../lib/geo';
import { WILD_LABEL, countryName, wildHint, wildRuleFor, wildStatusFor } from '../data/wildCamping';

export function TripView({ tripId }: { tripId: string }) {
  const trip = useTrips((s) => s.trips[tripId]);
  const saveTrip = useTrips((s) => s.saveTrip);
  const [busy, setBusy] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<GeoPoint | null>(null);
  const [acc, setAcc] = useState<Record<string, AccState>>({});
  const [accOpen, setAccOpen] = useState<string | null>(null);
  const [showCandidates, setShowCandidates] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showShare, setShowShare] = useState(false);
  // Handy: entweder Reiseplan oder Karte (beides gleichzeitig ist zu eng)
  const isMobile = useIsMobile();
  const [mobileMap, setMobileMap] = useState(false);

  const summary = useMemo(() => (trip ? buildItinerary(trip) : null), [trip]);
  const transits = useMemo(() => (trip ? allTransitStops(trip) : []), [trip]);
  const season = useSeason(trip, summary);
  const countryPoints = useMemo<GeoPoint[]>(() => (trip ? [...trip.stops, ...transits] : []), [trip, transits]);
  const countries = useCountries(countryPoints);
  const [disc, setDisc] = useState<Record<string, DiscoverState>>({});
  const [discOpen, setDiscOpen] = useState<string | null>(null);

  // Aufenthalte je Land (für Feiertage, Schulferien, Länderinfos)
  const stays = useMemo<CountryStay[]>(() => {
    if (!trip || !summary) return [];
    const byCc = new Map<string, CountryStay>();
    for (const it of summary.items) {
      if (it.type !== 'stop' && it.type !== 'transit') continue;
      const p = it.type === 'stop' ? it.stop : it.transit;
      const cc = countries[coordKey(p)]?.countryCode ?? trip.settings.region.countryCode?.toUpperCase();
      if (!cc) continue;
      const s = byCc.get(cc) ?? { countryCode: cc, places: [] };
      s.places.push({ id: p.id, name: p.name, arrive: it.arrive, depart: it.depart });
      byCc.set(cc, s);
    }
    return [...byCc.values()];
  }, [trip, summary, countries]);
  const travel = useTravelInfo(stays);
  const holidaysAt = (id: string) =>
    travel.info.flatMap((c) => c.holidaysByPlace).find((p) => p.id === id)?.holidays ?? [];

  if (!trip || !summary) {
    return (
      <main className="page">
        <div className="alert">
          Dieser Trip wurde nicht gefunden. <a href="#/">Zur Übersicht</a>
        </div>
      </main>
    );
  }

  const { settings } = trip;
  const disabled = busy !== null;
  const campingStyle = settings.style === 'camper' || settings.style === 'tent';
  const wildEnabled = campingStyle && (settings.wildCamping ?? true);

  /** Land eines Punkts; liegt er auf Wasser/Gletscher (keine Antwort), gilt das Land der Region. */
  const countryAt = (p: GeoPoint): CountryInfo | undefined => {
    const c = countries[coordKey(p)];
    if (c?.countryCode) return c;
    if (c && settings.region.countryCode) return { countryCode: settings.region.countryCode.toUpperCase() };
    return undefined;
  };

  /** Wildcamping-Regel am Ort eines Stops/Zwischenstopps */
  const wildInfo = (p: GeoPoint): WildInfo => {
    const c = countryAt(p);
    const rule = wildRuleFor(c?.countryCode, c?.state);
    const scot = c?.countryCode === 'GB' && /scotland|schottland/i.test(c?.state ?? '');
    return {
      enabled: wildEnabled,
      status: wildStatusFor(rule, settings.style),
      rule,
      countryCode: c?.countryCode,
      country: scot ? 'Schottland' : countryName(c?.countryCode),
    };
  };

  const run = async (label: string, fn: (progress: (m: string) => void) => Promise<Trip>) => {
    setBusy([label]);
    setError(null);
    try {
      const next = await fn((m) => setBusy((b) => [...(b ?? []), m]));
      saveTrip(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const updateStops = (stops: Stop[], label = 'Route wird aktualisiert …') =>
    run(label, (onProgress) => recalcTrip({ ...trip, stops }, { onProgress }));

  const changeNights = (id: string, delta: number) =>
    saveTrip(
      applyNights({
        ...trip,
        stops: trip.stops.map((s) => (s.id === id ? { ...s, nights: Math.max(1, s.nights + delta), manualNights: true } : s)),
      }),
    );

  const resetNights = (id: string) =>
    saveTrip(applyNights({ ...trip, stops: trip.stops.map((s) => (s.id === id ? { ...s, manualNights: false } : s)) }));

  const move = (index: number, dir: -1 | 1) => {
    const stops = [...trip.stops];
    const [s] = stops.splice(index, 1);
    stops.splice(index + dir, 0, s);
    updateStops(stops);
  };

  const addStop = (stop: Stop) =>
    run(`${stop.name} wird hinzugefügt …`, async (onProgress) => {
      const [enriched] = await enrichStops([stop], onProgress);
      return recalcTrip({ ...trip, stops: insertAtBestPosition(trip, enriched) }, { onProgress });
    });

  const addCandidate = (c: Candidate) => addStop(candidateToStop(c));

  const toggleAcc = async (key: string, point: GeoPoint, sleep = trip.stops.find((s) => s.id === key)?.info?.sleep) => {
    if (accOpen === key) {
      setAccOpen(null);
      return;
    }
    setAccOpen(key);
    setSelected(key);
    setFocus(point);
    if (acc[key] && !acc[key].error) return;
    setAcc((a) => ({ ...a, [key]: { loading: true, items: [] } }));
    const w = wildInfo(point);
    const res = await loadAccommodations(
      point,
      settings.style,
      sleep,
      (partial) => setAcc((a) => ({ ...a, [key]: { loading: true, items: partial } })),
      { enabled: w.enabled, status: w.status },
    );
    setAcc((a) => ({ ...a, [key]: { loading: false, items: res.items, error: res.error } }));
  };

  /** Entdecken-Bereich eines Stops/Zwischenstopps öffnen und Daten laden */
  const toggleDiscover = async (key: string, place: GeoPoint & { name: string; wvTitle?: string; wikidata?: string }) => {
    if (discOpen === key) {
      setDiscOpen(null);
      return;
    }
    setDiscOpen(key);
    setSelected(key);
    setFocus({ lat: place.lat, lon: place.lon });
    if (disc[key]?.data && !disc[key].data!.nearbyError) return;
    setDisc((d) => ({ ...d, [key]: { loading: true, data: d[key]?.data } }));
    try {
      const data = await loadDiscover(place);
      setDisc((d) => ({ ...d, [key]: { loading: false, data } }));
    } catch (e) {
      setDisc((d) => ({ ...d, [key]: { loading: false, error: (e as Error).message } }));
    }
  };

  const select = (id: string) => {
    setSelected(id);
    const p = trip.stops.find((s) => s.id === id) ?? transits.find((t) => t.id === id);
    if (p) setFocus({ lat: p.lat, lon: p.lon });
    document.getElementById(`item-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  /** Handy: von der Karte zurück zum Reiseplan und zum gewählten Eintrag springen */
  const showInPlan = (id: string | null) => {
    setMobileMap(false);
    if (id) requestAnimationFrame(() => document.getElementById(`item-${id}`)?.scrollIntoView({ block: 'start' }));
  };

  const mapVisible = !isMobile || mobileMap;
  const selectedItem = summary.items.find(
    (it) => (it.type === 'stop' && it.stop.id === selected) || (it.type === 'transit' && it.transit.id === selected),
  );

  const nightsDiff = summary.nightsUsed - settings.nights;
  const accItems = accOpen ? (acc[accOpen]?.items ?? []) : [];
  const pois = discOpen ? discoverPois(disc[discOpen]?.data) : [];
  const endPlace = settings.end ?? settings.start;
  const stopNames = Object.fromEntries(trip.stops.map((s) => [s.id, s.name]));
  const segmentLabels = Object.fromEntries(
    trip.segments.map((_, i) => [
      i,
      `${i === 0 ? settings.start.name : trip.stops[i - 1]?.name} → ${i < trip.stops.length ? trip.stops[i].name : endPlace.name}`,
    ]),
  );
  const passShown = new Set<number>();

  return (
    <main className={`layout ${isMobile ? (mobileMap ? 'm-map' : 'm-plan') : ''}`}>
      <section className="panel">
        <div className="trip-head">
          <input
            className="trip-name"
            value={trip.name}
            aria-label="Name des Trips"
            onChange={(e) => saveTrip({ ...trip, name: e.target.value })}
          />
          <div className="muted small">
            {STYLE_LABELS[settings.style].icon} {STYLE_LABELS[settings.style].label} · {PACE_LABELS[settings.pace].label} ·
            max. {settings.maxDriveHours} h/Tag
          </div>
          <div className="stats">
            <div>
              <strong>
                {formatDateShort(settings.startDate)}–{formatDateShort(summary.endDate)}
              </strong>
              <span>Zeitraum</span>
            </div>
            <div className={nightsDiff > 0 ? 'bad' : nightsDiff < 0 ? 'warn' : 'good'}>
              <strong>
                {summary.nightsUsed}/{settings.nights}
              </strong>
              <span>Nächte verplant</span>
            </div>
            <div>
              <strong>{formatKm(summary.totalKm)}</strong>
              <span>Strecke</span>
            </div>
            <div>
              <strong title={formatHours(summary.totalDriveH)}>{Math.round(summary.totalDriveH)} h</strong>
              <span>{settings.style === 'backpacker' ? 'Reisezeit ca.' : 'Fahrzeit'}</span>
            </div>
          </div>
          <div className="toolbar">
            <button className="btn btn-small" disabled={disabled || trip.stops.length < 2} onClick={() => run('Optimiere Reihenfolge …', (p) => recalcTrip(trip, { optimize: true, onProgress: p }))}>
              ⇄ Reihenfolge optimieren
            </button>
            <button className="btn btn-small" disabled={disabled} onClick={() => setShowSettings((v) => !v)}>
              ⚙ Einstellungen
            </button>
            <button
              className={`btn btn-small ${showShare ? 'btn-primary' : ''}`}
              disabled={disabled}
              onClick={() => setShowShare((v) => !v)}
            >
              📱 Aufs Handy / Teilen
            </button>
            <button
              className="btn btn-small btn-ghost"
              disabled={disabled}
              onClick={() => {
                if (!confirm('Stops neu vorschlagen lassen? Deine Änderungen an den Stops gehen dabei verloren.')) return;
                run('Plane neu …', async (p) => {
                  const fresh = await planTrip({ ...settings }, p);
                  return { ...fresh, id: trip.id, name: trip.name, createdAt: trip.createdAt };
                });
              }}
            >
              ↻ Neu vorschlagen
            </button>
          </div>
          {showShare && <ShareCard trip={trip} onClose={() => setShowShare(false)} />}
          {showSettings && (
            <SettingsEditor
              trip={trip}
              disabled={disabled}
              onApply={(s) => {
                setShowSettings(false);
                run('Übernehme Einstellungen …', (p) => recalcTrip({ ...trip, settings: { ...settings, ...s } }, { onProgress: p }));
              }}
            />
          )}
        </div>

        {busy && <Progress title="Einen Moment …" steps={busy} />}
        {error && <div className="alert error">{error}</div>}
        {trip.warnings.map((w) => (
          <div key={w} className="alert warn small">
            {w}
          </div>
        ))}
        {nightsDiff > 0 && (
          <div className="alert warn small">
            Die Route braucht {nightsDiff} {nightsDiff === 1 ? 'Nacht' : 'Nächte'} mehr als geplant. Entferne einen Stop, erhöhe die
            Fahrzeit pro Tag oder verlängere die Reise.
          </div>
        )}
        {nightsDiff < 0 && (
          <div className="alert small">
            Noch {-nightsDiff} {nightsDiff === -1 ? 'Nacht' : 'Nächte'} frei: Füge einen Stop hinzu oder setze manuelle Werte
            zurück.
          </div>
        )}

        <SeasonPanel
          report={season.report}
          loading={season.loading}
          error={season.error}
          interests={settings.interests}
          stopNames={stopNames}
          segmentLabels={segmentLabels}
        />

        <CountryInfoCard info={travel.info} loading={travel.loading} />

        <WildCampingCard
          style={settings.style}
          enabled={wildEnabled}
          disabled={disabled}
          places={summary.items.flatMap((it): { name: string; country?: CountryInfo }[] =>
            it.type === 'stop'
              ? [{ name: it.stop.name, country: countryAt(it.stop) }]
              : it.type === 'transit'
                ? [{ name: it.transit.name, country: countryAt(it.transit) }]
                : [],
          )}
          onToggle={(on) => {
            setAcc({});
            setAccOpen(null);
            saveTrip({ ...trip, settings: { ...settings, wildCamping: on } });
          }}
        />

        <ol className="itinerary">
          {summary.items.map((item, i) => {
            switch (item.type) {
              case 'start':
                return (
                  <li key={i} className="it-flag">
                    🏁 <strong>Start: {item.place.name}</strong> <span className="muted small">· {formatDate(item.date)}</span>
                  </li>
                );
              case 'end':
                return (
                  <li key={i} className="it-flag">
                    🎯 <strong>{settings.end ? 'Ziel' : 'Zurück'}: {item.place.name}</strong>{' '}
                    <span className="muted small">· {formatDate(item.date)}</span>
                  </li>
                );
              case 'drive': {
                const pass = season.report?.segments[item.segmentIndex]?.warning;
                const showPass = !!pass && !passShown.has(item.segmentIndex);
                if (pass) passShown.add(item.segmentIndex);
                return (
                  <li key={i} className={`it-drive ${item.long ? 'long' : ''}`}>
                    <span>{settings.style === 'backpacker' ? '🚌' : STYLE_LABELS[settings.style].icon}</span>
                    {formatHours(item.durationH)} · {formatKm(item.distanceKm)}
                    {item.long && <span className="pill pill-warn">länger als {settings.maxDriveHours} h</span>}
                    {showPass && (
                      <span className={`pill ${pass.level === 'bad' ? 'pill-bad' : 'pill-warn'}`} title={pass.text}>
                        ⛰ bis ca. {(Math.round(season.report!.segments[item.segmentIndex].maxElevation / 50) * 50).toLocaleString('de-DE')} m
                      </span>
                    )}
                  </li>
                );
              }
              case 'transit':
                return (
                  <li key={i} id={`item-${item.transit.id}`}>
                    <TransitCard
                      transit={item.transit}
                      arrive={item.arrive}
                      depart={item.depart}
                      selected={selected === item.transit.id}
                      style={settings.style}
                      accOpen={accOpen === item.transit.id}
                      acc={acc[item.transit.id]}
                      wild={campingStyle ? wildInfo(item.transit) : undefined}
                      travelers={settings.travelers ?? 2}
                      country={countryName(countryAt(item.transit)?.countryCode)}
                      onSelect={() => select(item.transit.id)}
                      onToggleAcc={() => toggleAcc(item.transit.id, item.transit, [])}
                      discover={disc[item.transit.id]}
                      discoverOpen={discOpen === item.transit.id}
                      onToggleDiscover={() => toggleDiscover(item.transit.id, item.transit)}
                      holidays={holidaysAt(item.transit.id)}
                    />
                  </li>
                );
              case 'stop':
                return (
                  <li key={item.stop.id} id={`item-${item.stop.id}`}>
                    <StopCard
                      stop={item.stop}
                      index={item.index}
                      count={trip.stops.length}
                      arrive={item.arrive}
                      depart={item.depart}
                      selected={selected === item.stop.id}
                      style={settings.style}
                      season={season.report?.stops[item.stop.id]}
                      wild={campingStyle ? wildInfo(item.stop) : undefined}
                      travelers={settings.travelers ?? 2}
                      country={countryName(countryAt(item.stop)?.countryCode)}
                      acc={acc[item.stop.id]}
                      accOpen={accOpen === item.stop.id}
                      disabled={disabled}
                      onSelect={() => select(item.stop.id)}
                      onNights={(d) => changeNights(item.stop.id, d)}
                      onResetNights={() => resetNights(item.stop.id)}
                      onMove={(dir) => move(item.index, dir)}
                      onRemove={() => updateStops(trip.stops.filter((s) => s.id !== item.stop.id), `${item.stop.name} wird entfernt …`)}
                      onToggleAcc={() => toggleAcc(item.stop.id, item.stop)}
                      discover={disc[item.stop.id]}
                      discoverOpen={discOpen === item.stop.id}
                      onToggleDiscover={() => toggleDiscover(item.stop.id, item.stop)}
                      holidays={holidaysAt(item.stop.id)}
                    />
                  </li>
                );
            }
          })}
        </ol>

        <div className="card add-stop">
          <h3>Stop hinzufügen</h3>
          <PlaceSearch
            placeholder="Ort, Nationalpark, Campingplatz …"
            value={null}
            clearOnSelect
            bias={settings.region.center}
            onChange={(r) => r && addStop(placeToStop({ name: r.name, label: r.label, lat: r.lat, lon: r.lon }))}
          />
          <label className="check small">
            <input type="checkbox" checked={showCandidates} onChange={(e) => setShowCandidates(e.target.checked)} />
            Weitere Wikivoyage-Empfehlungen auf der Karte zeigen ({trip.candidates.length})
          </label>
        </div>

        <p className="muted small attribution">
          Daten: © OpenStreetMap-Mitwirkende (ODbL), Wikivoyage & Wikipedia (CC BY-SA), Routing: OSRM. Fahrzeiten sind
          Schätzungen{settings.style === 'backpacker' ? ', ÖPNV-Zeiten grob aus Autofahrzeiten abgeleitet' : ''}.
        </p>
      </section>
      <section className="map-wrap">
        <MapView
          start={settings.start}
          end={settings.end ?? settings.start}
          stops={trip.stops}
          transits={transits}
          segments={trip.segments}
          candidates={showCandidates ? trip.candidates : []}
          onAddCandidate={disabled ? undefined : addCandidate}
          accommodations={accItems}
          pois={pois}
          selectedId={selected}
          onSelect={select}
          focus={focus}
          fitKey={`${trip.id}-${trip.stops.length}`}
          visible={mapVisible}
        />
        {isMobile && mobileMap && busy && <div className="map-status">{busy[busy.length - 1]}</div>}
        {isMobile && mobileMap && selectedItem && (selectedItem.type === 'stop' || selectedItem.type === 'transit') && (
          <div className="map-sheet">
            <div className="map-sheet-text">
              <strong>
                {selectedItem.type === 'stop'
                  ? `${selectedItem.index + 1}. ${selectedItem.stop.name}`
                  : `Zwischenstopp bei ${selectedItem.transit.name}`}
              </strong>
              <span className="muted small">
                {formatDate(selectedItem.arrive)} – {formatDate(selectedItem.depart)} ·{' '}
                {selectedItem.type === 'stop'
                  ? `${selectedItem.stop.nights} ${selectedItem.stop.nights === 1 ? 'Nacht' : 'Nächte'}`
                  : '1 Nacht'}
              </span>
            </div>
            <button className="btn btn-small btn-primary" onClick={() => showInPlan(selected)}>
              Im Reiseplan
            </button>
          </div>
        )}
      </section>
      {isMobile && (
        <button
          className="map-toggle"
          onClick={() => (mobileMap ? showInPlan(null) : setMobileMap(true))}
          aria-label={mobileMap ? 'Reiseplan anzeigen' : 'Karte anzeigen'}
        >
          {mobileMap ? '📋 Reiseplan' : '🗺️ Karte'}
        </button>
      )}
    </main>
  );
}

function TransitCard(p: {
  transit: TransitStop;
  arrive: string;
  depart: string;
  selected: boolean;
  style: TravelStyle;
  accOpen: boolean;
  acc?: AccState;
  wild?: WildInfo;
  travelers?: number;
  country?: string;
  onSelect: () => void;
  onToggleAcc: () => void;
  discover?: DiscoverState;
  discoverOpen: boolean;
  onToggleDiscover: () => void;
  holidays: PublicHoliday[];
}) {
  const w = p.wild;
  return (
    <div className={`card transit-card ${p.selected ? 'selected' : ''}`} onClick={p.onSelect}>
      <div className="transit-row">
        <span className="transit-icon" aria-hidden>
          ☾
        </span>
        <div className="stop-title">
          <strong>Zwischenstopp bei {p.transit.name}</strong>
          <div className="muted small">
            {formatDate(p.arrive)} · 1 Nacht auf der Durchreise
          </div>
          {w?.enabled && w.status !== 'unknown' && (
            <div className={`small wild-hint wild-${w.status}`}>
              {WILD_LABEL[w.status].icon} {wildHint(w.status, p.style)}
            </div>
          )}
          {p.holidays.length > 0 && (
            <div className="small holiday-line">
              🎉 {p.holidays.map((h) => `${formatDate(h.date)}: ${h.localName}`).join(' · ')}
            </div>
          )}
        </div>
      </div>
      <div className="stop-actions">
        <button
          className={`btn btn-small ${p.accOpen ? 'btn-primary' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            p.onToggleAcc();
          }}
        >
          🛏 Unterkünfte
        </button>
        <button
          className={`btn btn-small ${p.discoverOpen ? 'btn-primary' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            p.onToggleDiscover();
          }}
        >
          🔎 Entdecken
        </button>
      </div>
      {p.discoverOpen && p.discover && <DiscoverPanel state={p.discover} />}
      {p.accOpen && p.acc && (
        <AccommodationList
          state={p.acc}
          style={p.style}
          place={p.transit}
          arrive={p.arrive}
          depart={p.depart}
          wild={p.wild}
          travelers={p.travelers}
          country={p.country}
        />
      )}
    </div>
  );
}

function SettingsEditor({
  trip,
  disabled,
  onApply,
}: {
  trip: Trip;
  disabled: boolean;
  onApply: (s: Partial<Trip['settings']>) => void;
}) {
  const s = trip.settings;
  const [nights, setNights] = useState(s.nights);
  const [startDate, setStartDate] = useState(s.startDate);
  const [pace, setPace] = useState<Pace>(s.pace);
  const [maxDrive, setMaxDrive] = useState(s.maxDriveHours);
  const [style, setStyle] = useState<TravelStyle>(s.style);
  const [travelers, setTravelers] = useState(s.travelers ?? 2);
  return (
    <div className="settings card">
      <div className="row">
        <div className="field">
          <label htmlFor="s-date">Abreise</label>
          <input id="s-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <NumberField id="s-nights" label="Nächte" className="field-narrow" value={nights} min={1} max={120} onChange={setNights} />
        <NumberField
          id="s-travelers"
          label="Personen"
          className="field-narrow"
          value={travelers}
          min={1}
          max={16}
          onChange={setTravelers}
        />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="s-style">Reiseart</label>
          <select id="s-style" value={style} onChange={(e) => setStyle(e.target.value as TravelStyle)}>
            {(Object.keys(STYLE_LABELS) as TravelStyle[]).map((k) => (
              <option key={k} value={k}>
                {STYLE_LABELS[k].label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="s-pace">Tempo</label>
          <select id="s-pace" value={pace} onChange={(e) => setPace(e.target.value as Pace)}>
            {(Object.keys(PACE_LABELS) as Pace[]).map((k) => (
              <option key={k} value={k}>
                {PACE_LABELS[k].label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="s-drive">
          Max. Fahrzeit pro Tag: <strong>{maxDrive} h</strong>
        </label>
        <input id="s-drive" type="range" min={1.5} max={10} step={0.5} value={maxDrive} onChange={(e) => setMaxDrive(Number(e.target.value))} />
      </div>
      <button
        className="btn btn-primary btn-small"
        disabled={disabled}
        onClick={() => onApply({ nights, startDate, pace, maxDriveHours: maxDrive, style, travelers })}
      >
        Übernehmen
      </button>
    </div>
  );
}
