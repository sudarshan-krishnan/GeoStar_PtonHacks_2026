'use client';
// GeoStar Guide: talk to the studio. An ElevenLabs voice agent (services/api/app/sponsors/elevenlabs/guide.py) whose tools run here in
// the browser: it reads the screen, moves a pointer to what it is talking about, clicks for the user (asking first
// when a click changes something), and answers project questions through the GeoStar copilot, so every number it
// says comes from the layout engine or the CoStar extract.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConversationProvider, useConversationClientTool, useConversationControls, useConversationMode, useConversationStatus,
  type MessagePayload,
} from '@elevenlabs/react';
import { AudioLines, Check, Loader2, Maximize2, Mic, MicOff, Minimize2, PhoneOff, Send, X } from 'lucide-react';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';
import type { BriefPatch } from '../langchain/copilot';
import { Screen, realClick } from './screen';
import s from './guide.module.css';

interface Props {
  /** The same body the Studio sends to POST /studio/generate (null before the first generation). */
  body: Record<string, unknown> | null;
  conceptId: string | null; selected: string | null; stage: string; market: string;
  hasSite: boolean;
  onApply: (patch: BriefPatch) => void;
}
type Line = { who: 'you' | 'guide'; text: string };
const POS_KEY = 'plotstar-guide-pos';
type Pointer = { x: number; y: number; w: number; h: number; caption: string; click: boolean } | null;
interface CopilotRun { answer: string; planned_by: string; tools: { name: string; ok: boolean; ms: number }[]; ms: number;
  proposal: { patch: BriefPatch; consequences: { concept: string; changed: { metric: string; before_text: string; after_text: string }[] } } | null }

export function Guide(props: Props) {
  const [muted, setMuted] = useState(false);
  return (
    <ConversationProvider isMuted={muted} onMutedChange={setMuted}>
      <GuideInner {...props} muted={muted} setMuted={setMuted} />
    </ConversationProvider>
  );
}

