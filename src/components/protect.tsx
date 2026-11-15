'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Activity,
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  Cpu,
  Droplets,
  Flame,
  Layers,
  Plus,
  Radio,
  RotateCcw,
  Save,
  ShieldCheck,
  Thermometer,
  Trash2,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import { Button } from './ui/button';
import { SitePlan } from './site-plan';
import { Stat } from './discover';
import type { Project, Sensor } from '@/lib/types';
import type { Mutate } from './workspace';
const Scene = dynamic(() => import('./scene'), {
  ssr: false,
  loading: () => (
    <div className="scene-container loading-panel">Connecting your conceptual twin…</div>
  ),
});
const icons: Record<string, typeof Droplets> = {
  water: Droplets,
  temperature: Thermometer,
  fire: Flame,
  electrical: Zap,
};
export function Protect({
  p,
  mutate,
  busy,
  connected,
  onDesign,
}: {
  p: Project;
  mutate: Mutate;
  busy: boolean;
  connected: boolean;
  onDesign: () => void;
}) {
  const [view, setView] = useState('3d'),
    [floor, setFloor] = useState(1),
    [selected, setSelected] = useState<string | null>(null),
    [editing, setEditing] = useState<Partial<Sensor>>({}),
    [showAdd, setShowAdd] = useState(false),
    [adding, setAdding] = useState('water'),
    [now, setNow] = useState(Date.now()),
    [filter, setFilter] = useState('all'),
    [hardware, setHardware] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const s = p.sensors.find((s) => s.id === selected);
    setEditing(s ? { ...s } : {});
  }, [selected]);
  const d = p.designs.find((d) => d.id === p.approvedDesignId),
    site = p.sites.find((s) => s.id === p.selectedSiteId);
  if (!d || !site)
    return (
      <section className="panel stage-empty">
        <ShieldCheck />
        <h2>A smarter building starts with a concept.</h2>
        <p>Approve a design to generate a connected conceptual sensor plan.</p>
        <Button onClick={onDesign}>
          Shape your design <ArrowRight size={16} />
        </Button>
      </section>
    );
  const open = p.incidents.filter((i) => i.status !== 'resolved'),
    live = p.sensors.filter(
      (s) => s.source === 'hardware' && s.lastSeen && now - new Date(s.lastSeen).getTime() < 30000,
    ),
    bad = new Set(open.map((i) => i.sensorId)),
    s = p.sensors.find((s) => s.id === selected),
    filteredSensors = p.sensors.filter(
      (s) => s.floor === floor && (filter === 'all' || s.type === filter),
    ),
    plannedZones = new Set(p.sensors.map((s) => `${s.floor}:${s.zone}`));
  const pick = (id: string) => {
    setSelected(id);
    setShowAdd(false);
  };
  return (
    <div className="protect-layout">
      <div className="haven-banner">
        <div className="haven-logo">
          <ShieldCheck size={24} />
          <span>
            HAVEN<small>INTELLIGENCE ENGINE</small>
          </span>
        </div>
        <div className="haven-agent">
          <span className="pulse-dot" />
          <span>
            Guardian orchestrator<small>Monitoring → Event evaluation → Maintenance</small>
          </span>
        </div>
        <span className={`connection-pill ${live.length ? 'live' : ''}`}>
          {live.length ? <Wifi size={14} /> : <Radio size={14} />}{' '}
          {live.length
            ? `${live.length} live hardware sensors`
            : 'Simulation mode · no live hardware'}
        </span>
      </div>
      <div className="protect-stat-grid">
        <Stat label="Planned sensors" value={String(p.sensors.length)} />
        <Stat label="Mapped zones" value={`${plannedZones.size} / ${d.floors * 3}`} />
        <Stat label="Needs attention" value={String(open.length)} warning={open.length > 0} />
        <Stat
          label="Live telemetry"
          value={live.length ? `${live.length} connected` : 'No hardware'}
        />
      </div>
      <div className="protect-workbench">
        <section className="panel twin-panel">
          <div className="model-toolbar">
            <div>
              <ShieldCheck size={17} />
              <b>Live conceptual twin</b>
              <span className={`badge ${connected ? 'badge-green' : ''}`}>
                {connected ? 'SSE CONNECTED' : 'RECONNECTING'}
              </span>
            </div>
            <div className="segmented">
              <button className={view === '3d' ? 'active' : ''} onClick={() => setView('3d')}>
                3D twin
              </button>
              <button className={view === '2d' ? 'active' : ''} onClick={() => setView('2d')}>
                Sensor plan
              </button>
            </div>
          </div>
          <div className="twin-floors">
            <label>
              <Layers size={14} /> View floor{' '}
              <select
                aria-label="Twin floor"
                value={floor}
                onChange={(e) => setFloor(+e.target.value)}
              >
                {Array.from({ length: d.floors }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    Floor {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <span>
              <i className="green-dot" /> Nominal <i className="red-dot" /> Active incident{' '}
              <i className="blue-dot" /> Water sensor
            </span>
          </div>
          {view === '3d' ? (
            <Scene
              design={d}
              site={site}
              protect
              sensors={p.sensors}
              incidents={p.incidents}
              floor={floor}
              onSelect={pick}
              park={p.type === 'park'}
            />
          ) : (
            <SitePlan
              design={d}
              site={site}
              sensors={p.sensors}
              incidents={p.incidents}
              floor={floor}
              selectedSensor={selected || undefined}
              onSelect={pick}
              park={p.type === 'park'}
            />
          )}
          <div className="model-footer">
            <span>Click a sensor to inspect · Rings are illustrative, not certified coverage</span>
            <span>{d.name}</span>
          </div>
        </section>
        <aside className="panel simulation-panel">
          <div className="eyebrow">A SAFE SPACE TO PREPARE</div>
          <h2>What happens next?</h2>
          <p>Trigger a simulated reading. Follow the event from detection through response.</p>
          <div className="simulation-buttons">
            {[
              {
                kind: 'water-leak',
                name: 'Water leak',
                text: 'Abnormal moisture → maintenance',
                icon: Droplets,
                class: 'water',
              },
              {
                kind: 'overheating',
                name: 'Overheating',
                text: 'Temperature threshold → inspection',
                icon: Thermometer,
                class: 'heat',
              },
              {
                kind: 'fire-alarm',
                name: 'Fire alarm',
                text: 'Critical warning → response plan',
                icon: Flame,
                class: 'fire',
              },
            ].map((t) => (
              <button
                key={t.kind}
                disabled={busy}
                className={`simulate-button ${t.class}`}
                onClick={() => void mutate({ kind: t.kind }, '/simulate', 'POST')}
              >
                <span>
                  <t.icon size={20} />
                </span>
                <div>
                  <b>{t.name}</b>
                  <small>{t.text}</small>
                </div>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
          <Button
            className="full-width"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void mutate({ kind: 'reset' }, '/simulate', 'POST')}
          >
            <RotateCcw size={14} /> Reset simulation
          </Button>
          <div className="agent-flow">
            <span>
              <Activity size={15} />
              Monitoring agent
            </span>
            <i>↓ Threshold exceeded</i>
            <span>
              <ShieldCheck size={15} />
              Guardian orchestrator
            </span>
            <i>↓ Incident created</i>
            <span>
              <Cpu size={15} />
              Maintenance recommendation
            </span>
          </div>
          <p className="small-note">
            Simulations never actuate physical alarms, valves or equipment. Reset resolves simulated
            incidents and preserves hardware readings.
          </p>
        </aside>
      </div>
      <div className="monitoring-bottom">
        <section className="panel sensor-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">THE SIGNALS THAT MATTER</div>
              <h2>Your sensor network.</h2>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowAdd(true);
                setSelected(null);
              }}
            >
              <Plus size={14} /> Add sensor
            </Button>
          </div>
          <div className="sensor-toolbar">
            <div className="segmented">
              {['all', 'water', 'temperature', 'fire', 'electrical'].map((t) => (
                <button
                  key={t}
                  className={filter === t ? 'active' : ''}
                  onClick={() => setFilter(t)}
                >
                  {t === 'all' ? 'All types' : t}
                </button>
              ))}
            </div>
            <button className="text-link" onClick={() => setHardware(!hardware)}>
              <Wifi size={14} /> Hardware setup
            </button>
          </div>
          {hardware && (
            <div className="hardware-help">
              <h3>Connect an ESP32.</h3>
              <p>
                Bind a sensor below to your device ID. Set TELEMETRY_API_KEY in the server’s .env
                file and restart. Submit JSON to <code>POST /api/telemetry</code> with a Bearer
                token.
              </p>
              <pre>
                {JSON.stringify(
                  {
                    projectId: p.id,
                    sensorId: s?.id || p.sensors[0]?.id,
                    deviceId: 'esp32-lab-01',
                    value: 24.5,
                  },
                  null,
                  2,
                )}
              </pre>
              <p>
                Use a temperature sensor for °C and a calibrated water sensor for 0–100%. A reading
                received in the last 30 seconds is considered connected. Firmware:{' '}
                <code>hardware/plotstar_esp32.ino</code>.
              </p>
            </div>
          )}
          <div className="table-scroll sensor-table">
            <table>
              <thead>
                <tr>
                  <th>Sensor</th>
                  <th>Zone</th>
                  <th>Reading</th>
                  <th>Status</th>
                  <th>Connection</th>
                </tr>
              </thead>
              <tbody>
                {filteredSensors.map((sensor) => {
                  const Icon = icons[sensor.type] || Activity,
                    hot = sensor.value >= sensor.threshold,
                    online =
                      sensor.source === 'hardware' &&
                      sensor.lastSeen &&
                      now - new Date(sensor.lastSeen).getTime() < 30000;
                  return (
                    <tr
                      key={sensor.id}
                      onClick={() => pick(sensor.id)}
                      className={selected === sensor.id ? 'highlight-row' : ''}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') pick(sensor.id);
                      }}
                    >
                      <td>
                        <div className="sensor-name">
                          <Icon size={16} />
                          <span>
                            <b>{sensor.name}</b>
                            <small>
                              Floor {sensor.floor} · threshold {sensor.threshold}
                              {sensor.unit}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td>{sensor.zone}</td>
                      <td>
                        <b className={hot ? 'reading-hot' : ''}>
                          {sensor.value.toFixed(sensor.type === 'fire' ? 0 : 1)}{' '}
                          <small>{sensor.unit}</small>
                        </b>
                      </td>
                      <td>
                        <span className={`sensor-status ${hot ? 'alert' : ''}`}>
                          <i />
                          {hot ? 'Above threshold' : 'Nominal'}
                        </span>
                      </td>
                      <td>
                        {sensor.source === 'hardware' ? (
                          <span className={`connection-text ${online ? 'live' : ''}`}>
                            {online ? <Wifi size={12} /> : <WifiOff size={12} />}{' '}
                            {online ? 'Live hardware' : 'Hardware offline'}
                          </span>
                        ) : (
                          <span className="connection-text">
                            <Radio size={12} /> Simulated
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!filteredSensors.length && (
              <p className="empty-inline">
                No sensors of this type on floor {floor}. Add a conceptual sensor to begin.
              </p>
            )}
          </div>
        </section>
        <section className="panel incident-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">GUARDIAN EVENT TIMELINE</div>
              <h2>Aware. Informed. Ready.</h2>
            </div>
            <span className={`incident-count ${open.length ? 'active' : ''}`}>
              <Bell size={15} />
              {open.length}
            </span>
          </div>
          {!p.incidents.length ? (
            <div className="incident-empty">
              <ShieldCheck size={36} />
              <h3>A quiet moment.</h3>
              <p>
                Trigger a simulation to see Guardian’s event-driven response. No live hardware
                events have been received.
              </p>
            </div>
          ) : (
            <div className="incident-list">
              {p.incidents.map((i) => (
                <article
                  className={`incident-card severity-${i.severity} ${i.status === 'resolved' ? 'resolved' : ''}`}
                  key={i.id}
                >
                  <div className="incident-card-head">
                    <span>
                      {i.severity} · {i.source}
                    </span>
                    <span>{new Date(i.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <h3>{i.kind.replaceAll('-', ' ')}</h3>
                  <p>{i.message}</p>
                  <div className="recommendation">
                    <Cpu size={14} />
                    <p>{i.recommendation}</p>
                  </div>
                  <div className="incident-card-footer">
                    <span className="status-pill">{i.status}</span>
                    {i.status === 'open' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void mutate(
                            { incidentId: i.id, status: 'acknowledged' },
                            '/incidents',
                            'PATCH',
                          )
                        }
                      >
                        Acknowledge
                      </Button>
                    )}
                    {i.status !== 'resolved' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void mutate(
                            { incidentId: i.id, status: 'resolved' },
                            '/incidents',
                            'PATCH',
                          )
                        }
                      >
                        <Check size={13} /> Resolve
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
      {!!p.simulations.length && (
        <section className="panel simulation-history">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">SAVED WITH YOUR PROJECT</div>
              <h2>Simulation history.</h2>
            </div>
            <span className="badge">{p.simulations.length} RUNS</span>
          </div>
          {p.simulations.slice(0, 12).map((run) => (
            <div className="simulation-history-row" key={run.id}>
              <RotateCcw size={15} />
              <b>{run.kind.replaceAll('-', ' ')}</b>
              <p>{run.summary}</p>
              <time>{new Date(run.createdAt).toLocaleString()}</time>
            </div>
          ))}
        </section>
      )}
      {(selected || showAdd) && (
        <div className="modal-backdrop">
          <section
            className="modal sensor-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sensor-title"
          >
            <button
              className="modal-close"
              aria-label="Close sensor editor"
              onClick={() => {
                setSelected(null);
                setShowAdd(false);
              }}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">CONCEPTUAL SENSOR MAPPING</div>
            <h2 id="sensor-title">
              {showAdd ? 'Add a little awareness.' : 'Every signal has a place.'}
            </h2>
            <p>
              Position sensors within the approved building. Sensor IDs are stable and available for
              telemetry integration.
            </p>
            {s && (
              <div className="sensor-identity">
                <code>{s.id}</code>
                <span>
                  {s.source === 'hardware' ? 'Hardware reading received' : 'Simulation sensor'}
                </span>
              </div>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const body = showAdd
                  ? {
                      action: 'add',
                      type: adding,
                      name: editing.name || `${adding} sensor`,
                      zone: editing.zone || 'Mechanical room',
                      x: editing.x || 0,
                      z: editing.z || 0,
                      floor: editing.floor || floor,
                      deviceId: editing.deviceId || null,
                    }
                  : {
                      action: 'update',
                      sensorId: s?.id,
                      name: editing.name,
                      zone: editing.zone,
                      x: editing.x,
                      z: editing.z,
                      floor: editing.floor,
                      threshold: editing.threshold,
                      deviceId: editing.deviceId || null,
                    };
                if (await mutate(body, '/sensors', 'POST')) {
                  setSelected(null);
                  setShowAdd(false);
                }
              }}
            >
              <div className="form-grid">
                {showAdd && (
                  <label className="span-2">
                    Sensor type
                    <select value={adding} onChange={(e) => setAdding(e.target.value)}>
                      {['water', 'temperature', 'fire', 'electrical'].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="span-2">
                  Sensor name
                  <input
                    required
                    maxLength={80}
                    value={editing.name || ''}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </label>
                <label>
                  Zone
                  <select
                    value={editing.zone || 'Mechanical room'}
                    onChange={(e) => setEditing({ ...editing, zone: e.target.value })}
                  >
                    {(p.type === 'park'
                      ? ['Community pavilion', 'Restrooms', 'Irrigation plant']
                      : ['West wing', 'East wing', 'Mechanical room']
                    ).map((z) => (
                      <option key={z}>{z}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Floor
                  <input
                    aria-label="Sensor floor"
                    type="number"
                    required
                    min={1}
                    max={d.floors}
                    value={editing.floor || floor}
                    onChange={(e) => setEditing({ ...editing, floor: +e.target.value })}
                  />
                </label>
                <label>
                  X position (m)
                  <input
                    type="number"
                    step=".1"
                    min={-d.width / 2}
                    max={d.width / 2}
                    required
                    value={editing.x ?? 0}
                    onChange={(e) => setEditing({ ...editing, x: +e.target.value })}
                  />
                </label>
                <label>
                  Z position (m)
                  <input
                    type="number"
                    step=".1"
                    min={-d.depth / 2}
                    max={d.depth / 2}
                    required
                    value={editing.z ?? 0}
                    onChange={(e) => setEditing({ ...editing, z: +e.target.value })}
                  />
                </label>
                {!showAdd && (
                  <label>
                    Alert threshold ({s?.unit})
                    <input
                      type="number"
                      step=".1"
                      required
                      min={0.01}
                      max={10000}
                      value={editing.threshold || 1}
                      onChange={(e) => setEditing({ ...editing, threshold: +e.target.value })}
                    />
                  </label>
                )}
                <label className="span-2">
                  Bound device ID (optional)
                  <input
                    maxLength={100}
                    placeholder="esp32-lab-01"
                    value={editing.deviceId || ''}
                    onChange={(e) => setEditing({ ...editing, deviceId: e.target.value })}
                  />
                </label>
              </div>
              <p className="small-note">
                Coordinates are relative to the building center. Binding a device allows
                authenticated readings for this sensor. Do not include credentials here.
              </p>
              <Button className="full-width" disabled={busy}>
                <Save size={16} />
                {showAdd ? 'Add sensor' : 'Save sensor mapping'}
              </Button>
            </form>
            {s && (
              <Button
                className="full-width"
                variant="destructive"
                disabled={busy}
                onClick={async () => {
                  if (await mutate({ action: 'delete', sensorId: s.id }, '/sensors', 'POST'))
                    setSelected(null);
                }}
              >
                <Trash2 size={14} /> Remove sensor
              </Button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
