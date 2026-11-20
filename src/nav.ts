export type View = { name: 'list' } | { name: 'new' } | { name: 'trip'; id: string };

export function parseHash(): View {
  const h = location.hash.replace(/^#\/?/, '');
  if (h === 'new') return { name: 'new' };
  const m = /^trip\/(.+)$/.exec(h);
  if (m) return { name: 'trip', id: m[1] };
  return { name: 'list' };
}

export function navigate(v: View) {
  location.hash = v.name === 'list' ? '/' : v.name === 'new' ? '/new' : `/trip/${v.id}`;
}
