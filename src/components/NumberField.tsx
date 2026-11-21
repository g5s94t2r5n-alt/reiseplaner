import { useEffect, useState } from 'react';

interface Props {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  className?: string;
}

/**
 * Zahlenfeld, das sich beim Tippen frei bearbeiten lässt (auch komplett leeren).
 * Gültige Werte werden sofort übernommen; beim Verlassen wird auf min..max begrenzt
 * bzw. ein leeres Feld auf den letzten gültigen Wert zurückgesetzt.
 * type="text" + inputMode="numeric": Ziffernblock am Handy, kein Scroll-Rad-Ändern.
 */
export function NumberField({ id, label, value, min, max, onChange, className }: Props) {
  const [text, setText] = useState(String(value));

  // Änderungen von außen übernehmen (z. B. Zurücksetzen)
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : String(value)));
  }, [value]);

  const commit = () => {
    const n = parseInt(text, 10);
    const v = Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : value;
    setText(String(v));
    if (v !== value) onChange(v);
  };

  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/\D/g, '').slice(0, 3);
          setText(t);
          const n = parseInt(t, 10);
          if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = Math.max(min, Math.min(max, value + (e.key === 'ArrowUp' ? 1 : -1)));
            setText(String(v));
            onChange(v);
          }
        }}
      />
    </div>
  );
}
