import * as maplibregl from 'maplibre-gl';

// Turbopack does not emit MapLibre's worker next to its bundle, so serve it from /public.
// Refresh after upgrading maplibre-gl: cp node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs public/maplibre/
let done = false;
export function setupMaplibre() {
  if (done || typeof window === 'undefined') return;
  maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
  done = true;
}
