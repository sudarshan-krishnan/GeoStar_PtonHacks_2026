'use client';
// Small read-only MapLibre map for the CoStar dossier: a subject point plus evidence points (comps, homes), coloured
// on one sequential green ramp by a 0..1 score (darker = more similar / closer). Muted points are drawn grey.
import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, Point } from 'geojson';
import { setupMaplibre } from '@/lib/maplibre-setup';

export interface MapPoint { id: string; lat: number; lon: number; label: string; score?: number | null; muted?: boolean; subject?: boolean }

/** Sequential single-hue ramp (light → dark), the Studio's forest green. */
export const RAMP = ['#cfe3d3', '#93c2a0', '#5b9a70', '#34664b', '#1d3d2b'] as const;

export default function MiniMap({ points, height = 240, legend }: { points: MapPoint[]; height?: number; legend?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const pop = useRef<maplibregl.Popup | null>(null);

  useEffect(() => {
    if (!box.current) return;
    setupMaplibre();
    const m = new maplibregl.Map({
      container: box.current, attributionControl: { compact: true }, interactive: true, dragRotate: false,
      style: {
        version: 8,
        sources: { osm: { type: 'raster', tiles: [process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' } },
        layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.85, 'raster-opacity': 0.85 } }],
      },
      center: [-95.37, 29.76], zoom: 10,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const draw = () => {
      const fc = { type: 'FeatureCollection' as const, features: points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)).map((p): Feature<Point> => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { id: p.id, label: p.label, score: p.score ?? -1, muted: p.muted ? 1 : 0, subject: p.subject ? 1 : 0 },
      })) };
      const src = m.getSource('pts') as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(fc);
      else {
        m.addSource('pts', { type: 'geojson', data: fc });
        m.addLayer({ id: 'pts', type: 'circle', source: 'pts', filter: ['==', ['get', 'subject'], 0], paint: {
          'circle-radius': 6, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff',
          'circle-color': ['case', ['==', ['get', 'muted'], 1], '#b9c0ba', ['<', ['get', 'score'], 0], '#8a958d',
            ['interpolate', ['linear'], ['get', 'score'], 0, RAMP[0], 0.25, RAMP[1], 0.5, RAMP[2], 0.75, RAMP[3], 1, RAMP[4]]],
        } });
        m.addLayer({ id: 'subject', type: 'circle', source: 'pts', filter: ['==', ['get', 'subject'], 1], paint: {
          'circle-radius': 8, 'circle-color': '#b3362b', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff',
        } });
        for (const id of ['pts', 'subject']) {
          m.on('mouseenter', id, (e) => {
            m.getCanvas().style.cursor = 'pointer';
            const f = e.features?.[0];
            if (!f) return;
            pop.current?.remove();
            pop.current = new maplibregl.Popup({ closeButton: false, offset: 10 }).setLngLat((f.geometry as Point).coordinates as [number, number])
              .setText(String(f.properties?.label ?? '')).addTo(m);
          });
          m.on('mouseleave', id, () => { m.getCanvas().style.cursor = ''; pop.current?.remove(); });
        }
      }
      const b = new maplibregl.LngLatBounds();
      fc.features.forEach((f) => b.extend(f.geometry.coordinates as [number, number]));
      if (!b.isEmpty()) m.fitBounds(b, { padding: 34, maxZoom: 15, duration: 0 });
    };
    if (m.isStyleLoaded()) draw(); else m.once('load', draw);
  }, [points]);

  return (
    <figure style={{ margin: 0 }}>
      <div ref={box} style={{ height, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(24,35,29,0.08)' }} role="img"
        aria-label={`Map of ${points.length} points${legend ? `: ${legend}` : ''}`} />
      {legend && (
        <figcaption style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 11.5, color: 'var(--st-muted)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><i style={{ width: 9, height: 9, borderRadius: '50%', background: '#b3362b', display: 'inline-block' }} /> Subject</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>{RAMP.map((c) => <i key={c} style={{ width: 14, height: 8, background: c, display: 'inline-block' }} />)}</span>
          <span>{legend}</span>
        </figcaption>
      )}
    </figure>
  );
}
