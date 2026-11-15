'use client';
import { useState } from 'react';
import type { Design, Incident, Sensor, Site } from '@/lib/types';
import { number } from '@/lib/engine';
export function SitePlan({
  design: d,
  site,
  sensors = [],
  incidents = [],
  selectedSensor,
  onSelect,
  floor = 1,
  park = false,
}: {
  design: Design;
  site: Site;
  sensors?: Sensor[];
  incidents?: Incident[];
  selectedSensor?: string;
  onSelect?: (id: string) => void;
  floor?: number;
  park?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const pad = 28,
    vw = site.width + pad * 2,
    vh = site.depth + pad * 2,
    cx = vw / 2,
    cy = vh / 2;
  const bad = new Set(incidents.filter((i) => i.status !== 'resolved').map((i) => i.sensorId));
  return (
    <div className="plan-wrap">
      <svg
        viewBox={`0 0 ${vw} ${vh}`}
        className="site-plan"
        aria-label="Interactive conceptual site plan"
      >
        <defs>
          <pattern id="plan-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0H0V10" fill="none" stroke="#cad3c7" strokeWidth=".4" />
          </pattern>
          <pattern id="plan-green" width="5" height="5" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r=".5" fill="#8eaa79" />
          </pattern>
        </defs>
        <rect width={vw} height={vh} fill="#eaf0e6" />
        <g transform={`translate(${cx} ${cy}) scale(${zoom}) translate(${-cx} ${-cy})`}>
          <rect
            x={pad}
            y={pad}
            width={site.width}
            height={site.depth}
            rx="2"
            fill="#f7f8f0"
            stroke="#799276"
            strokeWidth=".8"
          />
          <rect x={pad} y={pad} width={site.width} height={site.depth} fill="url(#plan-grid)" />
          <rect
            x={pad + d.setback}
            y={pad + d.setback}
            width={Math.max(0, site.width - 2 * d.setback)}
            height={Math.max(0, site.depth - 2 * d.setback)}
            fill="none"
            stroke="#97a291"
            strokeWidth=".5"
            strokeDasharray="3 2"
          />
          <rect
            x={pad + 2}
            y={pad + 2}
            width={site.width - 4}
            height={Math.max(5, (site.depth * d.green) / 100)}
            fill="url(#plan-green)"
          />
          <path
            d={`M${pad} ${pad + site.depth - 8}H${pad + site.width}`}
            stroke="#c6cfc0"
            strokeWidth="8"
          />
          <g transform={`rotate(${d.rotation} ${cx} ${cy})`}>
            <rect
              x={cx - d.width / 2}
              y={cy - d.depth / 2}
              width={d.width}
              height={d.depth}
              fill="#d1dabc"
              stroke="#385f49"
              strokeWidth="1"
            />
            {(park
              ? ['Community pavilion', 'Irrigation plant', 'Restrooms']
              : ['West wing', 'Mechanical room', 'East wing']
            ).map((zone, i) => (
              <g key={zone}>
                <rect
                  x={cx - d.width / 2 + (d.width * i) / 3}
                  y={cy - d.depth / 2}
                  width={d.width / 3}
                  height={d.depth}
                  fill={
                    sensors.some((s) => s.zone === zone && s.floor === floor && bad.has(s.id))
                      ? '#fca895'
                      : 'transparent'
                  }
                  stroke="#789478"
                  strokeWidth=".4"
                />
                {d.width > 35 && (
                  <text
                    x={cx - d.width / 3 + (d.width * i) / 3}
                    y={cy + 2}
                    textAnchor="middle"
                    fontSize={Math.max(2, d.width / 25)}
                    fill="#446247"
                  >
                    {park ? ['Pavilion', 'Plant', 'Restrooms'][i] : ['WEST', 'PLANT', 'EAST'][i]}
                  </text>
                )}
              </g>
            ))}
            {sensors
              .filter((s) => s.floor === floor)
              .map((s) => (
                <g
                  key={s.id}
                  onClick={() => onSelect?.(s.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Inspect ${s.name}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSelect?.(s.id);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <circle
                    cx={cx + s.x}
                    cy={cy + s.z}
                    r={Math.max(5, Math.min(d.width, d.depth) * 0.14)}
                    fill={bad.has(s.id) ? '#ed765922' : '#76a95615'}
                    stroke={bad.has(s.id) ? '#dc6c50' : '#82a66a'}
                    strokeWidth=".3"
                    strokeDasharray="1 1"
                  />
                  <circle
                    cx={cx + s.x}
                    cy={cy + s.z}
                    r={selectedSensor === s.id ? 3.3 : 2.3}
                    fill={
                      bad.has(s.id)
                        ? '#db644a'
                        : s.type === 'water'
                          ? '#4f92ba'
                          : s.type === 'fire'
                            ? '#b88448'
                            : '#426f54'
                    }
                    stroke="white"
                    strokeWidth=".7"
                  />
                  <title>
                    {s.name} · {s.value}
                    {s.unit}
                  </title>
                </g>
              ))}
          </g>
          <text x={cx} y={pad - 8} textAnchor="middle" fontSize="4" fill="#586a58">
            {number(site.width)} m
          </text>
          <text
            x={pad - 9}
            y={cy}
            textAnchor="middle"
            fontSize="4"
            fill="#586a58"
            transform={`rotate(-90 ${pad - 9} ${cy})`}
          >
            {number(site.depth)} m
          </text>
          <text x={cx} y={vh - 9} textAnchor="middle" fontSize="4" fill="#65765e">
            ACCESS ROAD · CONCEPTUAL SETBACK {d.setback} m
          </text>
          {Array.from({ length: Math.min(18, d.parking) }, (_, i) => (
            <rect
              key={i}
              x={pad + 8 + (i * (site.width - 16)) / Math.min(18, d.parking)}
              y={pad + site.depth - 22}
              width={(site.width - 16) / Math.min(18, d.parking) - 1}
              height="7"
              fill="#dce1d1"
              stroke="#b4c0a8"
              strokeWidth=".3"
            />
          ))}
          <path
            d={`M${vw - 15} 21v-10l-2 4m2-4l2 4`}
            fill="none"
            stroke="#42634d"
            strokeWidth=".8"
          />
          <text x={vw - 15} y="8" fontSize="3.5" textAnchor="middle" fill="#42634d">
            N
          </text>
        </g>
      </svg>
      <div className="plan-controls">
        <label>
          Plan zoom{' '}
          <input
            aria-label="Plan zoom"
            type="range"
            min="0.8"
            max="2"
            step="0.1"
            value={zoom}
            onChange={(e) => setZoom(+e.target.value)}
          />
        </label>
        <span>
          Concept only · {d.width} × {d.depth} m footprint
        </span>
      </div>
    </div>
  );
}
