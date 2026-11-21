import { countryName, flag } from '../data/wildCamping';
import { currencyName, factsFor } from '../data/countries';
import { formatDate, formatDateShort } from '../planner/itinerary';
import type { CountryTravelInfo } from './useTravelInfo';

/** Praktisches pro Land: Fahrseite, Währung, Notruf, Maut, Feiertage und Schulferien während der Reise. */
export function CountryInfoCard({ info, loading }: { info: CountryTravelInfo[]; loading: boolean }) {
  if (info.length === 0) return null;
  const leftAny = info.some((c) => factsFor(c.countryCode)?.left);
  const holidayCount = info.reduce((n, c) => n + c.holidaysByPlace.reduce((m, p) => m + p.holidays.length, 0), 0);
  const schoolAny = info.some((c) => c.school);

  return (
    <details className="card season country-card" open={leftAny || undefined}>
      <summary className="season-head">
        <strong>Unterwegs wissen</strong>
        {leftAny && <span className="season-badge warn">Linksverkehr</span>}
        {holidayCount > 0 && <span className="season-badge warn">{holidayCount} Feiertag{holidayCount > 1 ? 'e' : ''}</span>}
        {schoolAny && <span className="season-badge warn">Schulferien</span>}
        {loading && <span className="muted small">lade …</span>}
      </summary>
      <ul className="wild-list">
        {info.map((c) => {
          const f = factsFor(c.countryCode);
          const holidays = c.holidaysByPlace.flatMap((p) => p.holidays.map((h) => ({ ...h, place: p.name })));
          return (
            <li key={c.countryCode}>
              <strong>
                {flag(c.countryCode)} {countryName(c.countryCode)}
              </strong>
              <span className="muted small"> · {formatDateShort(c.from)}–{formatDateShort(c.to)}</span>
              {f ? (
                <ul className="facts small">
                  <li className={f.left ? 'fact-warn' : ''}>{f.left ? '⚠️ Linksverkehr!' : '🚗 Rechtsverkehr'}</li>
                  <li>
                    💶 {currencyName(f.currency)} ({f.currency})
                  </li>
                  <li>🚨 Notruf {f.emergency}</li>
                  {f.note && <li>🛣️ {f.note}</li>}
                </ul>
              ) : (
                <div className="muted small">Keine Länderinfos hinterlegt.</div>
              )}
              {holidays.length > 0 && (
                <div className="small fact-warn">
                  🎉 Feiertag{holidays.length > 1 ? 'e' : ''}:{' '}
                  {holidays.map((h) => `${formatDate(h.date)} ${h.localName} (${h.place})`).join(' · ')} – Geschäfte oft
                  geschlossen, Unterkünfte voller.
                </div>
              )}
              {c.school && (
                <div className="small fact-warn">
                  🏫 Schulferien{c.school.regional ? ' (regional)' : ''}: {formatDateShort(c.school.start)}–
                  {formatDateShort(c.school.end)} – Campingplätze und Unterkünfte früh buchen.
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="muted small">
        Feiertage: Nager.Date · Schulferien: OpenHolidays (nicht für alle Länder verfügbar) · Länderinfos ohne Gewähr.
      </p>
    </details>
  );
}
