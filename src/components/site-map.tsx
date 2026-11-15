'use client';
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as LibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { setupMaplibre } from '@/lib/maplibre-setup';
setupMaplibre();
import type { AmenityResult, Site } from '@/lib/types';
import { failsHardGate, isRealSite, scoreSite } from '@/lib/engine';
export default function SiteMap({
  sites,
  selectedId,
  weights,
  onSelect,
  amenities,
}: {
  sites: Site[];
  selectedId: string;
  weights: Record<string, number>;
  onSelect: (id: string) => void;
  amenities?: AmenityResult | null;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<LibreMap | null>(null),
    markers = useRef<maplibregl.Marker[]>([]),
    callback = useRef(onSelect);
  callback.current = onSelect;
  const [failed, setFailed] = useState(false),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    try {
      const m = new maplibregl.Map({
        container: container.current,
        center: sites.length ? [sites[0].lng, sites[0].lat] : [-74.65, 40.34],
        zoom: sites.some(isRealSite) ? 9.6 : 12.2,
        pitch: 0,
        style: {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: [
                process.env.NEXT_PUBLIC_MAP_TILE_URL ||
                  'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              ],
              tileSize: 256,
              attribution:
                '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
              maxzoom: 19,
            },
          },
          layers: [
            {
              id: 'basemap',
              type: 'raster',
              source: 'osm',
              paint: { 'raster-saturation': -0.8, 'raster-contrast': -0.08, 'raster-opacity': 0.8 },
            },
          ],
        },
        attributionControl: { compact: false },
      });
      map.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      m.on('style.load', () => setLoaded(true));
      m.on('load', () => {
        setLoaded(true);
        setFailed(false);
      });
      m.on('error', (e) => {
        if (/WebGL|initialize|style.*load/i.test(e.error?.message || '')) setFailed(true);
      });
      return () => {
        markers.current.forEach((m) => m.remove());
        m.remove();
        map.current = null;
      };
    } catch {
      setFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Fit all candidates once the map is ready (real sites span a whole metro).
  useEffect(() => {
    if (!map.current || !loaded || sites.length < 2) return;
    const lngs = sites.map((s) => s.lng),
      lats = sites.map((s) => s.lat);
    map.current.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 60, maxZoom: 13, duration: 0 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  useEffect(() => {
    if (!map.current || !loaded) return;
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    for (const s of sites) {
      const el = document.createElement('button');
      el.className = `site-marker ${s.id === selectedId ? 'selected' : ''} ${failsHardGate(s) ? 'site-marker-fail' : ''}`;
      el.setAttribute('aria-label', `Select ${s.name}`);
      const letter = isRealSite(s) ? String.fromCharCode(65 + sites.indexOf(s)) : s.id.slice(-1).toUpperCase();
      el.textContent = failsHardGate(s) ? `${letter} · FAIL` : `${letter} · ${scoreSite(s, weights)}`;
      el.onclick = () => callback.current(s.id);
      markers.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map.current),
      );
    }
    for (const a of amenities?.points || []) {
      const el = document.createElement('div');
      el.className = 'amenity-marker';
      el.title = `${a.name} · OpenStreetMap`;
      markers.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([a.lng, a.lat]).addTo(map.current),
      );
    }
  }, [sites, selectedId, weights, loaded, amenities]);
  useEffect(() => {
    const site = sites.find((s) => s.id === selectedId);
    if (map.current && site) map.current.easeTo({ center: [site.lng, site.lat], duration: 800 });
  }, [selectedId, sites]);
  return (
    <div className="map-container">
      <div
        ref={container}
        className="map-canvas"
        aria-label="Interactive OpenStreetMap site comparison map"
      />
      {failed && (
        <div className="map-fallback">
          <b>Base map unavailable</b>
          <span>
            {sites.some(isRealSite)
              ? 'CoStar property locations are listed below.'
              : 'Candidate locations remain illustrative. Select a site below.'}
          </span>
          <div>
            {sites.map((s) => (
              <button key={s.id} onClick={() => onSelect(s.id)}>
                {s.name} · {s.lat}, {s.lng}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="map-label">
        {sites.some(isRealSite) ? (
          <>
            <span className="pulse-dot" /> COSTAR PROPERTIES <span>{sites.length} real candidates</span>
          </>
        ) : (
          <>
            <span className="pulse-dot" /> PRINCETON REGION <span>4 illustrative candidates</span>
          </>
        )}
      </div>
      <div className="map-legend">
        {sites.some(isRealSite) ? (
          <>
            <i /> Passes hard gates <i className="fail" /> Fails a hard gate
          </>
        ) : (
          <>
            <i /> Illustrative candidate <i className="amenity" /> Live mapped amenity
          </>
        )}
      </div>
    </div>
  );
}
