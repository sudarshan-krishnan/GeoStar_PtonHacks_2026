'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BatteryMedium,
  Camera,
  ChevronsDown,
  ChevronsUp,
  Drone,
  Leaf,
  LoaderCircle,
  MoveVertical,
  OctagonX,
  PlaneLanding,
  PlaneTakeoff,
  RotateCcw,
  RotateCw,
  ScanLine,
  Thermometer,
} from 'lucide-react';
import { PrimaryCard } from './shell';
import '@/app/dashboard-2/drone.css';

// Design → Discover: fly the Tello EDU from HAVEN and watch its camera live. Everything here
// comes from bridge/server.py via /api/drone/*. Nothing is simulated in the browser; when the
// bridge itself runs with --mock its frames are labeled as a test pattern.

type Action =
  | 'takeoff'
  | 'land'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'forward'
  | 'back'
  | 'cw'
  | 'ccw'
  | 'emergency';

type DroneStatus = {
  bridge: boolean;
  url: string;
  connected?: boolean;
  mock?: boolean;
  error?: string | null;
  battery?: number | null;
  height?: number | null;
  temp?: number | null;
  flying?: boolean;
  video?: boolean;
  ip?: string | null;
};

type Capture = { url: string; time: number; simulated: boolean };

type Phase = 'checking' | 'bridge-offline' | 'searching' | 'no-video' | 'test' | 'live';

const SWEEP_STOPS = 8; // 8 × 45° = one full turn

const LABEL: Record<Action, string> = {
  takeoff: 'Take off',
  land: 'Land',
  up: 'Up 30 cm',
  down: 'Down 30 cm',
  left: 'Left 30 cm',
  right: 'Right 30 cm',
  forward: 'Forward 30 cm',
  back: 'Back 30 cm',
  cw: 'Turn right 45°',
  ccw: 'Turn left 45°',
  emergency: 'Stop motors',
};

const KEYS: Record<string, Action> = {
  w: 'forward',
  s: 'back',
  a: 'left',
  d: 'right',
  q: 'ccw',
  e: 'cw',
  ArrowUp: 'up',
  ArrowDown: 'down',
  t: 'takeoff',
  l: 'land',
};

function phaseOf(s: DroneStatus | null): Phase {
  if (!s) return 'checking';
  if (!s.bridge) return 'bridge-offline';
  if (!s.connected) return 'searching';
  if (s.mock) return 'test';
  return s.video ? 'live' : 'no-video';
}

const PILL: Record<Phase, { text: string; tone: string }> = {
  checking: { text: 'Checking', tone: 'idle' },
  'bridge-offline': { text: 'Bridge offline', tone: 'off' },
  searching: { text: 'Looking for drone', tone: 'wait' },
  'no-video': { text: 'Connected · no video', tone: 'wait' },
  test: { text: 'Bridge test mode', tone: 'test' },
  live: { text: 'Live', tone: 'live' },
};

async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/drone/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

