'use client';
// The three acts of the GeoStar story, plus HAVEN. Each act has one interaction that proves its point:
// Find re-ranks parcels as you change priorities, Design finalizes into files, Protect simulates a leak,
// and HAVEN replays how its agents talk to different people.
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Component, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, Box, Check, Droplets, FileCode2, Flame, Lock, RotateCcw, ScanEye, ShieldCheck, Waves, Zap } from 'lucide-react';
import { AGENTS, ALERTS, SENSORS, TYPES, score, type Audience, type Sensor, type TypeStory } from './data';
import { LivePanel, useHardware } from './live';
import liveCss from './live.module.css';

const ConceptModel = dynamic(() => import('@/components/dashboard-2/concepts/concept-model'), {
  ssr: false,
  loading: () => <div className="ps-model-wait">Sketching the concept…</div>,
});

/** True once the element has come within a screen of the viewport, so heavy work can wait. */
function useNear<T extends Element>(margin = '60% 0px') {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setNear(true), io.disconnect()), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return [ref, near] as const;
}

/** Same, but tracks whether it is on screen right now. */
function useOnScreen<T extends Element>(threshold = 0.35) {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, on] as const;
}

function ActHead({ n, label, title, lede, light = false }: { n: string; label: string; title: ReactNode; lede: string; light?: boolean }) {
  return (
    <header className={`ps-act-head ${light ? 'light' : ''}`}>
      <p className="ps-eyebrow" data-reveal><b>Act {n}</b><i />{label}</p>
      <h2 data-reveal>{title}</h2>
      <p className="ps-act-lede" data-reveal>{lede}</p>
    </header>
  );
}

export function TypeChips({ type, onType, light = false }: { type: TypeStory; onType: (id: TypeStory['id']) => void; light?: boolean }) {
  return (
    <div className={`ps-chips ${light ? 'light' : ''}`} role="radiogroup" aria-label="Project type">
      {TYPES.map((t) => (
        <button key={t.id} type="button" role="radio" aria-checked={t.id === type.id} className="ps-chip" onClick={() => onType(t.id)}>{t.short}</button>
      ))}
    </div>
  );
}

/* ================================================================ Act I · Find */

