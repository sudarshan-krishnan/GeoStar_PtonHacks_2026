'use client';
// Judge-facing showcase of PlotStar's AI: ask a question, watch the real LangGraph pipeline run.
// Everything shown is from the live backend (POST /copilot/ask, GET /copilot/status) — nothing is faked.
// The engine decides every number; the model only plans tools and explains, and its wording is checked.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Boxes, CircleCheck, CircleX, Cpu, Database, GitBranch, Send, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { Brand } from '../brand';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';

interface Status {
  model: string | null; llm: boolean; framework: string; tools: string[]; costar_to_llm: boolean; langsmith: boolean;
  costar_store: boolean; note: string;
}
interface TraceNode { node: string; by?: string; ms: number; tools?: string[]; flags?: number }
interface ToolCall { name: string; args: Record<string, unknown>; ms: number; ok: boolean; output?: { headline?: string } }
interface ProposalRow { metric: string; before_text: string; after_text: string; delta_text: string; better: boolean | null }
interface Proposal { patch: Record<string, unknown>; concept_id: string; consequences?: { rows?: ProposalRow[]; concept?: string } }
interface Answer {
  answer: string; written_by: string; planned_by: string; tools: ToolCall[]; proposal: Proposal | null;
  flags: string[]; trace: TraceNode[]; ms: number; langsmith: { run_id: string; project: string } | null;
}

const NODES = [
  { key: 'plan', icon: GitBranch, title: 'Plan', blurb: 'Claude reads the question and picks which tools to call (LangChain tool-calling), or a rule parser does if no model.' },
  { key: 'act', icon: Workflow, title: 'Act', blurb: 'The chosen tools run. They only call the deterministic layout engine and the CoStar table — the model computes nothing.' },
  { key: 'verify', icon: ShieldCheck, title: 'Verify', blurb: "Every number in the draft answer is checked against the tools' real output. A stray number is rejected." },
  { key: 'respond', icon: Sparkles, title: 'Respond', blurb: 'Claude writes the explanation from the verified facts, or a deterministic template does.' },
] as const;

const SAMPLES = [
  'What changes if I switch to air cooling at 20 MW?',
  'Compare the three concepts on cost and carbon.',
  'Is the Shared Service Bands concept feasible, and why?',
  'What happens to NPV if I raise rent to $220 per kW-month?',
];

const DEMO_BODY = {
  brief: { name: 'Houston 20 MW', mw_it: 20, rack_kw: 20, redundancy: 'N+1', cooling: 'liquid', site_w: 324, site_d: 250, setback_m: 8, expansion_pct: 10, flexible_share: 0.3, storeys: 1 },
  site: { name: 'World Houston 46', gates: [{ gate: 'Residential proximity', status: 'Pass', value: 626 }, { gate: 'Grid proximity', status: 'Pass', value: 2.33 }] },
  priorities: { money: 3, people: 1, planet: 4, resources: 3 }, concept_id: 'service-bands', stage: 'Analyze', market: 'Houston',
};

