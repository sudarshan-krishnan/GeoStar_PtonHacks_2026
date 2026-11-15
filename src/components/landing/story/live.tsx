'use client';
// Live hardware for the Protect act. The physical model on the demo table (an ESP32 data hall with
// real sensors, a coolant valve and a cooling fan, plus an UNO R4 operator console) streams through
// /api/hardware. When it is connected the act stops simulating and shows the real thing.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BadgeCheck, Bot, Droplets, Fan as FanIcon, Thermometer, Users, Zap } from 'lucide-react';
import s from './live.module.css';

export type Hardware = {
  online: boolean;
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
};

/** Polls the hardware bridge once a second. null until the first answer. */
export function useHardware() {
  const [hw, setHw] = useState<Hardware | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
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
  return [hw, load] as const;
}

const fmt = (v: unknown, d = 1) => (typeof v === 'number' ? v.toFixed(d) : '--');
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function Spark({ points }: { points: [number, number][] }) {
  if (points.length < 2) return <svg className={s.spark} viewBox="0 0 300 60" aria-hidden="true" />;
  const ws = points.map((p) => p[1]);
  const lo = Math.min(...ws) * 0.9, hi = Math.max(...ws) * 1.05 || 1;
  const t0 = points[0][0], t1 = points[points.length - 1][0];
  const line = points
    .map(([t, w]) => `${(300 * (t - t0) / Math.max(1, t1 - t0)).toFixed(1)},${(56 - 50 * (w - lo) / Math.max(0.1, hi - lo)).toFixed(1)}`)
    .join(' ');
  return (
    <svg className={s.spark} viewBox="0 0 300 60" preserveAspectRatio="none" aria-label="Power over the last minutes">
      <polygon points={`0,60 ${line} 300,60`} className={s.sparkFill} />
      <polyline points={line} className={s.sparkLine} />
    </svg>
  );
}

function Card({ icon, title, tag, tone, children }: { icon: ReactNode; title: string; tag?: string; tone?: 'alert' | 'warn' | 'ok'; children: ReactNode }) {
  return (
    <div className={`ps-glass-dark ${s.card} ${tone ? s[tone] : ''}`}>
      <div className={s.cardHead}><span>{icon}{title}</span>{tag && <em>{tag}</em>}</div>
      {children}
    </div>
  );
}

