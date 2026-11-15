'use client';
// How GeoStar's AI works, for judges: the Deep Agents architecture as the server reports it (GET /agents/architecture),
// one click to run a real site evaluation on a CoStar parcel, and the live graph of that run. Nothing here is scripted:
// every agent, model call and tool call on screen is a runtime event from the API.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bot, Brain, Calculator, Database, GitBranch, Layers, Loader2, Play, Send, ShieldCheck, Workflow } from 'lucide-react';
import { Brand } from '../../brand';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';
import { AgentIntel } from './agent-intel';
import { isActive, useAgentRun } from './use-agent-run';

interface ToolInfo { name: string; display: string; provider: string; kind: string | null; available: boolean }
interface AgentInfo { name: string; title: string; role: string; description?: string; model: string; kind: string; tools: ToolInfo[]; skills: string[]; output?: string; approval?: string[] }
interface Arch {
  sdk: Record<string, string>; harness: string[]; agents: AgentInfo[];
  mcp: { server: string; transport: string; connected: boolean; tools: string[]; error: string | null };
  scoring: { pillars: Record<string, { label: string; weight: number; agent: string }>; criteria: { pillar: string; label: string; rule: string; tools: string[] }[]; verdict: string };
  privacy: { costar_fields_to_model: boolean }; langsmith: { tracing: boolean; project: string }; missing_tools: string[]; error: string | null;
}
interface RecentRun { id: string; kind: string; title: string; status: string; elapsed: number; verdict: string | null; score: number | null }

// A real Houston parcel from the CoStar extract with Vexcel coverage; its name and address stay on this machine.
const DEMO = {
  brief: { name: 'Houston 20 MW', mw_it: 20, rack_kw: 20, redundancy: 'N+1', cooling: 'liquid', halls: null, site_w: 225, site_d: 173,
    setback_m: 8, expansion_pct: 10, flexible_share: 0.3, storeys: 1, rent_kw_month: null },
  site: { id: 'costar:9220364', lat: 29.9287658, lon: -95.3390666, gates: [] },
  priorities: { money: 2, people: 2, planet: 2, resources: 2 }, assumptions: {}, edits: {}, market: 'Houston', stage: 'Define',
};

