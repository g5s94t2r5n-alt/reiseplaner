import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { Accommodation, Candidate, GeoPoint, Place, Segment, Stop, TransitStop } from '../types';
import { accommodationTypeLabel } from '../api/overpass';

export interface MapViewProps {
  start?: Place | null;
  end?: Place | null;
  stops?: Stop[];
  transits?: TransitStop[];
  segments?: Segment[];
  candidates?: Candidate[];
  onAddCandidate?: (c: Candidate) => void;
  accommodations?: Accommodation[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Ändert sich der Schlüssel, wird der Kartenausschnitt neu angepasst */
  fitKey?: string;
  focus?: GeoPoint | null;
  bbox?: [number, number, number, number];
}

const iconCache = new Map<string, L.DivIcon>();
function divIcon(key: string, html: string, size: number, className: string): L.DivIcon {
  let icon = iconCache.get(key);
  if (!icon) {
    icon = L.divIcon({ html, className, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    iconCache.set(key, icon);
  }
  return icon;
}

const ACC_ICON: Record<string, string> = {
  camp_site: '⛺',
  caravan_site: '🚐',
  wilderness_hut: '🛖',
  hostel: '🛏️',
  guest_house: '🏠',
  hotel: '🏨',
  motel: '🏨',
  apartment: '🏠',
  chalet: '🏡',
  camping: '⛺',
  budget: '🛏️',
  mid: '🏨',
  splurge: '🏨',
  shelter: '🛖',
  rest_area: '🅿️',
  motorhome_parking: '🅿️',
};

function FitBounds({ points, fitKey, bbox }: { points: [number, number][]; fitKey?: string; bbox?: MapViewProps['bbox'] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 11 });
    } else if (points.length === 1) {
      map.setView(points[0], 9);
    } else if (bbox) {
      map.fitBounds(
        [
          [bbox[1], bbox[0]],
          [bbox[3], bbox[2]],
        ],
        { padding: [20, 20] },
      );
    }
  }, [fitKey, bbox?.join(',')]);
  return null;
}

function FlyTo({ focus }: { focus?: GeoPoint | null }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lon], Math.max(map.getZoom(), 10), { duration: 0.6 });
  }, [focus?.lat, focus?.lon, map]);
  return null;
}

/** Leaflet braucht nach Layout-Änderungen (z. B. Mobilansicht) ein invalidateSize. */
function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export function MapView(props: MapViewProps) {
  const {
    start,
    end,
    stops = [],
    transits = [],
    segments = [],
    candidates = [],
    accommodations = [],
    selectedId,
    onSelect,
    onAddCandidate,
  } = props;

  const stopIds = useMemo(() => new Set(stops.map((s) => s.wvTitle ?? s.name)), [stops]);
  const freeCandidates = candidates.filter((c) => !stopIds.has(c.wvTitle ?? c.name));

  const fitPoints = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [];
    if (start) pts.push([start.lat, start.lon]);
    if (end) pts.push([end.lat, end.lon]);
    stops.forEach((s) => pts.push([s.lat, s.lon]));
    transits.forEach((t) => pts.push([t.lat, t.lon]));
    return pts;
  }, [start, end, stops, transits]);

  const sameEnd = start && end && Math.abs(start.lat - end.lat) < 1e-4 && Math.abs(start.lon - end.lon) < 1e-4;

  return (
    <MapContainer center={[50, 10]} zoom={4} className="map" worldCopyJump>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <AutoResize />
      <FitBounds points={fitPoints} fitKey={props.fitKey} bbox={props.bbox} />
      <FlyTo focus={props.focus} />

      {segments.map((seg, i) => (
        <Polyline key={i} positions={seg.geometry} pathOptions={{ color: '#1f6f5c', weight: 4, opacity: 0.85, className: 'route-line' }} />
      ))}

      {freeCandidates.map((c) => (
        <Marker key={c.id} position={[c.lat, c.lon]} icon={divIcon('cand', '', 12, 'mk-candidate')}>
          <Popup>
            <div className="popup">
              <strong>{c.name}</strong>
              <div className="muted small">{c.kind === 'nature' ? 'Naturziel' : 'Ort'} · Wikivoyage-Empfehlung</div>
              {c.description && <p>{c.description.slice(0, 220)}</p>}
              {onAddCandidate && (
                <button className="btn btn-small" onClick={() => onAddCandidate(c)}>
                  + Als Stop hinzufügen
                </button>
              )}
            </div>
          </Popup>
        </Marker>
      ))}

      {start && (
        <Marker position={[start.lat, start.lon]} icon={divIcon('start', '🏁', 28, 'mk-flag')}>
          <Tooltip>{sameEnd || !end ? `Start & Ziel: ${start.name}` : `Start: ${start.name}`}</Tooltip>
        </Marker>
      )}
      {end && !sameEnd && (
        <Marker position={[end.lat, end.lon]} icon={divIcon('end', '🎯', 28, 'mk-flag')}>
          <Tooltip>Ziel: {end.name}</Tooltip>
        </Marker>
      )}

      {transits.map((t) => (
        <Marker
          key={t.id}
          position={[t.lat, t.lon]}
          icon={divIcon(`tr-${selectedId === t.id}`, '☾', 22, `mk-transit ${selectedId === t.id ? 'selected' : ''}`)}
          eventHandlers={{ click: () => onSelect?.(t.id) }}
        >
          <Tooltip>Zwischenstopp: {t.name}</Tooltip>
        </Marker>
      ))}

      {stops.map((s, i) => (
        <Marker
          key={s.id}
          position={[s.lat, s.lon]}
          icon={divIcon(`st-${i}-${selectedId === s.id}`, String(i + 1), 30, `mk-stop ${selectedId === s.id ? 'selected' : ''}`)}
          eventHandlers={{ click: () => onSelect?.(s.id) }}
          zIndexOffset={1000}
        >
          <Tooltip>
            {i + 1}. {s.name} · {s.nights} {s.nights === 1 ? 'Nacht' : 'Nächte'}
          </Tooltip>
        </Marker>
      ))}

      {accommodations.map((a) => (
        <Marker key={a.id} position={[a.lat, a.lon]} icon={divIcon(`acc-${a.type}`, ACC_ICON[a.type] ?? '🛏️', 24, 'mk-acc')}>
          <Popup>
            <div className="popup">
              <strong>{a.name}</strong>
              <div className="muted small">
                {accommodationTypeLabel(a.type)}
                {a.price ? ` · ${a.price}` : ''}
              </div>
              {a.website && (
                <a href={a.website} target="_blank" rel="noreferrer">
                  Website ↗
                </a>
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
