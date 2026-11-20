import { useState } from 'react';
import type { Interest, Pace, Place, Region, TravelStyle, TripSettings } from '../types';
import { toRegion, type SearchResult } from '../api/geocode';
import { planTrip } from '../planner/plan';
import { DEFAULT_MAX_DRIVE, INTEREST_LABELS, PACE_LABELS, STYLE_LABELS } from '../planner/profiles';
import { useTrips } from '../store';
import { navigate } from '../nav';
import { PlaceSearch } from './PlaceSearch';
import { MapView } from './MapView';
import { Progress } from './Progress';

function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const toPlace = (r: SearchResult): Place => ({ name: r.name, label: r.label, lat: r.lat, lon: r.lon });

/** Länder mit Überseegebieten haben riesige Bounding-Boxen → für die Karte um das Zentrum begrenzen. */
function displayBbox(region: Region | null): Region['bbox'] {
  if (!region?.bbox) return region ? [region.center.lon - 3, region.center.lat - 2, region.center.lon + 3, region.center.lat + 2] : undefined;
  const [w, s, e, n] = region.bbox;
  if (n - s > 30 || e - w > 45 || e < w) {
    const c = region.center;
    return [c.lon - 15, c.lat - 9, c.lon + 15, c.lat + 9];
  }
  return region.bbox;
}

