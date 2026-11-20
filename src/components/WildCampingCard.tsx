import type { TravelStyle } from '../types';
import type { CountryInfo } from '../api/geocode';
import { WILD_LABEL, countryName, flag, wildRuleFor, wildStatusFor } from '../data/wildCamping';

interface Props {
  style: TravelStyle;
  enabled: boolean;
  /** Orte in Reihenfolge mit ermitteltem Land */
  places: { name: string; country?: CountryInfo }[];
  onToggle: (enabled: boolean) => void;
  disabled?: boolean;
}

/** Übersicht: Wo auf der Route ist Wildcampen bzw. Freistehen erlaubt? */
export function WildCampingCard({ style, enabled, places, onToggle, disabled }: Props) {
  if (style !== 'camper' && style !== 'tent') return null;

  // nach Land (bzw. Schottland) gruppieren, Reihenfolge der Route beibehalten
  const groups = new Map<string, { info: CountryInfo; names: string[] }>();
  for (const p of places) {
    if (!p.country?.countryCode) continue;
    const scot = p.country.countryCode === 'GB' && /scotland|schottland/i.test(p.country.state ?? '');
    const key = scot ? 'GB-SCT' : p.country.countryCode;
    const g = groups.get(key) ?? { info: p.country, names: [] };
    if (!g.names.includes(p.name)) g.names.push(p.name);
    groups.set(key, g);
  }

  return (
    <details className="card season wild-card" open>
      <summary className="season-head">
        <strong>{style === 'tent' ? 'Wildcampen' : 'Freistehen'} auf deiner Route</strong>
      </summary>
      <label className="check small wild-toggle">
        <input type="checkbox" checked={enabled} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
        Freie Plätze bei den Unterkünften vorschlagen (Schutzhütten, kostenlose Plätze
        {style === 'camper' ? ', Wohnmobil-Parkplätze und – wo erlaubt – Rastplätze' : ''})
      </label>
      {groups.size === 0 && <div className="muted small">Ermittle Länder entlang der Route …</div>}
      <ul className="wild-list">
        {[...groups.entries()].map(([key, g]) => {
          const rule = wildRuleFor(g.info.countryCode, g.info.state);
          const status = wildStatusFor(rule, style);
          const name = key === 'GB-SCT' ? 'Schottland' : (countryName(g.info.countryCode) ?? g.info.country);
          return (
            <li key={key} className={`wild-${status}`}>
              <div>
                <strong>
                  {flag(g.info.countryCode)} {name}
                </strong>{' '}
                <span className={`pill wild-pill-${status}`}>
                  {WILD_LABEL[status].icon} {WILD_LABEL[status].label}
                </span>
              </div>
              <div className="small">{rule ? rule.note : 'Für dieses Land sind keine Regeln hinterlegt – vor Ort informieren.'}</div>
              <div className="muted small">{g.names.join(' · ')}</div>
            </li>
          );
        })}
      </ul>
      <p className="muted small">
        Vereinfachte Übersicht ohne Gewähr (Stand 2026). Regeln ändern sich und sind oft regional verschieden – Schilder und
        lokale Vorschriften haben immer Vorrang. In Schutzgebieten und Nationalparks ist Wildcampen fast überall verboten.
      </p>
    </details>
  );
}
