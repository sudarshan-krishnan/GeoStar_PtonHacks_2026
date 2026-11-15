'use client';
import dynamic from 'next/dynamic';
import { Component, useCallback, useState, type ReactNode } from 'react';
import { Crosshair, Expand, Minus, Plus, RotateCcw } from 'lucide-react';
import { evacuationPlans, monitoringPoints, MODEL_ID, levelY } from '@/lib/haven/config';
import {
  activeIncidents,
  effectivePlan,
  routeAvailability,
  type ProtectionState,
} from '@/lib/haven/engine';

const TwinCanvas = dynamic(() => import('./twin-canvas'), {
  ssr: false,
  loading: () => <div className="hv-model-loading">Preparing the HAVEN twin…</div>,
});
class TwinBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function PlanView({ state }: { state: ProtectionState }) {
  const active = activeIncidents(state);
  const hazard = active.some((i) => i.kind === 'fire' || i.kind === 'leak');
  const plan = effectivePlan(state);
  const available = routeAvailability(state);
  const route = plan
    ? evacuationPlans[plan].points.filter((point) => Math.abs(point[1] - levelY(4) - 0.3) < 0.1)
    : [];
  const path = route
    .map((point, i) => `${i ? 'L' : 'M'}${350 + point[0] * 45} ${190 + point[2] * 36}`)
    .join(' ');
  return (
    <div className="hv-flat-plan">
      <svg viewBox="0 0 700 380" role="img" aria-label="Configured Level 4 demo evacuation plan">
        <rect width="700" height="380" fill="#f3f1ee" />
        <rect
          x="50"
          y="50"
          width="600"
          height="280"
          rx="12"
          fill="#fcfbf8"
          stroke="#a8a39a"
          strokeWidth="2"
        />
        <path d="M65 189H635" stroke="#dce7f8" strokeWidth="45" />
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <rect
              x={75 + i * 110}
              y="69"
              width="90"
              height="95"
              rx="5"
              fill="#ece7dd"
              stroke="#cfc6b6"
            />
            <rect
              x={75 + i * 110}
              y="225"
              width="90"
              height="85"
              rx="5"
              fill={hazard && i > 2 ? '#f2c6b8' : '#ece7dd'}
              stroke="#cfc6b6"
            />
          </g>
        ))}
        {hazard && (
          <rect x="380" y="169" width="220" height="40" rx="8" fill="#eb9a86" opacity=".8" />
        )}
        {plan && (
          <path
            d={path}
            stroke={available[plan || 'east'] ? '#2f7bff' : '#be6954'}
            strokeWidth="9"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            strokeDasharray="13 7"
          />
        )}
        <circle cx="320.75" cy="238.6" r="9" fill="#f59e0b" stroke="#fff" strokeWidth="3" />
        {monitoringPoints
          .filter((sensor) => state.config[sensor.protection].enabled)
          .map((sensor) => (
            <circle
              key={sensor.id}
              cx={350 + sensor.position[0] * 45}
              cy={190 + sensor.position[2] * 36}
              r="6"
              fill={active.some((i) => i.kind === sensor.protection) ? '#c26e52' : '#2f7bff'}
              stroke="#fff"
              strokeWidth="2"
            >
              <title>{sensor.label}</title>
            </circle>
          ))}
        <g fontSize="12" fontFamily="sans-serif" fill="#7c7a74">
          <text x="76" y="37">
            WEST STAIR → NORTH EXIT
          </text>
          <text x="472" y="350">
            EAST STAIR → EAST EXIT
          </text>
          <text x="265" y="357">
            LEVEL 4 · SAMPLE TOPOLOGY
          </text>
        </g>
        {!available.east && (
          <g stroke="#b64e41" strokeWidth="5">
            <path d="M585 266L609 290M609 266L585 290" />
          </g>
        )}
      </svg>
      <p>Level 4 route segment · ground-floor exits are reached by stairs · not step-free</p>
    </div>
  );
}
export function FacilityTwin({
  state,
  operational = false,
  initialFloor,
}: {
  state: ProtectionState;
  operational?: boolean;
  initialFloor?: number | null;
}) {
  const [view, setView] = useState<'3d' | 'plan'>('3d');
  const [floor, setFloor] = useState<number | null>(
    initialFloor !== undefined ? initialFloor : operational ? 4 : null,
  );
  const [command, setCommand] = useState({ sequence: 0, action: 'reset' });
  const [selected, setSelected] = useState('');
  // When a fire or leak starts, the live twin cuts away to Level 4 so the hazard is in view
  // (HAVEN's "focus active incident"). Users can still pick any level afterwards.
  const hazardKey = activeIncidents(state)
    .filter((i) => i.kind === 'fire' || i.kind === 'leak')
    .map((i) => i.kind)
    .sort()
    .join('+');
  const [seenHazards, setSeenHazards] = useState(hazardKey);
  if (hazardKey !== seenHazards) {
    setSeenHazards(hazardKey);
    if (operational && hazardKey) setFloor(4);
  }
  const unavailable = useCallback(() => setView('plan'), []);
  const send = (action: string) => setCommand((c) => ({ sequence: c.sequence + 1, action }));
  const enabled = monitoringPoints.filter((s) => state.config[s.protection].enabled);
  const plan = <PlanView state={state} />;
  return (
    <div className="hv-twin" data-model-id={MODEL_ID} data-facility-id={state.facility.id}>
      <div className="hv-viewer-tools">
        <div className="d2-view-toggle">
          <button
            aria-label="3D twin view"
            aria-pressed={view === '3d'}
            onClick={() => setView('3d')}
          >
            3D twin
          </button>
          <button
            aria-label="2D evacuation plan"
            aria-pressed={view === 'plan'}
            onClick={() => setView('plan')}
          >
            2D plan
          </button>
        </div>
        <div className="hv-camera-tools">
          <select
            aria-label="Twin level"
            disabled={view !== '3d'}
            value={floor ?? 'all'}
            onChange={(e) => setFloor(e.target.value === 'all' ? null : +e.target.value)}
          >
            <option value="all">All levels</option>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                Level {n}
              </option>
            ))}
          </select>
          <button aria-label="Zoom in" disabled={view !== '3d'} onClick={() => send('in')}>
            <Plus size={14} />
          </button>
          <button aria-label="Zoom out" disabled={view !== '3d'} onClick={() => send('out')}>
            <Minus size={14} />
          </button>
          <button aria-label="Reset camera" disabled={view !== '3d'} onClick={() => send('reset')}>
            <RotateCcw size={14} />
          </button>
          {operational && (
            <button
              aria-label="Focus active incident"
              title="Focus active incident"
              disabled={view !== '3d' || !hazardKey}
              onClick={() => {
                setFloor(4);
                send('reset');
              }}
            >
              <Crosshair size={14} />
            </button>
          )}
        </div>
      </div>
      {view === '3d' ? (
        <TwinBoundary
          fallback={
            <div className="hv-model-fallback">
              <p>3D unavailable on this device. The configured 2D plan remains available.</p>
              {plan}
            </div>
          }
        >
          <TwinCanvas
            state={state}
            floor={floor}
            command={command}
            operational={operational}
            onPick={setSelected}
            onUnavailable={unavailable}
          />
        </TwinBoundary>
      ) : (
        plan
      )}
      <div className="hv-twin-caption">
        <span>
          <Expand size={11} /> {operational ? 'HAVEN DIGITAL TWIN' : 'SAMPLE MODEL · HAVEN'}
        </span>
        <span>
          {view === '3d'
            ? 'Drag to orbit · scroll to zoom'
            : 'Configured demo route · not a surveyed plan'}
        </span>
      </div>
      {operational && (
        <div className="hv-model-legend">
          <span>
            <i className="hv-dot sensor" /> {enabled.length} monitoring points
          </span>
          <span>
            <i className="hv-dot clear" /> Scenario-clear route
          </span>
          <span>
            <i className="hv-dot hazard" /> Affected area
          </span>
        </div>
      )}
      {selected && (
        <div className="hv-inspection" role="status">
          <b>
            {monitoringPoints.find((s) => s.id === selected)?.label ||
              selected.replaceAll('-', ' ')}
          </b>
          <span>Configured sample geometry · {state.facility.name}</span>
          <button onClick={() => setSelected('')} aria-label="Close model inspection">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