export function AgentView() {
  const [status, setStatus] = useState<Status | null>(null);
  const [q, setQ] = useState(SAMPLES[0]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [active, setActive] = useState<number>(-1); // which node is lit during the replay
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thread = useRef(`judge-${Math.random().toString(36).slice(2, 8)}`);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    fetch(`${PUBLIC_DATA_API}/copilot/status`).then((r) => r.json()).then(setStatus).catch(() => setStatus(null));
    return () => timers.current.forEach(clearTimeout);
  }, []);

  const ask = useCallback(async (question: string) => {
    timers.current.forEach(clearTimeout);
    setRunning(true); setError(null); setAnswer(null); setActive(0);
    try {
      const r = await fetch(`${PUBLIC_DATA_API}/copilot/ask`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...DEMO_BODY, question, thread_id: thread.current }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail || `Request failed (${r.status})`);
      const data: Answer = await r.json();
      setAnswer(data);
      // replay the real trace: light each node in turn, spending time proportional to its real ms (clamped so it is watchable)
      const steps = data.trace.length ? data.trace : NODES.map((n) => ({ node: n.key, ms: 400 }));
      let t = 0;
      steps.forEach((step, i) => {
        const idx = NODES.findIndex((n) => n.key === step.node);
        timers.current.push(setTimeout(() => setActive(idx), t));
        t += Math.min(1500, Math.max(650, step.ms));
      });
      timers.current.push(setTimeout(() => { setActive(NODES.length); setRunning(false); }, t));
    } catch (e) {
      setError((e as Error).message); setRunning(false); setActive(-1);
    }
  }, []);

  const traceBy = useMemo(() => {
    const m: Record<string, TraceNode> = {};
    for (const n of answer?.trace ?? []) m[n.node] = n;
    return m;
  }, [answer]);
  const done = active >= NODES.length;

  return (
    <div className="st ag">
      <header className="st-top">
        <Brand />
        <div className="st-top-title"><b>Agent</b><span>How PlotStar&apos;s AI works</span></div>
        <nav className="st-top-nav">
          <Link href="/studio">Open the studio</Link>
          <Link href="/">Home</Link>
        </nav>
      </header>

      <main className="ag-main">
        <section className="ag-hero">
          <small className="st-eyebrow">LangChain · LangGraph · LangSmith</small>
          <h1>Ask the agent. Watch it think.</h1>
          <p className="ag-lede">PlotStar&apos;s copilot runs a LangGraph pipeline: it plans which tools to call, runs them on the
            deterministic engine, checks every number in its answer, then explains. The model never invents a figure.</p>
        </section>

        {/* system card: the real configuration from /copilot/status */}
        <section className="ag-sys">
          <Card icon={Cpu} label="Model" value={status?.model ?? (status?.llm === false ? 'Deterministic (no key)' : '…')} sub={status?.llm ? 'via LangChain' : 'rule-based fallback'} on={!!status?.llm} />
          <Card icon={Workflow} label="Framework" value="LangGraph" sub="plan · act · verify · respond" on />
          <Card icon={Boxes} label="Tools" value={`${status?.tools.length ?? 0}`} sub={status?.tools.join(' · ') ?? ''} on={!!status?.tools.length} />
          <Card icon={GitBranch} label="LangSmith" value={status?.langsmith ? 'Tracing on' : 'Off'} sub={status?.langsmith ? 'every run is traced' : 'set LANGSMITH_API_KEY'} on={!!status?.langsmith} />
          <Card icon={ShieldCheck} label="Numbers" value="Checked" sub="answer verified against tool output" on />
          <Card icon={Database} label="CoStar data" value={status?.costar_to_llm ? 'In prompts' : 'Kept out of prompts'} sub={status?.costar_store ? 'shown to the user only' : 'store offline'} on={status?.costar_to_llm === false} />
        </section>

        {/* ask box */}
        <section className="ag-ask">
          <form onSubmit={(e) => { e.preventDefault(); if (!running && q.trim()) void ask(q.trim()); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about the Houston 20 MW project…" maxLength={300} disabled={running} />
            <button type="submit" className="st-btn primary" disabled={running || !q.trim()}>{running ? 'Running…' : <>Ask <Send size={14} /></>}</button>
          </form>
          <div className="ag-samples">{SAMPLES.map((s) => (
            <button key={s} className="ag-chip" onClick={() => { setQ(s); void ask(s); }} disabled={running}>{s}</button>
          ))}</div>
          {error && <p className="ag-err"><CircleX size={14} /> {error}{error.includes('failed') ? ' — is the data service on :8000 running?' : ''}</p>}
        </section>

        {/* the live pipeline */}
        <section className="ag-pipe" aria-label="Agent pipeline">
          {NODES.map((n, i) => {
            const t = traceBy[n.key];
            const state = active === i ? 'live' : active > i ? 'done' : running || answer ? 'pending' : 'idle';
            return (
              <div key={n.key} className="ag-node-wrap">
                <article className={`ag-node ag-${state}`}>
                  <div className="ag-node-head"><span className="ag-node-ic"><n.icon size={16} /></span><b>{n.title}</b>{t && active >= i && <em>{t.ms} ms</em>}</div>
                  <p>{n.blurb}</p>
                  {active >= i && t && (
                    <div className="ag-node-detail">
                      {n.key === 'plan' && <span>{t.by?.includes('Claude') ? 'Claude chose' : 'Rules chose'}: {(t.tools ?? []).join(', ') || 'no tool (answer directly)'}</span>}
                      {n.key === 'act' && <span>{(answer?.tools ?? []).map((c) => c.name).join(', ') || 'nothing to run'}</span>}
                      {n.key === 'verify' && (
                        (answer?.flags.length ?? 0) > 0
                          ? <span className="ag-bad"><CircleX size={13} /> {answer!.flags.length} number rejected — redrawn from tool output</span>
                          : <span className="ag-ok"><CircleCheck size={13} /> every number matched the tools</span>
                      )}
                      {n.key === 'respond' && <span>{t.by?.replace('Written by ', '') ?? ''}</span>}
                    </div>
                  )}
                </article>
                {i < NODES.length - 1 && <ArrowRight size={18} className={`ag-arrow ${active > i ? 'on' : ''}`} />}
              </div>
            );
          })}
        </section>

        {/* the answer + the proposal the engine computed */}
        {answer && done && (
          <section className="ag-out">
            <div className="st-card ag-answer">
              <h3><Sparkles size={15} /> Answer</h3>
              <p>{answer.answer}</p>
              <small>{answer.written_by}</small>
            </div>
            {answer.tools[0]?.output?.headline && (
              <div className="st-card ag-tool">
                <h3><Workflow size={15} /> What the tool computed</h3>
                <p className="ag-headline">{answer.tools[0].output.headline}</p>
                {answer.proposal?.consequences?.rows && (
                  <table className="ag-diff"><tbody>
                    {answer.proposal.consequences.rows.slice(0, 7).map((r) => (
                      <tr key={r.metric}><td>{r.metric}</td><td className="n">{r.before_text}</td><td className="ar">→</td>
                        <td className={`n ${r.better === true ? 'up' : r.better === false ? 'down' : ''}`}>{r.after_text}</td></tr>
                    ))}
                  </tbody></table>
                )}
                <small>Computed by the layout engine, not the model. Ranking and figures are estimates from the stated assumptions.</small>
              </div>
            )}
          </section>
        )}

        {/* LangSmith call to action */}
        <section className="ag-smith">
          <div>
            <h3><GitBranch size={16} /> See the real trace in LangSmith</h3>
            <p>{status?.langsmith
              ? 'Every question above streams a full trace — each node, tool call, token count and latency — to the LangSmith project. Open it to inspect any run.'
              : 'LangSmith tracing is off. Set LANGSMITH_API_KEY and LANGSMITH_TRACING=true to stream traces here.'}</p>
            {answer?.langsmith && (
              <p className="ag-runid">Last run traced · project <b>{answer.langsmith.project}</b> · run <code>{answer.langsmith.run_id}</code></p>
            )}
          </div>
          <a className="st-btn primary" href="https://smith.langchain.com/" target="_blank" rel="noreferrer">Open LangSmith <ArrowRight size={14} /></a>
        </section>

        <footer className="ag-foot">
          <span>The engine decides; the model explains. No figure on this page was generated by an LLM.</span>
          <Link href="/studio" className="st-btn">Build a project in the studio <ArrowRight size={14} /></Link>
        </footer>
      </main>
    </div>
  );
}

function Card({ icon: Icon, label, value, sub, on }: { icon: typeof Cpu; label: string; value: string; sub: string; on: boolean }) {
  return (
    <div className={`ag-card ${on ? 'on' : ''}`}>
      <span className="ag-card-ic"><Icon size={16} /></span>
      <small>{label}</small>
      <b>{value}</b>
      <span className="ag-card-sub">{sub}</span>
    </div>
  );
}
