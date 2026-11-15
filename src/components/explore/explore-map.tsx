'use client';
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { setupMaplibre } from '@/lib/maplibre-setup';
setupMaplibre();
import type { Feature } from 'geojson';
import type { ExploreSite } from './types';
import { verdict } from './types';

export type MapMode = 'browse' | 'draw' | 'pin';
type Ring = [number, number][];

const CENTER: Record<string, [number, number]> = { Houston: [-95.4, 29.8], 'Los Angeles': [-118.3, 34.0] };

export default function ExploreMap({
  market,
  sites,
  selectedId,
  pickId = null,
  onSelect,
  mode,
  polygon,
  onPolygon,
  onPin,
  basemap,
}: {
  market: string;
  sites: ExploreSite[];
  selectedId: string | null;
  pickId?: string | null;
  onSelect: (id: string) => void;
  mode: MapMode;
  polygon: Ring | null;
  onPolygon: (ring: Ring | null) => void;
  onPin: (lng: number, lat: number) => void;
  basemap: 'map' | 'satellite';
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<Ring>([]);
  const cb = useRef({ onSelect, onPolygon, onPin, mode, draft });
  cb.current = { onSelect, onPolygon, onPin, mode, draft };

  // init
  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({
      container: box.current,
      center: CENTER[market] ?? CENTER.Houston,
      zoom: 9.4,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 19,
            attribution: '© OpenStreetMap contributors',
          },
          sat: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 19,
            attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
          },
          draw: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        },
        layers: [
          { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.75, 'raster-opacity': 0.9 } },
          { id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } },
          {
            id: 'draw-fill',
            type: 'fill',
            source: 'draw',
            filter: ['==', '$type', 'Polygon'],
            paint: { 'fill-color': '#adc479', 'fill-opacity': 0.18 },
          },
          {
            id: 'draw-line',
            type: 'line',
            source: 'draw',
            paint: { 'line-color': '#264d39', 'line-width': 2.5, 'line-dasharray': [2, 1] },
          },
          {
            id: 'draw-pts',
            type: 'circle',
            source: 'draw',
            filter: ['==', '$type', 'Point'],
            paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-color': '#264d39', 'circle-stroke-width': 2 },
          },
        ],
      },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
    m.on('load', () => setReady(true));
    m.on('click', (e) => {
      const c = cb.current;
      if (c.mode === 'draw') {
        const next: Ring = [...c.draft, [e.lngLat.lng, e.lngLat.lat]];
        // clicking near the first vertex closes the ring
        if (c.draft.length >= 3) {
          const first = m.project(c.draft[0]);
          if (Math.hypot(first.x - e.point.x, first.y - e.point.y) < 14) {
            c.onPolygon(c.draft);
            setDraft([]);
            return;
          }
        }
        setDraft(next);
      } else if (c.mode === 'pin') {
        c.onPin(e.lngLat.lng, e.lngLat.lat);
      }
    });
    m.on('dblclick', (e) => {
      const c = cb.current;
      if (c.mode === 'draw' && c.draft.length >= 3) {
        e.preventDefault();
        c.onPolygon(c.draft);
        setDraft([]);
      }
    });
    map.current = m;
    return () => {
      markers.current.forEach((x) => x.remove());
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // recentre on market change
  useEffect(() => {
    map.current?.flyTo({ center: CENTER[market] ?? CENTER.Houston, zoom: 9.4, duration: 900 });
  }, [market]);

  // basemap
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.setLayoutProperty('sat', 'visibility', basemap === 'satellite' ? 'visible' : 'none');
    m.setLayoutProperty('osm', 'visibility', basemap === 'map' ? 'visible' : 'none');
  }, [basemap, ready]);

  // mode affects interactions + cursor
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (mode === 'draw') m.doubleClickZoom.disable();
    else {
      m.doubleClickZoom.enable();
      setDraft([]);
    }
    m.getCanvas().style.cursor = mode === 'browse' ? '' : 'crosshair';
  }, [mode]);

  // draw layer
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const ring = draft.length ? draft : polygon || [];
    const features: Feature[] = ring.map((p) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: p },
    }));
    if (ring.length >= 2)
      features.push({
        type: 'Feature',
        properties: {},
        geometry:
          !draft.length && ring.length >= 3
            ? { type: 'Polygon', coordinates: [[...ring, ring[0]]] }
            : { type: 'LineString', coordinates: ring },
      });
    (m.getSource('draw') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }, [draft, polygon, ready]);

  // site markers
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    markers.current.forEach((x) => x.remove());
    markers.current = sites.map((s) => {
      const v = verdict(s);
      const el = document.createElement('button');
      el.className = `ws-marker ${v.tone} ${s.id === selectedId ? 'sel' : ''} ${s.id === pickId ? 'pick' : ''}`;
      el.textContent = s.letter;
      el.title = `${s.name} · ${v.label}`;
      el.onclick = (ev) => {
        ev.stopPropagation();
        cb.current.onSelect(s.id);
      };
      return new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(m);
    });
  }, [sites, selectedId, pickId, ready]);

  // fit to results
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !sites.length || polygon) return;
    const lngs = sites.map((s) => s.lng),
      lats = sites.map((s) => s.lat);
    m.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 80, maxZoom: 13, duration: 700 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites.length, ready]);

  // follow selection
  useEffect(() => {
    const s = sites.find((x) => x.id === selectedId);
    if (s && map.current) map.current.easeTo({ center: [s.lng, s.lat], zoom: Math.max(map.current.getZoom(), 12), duration: 700 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return (
    <div className="xp-map">
      <div ref={box} className="xp-map-canvas" />
      {mode === 'draw' && (
        <div className="xp-map-hint">
          {draft.length < 3
            ? 'Click to add vertices around the search area.'
            : 'Click the first vertex or double-click to close the polygon.'}
        </div>
      )}
      {mode === 'pin' && <div className="xp-map-hint">Click a location to run the screening gates at that point.</div>}
    </div>
  );
}
