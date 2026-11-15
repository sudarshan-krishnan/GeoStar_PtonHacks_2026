'use client';
// Tello EDU flight state for Studio's Discover step. Same bridge and rules as the Smart Blocks drone view
// (src/components/dashboard-2/drone-discover.tsx): everything comes from bridge/server.py through /api/drone/*,
// nothing is simulated in the browser, and a --mock bridge's frames are labeled as a test pattern.
import { useCallback, useEffect, useRef, useState } from 'react';

export type Action = 'takeoff' | 'land' | 'up' | 'down' | 'left' | 'right' | 'forward' | 'back' | 'cw' | 'ccw' | 'emergency';
export type DroneStatus = {
  bridge: boolean; url: string; connected?: boolean; mock?: boolean; error?: string | null; battery?: number | null;
  height?: number | null; temp?: number | null; flying?: boolean; video?: boolean; ip?: string | null;
};
export type Capture = { url: string; time: number; simulated: boolean };
export type Phase = 'checking' | 'bridge-offline' | 'searching' | 'no-video' | 'test' | 'live';

export const SWEEP_STOPS = 8; // 8 × 45° = one full turn
export const LABEL: Record<Action, string> = {
  takeoff: 'Take off', land: 'Land', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  forward: 'Forward', back: 'Back', cw: 'Turn right', ccw: 'Turn left', emergency: 'Stop motors',
};
// Hold-to-fly: while a move control is held the drone glides at these stick values (of 100) and
// eases to a hover on release. The bridge ramps the speed and stops by itself if updates stop.
export type Move = Exclude<Action, 'takeoff' | 'land' | 'emergency'>;
type Sticks = { right: number; forward: number; up: number; clockwise: number };
const GLIDE = 35, CLIMB = 35, TURN = 45, STICK_MS = 100;
const STICK: Record<Move, Partial<Sticks>> = {
  forward: { forward: GLIDE }, back: { forward: -GLIDE }, right: { right: GLIDE }, left: { right: -GLIDE },
  up: { up: CLIMB }, down: { up: -CLIMB }, cw: { clockwise: TURN }, ccw: { clockwise: -TURN },
};
export const isMove = (a: Action): a is Move => a in STICK;
const KEYS: Record<string, Action> = { w: 'forward', s: 'back', a: 'left', d: 'right', q: 'ccw', e: 'cw', ArrowUp: 'up', ArrowDown: 'down', t: 'takeoff', l: 'land' };

function phaseOf(s: DroneStatus | null): Phase {
  if (!s) return 'checking';
  if (!s.bridge) return 'bridge-offline';
  if (!s.connected) return 'searching';
  if (s.mock) return 'test';
  return s.video ? 'live' : 'no-video';
}

async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/drone/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export const captureSrc = (c: Capture) => `/api/drone${c.url}`;

export function useDrone() {
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
  const held = useRef(new Set<Move>());
  const stickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [holding, setHolding] = useState<Move[]>([]);

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
    return () => { alive = false; clearTimeout(timer); };
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
    return () => { alive = false; };
  }, [status?.bridge]);

  // "Stop motors" needs a second press within 3 s; it drops the drone out of the air.
  useEffect(() => {
    if (!armStop) return;
    const t = setTimeout(() => setArmStop(false), 3000);
    return () => clearTimeout(t);
  }, [armStop]);

  // Hold-to-fly. The held controls add up (forward + turn right = a curve); the sticks are re-sent
  // every STICK_MS, and zeros go out the moment the last control is released.
  const sendSticks = useCallback(() => {
    const sticks: Sticks = { right: 0, forward: 0, up: 0, clockwise: 0 };
    for (const move of held.current)
      for (const [axis, v] of Object.entries(STICK[move])) sticks[axis as keyof Sticks] += v;
    void fetch('/api/drone/rc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sticks), keepalive: true })
      .catch(() => {}); // a lost update is harmless: the next one follows, and silence stops the drone
  }, []);
  const syncHeld = useCallback(() => {
    setHolding([...held.current]);
    sendSticks();
    if (held.current.size && !stickTimer.current) stickTimer.current = setInterval(sendSticks, STICK_MS);
    if (!held.current.size && stickTimer.current) { clearInterval(stickTimer.current); stickTimer.current = null; }
  }, [sendSticks]);
  const hold = useCallback((move: Move) => {
    if (busy.current || held.current.has(move)) return;
    held.current.add(move);
    syncHeld();
  }, [syncHeld]);
  const release = useCallback((move?: Move) => {
    if (move ? !held.current.delete(move) : !held.current.size) return;
    if (!move) held.current.clear();
    syncHeld();
  }, [syncHeld]);
  // Let go of everything when the window loses focus, the drone lands or the page goes away.
  useEffect(() => {
    const drop = () => release();
    window.addEventListener('blur', drop);
    document.addEventListener('visibilitychange', drop);
    return () => { window.removeEventListener('blur', drop); document.removeEventListener('visibilitychange', drop); drop(); };
  }, [release]);
  useEffect(() => { if (!flying) release(); }, [flying, release]);

  const send = useCallback(async (action: Action) => {
    if (action !== 'emergency' && busy.current) return false;
    release(); // a step command (take-off, land, stop) lets go of the sticks first
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
  }, [release]);

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
    release();
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
      setMessage({ text: sweepCancel.current ? 'Survey cancelled' : '360° survey complete' });
    } finally {
      busy.current = false;
      setSweep(null);
    }
  }
  const cancelSweep = () => { sweepCancel.current = true; };

  function stopMotors() {
    if (!armStop) return setArmStop(true);
    setArmStop(false);
    sweepCancel.current = true;
    void send('emergency');
  }

  // Keyboard flying: hold W A S D to move, ↑ ↓ for height, Q E to turn; T take off, L land, C capture.
  useEffect(() => {
    if (!connected) return;
    const keyOf = (e: KeyboardEvent) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = keyOf(e);
      const action = KEYS[key];
      if (action && isMove(action) && flying) e.preventDefault(); // also stops the arrows scrolling while held
      if (e.repeat) return;
      if (key === 'c' && hasVideo) { e.preventDefault(); void capture(); return; }
      if (!action) return;
      if (action !== 'takeoff' && !flying) return;
      e.preventDefault();
      if (isMove(action)) hold(action);
      else void send(action);
    }
    function onKeyUp(e: KeyboardEvent) {
      const action = KEYS[keyOf(e)];
      if (action && isMove(action)) release(action);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
  }, [connected, flying, hasVideo, send, capture, hold, release]);

  return {
    status, phase, connected, hasVideo, flying, pending, message, captures, armStop, sweep, streamKey, frameSeen,
    setFrameSeen, retryStream: () => setTimeout(() => setStreamKey((k) => k + 1), 2000),
    send, capture, runSweep, cancelSweep, stopMotors, hold, release, holding,
  };
}