export function TripForm() {
  const saveTrip = useTrips((s) => s.saveTrip);
  const [region, setRegion] = useState<Region | null>(null);
  const [start, setStart] = useState<Place | null>(null);
  const [roundtrip, setRoundtrip] = useState(true);
  const [end, setEnd] = useState<Place | null>(null);
  const [startDate, setStartDate] = useState(isoInDays(14));
  const [nights, setNights] = useState(14);
  const [style, setStyle] = useState<TravelStyle>('camper');
  const [pace, setPace] = useState<Pace>('normal');
  const [maxDrive, setMaxDrive] = useState(DEFAULT_MAX_DRIVE.camper);
  const [driveTouched, setDriveTouched] = useState(false);
  const [interests, setInterests] = useState<Interest[]>(['nature']);
  const [wildCamping, setWildCamping] = useState(true);
  const [travelers, setTravelers] = useState(2);
  const [progress, setProgress] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const valid = !!region && !!start && (roundtrip || !!end) && nights >= 1;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const settings: TripSettings = {
      region: { ...region! },
      start: start!,
      end: roundtrip ? null : end,
      startDate,
      nights,
      style,
      pace,
      maxDriveHours: maxDrive,
      interests,
      wildCamping: style === 'camper' || style === 'tent' ? wildCamping : false,
      travelers,
    };
    setError(null);
    setProgress([]);
    try {
      const trip = await planTrip(settings, (msg) => setProgress((p) => [...(p ?? []), msg]));
      saveTrip(trip);
      navigate({ name: 'trip', id: trip.id });
    } catch (err) {
      setError((err as Error).message);
      setProgress(null);
    }
  };

  const toggleInterest = (i: Interest) =>
    setInterests((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]));

  return (
    <main className="layout">
      <section className="panel">
        {progress ? (
          <Progress title="Dein Trip wird geplant" steps={progress} />
        ) : (
          <form onSubmit={submit} className="form">
            <h1>Neuer Trip</h1>
            <p className="muted">
              Wähle Land oder Region, Start und Zeitraum. Der Planer schlägt Stops, Aufenthaltsdauer und Unterkünfte vor,
              und du kannst danach alles anpassen.
            </p>

            <PlaceSearch
              label="Wohin? (Land oder Region)"
              placeholder="z. B. Norwegen, Toskana, Schottland …"
              regionsOnly
              autoFocus
              value={region}
              onChange={(r) => setRegion(r ? toRegion(r) : null)}
            />

            <PlaceSearch
              label="Start"
              placeholder="z. B. München oder Flughafen Oslo"
              value={start}
              bias={region?.center}
              onChange={(r) => setStart(r ? toPlace(r) : null)}
            />

            <label className="check">
              <input type="checkbox" checked={roundtrip} onChange={(e) => setRoundtrip(e.target.checked)} />
              Rundreise (zurück zum Start)
            </label>
            {!roundtrip && (
              <PlaceSearch
                label="Ziel"
                placeholder="Wo endet die Reise?"
                value={end}
                bias={region?.center}
                onChange={(r) => setEnd(r ? toPlace(r) : null)}
              />
            )}

            <div className="row">
              <div className="field">
                <label htmlFor="startDate">Abreise</label>
                <input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
              </div>
              <div className="field field-narrow">
                <label htmlFor="nights">Nächte</label>
                <input
                  id="nights"
                  type="number"
                  min={1}
                  max={120}
                  value={nights}
                  onChange={(e) => setNights(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
                />
              </div>
              <div className="field field-narrow">
                <label htmlFor="travelers">Personen</label>
                <input
                  id="travelers"
                  type="number"
                  min={1}
                  max={16}
                  value={travelers}
                  onChange={(e) => setTravelers(Math.max(1, Math.min(16, Number(e.target.value) || 1)))}
                />
              </div>
            </div>

            <fieldset className="field">
              <legend>Reiseart</legend>
              <div className="tiles">
                {(Object.keys(STYLE_LABELS) as TravelStyle[]).map((s) => (
                  <button
                    type="button"
                    key={s}
                    className={`tile ${style === s ? 'on' : ''}`}
                    aria-pressed={style === s}
                    onClick={() => {
                      setStyle(s);
                      if (!driveTouched) setMaxDrive(DEFAULT_MAX_DRIVE[s]);
                    }}
                  >
                    <span className="tile-icon">{STYLE_LABELS[s].icon}</span>
                    <span>{STYLE_LABELS[s].label}</span>
                  </button>
                ))}
              </div>
              <div className="muted small">{STYLE_LABELS[style].hint}</div>
              {(style === 'camper' || style === 'tent') && (
                <label className="check small wild-toggle">
                  <input type="checkbox" checked={wildCamping} onChange={(e) => setWildCamping(e.target.checked)} />
                  {style === 'tent' ? 'Wildcampen' : 'Freistehen'} einbeziehen, wo es erlaubt ist (plus kostenlose Plätze und
                  Schutzhütten)
                </label>
              )}
            </fieldset>

            <fieldset className="field">
              <legend>Tempo</legend>
              <div className="segmented">
                {(Object.keys(PACE_LABELS) as Pace[]).map((p) => (
                  <button
                    type="button"
                    key={p}
                    className={pace === p ? 'on' : ''}
                    aria-pressed={pace === p}
                    onClick={() => setPace(p)}
                  >
                    {PACE_LABELS[p].label}
                  </button>
                ))}
              </div>
              <div className="muted small">{PACE_LABELS[pace].hint}</div>
            </fieldset>

            <div className="field">
              <label htmlFor="drive">
                Max. {style === 'backpacker' ? 'Reisezeit' : 'Fahrzeit'} pro Tag: <strong>{maxDrive} h</strong>
              </label>
              <input
                id="drive"
                type="range"
                min={1.5}
                max={10}
                step={0.5}
                value={maxDrive}
                onChange={(e) => {
                  setMaxDrive(Number(e.target.value));
                  setDriveTouched(true);
                }}
              />
            </div>

            <fieldset className="field">
              <legend>Interessen</legend>
              <div className="chips">
                {(Object.keys(INTEREST_LABELS) as Interest[]).map((i) => (
                  <button
                    type="button"
                    key={i}
                    className={`chip ${interests.includes(i) ? 'on' : ''}`}
                    aria-pressed={interests.includes(i)}
                    onClick={() => toggleInterest(i)}
                  >
                    {INTEREST_LABELS[i].icon} {INTEREST_LABELS[i].label}
                  </button>
                ))}
              </div>
            </fieldset>

            {error && <div className="alert error">{error}</div>}

            <button className="btn btn-primary btn-block" type="submit" disabled={!valid}>
              Route planen
            </button>
            {!valid && <div className="muted small center">Region und Start auswählen{!roundtrip && ' sowie Ziel'}.</div>}
          </form>
        )}
      </section>
      <section className="map-wrap">
        <MapView
          start={start}
          end={roundtrip ? start : end}
          bbox={displayBbox(region)}
          fitKey={`${start?.lat}-${end?.lat}-${roundtrip}`}
        />
      </section>
    </main>
  );
}