export function LivePanel({ hw, reload }: { hw: Hardware | null; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState('');
  const [depth, setDepth] = useState(40);
  if (!hw) return null;
  if (!hw.online) {
    return (
      <div className={`ps-glass-dark ${s.offline}`}>
        <span className={s.off} /> The physical model is not connected, so the building above is a simulation.
        Start GeoStar PROTECT on the demo laptop and this act goes live.
      </div>
    );
  }

  const act = async (action: string) => {
    setBusy(action);
    try {
      await fetch('/api/hardware', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, depth }) });
      await reload();
    } finally {
      setBusy('');
    }
  };

  const L = hw.live ?? {}, P = hw.power!, G = P.grid;
  const active = hw.incidents?.filter((i) => i.status === 'active') ?? [];
  const leak = L.leak_wet === true, smoke = L.smoke === true;
  const vsw = L.valve_switch_confirms_shut;
  const hot = typeof L.mech_temp_c === 'number' && L.mech_temp_c >= 31;
  const humid = active.some((i) => i.kind === 'humidity_spike');
  const pending = hw.agent?.pending?.filter(Boolean) ?? [];
  const last = hw.messages?.[hw.messages.length - 1];
  const fanDur = P.fan > 0.02 ? `${Math.max(0.25, 2.2 - P.fan * 2)}s` : '0s';

  return (
    <div className={s.live}>
      <header className={s.head}>
        <span className={s.eyebrow}><i className={s.dot} />Live · the model on the table</span>
        <h3>This part is not a simulation. <em>Touch it.</em></h3>
        <p>
          Every number below comes from the physical data hall in front of you: real sensors, a coolant valve,
          a cooling fan, and a manager’s card that has to approve anything costly.
        </p>
      </header>

      <div className={s.grid}>
        <Card icon={<Zap size={14} />} title="Data hall power" tag={P.it_measured ? 'measured' : 'no reading'} tone={G.state === 'active' ? 'ok' : undefined}>
          <div className={s.big}>{fmt(P.total_w)}<span>W</span></div>
          <Spark points={P.history} />
          <dl className={s.rows}>
            <div><dt>Servers (laptop chip)</dt><dd>{fmt(P.it_w)} W</dd></div>
            <div><dt>Cooling fan <i>estimated</i></dt><dd>{fmt(P.fan_w, 2)} W</dd></div>
          </dl>
        </Card>

        <Card icon={<Zap size={14} />} title="Grid event"
          tag={G.state === 'active' ? `cutting ${G.depth}%` : G.state === 'requested' ? 'awaiting approval' : 'grid normal'}
          tone={G.state === 'active' ? 'alert' : G.state === 'requested' ? 'warn' : undefined}>
          <div className={s.big}>{G.state === 'normal' ? depth : G.depth}<span>% cut</span></div>
          <dl className={s.rows}>
            <div><dt>Flexible AI jobs running</dt><dd>{P.jobs_running ?? '--'} / {P.jobs_total ?? '--'}</dd></div>
            {G.result && <div><dt>Last event</dt><dd>{G.result.before_w} → {G.result.during_w} W (−{G.result.cut_pct}%)</dd></div>}
          </dl>
          {G.state === 'normal' && (
            <div className={s.controls}>
              <input type="range" min={10} max={90} step={5} value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="Cut depth" />
              <button type="button" className={s.btn} onClick={() => void act('grid-start')} disabled={!!busy}>Start grid event</button>
            </div>
          )}
          {G.state === 'requested' && (
            <div className={s.controls}>
              <small>Tap the manager card, or</small>
              <button type="button" className={s.btn} onClick={() => void act('approve')} disabled={!!busy}>Approve</button>
              <button type="button" className={s.ghost} onClick={() => void act('decline')} disabled={!!busy}>Decline</button>
            </div>
          )}
          {G.state === 'active' && (
            <div className={s.controls}>
              <small>Push the joystick to change the cut live</small>
              <button type="button" className={s.btn} onClick={() => void act('grid-end')} disabled={!!busy}>End event</button>
            </div>
          )}
        </Card>

        <Card icon={<FanIcon size={14} />} title="Cooling"
          tag={smoke ? 'fire mode: off' : hot ? 'hot aisle: full' : humid ? 'drying: full' : G.state === 'active' ? 'grid: slowed' : 'normal'}
          tone={smoke ? 'alert' : hot || humid ? 'warn' : undefined}>
          <div className={s.fanRow}>
            <svg viewBox="0 0 40 40" className={s.fan} style={{ animationDuration: fanDur, animationPlayState: P.fan > 0.02 ? 'running' : 'paused' }} aria-hidden="true">
              {[0, 120, 240].map((a) => <path key={a} d="M20 20 C 22 9, 31 8, 30 15 C 29 19, 24 20, 20 20 Z" transform={`rotate(${a} 20 20)`} />)}
              <circle cx="20" cy="20" r="3.2" />
            </svg>
            <div className={s.big}>{Math.round(P.fan * 100)}<span>% fan</span></div>
          </div>
          <div className={s.bar}><i style={{ width: `${Math.round(P.fan * 100)}%` }} /></div>
          <dl className={s.rows}><div><dt>Speed follows heat, humidity and the grid</dt><dd /></div></dl>
        </Card>

        <Card icon={<Thermometer size={14} />} title="Hot aisle" tone={hot ? 'alert' : humid ? 'warn' : undefined} tag={hot ? 'overheating' : humid ? 'humidity spike' : 'normal'}>
          <div className={s.pair}>
            <div><div className={s.big}>{fmt(L.mech_temp_c)}<span>°C</span></div><small>alarm at 31</small></div>
            <div><div className={s.big}>{fmt(L.mech_rh_pct, 0)}<span>%</span></div><small>humidity</small></div>
          </div>
        </Card>

        <Card icon={<Droplets size={14} />} title="Coolant loop" tag={leak ? 'LEAK' : 'dry'} tone={leak ? 'alert' : 'ok'}>
          <dl className={s.rows}>
            <div><dt>Leak sensor</dt><dd className={leak ? s.bad : s.good}>{leak ? 'WET' : 'dry'}</dd></div>
            <div><dt>Shutoff valve</dt><dd className={L.valve_open ? s.good : s.bad}>{L.valve_open ? 'OPEN' : 'SHUT'}</dd></div>
            <div><dt>Valve switch</dt><dd>{vsw === true ? 'confirms shut' : vsw === false && !L.valve_open ? 'NOT shut' : L.valve_open ? 'open' : '--'}</dd></div>
            <div><dt>Water saved</dt><dd>{typeof L.water_saved_l === 'number' && L.water_saved_l >= 1 ? `${Math.round(L.water_saved_l)} L` : '--'}</dd></div>
          </dl>
        </Card>

        <Card icon={<Users size={14} />} title="People in the hall" tone={L.lounge_occupied ? 'warn' : undefined} tag="motion sensor">
          <div className={s.mid}>{L.lounge_occupied ? 'Occupied' : 'Empty'}</div>
          <small>{L.lounge_occupied ? 'HAVEN adds evacuation steps to any alarm.' : 'No one detected near the racks.'}</small>
        </Card>

        <Card icon={<BadgeCheck size={14} />} title="Human approval" tone={pending.length ? 'warn' : undefined} tag="manager card">
          {pending.length ? (
            <>
              <div className={s.mid}>Waiting for the manager</div>
              <small>{pending[pending.length - 1]}</small>
              {G.state !== 'requested' && (
                <div className={s.controls}>
                  <small>Tap the card, or</small>
                  <button type="button" className={s.btn} onClick={() => void act('approve')} disabled={!!busy}>Approve</button>
                  <button type="button" className={s.ghost} onClick={() => void act('decline')} disabled={!!busy}>Decline</button>
                </div>
              )}
            </>
          ) : (
            <div className={s.mid}>Nothing waiting</div>
          )}
          <dl className={s.rows}>
            <div><dt>Last card</dt><dd>{hw.badge ? `${hw.badge.role === 'manager' ? 'manager' : 'other'} · ${clock(hw.badge.t)}` : '--'}</dd></div>
          </dl>
        </Card>

        <Card icon={<Bot size={14} />} title="HAVEN on this model" tag={hw.agent?.mode === 'offline' ? 'rule playbook' : hw.agent?.mode ? `Claude · ${hw.agent.mode}` : ''}>
          <div className={s.mid}>{active.length ? active.slice(0, 2).map((i) => i.title).join(' · ') : 'All clear'}</div>
          <ul className={s.trace}>
            {(hw.agent?.trace ?? []).slice(-2).map((t, k) => <li key={k}><span>{clock(t.t)}</span> {t.text}</li>)}
          </ul>
          {last && <p className={s.msg}><span>To the manager · {clock(last.t)}</span>{last.text}</p>}
        </Card>
      </div>

      <footer className={s.foot}>
        <span className={hw.boards?.esp32 ? s.on : s.offDot}>Sensor board</span>
        <span className={hw.boards?.console ? s.on : s.offDot}>Operator console</span>
        <span>Servers: {P.it_source ?? '--'}</span>
        <span>Fan watts are estimated from its speed</span>
      </footer>
    </div>
  );
}
