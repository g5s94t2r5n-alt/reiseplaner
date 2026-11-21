import { useEffect, useState } from 'react';
import { useTrips } from './store';
import { TripList } from './components/TripList';
import { TripForm } from './components/TripForm';
import { TripView } from './components/TripView';
import { ImportView } from './components/ImportView';
import { UpdateBanner } from './components/UpdateBanner';
import { parseHash, type View } from './nav';

function useHydrated() {
  const [hydrated, setHydrated] = useState(useTrips.persist.hasHydrated());
  useEffect(() => {
    const unsub = useTrips.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useTrips.persist.hasHydrated());
    return unsub;
  }, []);
  return hydrated;
}

export default function App() {
  const [view, setView] = useState<View>(parseHash);
  const hydrated = useHydrated();

  // Merken, ob gerade ein Eingabefeld aktiv ist (Handy: Tastatur offen → schwebende Buttons ausblenden)
  useEffect(() => {
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && (el as HTMLInputElement).type !== 'checkbox';
    const onIn = (e: FocusEvent) => isField(e.target) && document.documentElement.classList.add('typing');
    const onOut = () => document.documentElement.classList.remove('typing');
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);

  useEffect(() => {
    const onHash = () => setView(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          <span aria-hidden>🚐</span> <span className="brand-text">Reiseplaner</span>
        </a>
        <nav>
          <a href="#/" className={view.name === 'list' ? 'active' : ''}>
            Meine Trips
          </a>
          <a href="#/new" className={`btn btn-small ${view.name === 'new' ? 'active' : ''}`}>
            + Neuer Trip
          </a>
        </nav>
      </header>
      {!hydrated ? (
        <div className="center-msg">Lade gespeicherte Trips …</div>
      ) : view.name === 'new' ? (
        <TripForm />
      ) : view.name === 'trip' ? (
        <TripView key={view.id} tripId={view.id} />
      ) : view.name === 'import' ? (
        <ImportView key={view.data} data={view.data} />
      ) : (
        <TripList />
      )}
      <UpdateBanner />
    </div>
  );
}