export function AgentView() {
  const run = useAgentRun();
  const [arch, setArch] = useState<Arch | null>(null);
  const [archErr, setArchErr] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentRun[]>([]);
  const [q, setQ] = useState('');
  const busy = isActive(run.state);

  useEffect(() => {
    fetch(`${PUBLIC_DATA_API}/agents/architecture`).then((r) => r.json()).then(setArch).catch(() => setArchErr(`Can't reach the GeoStar API at ${PUBLIC_DATA_API}.`));
  }, []);
  useEffect(() => {
    const load = () => fetch(`${PUBLIC_DATA_API}/agents/runs`).then((r) => r.json()).then((d) => setRecent(d.runs ?? [])).catch(() => {});
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const evaluate = () => void run.start('/agents/site-evaluation', DEMO, 'Evaluate costar:9220364 (Houston) for a 20 MW data center');
  const ask = (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setQ('');
    void run.start('/agents/chat', { ...DEMO, question, thread_id: 'judges' }, question);
  };

  const orch = arch?.agents.find((a) => a.kind === 'orchestrator');
  const subs = arch?.agents.filter((a) => a.kind === 'subagent') ?? [];
  return (
    <div className="st ag">
      <header className="st-top">
        <Brand />
        <div className="st-top-title"><b>How the AI works</b><span>Deep Agents · LangGraph runtime · LangSmith traces · CoStar MCP</span></div>
        <nav className="st-top-nav"><Link href="/studio">Studio</Link><Link href="/studio/data">Data</Link><Link href="/">Home</Link></nav>
      </header>
      <main className="ag-main">
        <section className="ag-hero">
          <small className="st-eyebrow">One orchestrator · six specialists · every number from a tool</small>
          <h1>Watch the agents evaluate a real site.</h1>
          <p className="ag-lede">The PlotStar orchestrator is a LangChain Deep Agent. It writes a plan, delegates to specialist subagents in
            isolated contexts (in parallel when their work is independent), and a deterministic scoring function turns their evidence into a
            score. Models choose what to investigate and explain it; code produces every number.</p>
          <div className="ag-actions">
            <button className="st-btn primary big" onClick={evaluate} disabled={busy}>{busy ? <Loader2 size={15} className="ai-spin" /> : <Play size={15} />} {busy ? 'Agents working…' : 'Evaluate a Houston parcel live'}</button>
            <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="ag-askline">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Or ask: What if we use air cooling instead?" maxLength={800} aria-label="Question for the agents" />
              <button className="st-btn" type="submit" disabled={!q.trim() || busy} aria-label="Ask"><Send size={14} /></button>
            </form>
          </div>
        </section>

        <AgentIntel s={run.state} page onDecide={(a) => void run.decide(a)} />

        <section className="ag-arch">
          <h2><Layers size={18} /> The architecture, as the server reports it</h2>
          {archErr && <p className="st-muted">{archErr}</p>}
          {!arch && !archErr && <p className="st-muted"><Loader2 size={13} className="ai-spin" /> Loading…</p>}
          {arch && (
            <>
              <div className="ag-sys">
                <div className="ag-card on"><Workflow size={16} className="ag-card-ic" /><small>Harness</small><b>Deep Agents {arch.sdk.deepagents}</b><span className="ag-card-sub">LangGraph {arch.sdk.langgraph} · LangChain {arch.sdk.langchain}</span></div>
                <div className={`ag-card ${arch.mcp.connected ? 'on' : ''}`}><Database size={16} className="ag-card-ic" /><small>CoStar MCP</small><b>{arch.mcp.connected ? `${arch.mcp.tools.length} tools` : 'Offline'}</b><span className="ag-card-sub">{arch.mcp.server} · {arch.mcp.transport}</span></div>
                <div className={`ag-card ${arch.langsmith.tracing ? 'on' : ''}`}><GitBranch size={16} className="ag-card-ic" /><small>LangSmith</small><b>{arch.langsmith.tracing ? 'Tracing on' : 'Off'}</b><span className="ag-card-sub">project {arch.langsmith.project}; agents, models, tools, computation and verification are separate run types</span></div>
                <div className="ag-card on"><ShieldCheck size={16} className="ag-card-ic" /><small>CoStar privacy</small><b>{arch.privacy.costar_fields_to_model ? 'Full records to model' : 'Redacted for models'}</b><span className="ag-card-sub">Names, addresses, prices, rents and coordinates stay in GeoStar unless enabled</span></div>
              </div>

              {orch && (
                <div className="ag-orch">
                  <div className="ag-agent-h"><span className="ai-chip c-agent"><Bot size={12} /> Orchestrator</span><b>{orch.title}</b><span className="ai-chip c-model"><Brain size={11} /> {orch.model}</span></div>
                  <p>{orch.role} Tools: {orch.tools.map((t) => t.display).join(' · ')}. Skills: {orch.skills.join(', ')}. Human approval before: {orch.approval?.join(', ')}.</p>
                </div>
              )}
              <div className="ag-subs">
                {subs.map((a) => (
                  <article key={a.name} className="ag-sub">
                    <div className="ag-agent-h"><span className="ai-chip c-agent"><Bot size={11} /> Subagent</span><b>{a.title}</b></div>
                    <p>{a.description}</p>
                    <div className="ai-calls">{a.tools.map((t) => (
                      <span key={t.name} className={`ai-chip ${t.kind === 'computation' ? 'c-compute' : 'c-tool'}`} title={t.provider}>
                        {t.kind === 'mcp' ? <Database size={10} /> : t.kind === 'computation' ? <Calculator size={10} /> : null}{t.display.replace('CoStar · ', '').replace('GeoStar · ', '')}{t.kind === 'mcp' && <em>MCP</em>}
                      </span>))}</div>
                    <small>{a.model} · returns {a.output}</small>
                  </article>
                ))}
              </div>

              <h3>The score, as code</h3>
              <table className="ai-table ag-rules">
                <thead><tr><th>Pillar</th><th>Weight</th><th>Criterion</th><th>Rule</th><th>Evidence from</th></tr></thead>
                <tbody>{arch.scoring.criteria.map((c, i) => {
                  const p = arch.scoring.pillars[c.pillar];
                  return <tr key={i}><td>{p.label}</td><td>{Math.round(p.weight * 100)}%</td><td>{c.label}</td><td>{c.rule}</td><td><code>{c.tools.join(' or ')}</code></td></tr>;
                })}</tbody>
              </table>
              <p className="st-muted st-small">{arch.scoring.verdict}</p>
              <h3>Harness features in use</h3>
              <ul className="ag-harness">{arch.harness.map((h) => <li key={h}>{h}</li>)}</ul>
              {arch.missing_tools.length > 0 && <p className="st-muted">Unavailable right now: {arch.missing_tools.join(', ')}</p>}
            </>
          )}
        </section>

        {recent.length > 0 && (
          <section className="ag-recent">
            <h2><GitBranch size={18} /> Recent runs</h2>
            <ul>{recent.map((r) => (
              <li key={r.id}><button onClick={() => run.follow(r.id, r.kind as 'site-evaluation' | 'conversation', r.title)}>
                <b>{r.title}</b><span>{r.kind === 'site-evaluation' ? 'Site evaluation' : 'Conversation'} · {r.status}{r.verdict ? ` · ${r.verdict} ${r.score ?? ''}` : ''} · {r.elapsed.toFixed(0)} s</span><ArrowRight size={13} />
              </button></li>
            ))}</ul>
          </section>
        )}
      </main>
    </div>
  );
}
