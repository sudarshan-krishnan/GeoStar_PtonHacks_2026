'use client';
// Live hardware for any deployed project's Command Center. One physical model (ESP32 + UNO R4
// console) is connected to one project at a time: that project shows every reading and response
// live; any other project shows where the kit is and a button to connect it there. Deploying a
// project connects the kit automatically. Data comes from /api/hardware, which reads the SiteStar
// PROTECT service on the laptop wired to the boards.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Facility } from '@/lib/haven/engine';
import { hardwareCopy } from '@/lib/hardware/copy';
import s from './live-hardware.module.css';

type Hw = {
  online: boolean;
  at?: number;
  live?: Record<string, number | boolean | string | null>;
  power?: {
    it_w: number | null; it_measured: boolean; it_source: string | null; fan: number; fan_w: number;
    total_w: number | null; jobs_running: number | null; jobs_total: number | null;
    grid: { state: 'normal' | 'requested' | 'active'; depth: number; typed: string;
      result: { before_w: number; during_w: number; cut_pct: number; minutes: number } | null };
    history: [number, number][];
  };
  incidents?: { id: string; kind: string; title: string; room: string; severity: string; status: string; started: number }[];
  agent?: { mode: string | null; pending: string[]; trace: { t: number; who: string; text: string }[] };
  badge?: { uid: string; role: string; t: number; result: string } | null;
  messages?: { t: number; dir: string; text: string }[];
  boards?: { esp32: boolean; console: boolean };
  facilityId?: string | null;
  linked?: { id: string; name: string; type: string | null; by: string | null; error: string | null } | null;
};

const fmt = (v: unknown, d = 1) => (typeof v === 'number' ? v.toFixed(d) : '--');
const hhmm = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function Spark({ points }: { points: [number, number][] }) {
  if (points.length < 2) return <svg className={s.spark} viewBox="0 0 300 64" aria-hidden="true" />;
  const ws = points.map((p) => p[1]);
  const lo = Math.min(...ws) * 0.92, hi = Math.max(...ws) * 1.04 || 1;
  const t0 = points[0][0], t1 = points[points.length - 1][0];
  const xy = points.map(([t, w]) => [300 * (t - t0) / Math.max(1, t1 - t0), 60 - 54 * (w - lo) / Math.max(0.1, hi - lo)]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg className={s.spark} viewBox="0 0 300 64" preserveAspectRatio="none" aria-label="Power over the last minutes">
      <polygon points={`0,64 ${line} 300,64`} className={s.sparkFill} />
      <polyline points={line} className={s.sparkLine} />
    </svg>
  );
}

function Fan({ level }: { level: number }) {
  const dur = level > 0.02 ? `${Math.max(0.25, 2.2 - level * 2)}s` : '0s';
  return (
    <svg viewBox="0 0 40 40" className={s.fan} style={{ animationDuration: dur, animationPlayState: level > 0.02 ? 'running' : 'paused' }} aria-hidden="true">
      {[0, 120, 240].map((a) => (
        <path key={a} d="M20 20 C 22 9, 31 8, 30 15 C 29 19, 24 20, 20 20 Z" transform={`rotate(${a} 20 20)`} />
      ))}
      <circle cx="20" cy="20" r="3.2" />
    </svg>
  );
}

function Card({ title, tag, children, tone }: { title: string; tag?: string; children: React.ReactNode; tone?: 'alert' | 'warn' | 'ok' }) {
  return (
    <div className={`${s.card} ${tone ? s[tone] : ''}`}>
      <div className={s.cardHead}><span>{title}</span>{tag && <em>{tag}</em>}</div>
      {children}
    </div>
  );
}