const captureSrc = (c: Capture) => `/api/drone${c.url}`;
const clock = (t: number) =>
  new Date(t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

export function DroneDiscover({
  facility,
  onContinue,
}: {
  facility: { name: string; city: string };
  onContinue: () => void;
}) {
  const [status, setStatus] = useState<DroneStatus | null>(null);
  const [pending, setPending] = useState<Action | 'capture' | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [armStop, setArmStop] = useState(false);
  const [sweep, setSweep] = useState<number | null>(null); // stops completed, null = idle
  const [streamKey, setStreamKey] = useState(0);
  const [frameSeen, setFrameSeen] = useState(false);
  const sweepCancel = useRef(false);
  const busy = useRef(false);

  const phase = phaseOf(status);
  const connected = phase === 'live' || phase === 'test' || phase === 'no-video';
  const hasVideo = phase === 'live' || phase === 'test';
  const flying = !!status?.flying;

  // Poll the bridge. 1.5 s keeps telemetry fresh without flooding the drone's state socket.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const res = await fetch('/api/drone/status', { cache: 'no-store' });
        const next = (await res.json()) as DroneStatus;
        if (alive) setStatus(next);
      } catch {
        if (alive) setStatus({ bridge: false, url: '' });
      }
      if (alive) timer = setTimeout(tick, 1500);
    }
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  // Reopen the MJPEG stream whenever video (re)appears; drop it when it goes away.
  useEffect(() => {
    if (hasVideo) setStreamKey((k) => k + 1);
    else setFrameSeen(false);
  }, [hasVideo]);

  // Earlier captures stored on the bridge.
  useEffect(() => {
    if (!status?.bridge) return;
    let alive = true;
    fetch('/api/drone/snapshots', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Capture[]) => alive && Array.isArray(list) && setCaptures(list))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [status?.bridge]);

  // "Stop motors" needs a second press within 3 s; it drops the drone out of the air.
  useEffect(() => {
    if (!armStop) return;
    const t = setTimeout(() => setArmStop(false), 3000);
    return () => clearTimeout(t);
  }, [armStop]);

  const send = useCallback(
    async (action: Action) => {
      if (action !== 'emergency' && busy.current) return false;
      if (action !== 'emergency') busy.current = true;
      setPending(action);
      setMessage({ text: `${LABEL[action]}…` });
      try {
        await post('command', { action });
        setMessage({ text: `${LABEL[action]} · done` });
        return true;
      } catch (err) {
        setMessage({ text: `${LABEL[action]}: ${(err as Error).message}`, error: true });
        return false;
      } finally {
        if (action !== 'emergency') busy.current = false;
        setPending(null);
      }
    },
    [],
  );

  const capture = useCallback(async (quiet = false) => {
    if (!quiet && busy.current) return false;
    setPending('capture');
    try {
      const shot = await post<Capture>('snapshot');
      setCaptures((list) => [shot, ...list.filter((c) => c.url !== shot.url)]);
      if (!quiet) setMessage({ text: 'Frame saved to the bridge’s captures folder' });
      return true;
    } catch (err) {
      setMessage({ text: `Capture: ${(err as Error).message}`, error: true });
      return false;
    } finally {
      setPending(null);
    }
  }, []);

  async function runSweep() {
    if (busy.current) return;
    busy.current = true;
    sweepCancel.current = false;
    setSweep(0);
    try {
      for (let stop = 0; stop < SWEEP_STOPS; stop++) {
        if (sweepCancel.current) break;
        setMessage({ text: `360° survey · frame ${stop + 1} of ${SWEEP_STOPS}` });
        if (!(await capture(true))) break;
        setSweep(stop + 1);
        if (stop === SWEEP_STOPS - 1 || sweepCancel.current) break;
        setPending('cw');
        try {
          await post('command', { action: 'cw' });
        } catch (err) {
          setMessage({ text: `Survey stopped: ${(err as Error).message}`, error: true });
          break;
        } finally {
          setPending(null);
        }
      }
      if (!sweepCancel.current) setMessage({ text: '360° survey complete' });
      else setMessage({ text: 'Survey cancelled' });
    } finally {
      busy.current = false;
      setSweep(null);
    }
  }

  function stopMotors() {
    if (!armStop) return setArmStop(true);
    setArmStop(false);
    sweepCancel.current = true;
    void send('emergency');
  }

  // Keyboard flying: W A S D move, ↑ ↓ height, Q E turn, T take off, L land, C capture.
  useEffect(() => {
    if (!connected) return;
    function onKey(e: KeyboardEvent) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === 'c' && hasVideo) {
        e.preventDefault();
        void capture();
        return;
      }
      const action = KEYS[key];
      if (!action) return;
      if (action !== 'takeoff' && !flying) return;
      e.preventDefault();
      void send(action);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connected, flying, hasVideo, send, capture]);

  const locked = !connected || pending !== null || sweep !== null;
  const moveLocked = locked || !flying;
  const pill = PILL[phase];
  const lowBattery = status?.battery != null && status.battery < 20;

  // A render helper, not a component: a component declared here would remount every button
  // (and drop keyboard focus) on each status poll.
  const key = (action: Action, Icon: typeof ArrowUp, label = '', className = '') => (
    <button
      type="button"
      className={`dr-key ${className} ${pending === action ? 'is-pending' : ''}`}
      disabled={action === 'takeoff' ? locked || flying : moveLocked}
      onClick={() => void send(action)}
      aria-label={LABEL[action]}
      title={LABEL[action]}
    >
      {pending === action ? <LoaderCircle className="dr-spin" size={17} /> : <Icon size={17} />}
      {label && <span>{label}</span>}
    </button>
  );

  return (
    <PrimaryCard className="dr-discover">
      <div className="d2-card-top">
        <span className="d2-kicker">
          <span /> AERIAL DISCOVERY
        </span>
        <span className={`dr-pill dr-tone-${pill.tone}`} role="status" aria-live="polite">
          <i /> {pill.text}
        </span>
      </div>
      <h1>See the site{'\n'}from above.</h1>
      <p className="d2-lede">
        {facility.name} · {facility.city}
        <br />
        Fly the Tello over the model site and save what the camera sees.
      </p>

      <div className="dr-layout">
        <div className="dr-stage-wrap">
          <div className={`dr-stage ${hasVideo && frameSeen ? 'has-video' : ''}`}>
            {hasVideo && (
              // MJPEG needs a plain <img>; next/image cannot render a multipart stream.
              <img
                key={streamKey}
                src={`/api/drone/video?s=${streamKey}`}
                alt={`Live camera view from the Tello over ${facility.name}`}
                onLoad={() => setFrameSeen(true)}
                onError={() => {
                  setFrameSeen(false);
                  setTimeout(() => setStreamKey((k) => k + 1), 2000);
                }}
              />
            )}
            {!(hasVideo && frameSeen) && <StageEmpty phase={phase} status={status} />}
            {hasVideo && frameSeen && (
              <>
                <span className={`dr-badge ${phase === 'test' ? 'is-test' : ''}`}>
                  <i />{' '}
                  {phase === 'test' ? (
                    <>
                      Test pattern<span className="dr-badge-more"> · not a camera</span>
                    </>
                  ) : (
                    'Live'
                  )}
                </span>
                {sweep !== null && (
                  <span className="dr-sweep-badge">
                    <ScanLine size={13} /> Survey {sweep}/{SWEEP_STOPS}
                  </span>
                )}
              </>
            )}
          </div>
          <dl className="dr-telemetry" aria-label="Drone telemetry">
            <div>
              <dt>
                <BatteryMedium size={14} /> Battery
              </dt>
              <dd className={lowBattery ? 'is-low' : ''}>
                {status?.battery != null ? `${status.battery}%` : '—'}
              </dd>
            </div>
            <div>
              <dt>
                <MoveVertical size={14} /> Height
              </dt>
              <dd>{status?.height != null ? `${status.height} cm` : '—'}</dd>
            </div>
            <div>
              <dt>
                <Thermometer size={14} /> Temp
              </dt>
              <dd>{status?.temp != null ? `${status.temp} °C` : '—'}</dd>
            </div>
            <div>
              <dt>
                <Drone size={14} /> Flight
              </dt>
              <dd>{connected ? (flying ? 'Airborne' : 'Landed') : '—'}</dd>
            </div>
          </dl>
        </div>

        <aside className="dr-controls" aria-label="Flight controls">
          <div className="dr-group">
            <span className="dr-group-title">Flight</span>
            <div className="dr-flight">
              {key('takeoff', PlaneTakeoff, 'Take off', 'dr-primary')}
              {key('land', PlaneLanding, 'Land', 'dr-primary')}
            </div>
          </div>

          <div className="dr-group">
            <span className="dr-group-title">Move</span>
            <div className="dr-dpad">
              {key('forward', ArrowUp, '', 'dr-n')}
              {key('left', ArrowLeft, '', 'dr-w')}
              <button
                type="button"
                className={`dr-key dr-c ${pending === 'capture' ? 'is-pending' : ''}`}
                disabled={!hasVideo || pending !== null || sweep !== null}
                onClick={() => void capture()}
                aria-label="Capture frame"
                title="Capture frame (C)"
              >
                {pending === 'capture' ? <LoaderCircle className="dr-spin" size={18} /> : <Camera size={18} />}
              </button>
              {key('right', ArrowRight, '', 'dr-e')}
              {key('back', ArrowDown, '', 'dr-s')}
            </div>
          </div>

          <div className="dr-group dr-pair">
            <div>
              <span className="dr-group-title">Height</span>
              <div className="dr-row">
                {key('up', ChevronsUp)}
                {key('down', ChevronsDown)}
              </div>
            </div>
            <div>
              <span className="dr-group-title">Turn</span>
              <div className="dr-row">
                {key('ccw', RotateCcw)}
                {key('cw', RotateCw)}
              </div>
            </div>
          </div>

          <button
            type="button"
            className={`dr-stop ${armStop ? 'is-armed' : ''}`}
            disabled={!connected}
            onClick={stopMotors}
            title="Cuts all motors immediately. The drone will fall."
          >
            <OctagonX size={16} />
            {armStop ? 'Press again · drone will drop' : 'Stop motors'}
          </button>

          <p className={`dr-message ${message?.error ? 'is-error' : ''}`} role="status" aria-live="polite">
            {message?.text ||
              (connected
                ? flying
                  ? 'Each press moves 30 cm or turns 45°.'
                  : 'Take off to unlock movement.'
                : 'Controls unlock once the drone connects.')}
          </p>
          <dl className="dr-keys" aria-label="Keyboard shortcuts">
            {[
              [['W', 'A', 'S', 'D'], 'Move'],
              [['↑', '↓'], 'Height'],
              [['Q', 'E'], 'Turn'],
              [['T', 'L'], 'Take off · Land'],
              [['C'], 'Capture'],
            ].map(([keys, label]) => (
              <div key={label as string}>
                <dt>
                  {(keys as string[]).map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </dt>
                <dd>{label as string}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>

      <section className="dr-survey" aria-labelledby="dr-survey-title">
        <div className="dr-survey-head">
          <div>
            <h2 id="dr-survey-title">Survey</h2>
            <p>
              Captures are saved on the demo laptop in <code>captures/</code>. A 360° survey takes
              one frame every 45° while the drone turns in place.
            </p>
          </div>
          <div className="dr-survey-actions">
            <button
              type="button"
              className="d2-back dr-ghost"
              disabled={!hasVideo || pending !== null || sweep !== null}
              onClick={() => void capture()}
            >
              <Camera size={15} /> Capture frame
            </button>
            {sweep === null ? (
              <button
                type="button"
                className="d2-button dr-sweep"
                disabled={!hasVideo || !flying || pending !== null}
                onClick={() => void runSweep()}
                title={flying ? 'Turn 360° and capture 8 frames' : 'Take off first'}
              >
                <ScanLine size={15} /> 360° survey
              </button>
            ) : (
              <button
                type="button"
                className="d2-button dr-sweep"
                onClick={() => {
                  sweepCancel.current = true;
                }}
              >
                <LoaderCircle className="dr-spin" size={15} /> Cancel · {sweep}/{SWEEP_STOPS}
              </button>
            )}
          </div>
        </div>
        {captures.length ? (
          <ul className="dr-captures">
            {captures.slice(0, 12).map((c) => (
              <li key={c.url}>
                <a href={captureSrc(c)} target="_blank" rel="noopener">
                  <img src={captureSrc(c)} alt={`Aerial capture at ${clock(c.time)}`} loading="lazy" />
                  <span>
                    {clock(c.time)}
                    {c.simulated && <em>Test pattern</em>}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dr-captures-empty">
            {status?.bridge ? 'No captures yet.' : 'Captures appear here once the bridge is running.'}
          </p>
        )}
      </section>

      <ConnectionDetails status={status} phase={phase} />

      <div className="d2-form-footer">
        <span>
          <Leaf size={15} /> Live camera and flight controls from the Tello bridge.
        </span>
        <button className="d2-button" onClick={onContinue}>
          Continue to Model <ArrowRight size={16} />
        </button>
      </div>
    </PrimaryCard>
  );
}

function StageEmpty({ phase, status }: { phase: Phase; status: DroneStatus | null }) {
  const copy: Record<Phase, { title: string; body: string }> = {
    checking: { title: 'Checking for the drone', body: 'One moment.' },
    'bridge-offline': {
      title: 'Drone bridge offline',
      body: 'Start bridge/server.py on this laptop. Setup is below.',
    },
    searching: {
      title: 'Looking for the Tello',
      body: status?.error
        ? 'The drone isn’t answering. Check it’s switched on and this laptop is on its TELLO-XXXXXX Wi-Fi.'
        : 'Connecting…',
    },
    'no-video': {
      title: 'Connected, waiting for video',
      body: 'Tello EDUs only stream video on their own TELLO-XXXXXX Wi-Fi, not after joining a router.',
    },
    test: { title: 'Opening the stream', body: 'One moment.' },
    live: { title: 'Opening the camera', body: 'The first frame usually takes a few seconds.' },
  };
  const c = copy[phase];
  const spinning = phase === 'checking' || phase === 'searching' || phase === 'live' || phase === 'test';
  return (
    <div className="dr-empty">
      <span className="dr-empty-icon">
        {spinning ? <LoaderCircle className="dr-spin" size={26} /> : <Drone size={30} strokeWidth={1.4} />}
      </span>
      <b>{c.title}</b>
      <p>{c.body}</p>
    </div>
  );
}

function ConnectionDetails({ status, phase }: { status: DroneStatus | null; phase: Phase }) {
  const bridgeOk = !!status?.bridge;
  const droneOk = !!status?.connected;
  const videoOk = phase === 'live' || phase === 'test';
  return (
    <details className="dr-connection" open={phase === 'bridge-offline' || phase === 'searching'}>
      <summary>
        Connection
        <span className="dr-conn-dots" aria-hidden="true">
          <i className={bridgeOk ? 'ok' : ''} />
          <i className={droneOk ? 'ok' : ''} />
          <i className={videoOk ? 'ok' : ''} />
        </span>
      </summary>
      <ul className="dr-conn-list">
        <li>
          <i className={bridgeOk ? 'ok' : ''} />
          <b>Bridge</b>
          <span>
            {bridgeOk
              ? `Running at ${status?.url}${status?.mock ? ' in test mode (--mock)' : ''}`
              : `Not reachable at ${status?.url || 'http://127.0.0.1:8010'}`}
          </span>
        </li>
        <li>
          <i className={droneOk ? 'ok' : ''} />
          <b>Drone</b>
          <span>
            {status?.mock
              ? 'No drone: the bridge is simulating one'
              : droneOk
                ? `Tello at ${status?.ip}`
                : status?.error
                  ? `Not answering at ${status?.ip || '192.168.10.1'}`
                  : '—'}
          </span>
        </li>
        <li>
          <i className={videoOk ? 'ok' : ''} />
          <b>Video</b>
          <span>
            {phase === 'live'
              ? 'Streaming from the drone camera'
              : phase === 'test'
                ? 'Bridge test pattern, not a camera'
                : phase === 'no-video'
                  ? 'No frames yet'
                  : '—'}
          </span>
        </li>
      </ul>
      <div className="dr-setup">
        <b>Fly from this laptop</b>
        <ol>
          <li>Power on the Tello and join its TELLO-XXXXXX Wi-Fi.</li>
          <li>
            <code>pip install -r bridge/requirements.txt</code>
          </li>
          <li>
            <code>python bridge/server.py</code> (serves on port 8010)
          </li>
        </ol>
        <p>
          No drone at hand? <code>python bridge/server.py --mock</code> runs the bridge with a
          labeled test pattern.
        </p>
      </div>
    </details>
  );
}
