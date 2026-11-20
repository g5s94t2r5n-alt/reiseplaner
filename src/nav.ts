export type View =
  | { name: 'list' }
  | { name: 'new' }
  | { name: 'trip'; id: string }
  | { name: 'import'; data: string };

export function parseHash(): View {
  const h = location.hash.replace(/^#\/?/, '');
  if (h === 'new') return { name: 'new' };
  const imp = /^import\/(.+)$/.exec(h);
  if (imp) return { name: 'import', data: imp[1] };
  const m = /^trip\/(.+)$/.exec(h);
  if (m) return { name: 'trip', id: m[1] };
  return { name: 'list' };
}

export function navigate(v: View, replace = false) {
  const hash =
    v.name === 'list' ? '#/' : v.name === 'new' ? '#/new' : v.name === 'trip' ? `#/trip/${v.id}` : `#/import/${v.data}`;
  if (replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = hash;
  }
}
