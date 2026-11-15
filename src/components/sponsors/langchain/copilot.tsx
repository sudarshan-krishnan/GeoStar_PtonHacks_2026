'use client';
// Ask GeoStar: the one conversational agent for the whole Studio. Every question goes to the PlotStar orchestrator
// (Deep Agents, services/api/app/sponsors/langchain/deep_agents/agents.py) with the Studio's live state: the stage, the site, the brief, the
// active concept, the selected object and the latest site score. The orchestrator delegates to the specialists the
// question needs; the Agent Intelligence panel shows that live. What-ifs are previews: nothing changes until Apply.
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, CircleAlert, GitBranch, Loader2, Send, ShieldCheck, Sparkles, X } from 'lucide-react';
import { Markdown } from './markdown';
import { activeAgents, type RunState, type Verification } from './use-agent-run';
import s from './copilot.module.css';

/** Brief fields a what-if may change, in the API's names (services/api/app/routers/studio.py Brief). */
export type BriefPatch = Partial<Record<'rack_kw' | 'mw_it' | 'cooling' | 'redundancy' | 'halls' | 'storeys' | 'flexible_share'
  | 'expansion_pct' | 'setback_m' | 'rent_kw_month', number | string>>;

interface Row { metric: string; before_text: string; after_text: string; delta_text: string; changed: boolean; better: boolean | null; stage: string }
interface Consequences {
  concept: string; concept_id: string; feasible_after: boolean; changed: Row[]; stages: string[];
  check_flips: { name: string; after: boolean; detail: string }[];
}
interface Answer {
  runId: string; text: string; verification: Verification | null; agents: number; tools: number; mcp: number; seconds: number;
  proposal: { patch: BriefPatch; concept_id: string; consequences: Consequences } | null;
}
type Msg = { role: 'user'; text: string } | { role: 'copilot'; data: Answer; applied?: boolean } | { role: 'error'; text: string };

type AgentApi = { state: RunState; start: (path: '/agents/chat', body: unknown, title: string) => Promise<string | null> };