export function LiveHardware({ facility }: { facility: Facility }) {
  const [hw, setHw] = useState<Hw | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [depth, setDepth] = useState(40);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const copy = hardwareCopy(facility.type);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/hardware', { cache: 'no-store' });
      setHw(await r.json());
    } catch {
      setHw({ online: false });
    }
  }, []);
  useEffect(() => {
    void load();
    timer.current = setInterval(load, 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  const act = async (action: string) => {
    setBusy(action);
    setErr('');
    try {
      const project = { id: facility.id, name: facility.name, city: facility.city, type: facility.type };
      const r = await fetch('/api/hardware', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, depth, project }),
      });
      if (!r.ok) setErr(((await r.json().catch(() => ({}))) as { error?: string }).error || 'The hardware did not respond.');
      await load();
    } catch {
      setErr('The hardware did not respond.');
    } finally {
      setBusy('');
    }
  };

  if (!hw) return null;

  if (!hw.online)
    return (
      <section className={`${s.panel} ${s.compact}`} aria-label="Live hardware">
        <div className={s.head}><h2>Live hardware</h2><span className={s.offline}>offline</span></div>
        <p className={s.muted}>
          The physical model isn’t streaming. Start SiteStar PROTECT on the laptop wired to the boards, and this
          project’s live readings and responses appear here.
        </p>
      </section>
    );

  const here = hw.linked?.id === facility.id;
  if (!here)
    return (
      <section className={`${s.panel} ${s.compact}`} aria-label="Live hardware">
        <div className={s.head}>
          <h2>Live hardware</h2>
          <span className={s.linked}>{hw.linked ? `connected to ${hw.linked.name}` : 'not connected'}</span>
        </div>
        <p className={s.muted}>
          {hw.linked
            ? `The physical model is streaming into ${hw.linked.name}. Connect it here to run ${facility.name} on the real sensors: leak and valve, temperature and humidity, ventilation, occupancy, card approvals and the AI incident commander.`
            : `The physical model is online but not connected to a project yet. Connect it to run ${facility.name} on the real sensors.`}
        </p>
        <div className={s.controls}>
          <button onClick={() => void act('link')} disabled={!!busy}>
            {busy === 'link' ? 'Connecting…' : `Connect the physical model here`}
          </button>
          {err && <span className={s.error}>{err}</span>}
        </div>
      </section>
    );

  const L = hw.live ?? {}, P = hw.power, G = P?.grid, active = hw.incidents?.filter((i) => i.status === 'active') ?? [];
  const dc = copy.dataCenter && !!P && !!G;
  const fan = typeof P?.fan === 'number' ? P.fan : typeof L.fan === 'number' ? L.fan : 0;
  const leak = L.leak_wet === true, smoke = L.smoke === true;
  const vsw = L.valve_switch_confirms_shut;
  const hot = typeof L.mech_temp_c === 'number' && L.mech_temp_c >= 31;
  const humid = active.some((i) => i.kind === 'humidity_spike');
  const pending = hw.agent?.pending?.filter(Boolean) ?? [];
  const cooling = P?.it_w ? (P.fan_w / P.it_w) * 100 : null;
  const fanTag = smoke ? 'fire mode: off' : hot ? 'overheat: full' : humid ? 'drying: full'
    : dc && G?.state === 'active' ? 'grid: slowed' : 'normal';

  return (
    <section className={s.panel} aria-label="Live hardware">
      <div className={s.head}>
        <h2>Live hardware <small>· {facility.name} physical model</small></h2>
        <span className={s.live}><i />LIVE</span>
      </div>

      <div className={s.grid}>
        {dc && P && G && (
          <Card title="Data hall power" tag={P.it_measured ? 'measured' : 'no reading'} tone={G.state === 'active' ? 'ok' : undefined}>
            <div className={s.big}>{fmt(P.total_w)}<span> W</span></div>
            <Spark points={P.history} />
            <div className={s.rows}>
              <div><span>Servers (laptop)</span><b>{fmt(P.it_w)} W</b></div>
              <div><span>Cooling fan <i>estimated</i></span><b>{fmt(P.fan_w, 2)} W</b></div>
            </div>
          </Card>
        )}

        {dc && P && G && (
          <Card title="Grid event" tag={G.state === 'active' ? `cutting ${G.depth}%` : G.state === 'requested' ? 'awaiting approval' : 'grid normal'}
            tone={G.state === 'active' ? 'alert' : G.state === 'requested' ? 'warn' : undefined}>
            <div className={s.big}>{G.state === 'normal' ? `${depth}%` : `${G.depth}%`}<span> cut</span></div>
            <div className={s.rows}>
              <div><span>Flexible AI jobs running</span><b>{P.jobs_running ?? '--'} / {P.jobs_total ?? '--'}</b></div>
              {G.result && <div><span>Last event</span><b>{G.result.before_w} → {G.result.during_w} W (−{G.result.cut_pct}%)</b></div>}
            </div>
            {G.state === 'normal' && (
              <div className={s.controls}>
                <input type="range" min={10} max={90} step={5} value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="Cut depth" />
                <button onClick={() => void act('grid-start')} disabled={!!busy}>Start grid event</button>
              </div>
            )}
            {G.state === 'requested' && (
              <div className={s.controls}>
                <span className={s.hint}>Tap the manager card on the reader, or</span>
                <button onClick={() => void act('approve')} disabled={!!busy}>Approve</button>
                <button className={s.ghost} onClick={() => void act('decline')} disabled={!!busy}>Decline</button>
              </div>
            )}
            {G.state === 'active' && (
              <div className={s.controls}>
                <span className={s.hint}>Push the joystick to change the cut live</span>
                <button onClick={() => void act('grid-end')} disabled={!!busy}>End event</button>
              </div>
            )}
          </Card>
        )}

        <Card title={copy.leak.title} tag={leak ? 'LEAK' : copy.leak.okTag} tone={leak ? 'alert' : 'ok'}>
          <div className={s.rows}>
            <div><span>Leak sensor</span><b className={leak ? s.red : s.green}>{leak ? 'WET' : 'dry'}</b></div>
            <div><span>Shutoff valve</span><b className={L.valve_open ? s.green : s.red}>{L.valve_open ? 'OPEN' : 'SHUT'}</b></div>
            <div><span>Valve switch</span><b>{vsw === true ? 'confirms shut ✓' : vsw === false && !L.valve_open ? 'NOT SHUT ✗' : L.valve_open ? 'open' : '--'}</b></div>
            <div><span>Alarm</span><b className={L.buzz ? s.red : undefined}>{L.buzz ? 'sounding' : 'quiet'}</b></div>
            <div><span>Water saved</span><b>{typeof L.water_saved_l === 'number' && L.water_saved_l >= 1 ? `${Math.round(L.water_saved_l)} L` : '--'}</b></div>
          </div>
        </Card>

        <Card title={copy.climate.title} tag={copy.climate.tag} tone={hot ? 'alert' : humid ? 'warn' : undefined}>
          <div className={s.pair}>
            <div><div className={s.big}>{fmt(L.mech_temp_c)}<span> °C</span></div><span className={s.muted}>temperature · alarm at 31</span></div>
            <div><div className={s.big}>{fmt(L.mech_rh_pct, 0)}<span> %</span></div><span className={s.muted}>humidity · spike +12</span></div>
          </div>
        </Card>

        <Card title={copy.fan.title} tag={fanTag} tone={smoke ? 'alert' : hot || humid ? 'warn' : undefined}>
          <div className={s.fanRow}>
            <Fan level={fan} />
            <div className={s.big}>{Math.round(fan * 100)}<span>% fan</span></div>
          </div>
          <div className={s.bar}><i style={{ width: `${Math.round(fan * 100)}%` }} /></div>
          {dc && (
            <div className={s.rows}>
              <div><span>Cooling vs servers</span><b>{cooling == null ? '--' : `${cooling.toFixed(1)}%`}</b></div>
            </div>
          )}
        </Card>

        <Card title={copy.people.title} tag="PIR" tone={L.lounge_occupied ? 'warn' : undefined}>
          <div className={s.big}>{L.lounge_occupied ? 'Occupied' : 'Empty'}</div>
          <span className={s.muted}>{L.lounge_occupied ? copy.people.occupied : copy.people.empty}</span>
        </Card>

        <Card title="Human approval" tag="RFID" tone={pending.length ? 'warn' : undefined}>
          {pending.length ? (
            <>
              <div className={s.mid}>Waiting for the manager</div>
              <span className={s.muted}>{pending[pending.length - 1]}</span>
              {G?.state !== 'requested' && (
                <div className={s.controls}>
                  <span className={s.hint}>Tap the manager card, or</span>
                  <button onClick={() => void act('approve')} disabled={!!busy}>Approve</button>
                  <button className={s.ghost} onClick={() => void act('decline')} disabled={!!busy}>Decline</button>
                </div>
              )}
            </>
          ) : (
            <div className={s.mid}>Nothing waiting</div>
          )}
          <div className={s.rows}>
            <div><span>Last card</span><b>{hw.badge ? `${hw.badge.role === 'manager' ? 'manager' : 'other'} · ${hhmm(hw.badge.t)}` : '--'}</b></div>
            {hw.badge && <div><span>Result</span><b>{hw.badge.result}</b></div>}
          </div>
        </Card>

        <Card title="AI incident commander" tag={hw.agent?.mode === 'offline' ? 'offline playbook' : hw.agent?.mode ? `Claude · ${hw.agent.mode}` : ''}>
          {active.length ? active.slice(0, 2).map((i) => (
            <div key={i.id} className={s.incident}><b>{i.title}</b> · {i.room}</div>
          )) : <div className={s.mid}>All clear</div>}
          <ul className={s.trace}>
            {(hw.agent?.trace ?? []).slice(-3).map((t, k) => <li key={k}><span>{hhmm(t.t)}</span> {t.text}</li>)}
          </ul>
          {hw.messages?.length ? (
            <div className={s.msg}>
              <span>Latest to the manager · {hhmm(hw.messages[hw.messages.length - 1].t)}</span>
              {hw.messages[hw.messages.length - 1].text}
            </div>
          ) : null}
        </Card>
      </div>

      {hw.linked?.error && (
        <div className={s.note}>
          Readings are live, but the last event didn’t reach this project’s incident timeline: {hw.linked.error}
        </div>
      )}

      <div className={s.foot}>
        <span className={hw.boards?.esp32 ? s.on : s.off}>ESP32 sensors</span>
        <span className={hw.boards?.console ? s.on : s.off}>Operator console</span>
        {dc && <span>Servers: {P?.it_source ?? '--'}</span>}
        {dc && <span>Fan watts are estimated from its speed (fan law)</span>}
        {hw.linked?.by === 'deploy' && <span>Connected when this project was deployed</span>}
      </div>
    </section>
  );
}