export function Find({ type, onType }: { type: TypeStory; onType: (id: TypeStory['id']) => void }) {
  const [weights, setWeights] = useState<Record<string, Record<string, number>>>({});
  const factors = type.factors.map((f) => ({ ...f, weight: weights[type.id]?.[f.id] ?? f.weight }));
  const ranked = type.sites.map((s) => ({ s, v: score(s, factors) })).sort((a, b) => b.v - a.v);
  const rank = Object.fromEntries(ranked.map((r, i) => [r.s.id, i]));
  const best = ranked[0];
  const reasons = [...factors].sort((a, b) => b.weight * (best.s.scores[b.id] ?? 0) - a.weight * (best.s.scores[a.id] ?? 0)).slice(0, 2);
  const changed = !!weights[type.id];

  const setW = (id: string, v: number) => setWeights((w) => ({ ...w, [type.id]: { ...(w[type.id] ?? {}), [id]: v } }));
  const reset = () => setWeights(({ [type.id]: _, ...rest }) => rest);

  return (
    <section id="find" data-chapter className="ps-act ps-act-find" aria-labelledby="find-title">
      <div className="ps-wrap ps-split">
        <div className="ps-split-copy">
          <ActHead
            n="I"
            label="Find"
            title={<span id="find-title">The best site depends on <em>what you are building.</em></span>}
            lede="A data center lives or dies on power and water. A family home lives on schools, parks and the walk to the river. GeoStar weighs the factors that matter for your project and shows you why a parcel wins."
          />
          <ul className="ps-facts" data-reveal>
            <li><b>Real parcels</b><span>CoStar parcels and Vexcel aerials, not guesses.</span></li>
            <li><b>Public record</b><span>Grid, flood, water stress, schools and homes.</span></li>
            <li><b>No black box</b><span>Every score shows the factors behind it.</span></li>
          </ul>
        </div>

        <div className="ps-neu ps-rank" data-reveal>
          <div className="ps-rank-top">
            <TypeChips type={type} onType={onType} />
          </div>
          <p className="ps-rank-q">{type.question}</p>

          <div className="ps-rank-body">
            <fieldset className="ps-weights">
              <legend>How much does each factor matter?</legend>
              {factors.map((f) => (
                <label key={f.id} className="ps-weight">
                  <span className="ps-weight-l"><b>{f.label}</b><small>{f.hint}</small></span>
                  <input
                    type="range" min={0} max={10} step={1} value={f.weight}
                    onChange={(e) => setW(f.id, Number(e.target.value))}
                    style={{ '--v': `${f.weight * 10}%` } as CSSProperties}
                    aria-valuetext={`${f.weight} of 10`}
                  />
                  <output>{f.weight}</output>
                </label>
              ))}
              <button type="button" className="ps-link" onClick={reset} disabled={!changed}><RotateCcw size={13} /> Reset priorities</button>
            </fieldset>

            <div className="ps-results">
              <div className="ps-best" aria-live="polite">
                <Ring value={best.v} />
                <div>
                  <small>Best fit</small>
                  <b>{best.s.name}</b>
                  <span>{best.s.place}</span>
                </div>
              </div>
              <p className="ps-why">Wins on <b>{reasons[0].label.toLowerCase()}</b> and <b>{reasons[1].label.toLowerCase()}</b>.</p>
              <ol className="ps-board" aria-label="Parcels ranked">
                {type.sites.map((s) => {
                  const v = ranked.find((r) => r.s.id === s.id)!.v;
                  return (
                    <li key={s.id} style={{ '--r': rank[s.id] } as CSSProperties} className={rank[s.id] === 0 ? 'lead' : ''}>
                      <span className="ps-board-n">{rank[s.id] + 1}</span>
                      <span className="ps-board-name"><b>{s.name}</b><small>{s.place}</small></span>
                      <span className="ps-board-bar"><i style={{ width: `${v}%` }} /></span>
                      <span className="ps-board-v">{v}</span>
                    </li>
                  );
                })}
              </ol>
              <p className="ps-note">Illustrative scores. In the product they come from the parcel’s real data.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Ring({ value }: { value: number }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <svg className="ps-ring" viewBox="0 0 64 64" aria-label={`Score ${value} of 100`}>
      <circle cx="32" cy="32" r={r} className="bg" />
      <circle cx="32" cy="32" r={r} className="fg" style={{ strokeDasharray: c, strokeDashoffset: c * (1 - value / 100) }} />
      <text x="32" y="37" textAnchor="middle">{value}</text>
    </svg>
  );
}

/* ================================================================ Act II · Design */

class ModelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="ps-model-wait">3D preview is not available in this browser.</div> : this.props.children; }
}

const STAGES = [
  { t: 'Model it on the parcel', d: 'GeoStar drafts a building that fits the site: setbacks, height limits, access and the program you asked for.' },
  { t: 'Edit until it is right', d: 'Move it, resize it, change the mix. Every change re-checks the rules and the numbers, so nothing breaks quietly.' },
  { t: 'Finalize and hand it over', d: 'Lock the design and get the files: a CAD drawing engineers can build from, the 3D model and a Gaussian splat to walk through.' },
] as const;

const CHECKS = ['Setbacks clear', 'Under the height limit', 'Fire access on two sides', 'Parking meets code'];

const FILES = [
  { icon: FileCode2, name: 'site-plan.dxf', d: 'CAD for engineers' },
  { icon: Box, name: 'building.glb', d: '3D model' },
  { icon: ScanEye, name: 'walkthrough.splat', d: 'Gaussian splat' },
];

