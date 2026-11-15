'use client';
// Studio · Discover: fly the Tello over the site, watch its camera live and save frames. Studio look, Smart Blocks drone.
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BatteryMedium, Sparkles, Camera, ChevronsDown, ChevronsUp, Drone, LoaderCircle,
  MoveVertical, OctagonX, PlaneLanding, PlaneTakeoff, RotateCcw, RotateCw, ScanLine, Thermometer,
} from 'lucide-react';
import { captureSrc, isMove, LABEL, SWEEP_STOPS, useDrone, type Action, type DroneStatus, type Move, type Phase } from './use-drone';

const PILL: Record<Phase, { text: string; tone: string }> = {
  checking: { text: 'Checking', tone: 'idle' }, 'bridge-offline': { text: 'Bridge offline', tone: 'off' },
  searching: { text: 'Looking for drone', tone: 'wait' }, 'no-video': { text: 'Connected · no video', tone: 'wait' },
  test: { text: 'Bridge test mode', tone: 'test' }, live: { text: 'Live', tone: 'live' },
};
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

export function DroneSurvey({ siteName, onContinue, busy = false }: { siteName: string; onContinue?: () => void; busy?: boolean }) {
  const d = useDrone();
  const { status, phase, connected, hasVideo, flying, pending, sweep } = d;
  const locked = !connected || pending !== null || sweep !== null;
  const moveLocked = locked || !flying;
  const pill = PILL[phase];
  const lowBattery = status?.battery != null && status.battery < 20;

  // Move controls fly while held and stop on release. A keyboard "click" (Space or Enter on a
  // focused button) has no release event, so it gives a short nudge instead.
  const holdProps = (move: Move) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => { e.currentTarget.setPointerCapture(e.pointerId); d.hold(move); },
    onPointerUp: () => d.release(move),
    onPointerCancel: () => d.release(move),
    onLostPointerCapture: () => d.release(move),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: (e: React.MouseEvent) => { if (e.detail === 0) { d.hold(move); setTimeout(() => d.release(move), 450); } },
  });

  // A render helper, not a component: a nested component would remount every button (and drop focus) on each poll.
  const key = (action: Action, Icon: typeof ArrowUp, label = '', className = '') => (
    <button type="button" className={`st-dr-key ${className} ${isMove(action) && d.holding.includes(action) ? 'is-held' : ''}`}
      disabled={action === 'takeoff' ? locked || flying : moveLocked}
      {...(isMove(action) ? holdProps(action) : { onClick: () => void d.send(action) })}
      aria-label={LABEL[action]} title={isMove(action) ? `${LABEL[action]} (hold)` : LABEL[action]}>
      {pending === action ? <LoaderCircle className="st-dr-spin" size={16} /> : <Icon size={16} />}
      {label && <span>{label}</span>}
    </button>
  );

  return (
    <>
      <div className="st-dr">
        <div className="st-card st-dr-view">
          <div className="st-dr-head">
            <h3><Drone size={16} /> Live camera</h3>
            <span className={`st-dr-pill tone-${pill.tone}`} role="status" aria-live="polite"><i /> {pill.text}</span>
          </div>
          <div className={`st-dr-stage ${hasVideo && d.frameSeen ? 'has-video' : ''}`}>
            {hasVideo && (
              // MJPEG needs a plain <img>; next/image cannot render a multipart stream.
              // eslint-disable-next-line @next/next/no-img-element
              <img key={d.streamKey} src={`/api/drone/video?s=${d.streamKey}`} alt={`Live camera view from the Tello over ${siteName}`}
                onLoad={() => d.setFrameSeen(true)} onError={() => { d.setFrameSeen(false); d.retryStream(); }} />
            )}
            {!(hasVideo && d.frameSeen) && <StageEmpty phase={phase} status={status} onContinue={onContinue} busy={busy} />}
            {hasVideo && d.frameSeen && (
              <>
                <span className={`st-dr-badge ${phase === 'test' ? 'is-test' : ''}`}><i /> {phase === 'test' ? 'Test pattern · not a camera' : 'Live'}</span>
                {sweep !== null && <span className="st-dr-sweep"><ScanLine size={13} /> Survey {sweep}/{SWEEP_STOPS}</span>}
              </>
            )}
          </div>
          <dl className="st-dr-tele" aria-label="Drone telemetry">
            <div><dt><BatteryMedium size={13} /> Battery</dt><dd className={lowBattery ? 'is-low' : ''}>{status?.battery != null ? `${status.battery}%` : '—'}</dd></div>
            <div><dt><MoveVertical size={13} /> Height</dt><dd>{status?.height != null ? `${status.height} cm` : '—'}</dd></div>
            <div><dt><Thermometer size={13} /> Temperature</dt><dd>{status?.temp != null ? `${status.temp} °C` : '—'}</dd></div>
            <div><dt><Drone size={13} /> Flight</dt><dd>{connected ? (flying ? 'Airborne' : 'Landed') : '—'}</dd></div>
          </dl>
        </div>

        <aside className="st-card st-dr-controls" aria-label="Flight controls">
          <h4>Flight</h4>
          <div className="st-dr-pair">{key('takeoff', PlaneTakeoff, 'Take off', 'wide')}{key('land', PlaneLanding, 'Land', 'wide')}</div>
          <h4>Move</h4>
          <div className="st-dr-dpad">
            {key('forward', ArrowUp, '', 'n')}
            {key('left', ArrowLeft, '', 'w')}
            <button type="button" className="st-dr-key c" disabled={!hasVideo || pending !== null || sweep !== null}
              onClick={() => void d.capture()} aria-label="Capture frame" title="Capture frame (C)">
              {pending === 'capture' ? <LoaderCircle className="st-dr-spin" size={16} /> : <Camera size={16} />}
            </button>
            {key('right', ArrowRight, '', 'e')}
            {key('back', ArrowDown, '', 's')}
          </div>
          <div className="st-dr-pair">
            <div><h4>Height</h4><div className="st-dr-pair">{key('up', ChevronsUp)}{key('down', ChevronsDown)}</div></div>
            <div><h4>Turn</h4><div className="st-dr-pair">{key('ccw', RotateCcw)}{key('cw', RotateCw)}</div></div>
          </div>
          <button type="button" className={`st-btn st-dr-stop ${d.armStop ? 'is-armed' : ''}`} disabled={!connected} onClick={d.stopMotors}
            title="Cuts all motors immediately. The drone will fall.">
            <OctagonX size={14} /> {d.armStop ? 'Press again · drone will drop' : 'Stop motors'}
          </button>
          <p className={`st-dr-msg ${d.message?.error ? 'is-error' : ''}`} role="status" aria-live="polite">
            {d.message?.text || (connected ? (flying ? 'Hold a control to fly; release to hover.' : 'Take off to unlock movement.') : 'Controls unlock once the drone connects.')}
          </p>
          <dl className="st-dr-keys" aria-label="Keyboard shortcuts">
            {([[['W', 'A', 'S', 'D'], 'Move'], [['↑', '↓'], 'Height'], [['Q', 'E'], 'Turn'], [['T', 'L'], 'Take off · Land'], [['C'], 'Capture']] as const).map(([keys, label]) => (
              <div key={label}><dt>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt><dd>{label}</dd></div>
            ))}
          </dl>
        </aside>
      </div>

      <div className="st-card">
        <div className="st-head-row">
          <div>
            <h3>Survey</h3>
            <p className="st-muted st-small">Captures are saved on the demo laptop in <code>captures/</code>. A 360° survey takes one frame every 45° while the drone turns in place.</p>
          </div>
          <div className="st-dr-actions">
            {onContinue && <button type="button" className="st-btn" onClick={onContinue} disabled={busy} title="Skip the survey and generate the three layouts">{busy ? 'Generating…' : 'Next · Generate layouts'} <ArrowRight size={13} /></button>}
            <button type="button" className="st-btn" disabled={!hasVideo || pending !== null || sweep !== null} onClick={() => void d.capture()}><Camera size={13} /> Capture frame</button>
            {sweep === null
              ? <button type="button" className="st-btn primary" disabled={!hasVideo || !flying || pending !== null} onClick={() => void d.runSweep()}
                  title={flying ? 'Turn 360° and capture 8 frames' : 'Take off first'}><ScanLine size={13} /> 360° survey</button>
              : <button type="button" className="st-btn primary" onClick={d.cancelSweep}><LoaderCircle className="st-dr-spin" size={13} /> Cancel · {sweep}/{SWEEP_STOPS}</button>}
          </div>
        </div>
        {d.captures.length ? (
          <ul className="st-dr-captures">
            {d.captures.slice(0, 12).map((c) => (
              <li key={c.url}>
                <a href={captureSrc(c)} target="_blank" rel="noopener">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={captureSrc(c)} alt={`Aerial capture at ${clock(c.time)}`} loading="lazy" />
                  <span>{clock(c.time)}{c.simulated && <span className="st-tag st-tag-simulated">Test pattern</span>}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : <p className="st-muted st-small st-dr-none">{status?.bridge ? 'No captures yet.' : 'Captures appear here once the bridge is running.'}</p>}
      </div>

      <Connection status={status} phase={phase} />
    </>
  );
}

function StageEmpty({ phase, status, onContinue, busy }: { phase: Phase; status: DroneStatus | null; onContinue?: () => void; busy?: boolean }) {
  const copy: Record<Phase, { title: string; body: string }> = {
    checking: { title: 'Checking for the drone', body: 'One moment.' },
    'bridge-offline': { title: 'Drone bridge offline', body: 'Start bridge/server.py on this laptop. Setup is under Connection below.' },
    searching: { title: 'Looking for the Tello', body: status?.error ? 'The bridge is searching this laptop’s Wi-Fi for the drone. Check it’s switched on and that this laptop is on the drone’s own Wi-Fi (TELLO-XXXXXX, or RMTT-XXXXXX with the expansion pack) or on the hotspot the drone joined.' : 'Connecting…' },
    'no-video': { title: 'Connected, waiting for video', body: 'Tello EDUs only stream video on their own TELLO-XXXXXX Wi-Fi, not after joining a router.' },
    test: { title: 'Opening the stream', body: 'One moment.' },
    live: { title: 'Opening the camera', body: 'The first frame usually takes a few seconds.' },
  };
  const c = copy[phase];
  const spinning = phase === 'checking' || phase === 'searching' || phase === 'live' || phase === 'test';
  return (
    <div className="st-dr-empty">
      {spinning ? <LoaderCircle className="st-dr-spin" size={24} /> : <Drone size={28} strokeWidth={1.4} />}
      <b>{c.title}</b>
      <p>{c.body}</p>
      {onContinue && phase !== 'checking' && phase !== 'live' && phase !== 'test' && (
        <button type="button" className="st-btn primary st-dr-next" onClick={onContinue} disabled={busy}
          title="The survey is optional. Generate the three layouts without it.">
          <Sparkles size={14} /> {busy ? 'Generating…' : 'Continue without the drone'} <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}

function Connection({ status, phase }: { status: DroneStatus | null; phase: Phase }) {
  const bridgeOk = !!status?.bridge, droneOk = !!status?.connected, videoOk = phase === 'live' || phase === 'test';
  return (
    <details className="st-card st-dr-conn" open={phase === 'bridge-offline' || phase === 'searching'}>
      <summary>Connection <span aria-hidden="true"><i className={bridgeOk ? 'ok' : ''} /><i className={droneOk ? 'ok' : ''} /><i className={videoOk ? 'ok' : ''} /></span></summary>
      <ul>
        <li><i className={bridgeOk ? 'ok' : ''} /><b>Bridge</b><span>{bridgeOk ? `Running at ${status?.url}${status?.mock ? ' in test mode (--mock)' : ''}` : `Not reachable at ${status?.url || 'http://127.0.0.1:8010'}`}</span></li>
        <li><i className={droneOk ? 'ok' : ''} /><b>Drone</b><span>{status?.mock ? 'No drone: the bridge is simulating one' : droneOk ? `Tello at ${status?.ip}` : status?.error ? status.error : '—'}</span></li>
        <li><i className={videoOk ? 'ok' : ''} /><b>Video</b><span>{phase === 'live' ? 'Streaming from the drone camera' : phase === 'test' ? 'Bridge test pattern, not a camera' : phase === 'no-video' ? 'No frames yet' : '—'}</span></li>
      </ul>
      <div className="st-dr-setup">
        <b>Fly from this laptop</b>
        <ol>
          <li>Power on the Tello and join its TELLO-XXXXXX Wi-Fi (RMTT-XXXXXX with the expansion pack).</li>
          <li><code>pip install -r bridge/requirements.txt</code></li>
          <li><code>python bridge/server.py --drone</code> (serves on port 8010)</li>
        </ol>
        <p>No drone at hand? <code>python bridge/server.py --mock</code> runs the bridge with a labeled test pattern.</p>
      </div>
    </details>
  );
}
