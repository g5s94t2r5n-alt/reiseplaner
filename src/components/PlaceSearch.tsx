import { useEffect, useId, useRef, useState } from 'react';
import { searchPlaces, typeLabel, type SearchResult } from '../api/geocode';
import type { GeoPoint } from '../types';

interface Props {
  label?: string;
  placeholder?: string;
  value: { name: string; label?: string } | null;
  onChange: (r: SearchResult | null) => void;
  regionsOnly?: boolean;
  bias?: GeoPoint;
  /** Nach Auswahl Feld leeren statt Auswahl anzuzeigen */
  clearOnSelect?: boolean;
  autoFocus?: boolean;
}

export function PlaceSearch({ label, placeholder, value, onChange, regionsOnly, bias, clearOnSelect, autoFocus }: Props) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openList = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = null;
    setOpen(true);
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const my = ++reqId.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchPlaces(q, { regionsOnly, bias });
        if (my === reqId.current) {
          setResults(r);
          setActive(0);
          setError(null);
        }
      } catch (e) {
        if (my === reqId.current) setError((e as Error).message);
      } finally {
        if (my === reqId.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, regionsOnly, bias?.lat, bias?.lon]);

  const choose = (r: SearchResult) => {
    onChange(r);
    setOpen(false);
    setQuery('');
    setResults([]);
  };

  if (value && !clearOnSelect) {
    return (
      <div className="field">
        {label && <label>{label}</label>}
        <div className="chosen">
          <div>
            <strong>{value.name}</strong>
            {value.label && value.label !== value.name && <div className="muted small">{value.label}</div>}
          </div>
          <button type="button" className="icon-btn" onClick={() => onChange(null)} aria-label="Auswahl entfernen">
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field search">
      {label && <label htmlFor={id}>{label}</label>}
      <input
        id={id}
        type="search"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          openList();
        }}
        onFocus={openList}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (results[active]) choose(results[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && query.trim().length >= 2 && (
        <ul className="results" role="listbox">
          {loading && results.length === 0 && <li className="muted">Suche …</li>}
          {error && <li className="error-text">{error}</li>}
          {!loading && !error && results.length === 0 && <li className="muted">Nichts gefunden</li>}
          {results.map((r, i) => (
            <li
              key={`${r.osmType}${r.osmId}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(r);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <div>
                <strong>{r.name}</strong> <span className="pill">{typeLabel(r.type)}</span>
              </div>
              <div className="muted small">{r.label}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