export function Design({ type, onType }: { type: TypeStory; onType: (id: TypeStory['id']) => void }) {
  const [stage, setStage] = useState(0);
  const [frame, near] = useNear<HTMLDivElement>();
  const [ticked, setTicked] = useState(0);

  useEffect(() => {
    if (stage !== 1) return;
    setTicked(0);
    const t = setInterval(() => setTicked((n) => (n >= CHECKS.length ? n : n + 1)), 420);
    return () => clearInterval(t);
  }, [stage]);
  useEffect(() => setStage(0), [type.id]);

  return (
    <section id="design" data-chapter className="ps-act ps-act-design" aria-labelledby="design-title">
      <div className="ps-wrap">
        <ActHead
          n="II"
          label="Design"
          title={<span id="design-title">See the building <em>before it exists.</em></span>}
          lede="Once the site is chosen, GeoStar models a building on it. You shape it, you finalize it, and you walk away with files the engineers can actually use."
        />

        <div className="ps-design">
          <ol className="ps-stages" data-reveal>
            {STAGES.map((s, i) => (
              <li key={s.t} className={i === stage ? 'now' : i < stage ? 'past' : ''}>
                <button type="button" onClick={() => setStage(i)} aria-current={i === stage ? 'step' : undefined}>
                  <span className="ps-stage-n">{i < stage ? <Check size={14} /> : i + 1}</span>
                  <span className="ps-stage-t">{s.t}</span>
                </button>
                <p>{s.d}</p>
              </li>
            ))}
            <li className="ps-stage-cta">
              {stage < 2 ? (
                <button type="button" className="ps-btn ps-btn-ink" onClick={() => setStage((s) => s + 1)}>
                  {stage === 0 ? 'Edit the design' : 'Finalize'} <ArrowRight size={15} />
                </button>
              ) : (
                <Link href="/studio" className="ps-btn ps-btn-ink">Design yours <ArrowRight size={15} /></Link>
              )}
            </li>
          </ol>

          <div className="ps-model ps-glass" ref={frame} data-reveal data-stage={stage}>
            <div className="ps-model-bar">
              <TypeChips type={type} onType={onType} />
            </div>
            <div className="ps-model-canvas">
              {near ? <ModelBoundary><ConceptModel type={type.id} /></ModelBoundary> : <div className="ps-model-wait">Sketching the concept…</div>}
              <span className="ps-model-tag">{['Draft · on Parcel B', 'Editing · every change re-checked', 'Final · locked'][stage]}</span>
              {stage === 1 && (
                <ul className="ps-checks ps-glass" aria-label="Design checks">
                  {CHECKS.map((c, i) => <li key={c} className={i < ticked ? 'ok' : ''}><Check size={12} />{c}</li>)}
                </ul>
              )}
              <span className="ps-model-hint">Drag to orbit · scroll to zoom · concept sketch, not a survey</span>
            </div>
            <ul className={`ps-files ${stage === 2 ? 'ready' : ''}`} aria-label="Deliverables">
              {FILES.map((f, i) => (
                <li key={f.name} style={{ '--i': i } as CSSProperties}>
                  <span className="ps-file-ico">{stage === 2 ? <f.icon size={18} strokeWidth={1.6} /> : <Lock size={15} strokeWidth={1.6} />}</span>
                  <span><b>{f.name}</b><small>{f.d}</small></span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ================================================================ Act III · Protect */

const KIND = {
  water: { icon: Droplets, label: 'Water leaks', line: 'Hidden leaks that rot the structure' },
  electric: { icon: Zap, label: 'Electrical faults', line: 'Short circuits that smoulder for weeks' },
  smoke: { icon: Flame, label: 'Smoke and heat', line: 'The classic alarm, now not alone' },
  structure: { icon: Waves, label: 'Structure', line: 'Movement that water damage leaves behind' },
} as const;

type Sim = 'idle' | 'leak' | 'alert' | 'safe';

export function Protect() {
  const [pick, setPick] = useState<Sensor>(SENSORS[0]);
  const [sim, setSim] = useState<Sim>('idle');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const run = () => {
    timers.current.forEach(clearTimeout);
    setPick(SENSORS[0]);
    setSim('leak');
    timers.current = [setTimeout(() => setSim('alert'), 2200), setTimeout(() => setSim('safe'), 5200)];
  };

  // Live hardware: when the physical model on the demo table is connected, the cutaway follows its
  // real leak sensor and valve instead of the scripted simulation, and the panel below shows every reading.
  const [hw, reloadHw] = useHardware();
  const online = hw?.online === true;
  const wet = online && hw?.live?.leak_wet === true;
  const valveShut = online && hw?.live?.valve_open === false;
  const waiting = (hw?.agent?.pending?.length ?? 0) > 0;
  const wetAt = useRef<number | null>(null);
  const [liveSim, setLiveSim] = useState<Sim>('idle');
  useEffect(() => {
    if (!online) return;
    if (wet && wetAt.current === null) { wetAt.current = Date.now(); setPick(SENSORS[0]); }
    if (!wet) wetAt.current = null;
    const age = wetAt.current ? Date.now() - wetAt.current : 0;
    setLiveSim(wet ? (age < 1500 ? 'leak' : age < 4000 || !valveShut ? 'alert' : 'safe') : valveShut ? 'safe' : 'idle');
  }, [hw, online, wet, valveShut]);
  const shown: Sim = online ? liveSim : sim;
  const adc = typeof hw?.live?.leak_adc === 'number' ? hw.live.leak_adc : 0;
  const moisture = online ? Math.min(100, Math.round(adc / 16)) : { idle: 12, leak: 46, alert: 68, safe: 21 }[sim];
  const TOAST: Record<Sim, [string, string]> = online
    ? {
        idle: ['Monitor · Live: every sensor on the model reads normal', 'Drip water on the leak sensor on the table and watch this building react.'],
        leak: ['Guardian · Water at the coolant loop', 'A real sensor on the model just got wet. Checking it against its dry baseline.'],
        alert: ['Guardian · Leak confirmed at the coolant loop', 'The valve is closing in firmware. No AI sits in the safety loop.'],
        safe: ['Operator · Valve closed, leak contained', waiting ? 'Waiting for the manager’s card tap before anyone is dispatched or the valve reopens.' : 'The valve stays shut until the sensor is dry and the manager approves.'],
      }
    : {
        idle: ['Monitor · All seven sensors reading normal', 'Hover a sensor to see what it watches for.'],
        leak: ['Guardian · Something is changing on Level 3', 'Wall moisture is climbing. Checking it is not condensation.'],
        alert: ['Guardian · Leak behind the Level 3 riser', 'Moisture up 18% in six hours. Maintenance paged.'],
        safe: ['Operator · Valve closed, leak contained', 'Damage stopped at one wall. Recovery is watching the dry-out.'],
      };

  return (
    <section id="protect" data-chapter className="ps-act ps-act-protect" aria-labelledby="protect-title">
      <div className="ps-wrap">
        <ActHead
          light
          n="III"
          label="Protect"
          title={<span id="protect-title">Smoke alarms catch fires. <em>We catch what causes them.</em></span>}
          lede="Most damage starts quietly: a pinhole leak inside a wall, a loose connection heating up behind the drywall. GeoStar places sensors where buildings really fail, long before a smoke alarm would ever notice."
        />

        <div className="ps-protect">
          <div className="ps-cut" data-sim={shown} data-reveal>
            <Cutaway />
            {SENSORS.map((s) => {
              const K = KIND[s.kind].icon;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`ps-sensor k-${s.kind} ${pick.id === s.id ? 'on' : ''} ${shown !== 'idle' && s.id === 'w1' ? 'hot' : ''}`}
                  style={{ left: `${s.x}%`, top: `${s.y}%` }}
                  onClick={() => setPick(s)}
                  onMouseEnter={() => setPick(s)}
                  onFocus={() => setPick(s)}
                  aria-label={s.label}
                  aria-pressed={pick.id === s.id}
                >
                  <K size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              );
            })}
            {shown !== 'idle' && <span className="ps-drip" style={{ left: '30%', top: '33%' }} aria-hidden="true"><i /><i /><i /></span>}
            <div className={`ps-toast ps-glass-dark ${shown}`} role="status">
              <span className={`ps-ava ${shown === 'safe' ? 'p' : shown === 'idle' ? 'b' : 'g'}`}>{shown === 'safe' ? 'O' : shown === 'idle' ? 'M' : 'G'}</span>
              <div key={`${online}-${shown}`}>
                <b>{TOAST[shown][0]}</b>
                <span>{TOAST[shown][1]}</span>
              </div>
            </div>
          </div>

          <aside className="ps-sense" data-reveal>
            <div className="ps-glass-dark ps-sense-card" aria-live="polite">
              <span className={`ps-sense-kind k-${pick.kind}`}>{(() => { const K = KIND[pick.kind].icon; return <K size={14} />; })()}{KIND[pick.kind].label}</span>
              <h3>{pick.label}</h3>
              <p>{pick.why}</p>
              {pick.id === 'w1' && (
                <div className="ps-meter" aria-label={`${online ? 'Leak sensor' : 'Wall moisture'} ${moisture}%`}>
                  <span>{online ? 'Leak sensor · live' : 'Wall moisture'}</span>
                  <i><b style={{ width: `${moisture}%` }} className={moisture > 40 ? 'hi' : ''} /></i>
                  <em>{moisture}%</em>
                </div>
              )}
            </div>
            <ul className="ps-kinds">
              {(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => {
                const K = KIND[k].icon;
                return <li key={k} className={`k-${k}`}><K size={15} /><span><b>{KIND[k].label}</b><small>{KIND[k].line}</small></span></li>;
              })}
            </ul>
            {online ? (
              <div className={`ps-glass-dark ${liveCss.liveChip}`} role="status">
                <Droplets size={16} aria-hidden="true" />
                <span><b>Live hardware connected.</b> No simulation needed: drip water on the model’s leak sensor.</span>
              </div>
            ) : (
              <button type="button" className="ps-btn ps-btn-lime" onClick={run} disabled={sim === 'leak' || sim === 'alert'}>
                {sim === 'safe' ? <><RotateCcw size={15} /> Run it again</> : <><Droplets size={15} /> Simulate a hidden leak</>}
              </button>
            )}
          </aside>
        </div>

        <LivePanel hw={hw} reload={reloadHw} />
      </div>
    </section>
  );
}

/** Section through a three-storey building with its pipes and wiring. Coordinates match SENSORS (percent of 600 x 420). */
function Cutaway() {
  return (
    <svg className="ps-cut-svg" viewBox="0 0 600 420" aria-hidden="true">
      <rect x="0" y="330" width="600" height="90" className="earth" />
      <path d="M60 40 H540 V400 H60 Z" className="shell" />
      {[140, 240, 330].map((y) => <rect key={y} x="60" y={y - 4} width="480" height="8" className="slab" />)}
      <path d="M60 330 H540" className="ground" />
      <rect x="236" y="244" width="8" height="82" className="col" />
      {/* rooms, lightly */}
      <path d="M90 236 h70 v-26 h-70z M96 210 v-10 h20 v10" className="furn" />
      <path d="M300 236 h90 v-18 h-90z M300 218 v-14 h18 v14" className="furn" />
      <path d="M110 136 h60 v-34 h-60z" className="furn" />
      <path d="M400 136 h80 v-20 h-80z M420 116 v-10 h40 v10" className="furn" />
      <rect x="390" y="252" width="40" height="74" rx="6" className="heater" />
      <rect x="478" y="336" width="30" height="44" rx="3" className="panel" />
      {/* water: main, riser, branches */}
      <path d="M0 352 H180 V60 M180 138 H330 M180 240 H408 V252" className="pipe" />
      {/* power: panel up to the floors */}
      <path d="M492 336 V155 H220 M492 240 H440 M492 60 H360 V48" className="wire" />
      {/* smoke detector */}
      <rect x="348" y="44" width="24" height="7" rx="3" className="det" />
    </svg>
  );
}

/* ================================================================ HAVEN */

const AUDIENCE: { id: Audience; label: string; who: string }[] = [
  { id: 'owner', label: 'Owner', who: 'The building’s owner, at 2 a.m.' },
  { id: 'resident', label: 'Resident', who: 'Maya, who lives in 4B' },
  { id: 'engineer', label: 'Engineer', who: 'The facilities engineer on shift' },
];

export function Haven() {
  const [aud, setAud] = useState<Audience>('owner');
  const [shown, setShown] = useState(0);
  const [run, setRun] = useState(0);
  const [ref, on] = useOnScreen<HTMLDivElement>(0.4);
  const feed = ALERTS[aud];
  const agent = useMemo(() => Object.fromEntries(AGENTS.map((a) => [a.id, a])), []);

  useEffect(() => { setShown(0); }, [aud, run]);
  useEffect(() => {
    if (!on || shown >= feed.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 400 : 1500);
    return () => clearTimeout(t);
  }, [on, shown, feed.length]);

  return (
    <section id="haven" data-chapter className="ps-act ps-act-haven" aria-labelledby="haven-title">
      <div className="ps-wrap ps-split">
        <div className="ps-split-copy">
          <ActHead
            light
            n="+"
            label="HAVEN"
            title={<span id="haven-title">A team that never sleeps, <em>and knows how to talk.</em></span>}
            lede="HAVEN is five agents, each with one job and its own voice. They read every sensor, decide what is real, act on the building and tell each person exactly what they need to know. An owner gets the cost. A resident gets the way out. An engineer gets the breaker number."
          />
          <ul className="ps-agents" data-reveal>
            {AGENTS.map((a, i) => (
              <li key={a.id} style={{ '--i': i } as CSSProperties} tabIndex={0}>
                <span className={`ps-ava ${a.hue}`}>{a.name[0]}</span>
                <span><b>{a.name}</b><small>{a.role}</small></span>
                <em className="ps-agent-voice">{a.voice}</em>
              </li>
            ))}
          </ul>
        </div>

        <div className="ps-phone-wrap" ref={ref} data-reveal>
          <div className="ps-seg ps-seg-dark" role="tablist" aria-label="Who is HAVEN talking to?">
            {AUDIENCE.map((a) => (
              <button key={a.id} type="button" role="tab" aria-selected={aud === a.id} onClick={() => setAud(a.id)}>{a.label}</button>
            ))}
          </div>
          <div className="ps-phone ps-glass-dark">
            <div className="ps-phone-head">
              <ShieldCheck size={16} />
              <span><b>HAVEN</b><small>{AUDIENCE.find((a) => a.id === aud)!.who}</small></span>
              <button type="button" className="ps-icon-btn" onClick={() => setRun((r) => r + 1)} aria-label="Replay the conversation"><RotateCcw size={14} /></button>
            </div>
            <ol className="ps-feed" aria-live="polite">
              {feed.slice(0, shown).map((m, i) => {
                const a = agent[m.agent];
                return (
                  <li key={`${aud}-${run}-${i}`} className={`t-${m.tone}`}>
                    <span className={`ps-ava ${a.hue}`}>{a.name[0]}</span>
                    <div>
                      <header><b>{a.name}</b><time>{m.time}</time></header>
                      <p>{m.text}</p>
                    </div>
                  </li>
                );
              })}
              {on && shown < feed.length && (
                <li className="ps-typing" aria-label="Typing"><span className={`ps-ava ${agent[feed[shown].agent].hue}`}>{agent[feed[shown].agent].name[0]}</span><i /><i /><i /></li>
              )}
            </ol>
          </div>
          <p className="ps-note light">A replay of HAVEN’s response rules in simulation. No real building is connected on this page.</p>
        </div>
      </div>
    </section>
  );
}