export function Copilot({ body, conceptId, selected, stage, market, facilityId, lastScore, agent, onOpenGraph, onApply, busy }: {
  /** The same body the Studio sends to POST /studio/generate. */
  body: Record<string, unknown>;
  conceptId: string | null; selected: string | null; stage: string; market: string;
  facilityId?: string | null; lastScore?: { verdict: string; score: number | null } | null;
  /** The Studio's shared agent run, so the panel shows this conversation's graph. */
  agent: AgentApi; onOpenGraph: () => void;
  /** Apply a previewed change to the brief. Called only after the user confirms. */
  onApply: (patch: BriefPatch) => void;
  onSelectSite?: (parcelId: string) => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [thread] = useState(() => `c${Math.random().toString(36).slice(2, 12)}`);
  const end = useRef<HTMLDivElement>(null);
  const st = agent.state;
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, pending, st.order.length]);

  // when the run we started finishes, turn it into a reply
  useEffect(() => {
    if (!pending || st.runId !== pending || (st.status !== 'done' && st.status !== 'error')) return;
    const nodes = Object.values(st.nodes);
    if (st.status === 'error' || !st.answer) {
      setMsgs((m) => [...m, { role: 'error', text: st.error ?? 'The agents did not produce an answer.' }]);
    } else {
      setMsgs((m) => [...m, { role: 'copilot', data: {
        runId: pending, text: st.answer!, verification: st.verification, proposal: st.proposal as Answer['proposal'],
        agents: nodes.filter((n) => n.kind === 'agent' && n.parent !== null).length,
        tools: nodes.filter((n) => n.kind !== 'agent' && n.kind !== 'model').length, mcp: nodes.filter((n) => n.kind === 'mcp').length,
        seconds: (nodes.find((n) => n.parent === null)?.ms ?? 0) / 1000,
      } }]);
    }
    setPending(null);
  }, [pending, st]);

  const suggestions = [
    ...(selected?.startsWith('DH') ? [`What if I double the rack density in ${selected}?`] : []),
    'What if we use air cooling instead?', 'Is this site financially viable?', 'What are the biggest risks for the neighbours?',
    'Which concept should we build and why?', ...(facilityId ? ['Is anything wrong at the facility right now?'] : []),
  ].slice(0, 5);

  async function ask(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    setMsgs((m) => [...m, { role: 'user', text: question }]); setQ('');
    const id = await agent.start('/agents/chat', {
      ...body, question, thread_id: thread, stage, market, concept_id: conceptId, selected, facility_id: facilityId ?? null,
      last_score: lastScore ?? null,
    }, question);
    if (id) setPending(id);
    else setMsgs((m) => [...m, { role: 'error', text: 'Could not reach the GeoStar agents. Is the API running?' }]);
  }

  function apply(i: number, patch: BriefPatch) {
    onApply(patch);
    setMsgs((m) => m.map((x, j) => (j === i && x.role === 'copilot' ? { ...x, applied: true } : x)));
  }

  if (!open) return <button className={s.fab} onClick={() => setOpen(true)} aria-label="Open Ask GeoStar"><Sparkles size={15} /> Ask GeoStar</button>;

  const live = pending && st.runId === pending;
  const n = activeAgents(st);
  return (
    <section className={s.panel} aria-label="Ask GeoStar">
      <header className={s.head}>
        <div><b><Sparkles size={14} /> Ask GeoStar</b><span>{stage}{conceptId ? ' · active concept' : ''}{selected ? ` · ${selected} selected` : ''} · one agent across the Studio</span></div>
        <button className={s.icon} onClick={() => setOpen(false)} aria-label="Close Ask GeoStar"><X size={15} /></button>
      </header>
      <div className={s.body}>
        {msgs.length === 0 && (
          <div className={s.empty}>
            <p>Ask about this project. The orchestrator sends your question to the specialists it needs (property, money, power and resources, community, design, safety), and every number comes from their tools. Changes are previewed before anything is applied.</p>
            <div className={s.chips}>{suggestions.map((t) => <button key={t} onClick={() => void ask(t)}>{t}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => m.role === 'user' ? <div key={i} className={s.user}>{m.text}</div>
          : m.role === 'error' ? <div key={i} className={s.error}><CircleAlert size={14} /> {m.text}</div>
          : <Reply key={i} a={m.data} applied={!!m.applied} busy={!!busy} onApply={(p) => apply(i, p)} onOpenGraph={onOpenGraph} />)}
        {pending && (
          <button className={s.thinking} onClick={onOpenGraph} title="Watch the agents work">
            <Loader2 size={14} className={s.spin} />
            {live ? (st.plan.length ? `Plan: ${st.plan.map((p) => p.content).slice(0, 2).join(' · ')}` : 'The orchestrator is planning…') : 'Starting…'}
            {live && n > 0 && <b> · {n} agent{n === 1 ? '' : 's'} working</b>}
            <span className={s.watch}><GitBranch size={12} /> Watch live</span>
          </button>
        )}
        <div ref={end} />
      </div>
      <form className={s.input} onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={selected ? `Ask about ${selected} or the project…` : 'Ask about the project…'} maxLength={800} aria-label="Question" />
        <button className="st-btn primary" type="submit" disabled={!q.trim() || !!pending} aria-label="Send"><Send size={14} /></button>
      </form>
    </section>
  );
}

function Reply({ a, applied, busy, onApply, onOpenGraph }: { a: Answer; applied: boolean; busy: boolean; onApply: (p: BriefPatch) => void; onOpenGraph: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const p = a.proposal;
  const rows = p ? (showAll ? p.consequences.changed : p.consequences.changed.slice(0, 7)) : [];
  return (
    <div className={s.reply}>
      <Markdown text={a.text} className={s.text} />
      {p && (
        <div className={s.cons}>
          <div className={s.consHead}><b>Preview · {p.consequences.concept}</b><span>Ripples into {p.consequences.stages.join(', ')}</span></div>
          <table>
            <thead><tr><th>Measure</th><th>Now</th><th>After</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.metric}><td>{r.metric}</td><td>{r.before_text}</td><td><b>{r.after_text}</b></td>
                <td className={r.better === true ? s.good : r.better === false ? s.bad : s.neutral}>
                  {r.better === true ? <ArrowDown size={11} /> : r.better === false ? <ArrowUp size={11} /> : null}{r.delta_text}</td></tr>
            ))}</tbody>
          </table>
          {p.consequences.changed.length > 7 && <button className={s.link} onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${p.consequences.changed.length} changes`}</button>}
          {p.consequences.check_flips.length > 0 && (
            <ul className={s.flips}>{p.consequences.check_flips.map((k) => <li key={k.name} className={k.after ? s.good : s.bad}>{k.after ? <Check size={12} /> : <CircleAlert size={12} />} {k.name}: {k.detail}</li>)}</ul>
          )}
          <div className={s.actions}>
            {applied ? <span className={s.applied}><Check size={13} /> Applied. The layouts were regenerated.</span>
              : confirm ? (<>
                <span className={s.ask}>Replace the current brief with this change? The first run stays as the comparison.</span>
                <button className="st-btn primary" disabled={busy} onClick={() => { onApply(p.patch); setConfirm(false); }}>Yes, apply</button>
                <button className="st-btn" onClick={() => setConfirm(false)}>Cancel</button>
              </>) : <button className="st-btn primary" disabled={busy} onClick={() => setConfirm(true)}>Apply this change</button>}
          </div>
        </div>
      )}
      <button className={s.how} onClick={onOpenGraph}>
        <GitBranch size={12} /> How the agents worked it out · {a.agents} agent{a.agents === 1 ? '' : 's'} · {a.tools} tool calls{a.mcp ? ` (${a.mcp} CoStar MCP)` : ''} · {a.seconds.toFixed(1)} s
        {a.verification && <span className={a.verification.grounded ? s.good : s.bad}><ShieldCheck size={11} /> {a.verification.grounded ? 'numbers verified' : 'check numbers'}</span>}
      </button>
    </div>
  );
}
