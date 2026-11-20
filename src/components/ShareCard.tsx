import { useEffect, useState } from 'react';
import { renderSVG } from 'uqr';
import type { Trip } from '../types';
import { shareUrl } from '../lib/share';

/** Trip aufs Handy oder an Mitreisende schicken: QR-Code, Link kopieren, Teilen-Menü. */
export function ShareCard({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nur bei inhaltlichen Änderungen neu erzeugen (Route-Geometrie spielt keine Rolle)
  const key = JSON.stringify([trip.id, trip.name, trip.settings, trip.stops.map((s) => [s.name, s.lat, s.lon, s.nights, s.manualNights])]);
  useEffect(() => {
    let cancelled = false;
    shareUrl(trip).then(
      (u) => !cancelled && setUrl(u),
      (e) => !cancelled && setError((e as Error).message),
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  const qr = url
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSVG(url, { ecc: 'L', border: 2, pixelSize: 6 }))}`
    : null;
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Kopieren nicht möglich – bitte den Link unten markieren und manuell kopieren.');
    }
  };

  const share = async () => {
    if (!url) return;
    try {
      await navigator.share({ title: trip.name, text: `Reiseplan: ${trip.name}`, url });
    } catch {
      // abgebrochen – nichts zu tun
    }
  };

  return (
    <div className="card share-card">
      <div className="share-head">
        <strong>Aufs Handy oder teilen</strong>
        <button className="icon-btn" onClick={onClose} aria-label="Schließen">
          ✕
        </button>
      </div>
      <div className="share-body">
        {qr ? <img className="share-qr" src={qr} alt="QR-Code mit dem Link zu diesem Trip" /> : <div className="share-qr placeholder" />}
        <div className="share-text small">
          <p>
            <strong>Mit der Handy-Kamera scannen</strong> – der Trip öffnet sich in der Online-Version und wird dort mit einem
            Tipp übernommen.
          </p>
          <p className="muted">
            Der Link enthält Orte, Daten und Nächte deines Trips. Wer ihn hat, kann den Trip öffnen – praktisch auch für
            Mitreisende. Die Daten stecken nur im Link, nicht auf einem Server.
          </p>
        </div>
      </div>
      <div className="share-actions">
        <button className="btn btn-small btn-primary" onClick={copy} disabled={!url}>
          {copied ? '✓ Kopiert' : 'Link kopieren'}
        </button>
        {canShare && (
          <button className="btn btn-small" onClick={share} disabled={!url}>
            Teilen …
          </button>
        )}
      </div>
      {url && <input className="share-url" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Teilen-Link" />}
      {error && <div className="alert error small">{error}</div>}
    </div>
  );
}
