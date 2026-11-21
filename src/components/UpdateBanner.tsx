import { useEffect, useState } from 'react';

/** Name des aktuell geladenen App-Bundles, z. B. "index-Qpez0ZgM.js" (im Dev-Server: null). */
function currentBundle(): string | null {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/"]')?.src;
  return src ? src.split('/').pop()! : null;
}

/**
 * Installierte Web-Apps bleiben auf dem Handy oft tagelang geöffnet. Beim Zurückkehren
 * in die App wird geprüft, ob es eine neuere Version gibt, und ggf. ein Hinweis gezeigt.
 */
export function UpdateBanner() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const mine = currentBundle();
    if (!import.meta.env.PROD || !mine) return;
    const check = async () => {
      try {
        const html = await fetch(`./index.html?v=${Date.now()}`, { cache: 'no-store' }).then((r) => r.text());
        const latest = /assets\/(index-[\w-]+\.js)/.exec(html)?.[1];
        if (latest && latest !== mine) setAvailable(true);
      } catch {
        // offline – später erneut
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(check, 30 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, []);

  if (!available) return null;
  return (
    <div className="update-banner" role="status">
      <span>Eine neue Version des Reiseplaners ist da.</span>
      <button className="btn btn-small btn-primary" onClick={() => location.reload()}>
        Neu laden
      </button>
      <button className="icon-btn" aria-label="Später" onClick={() => setAvailable(false)}>
        ✕
      </button>
    </div>
  );
}