function GuideInner({ body, conceptId, selected, stage, market, hasSite, onApply, muted, setMuted }: Props & { muted: boolean; setMuted: (m: boolean) => void }) {
  const { startSession, endSession, sendUserMessage, sendContextualUpdate, getInputVolume, getOutputVolume } = useConversationControls();
  const { status, message } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [pointer, setPointer] = useState<Pointer>(null);
  const [proposal, setProposal] = useState<CopilotRun['proposal']>(null);
  const [applied, setApplied] = useState(false);
  const [level, setLevel] = useState(0);
  // compact: shrink to a pill whenever the user works elsewhere on the page, so form fields stay reachable
  const [compact, setCompact] = useState(false);
  const [off, setOff] = useState<{ x: number; y: number }>(() => {
    try { const v = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : { x: 0, y: 0 }; } catch { return { x: 0, y: 0 }; }
  });
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const screen = useRef(new Screen(() => document.querySelector('.st') ?? document));
  const pointed = useRef<Element | null>(null);
  const lastRun = useRef<CopilotRun | null>(null);
  const live = status === 'connected';
  const latest = useRef({ body, conceptId, selected, stage, market, hasSite });
  latest.current = { body, conceptId, selected, stage, market, hasSite };

  // the pointer follows its element while the page scrolls or re-lays out
  useEffect(() => {
    if (!pointer) return;
    let raf = 0;
    const tick = () => {
      const el = pointed.current;
      if (el && el.isConnected) {
        const r = el.getBoundingClientRect();
        setPointer((p) => (p && (Math.abs(p.x - r.left) > 0.5 || Math.abs(p.y - r.top) > 0.5) ? { ...p, x: r.left, y: r.top, w: r.width, h: r.height } : p));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const hide = setTimeout(() => setPointer(null), 9000);
    return () => { cancelAnimationFrame(raf); clearTimeout(hide); };
  }, [pointer?.caption, pointer?.click]); // eslint-disable-line react-hooks/exhaustive-deps

  // voice level for the orb
  useEffect(() => {
    if (!live) { setLevel(0); return; }
    let raf = 0;
    const tick = () => { setLevel(Math.min(1, (isSpeaking ? getOutputVolume() : getInputVolume()) * 2.2)); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, isSpeaking, getInputVolume, getOutputVolume]);

  // collapse while the user works elsewhere; expand again for things that need their attention
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!(e.target as Element | null)?.closest?.('[data-guide-ui]')) setCompact(true); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('focusin', away, true);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('focusin', away, true); };
  }, [open]);
  useEffect(() => { if (proposal || error) setCompact(false); }, [proposal, error]);

  // drag by the header (or the pill); the position is remembered in this browser only
  function onDragStart(e: React.PointerEvent) {
    if ((e.target as Element).closest('button, input, a')) return;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: off.x, oy: off.y, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function onDragMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setOff({ x: Math.max(-innerWidth + 260, Math.min(160, d.ox + dx)), y: Math.max(-innerHeight + 200, Math.min(60, d.oy + dy)) });
  }
  function onDragEnd() {
    const moved = drag.current?.moved;
    drag.current = null;
    if (moved) { try { localStorage.setItem(POS_KEY, JSON.stringify(off)); } catch { /* storage unavailable */ } }
    return moved;
  }
  const place = { transform: `translate(${off.x}px, ${off.y}px)` };

  // keep the agent aware of where the user is
  useEffect(() => {
    if (live) sendContextualUpdate(`The user is on the ${stage} step${selected ? ` with ${selected} selected` : ''}${hasSite ? '' : ' and has not chosen a site yet'}.`);
  }, [live, stage, selected, hasSite, sendContextualUpdate]);

  const show = useCallback((el: Element, caption: string, click = false) => {
    pointed.current = el;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    const r = el.getBoundingClientRect();
    setPointer({ x: r.left, y: r.top, w: r.width, h: r.height, caption, click });
  }, []);

  // ---------------------------------------------------------------- client tools (names match services/api/app/sponsors/elevenlabs/guide.py)
  useConversationClientTool('read_screen', () => {
    const { stage: st, selected: sel, conceptId: cid, hasSite: site } = latest.current;
    const targets = screen.current.scan().filter((t) => !t.disabled).slice(0, 60);
    return JSON.stringify({ step: st, selected_object: sel, active_concept: cid, site_chosen: site,
      targets: targets.map((t) => `${t.id} = ${t.label}${t.risky ? ' (changes something)' : ''}`) });
  });

  useConversationClientTool('point_at', (p: Record<string, unknown>) => {
    const target = String(p.target ?? ''), caption = p.caption ? String(p.caption) : '';
    const hit = screen.current.find(String(target ?? ''));
    if (!hit) return `Nothing called "${target}" is on screen. Call read_screen for the current targets.`;
    show(hit.el, caption || hit.t.label);
    return `Pointing at ${hit.t.label}.`;
  });

  useConversationClientTool('click', async (p: Record<string, unknown>) => {
    const target = String(p.target ?? ''), confirmed = p.confirmed === true || p.confirmed === 'true';
    const hit = screen.current.find(String(target ?? ''));
    if (!hit) return `Nothing called "${target}" is on screen. Call read_screen for the current targets.`;
    if (hit.t.disabled) { show(hit.el, `${hit.t.label} is not available yet`); return `${hit.t.label} is disabled right now. Explain what the user has to do first.`; }
    if (hit.t.risky && !confirmed) { show(hit.el, `${hit.t.label}?`); return `"${hit.t.label}" changes or saves something. Ask the user to confirm, then call click again with confirmed=true.`; }
    show(hit.el, hit.t.label, true);
    await new Promise((r) => setTimeout(r, 650));
    await realClick(hit.el);
    return `Clicked ${hit.t.label}.`;
  });

  useConversationClientTool('ask_plotstar', async (p: Record<string, unknown>) => {
    const question = String(p.question ?? '');
    const { body: b, conceptId: cid, selected: sel, stage: st, market: mk } = latest.current;
    if (!b) return 'There are no layouts yet, so there is nothing to compute. Suggest finishing Define and generating layouts first.';
    try {
      const r = await fetch(`${PUBLIC_DATA_API}/copilot/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...b, question: String(question).slice(0, 600), concept_id: cid, selected: sel, stage: st, market: mk, thread_id: 'voice-guide' }) });
      const d = await r.json();
      if (!r.ok) return `The copilot could not answer: ${typeof d?.detail === 'string' ? d.detail : r.status}.`;
      lastRun.current = d as CopilotRun;
      if (d.proposal) { setProposal(d.proposal); setApplied(false); }
      return `${d.answer}${d.proposal ? ' (A preview with an Apply button is now on screen.)' : ''}`;
    } catch { return `The GeoStar API at ${PUBLIC_DATA_API} is not reachable.`; }
  });

  useConversationClientTool('agents_status', async () => {
    try {
      const d = await (await fetch(`${PUBLIC_DATA_API}/guide/agents`)).json();
      const run = lastRun.current;
      return JSON.stringify({ services: d.services, last_copilot_run: run ? { planned_by: run.planned_by, tools: run.tools.map((t) => `${t.name} ${t.ms} ms`), total_ms: run.ms } : 'none yet in this conversation' });
    } catch { return 'The GeoStar API is not reachable, so I cannot list the services.'; }
  });

  useConversationClientTool('next_steps', () => {
    const { stage: st, hasSite: site, selected: sel, body: b } = latest.current;
    const tips: Record<string, string[]> = {
      Define: site ? ['Review the brief, then continue to Discover.', 'Ask what the site checks mean.']
        : ['Pick a numbered CoStar property on the map, or drop your own pin.', 'Ask me to find industrial sites with heavy power.'],
      Discover: ['Fly the drone over the site and capture a 360° survey, or skip it.', 'Press Generate layouts when you are ready.'],
      Explore: [sel ? `Ask why ${sel} is sized the way it is, or what doubling its rack density would do.` : 'Click a data hall in the plan to inspect it.',
        'Switch between the 2D plan and 3D model, or turn on the power and cooling routes.'],
      Analyze: ['Try a what-if: switch cooling or redundancy and watch cost, water and carbon move together.', 'Ask for the biggest risks.'],
      Compare: ['Ask which concept is cheaper over ten years, then select a preferred one.'],
      Decide: ['Pick the preferred concept, write why, and save the decision.'],
      Deliver: ['Export the DXF for CAD, or download the decision report.', 'Then open Design to see the 3D facility model.'],
      Design: ['Orbit and zoom the concept model for the property type you picked, then press Use this model.', 'Then open the Protect tab.'],
      Protect: ['Choose which alerts to watch and their limits, place the sensors, pick an evacuation route, then deploy.'],
      Deploy: ['Watch the facility in its Command Center, or open another deployed project from the list.'],
    };
    return (tips[st] ?? ['Ask me anything about the project.']).concat(b ? [] : ['Layouts are not generated yet.']).join(' ');
  });

  // ---------------------------------------------------------------- session
  async function start() {
    setError(null); setOpen(true);
    try {
      const r = await fetch(`${PUBLIC_DATA_API}/guide/session`);
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(typeof d?.detail === 'string' ? d.detail : `Voice guide unavailable (${r.status})`);
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((m) => m.getTracks().forEach((t) => t.stop()));
      startSession({
        signedUrl: d.signed_url,
        onMessage: (m: MessagePayload) => setLines((l) => [...l.slice(-5), { who: m.source === 'user' ? 'you' : 'guide', text: m.message }]),
        onError: (msg: string) => setError(msg),
        onDisconnect: () => setPointer(null),
      });
    } catch (e) {
      const msg = (e as Error).name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in the address bar to talk to the guide.' : (e as Error).message;
      setError(msg.includes('fetch') ? `Can't reach the GeoStar API at ${PUBLIC_DATA_API}.` : msg);
    }
  }
  function stop() { endSession(); setOpen(false); setPointer(null); setCompact(false); }
  function send(e: React.FormEvent) { e.preventDefault(); if (typed.trim() && live) { sendUserMessage(typed.trim()); setLines((l) => [...l.slice(-5), { who: 'you', text: typed.trim() }]); setTyped(''); } }

  const label = status === 'connecting' ? 'Connecting…' : !live ? 'Talk to GeoStar' : isSpeaking ? 'Speaking' : muted ? 'Muted' : 'Listening';

  return (
    <>
      {pointer && (
        <div className={s.overlay} data-guide-ui aria-hidden>
          <div className={`${s.ring} ${pointer.click ? s.ringClick : ''}`} style={{ left: pointer.x - 4, top: pointer.y - 4, width: pointer.w + 8, height: pointer.h + 8 }} />
          <div className={s.cursor} style={{ transform: `translate(${pointer.x + Math.min(pointer.w, 220) * 0.7}px, ${pointer.y + pointer.h * 0.65}px)` }}>
            <svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7.5 16 L11 24 L14.5 22.5 L11 15 L18 15 Z" /></svg>
            <span>{pointer.caption}</span>
          </div>
        </div>
      )}

      {!open ? (
        <button className={s.orbBtn} onClick={() => void start()} data-guide-ui aria-label="Talk to the GeoStar guide">
          <AudioLines size={16} /> Talk to GeoStar
        </button>
      ) : (
        compact ? (
        <section className={s.pill} data-guide-ui aria-label="GeoStar voice guide, collapsed" style={place}
          onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={(e) => { if (!onDragEnd() && !(e.target as Element).closest('button')) setCompact(false); }}>
          <div className={`${s.orb} ${s.orbSmall} ${isSpeaking ? s.speaking : ''}`} style={{ ['--lvl' as string]: level }}>
            {status === 'connecting' ? <Loader2 size={14} className={s.spin} /> : <AudioLines size={14} />}
          </div>
          <div className={s.pillText}><b>{label}</b><span>{[...lines].reverse().find((l) => l.who === 'guide')?.text ?? 'GeoStar guide'}</span></div>
          <button className={s.icon} onClick={() => setCompact(false)} aria-label="Expand the guide"><Maximize2 size={14} /></button>
          {live && <button className={s.icon} onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>{muted ? <MicOff size={14} /> : <Mic size={14} />}</button>}
          <button className={s.icon} onClick={stop} aria-label="End the conversation">{live ? <PhoneOff size={14} /> : <X size={14} />}</button>
        </section>
        ) : (
        <section className={s.panel} data-guide-ui aria-label="GeoStar voice guide" style={place}>
          <div className={`${s.top} ${s.handle}`} onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} title="Drag to move">
            <div className={`${s.orb} ${isSpeaking ? s.speaking : ''}`} style={{ ['--lvl' as string]: level }}>
              {status === 'connecting' ? <Loader2 size={16} className={s.spin} /> : <AudioLines size={16} />}
            </div>
            <div className={s.state}><b>{label}</b><span>GeoStar guide · ElevenLabs voice</span></div>
            <button className={s.icon} onClick={() => setCompact(true)} aria-label="Collapse the guide"><Minimize2 size={15} /></button>
            {live && <button className={s.icon} onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>{muted ? <MicOff size={15} /> : <Mic size={15} />}</button>}
            <button className={s.icon} onClick={stop} aria-label="End the conversation">{live ? <PhoneOff size={15} /> : <X size={15} />}</button>
          </div>
          {error && <p className={s.error}>{error}{message && message !== error ? ` (${message})` : ''}</p>}
          <div className={s.lines} aria-live="polite">
            {lines.length === 0 && live && <p className={s.hint}>Try: “Walk me through this step”, “What if we double the rack density?”, “What agents are running?”</p>}
            {lines.map((l, i) => <p key={i} className={l.who === 'you' ? s.you : s.guide}><b>{l.who === 'you' ? 'You' : 'Guide'}</b>{l.text}</p>)}
          </div>
          {proposal && (
            <div className={s.proposal}>
              <b>Preview · {proposal.consequences.concept}</b>
              <ul>{proposal.consequences.changed.slice(0, 4).map((r) => <li key={r.metric}>{r.metric}: {r.before_text} → <b>{r.after_text}</b></li>)}</ul>
              {applied ? <span className={s.applied}><Check size={13} /> Applied</span>
                : <div className={s.row}><button className="st-btn primary" onClick={() => { onApply(proposal.patch); setApplied(true); if (live) sendContextualUpdate('The user applied the previewed change; layouts are regenerating.'); }}>Apply this change</button>
                  <button className="st-btn" onClick={() => setProposal(null)}>Dismiss</button></div>}
            </div>
          )}
          {live && (
            <form className={s.type} onSubmit={send}>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type to the guide…" maxLength={400} aria-label="Message the guide" />
              <button className="st-btn" type="submit" disabled={!typed.trim()} aria-label="Send"><Send size={13} /></button>
            </form>
          )}
        </section>
        )
      )}
    </>
  );
}
