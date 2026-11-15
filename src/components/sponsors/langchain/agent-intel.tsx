'use client';
// Agent Intelligence: what the Deep Agents actually did, live. Three views of one run:
//   Live graph   the orchestrator, each subagent it delegated to (parallel ones side by side), their model and tool calls,
//                the score synthesis and the decision; every box is a runtime callback the server recorded
//   Timeline     every call on a shared clock
//   Evidence     the score breakdown, each specialist's structured findings, and the evidence records behind them
// Colours carry meaning and always come with a label: purple agent, blue model, amber tool/MCP, green done, red failed.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bot, Brain, Calculator, Check, CircleAlert, CircleCheck, ClipboardList, Copy, Database, ExternalLink, FileSearch,
  GitBranch, Hourglass, ListChecks, Loader2, Network, ShieldCheck, Timer, Wrench, X,
} from 'lucide-react';
import { Markdown } from './markdown';
import { evidenceUrl, type AgentNode, type Evidence, type Finding, type RunState, type Score } from './use-agent-run';

type Tab = 'graph' | 'timeline' | 'evidence';
type Pick = { kind: 'node'; id: string } | { kind: 'evidence'; id: string } | null;

const AGENT_TITLE: Record<string, string> = {
  'plotstar-orchestrator': 'PlotStar Orchestrator', 'property-intelligence': 'Property Intelligence',
  'financial-feasibility': 'Financial Feasibility', 'resource-infrastructure': 'Resource & Infrastructure',
  'community-sustainability': 'Community & Sustainability', 'design-simulation': 'Design & Simulation',
  'safety-operations': 'Safety & Operations', 'general-purpose': 'General purpose',
};
const KIND_LABEL: Record<string, string> = { agent: 'Deep Agent', model: 'Model call', tool: 'Tool', mcp: 'MCP tool', compute: 'Computation', verify: 'Verification', plan: 'Planning' };
const title = (name: string) => AGENT_TITLE[name] ?? name;
const sec = (ms: number | null | undefined) => (ms == null ? '…' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const modelName = (n: AgentNode) => (typeof n.model === 'string' ? n.model : n.model?.name) ?? '';

function KindIcon({ k, size = 13 }: { k: string; size?: number }) {
  const I = k === 'agent' ? Bot : k === 'model' ? Brain : k === 'mcp' ? Database : k === 'compute' ? Calculator
    : k === 'verify' ? ShieldCheck : k === 'plan' ? ListChecks : Wrench;
  return <I size={size} aria-hidden="true" />;
}

function StatusBadge({ s }: { s: string }) {
  const label = s === 'done' ? 'Done' : s === 'error' ? 'Failed' : s === 'running' ? 'Running' : s === 'awaiting_approval' ? 'Needs approval' : s === 'starting' ? 'Starting' : 'Idle';
  return <span className={`ai-status ai-s-${s}`}>{s === 'running' || s === 'starting' ? <Loader2 size={11} className="ai-spin" /> : s === 'done' ? <Check size={11} /> : s === 'error' ? <CircleAlert size={11} /> : <Hourglass size={11} />}{label}</span>;
}

export function AgentIntel({ s, onClose, onDecide, page = false }: {
  s: RunState; onClose?: () => void; onDecide?: (approve: boolean) => void; page?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('graph');
  const [pick, setPick] = useState<Pick>(null);
  const [now, setNow] = useState(() => Date.now());
  const live = s.status === 'running' || s.status === 'starting' || s.status === 'awaiting_approval';
  useEffect(() => { if (!live) return; const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, [live]);
  useEffect(() => { setPick(null); }, [s.runId]);

  const nodes = s.order.map((id) => s.nodes[id]).filter(Boolean);
  const counts = {
    agents: nodes.filter((n) => n.kind === 'agent' && n.parent !== null).length,
    models: nodes.filter((n) => n.kind === 'model').length,
    tools: nodes.filter((n) => n.kind === 'tool' || n.kind === 'compute' || n.kind === 'plan').length,
    mcp: nodes.filter((n) => n.kind === 'mcp').length,
    running: nodes.filter((n) => n.kind === 'agent' && n.parent !== null && n.status === 'running').length,
  };
  const root = nodes.find((n) => n.parent === null);
  const elapsed = root ? (root.end ?? (s.startedAt ? (now - s.startedAt) / 1000 : 0)) : 0;

  return (
    <section className={`ai ${page ? 'ai-page' : 'ai-drawer'}`} aria-label="Agent Intelligence">
      <header className="ai-head">
        <div className="ai-title">
          <span className="ai-eyebrow"><Network size={13} /> Agent Intelligence · Deep Agents</span>
          <h2>{s.title || 'No agent run yet'}</h2>
          <div className="ai-meta">
            <StatusBadge s={s.status} />
            {s.runId && <span><Timer size={12} /> {elapsed.toFixed(1)} s</span>}
            {s.runId && <span><Bot size={12} /> {counts.agents} agent{counts.agents === 1 ? '' : 's'}{counts.running ? ` · ${counts.running} active` : ''}</span>}
            {s.runId && <span><Brain size={12} /> {counts.models} model calls</span>}
            {s.runId && <span><Wrench size={12} /> {counts.tools + counts.mcp} tool calls · {counts.mcp} MCP</span>}
            {s.traceId && <TraceRef id={s.traceId} />}
          </div>
        </div>
        <nav className="ai-tabs" role="tablist">
          {([['graph', 'Live graph', GitBranch], ['timeline', 'Timeline', Timer], ['evidence', 'Evidence & decisions', FileSearch]] as const).map(([k, l, I]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><I size={13} /> {l}</button>
          ))}
        </nav>
        {onClose && <button className="ai-close" onClick={onClose} aria-label="Close Agent Intelligence"><X size={16} /></button>}
      </header>

      {s.status === 'awaiting_approval' && s.approval && (
        <div className="ai-approval" role="alert">
          <ShieldCheck size={16} />
          <div><b>A person must approve this action</b>
            {s.approval.actions.map((a, i) => <p key={i}><code>{a.name}</code> {Object.entries(a.args ?? {}).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</p>)}
          </div>
          <button className="st-btn primary" onClick={() => onDecide?.(true)}>Approve</button>
          <button className="st-btn" onClick={() => onDecide?.(false)}>Reject</button>
        </div>
      )}
      {s.error && <div className="ai-error"><CircleAlert size={14} /> {s.error}</div>}

      <div className={`ai-body ${pick ? 'has-detail' : ''}`}>
        <div className="ai-main">
          {!s.runId && s.status !== 'starting' ? <Empty /> : tab === 'graph' ? <LiveGraph s={s} nodes={nodes} pick={pick} onPick={setPick} now={now} />
            : tab === 'timeline' ? <Timeline s={s} nodes={nodes} onPick={setPick} pick={pick} now={now} />
            : <EvidenceView s={s} onPick={setPick} />}
        </div>
        {pick && (
          <aside className="ai-detail">
            <button className="ai-close" onClick={() => setPick(null)} aria-label="Close details"><X size={14} /></button>
            {pick.kind === 'node' && s.nodes[pick.id] ? <NodeDetail n={s.nodes[pick.id]} s={s} onPick={setPick} />
              : pick.kind === 'evidence' && s.runId ? <EvidenceDetail runId={s.runId} e={s.evidence[pick.id]} id={pick.id} /> : null}
          </aside>
        )}
      </div>
      <footer className="ai-legend" aria-label="Legend">
        <span className="k-agent"><Bot size={11} /> Deep Agent</span><span className="k-model"><Brain size={11} /> Model call</span>
        <span className="k-tool"><Wrench size={11} /> Tool / <Database size={11} /> MCP</span><span className="k-compute"><Calculator size={11} /> Deterministic computation</span>
        <span className="k-done"><Check size={11} /> Done</span><span className="k-error"><CircleAlert size={11} /> Failed</span><span className="k-idle"><Hourglass size={11} /> Pending</span>
        <em>Every box is a real runtime event (LangChain callback; same run ids as LangSmith).</em>
      </footer>
    </section>
  );
}

function Empty() {
  return (
    <div className="ai-empty">
      <Network size={30} strokeWidth={1.3} />
      <b>Nothing has run yet</b>
      <p>Choose a site and press <em>Analyze with agents</em>, or ask GeoStar a question. The orchestrator plans, delegates to specialists and this view fills in as they work.</p>
    </div>
  );
}

function TraceRef({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="ai-trace" title="LangSmith trace id (project: plotstar). Click to copy." onClick={() => { void navigator.clipboard?.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
      <ExternalLink size={11} /> LangSmith {id.slice(0, 8)}… {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

// ------------------------------------------------------------------------------------------------- live graph

type Row = { kind: 'wave'; agents: AgentNode[] } | { kind: 'step'; node: AgentNode };

function rows(root: AgentNode | undefined, nodes: AgentNode[]): Row[] {
  if (!root) return [];
  const subs = nodes.filter((n) => n.kind === 'agent' && n.parent === root.id).sort((a, b) => a.start - b.start);
  const steps = nodes.filter((n) => n.parent === root.id && (n.kind === 'compute' || n.name === 'dispatch_safety_alert'));
  const items: { t: number; r: Row }[] = [];
  let wave: AgentNode[] = [];
  const flush = () => { if (wave.length) items.push({ t: wave[0].start, r: { kind: 'wave', agents: wave } }); wave = []; };
  for (const a of subs) {
    // a wave is the set of agents that started before any of them finished: they ran in parallel
    const firstEnd = Math.min(...wave.map((w) => w.end ?? Infinity));
    if (wave.length && a.start > firstEnd) flush();
    wave.push(a);
  }
  flush();
  for (const n of steps) items.push({ t: n.start, r: { kind: 'step', node: n } });
  return items.sort((a, b) => a.t - b.t).map((x) => x.r);
}

function LiveGraph({ s, nodes, pick, onPick, now }: { s: RunState; nodes: AgentNode[]; pick: Pick; onPick: (p: Pick) => void; now: number }) {
  const root = nodes.find((n) => n.parent === null);
  const rs = useMemo(() => rows(root, nodes), [root, nodes]);
  const box = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<{ d: string; st: string; key: string }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // edges: orchestrator -> first row; each row -> the next; last row -> decision. Measured from the laid-out boxes.
  const chain = useMemo(() => {
    const ids: string[][] = [[root?.id ?? '']];
    for (const r of rs) ids.push(r.kind === 'wave' ? r.agents.map((a) => a.id) : [r.node.id]);
    ids.push(['final']);
    return ids;
  }, [rs, root]);
  const statusOf = (id: string) => (id === 'final' ? (s.status === 'done' ? 'done' : s.status === 'error' ? 'error' : 'idle') : s.nodes[id]?.status ?? 'idle');

  useLayoutEffect(() => {
    const host = box.current;
    if (!host) return;
    const place = () => {
      const hb = host.getBoundingClientRect();
      const at = (id: string) => host.querySelector<HTMLElement>(`[data-gid="${id}"]`)?.getBoundingClientRect();
      const out: { d: string; st: string; key: string }[] = [];
      for (let i = 0; i < chain.length - 1; i++) {
        for (const a of chain[i]) for (const b of chain[i + 1]) {
          const ra = at(a), rb = at(b);
          if (!ra || !rb) continue;
          const x1 = ra.left + ra.width / 2 - hb.left, y1 = ra.bottom - hb.top, x2 = rb.left + rb.width / 2 - hb.left, y2 = rb.top - hb.top;
          const my = (y1 + y2) / 2;
          out.push({ key: `${a}>${b}`, st: statusOf(b), d: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}` });
        }
      }
      setEdges(out);
      setSize({ w: host.scrollWidth, h: host.scrollHeight });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(host);
    return () => ro.disconnect();
  }, [chain, s.nodes, s.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!root) return <div className="ai-wait"><Loader2 size={16} className="ai-spin" /> Starting the orchestrator…</div>;
  const own = nodes.filter((n) => n.parent === root.id && n.kind !== 'agent');
  return (
    <div className="ai-graph" ref={box}>
      <svg className="ai-edges" width={size.w} height={size.h} aria-hidden="true">
        {edges.map((e) => <path key={e.key} d={e.d} className={`ai-edge e-${e.st}`} />)}
      </svg>
      <div className="ai-row">
        <OrchestratorCard n={root} s={s} own={own} picked={pick?.kind === 'node' && pick.id === root.id} onPick={onPick} />
      </div>
      {rs.map((r, i) => r.kind === 'wave' ? (
        <div key={i} className="ai-row">
          {r.agents.length > 1 && <span className="ai-parallel"><GitBranch size={11} /> Parallel · {r.agents.length} agents</span>}
          {r.agents.map((a) => <AgentCard key={a.id} n={a} s={s} nodes={nodes} picked={pick?.kind === 'node' && pick.id === a.id} onPick={onPick} now={now} />)}
        </div>
      ) : (
        <div key={i} className="ai-row">
          <StepCard n={r.node} s={s} onPick={onPick} picked={pick?.kind === 'node' && pick.id === r.node.id} />
        </div>
      ))}
      <div className="ai-row"><DecisionCard s={s} /></div>
    </div>
  );
}

function OrchestratorCard({ n, s, own, picked, onPick }: { n: AgentNode; s: RunState; own: AgentNode[]; picked: boolean; onPick: (p: Pick) => void }) {
  const models = own.filter((x) => x.kind === 'model');
  return (
    <div data-gid={n.id} className={`ai-card ai-orch st-${n.status} ${picked ? 'picked' : ''}`}>
      <button className="ai-card-head" onClick={() => onPick({ kind: 'node', id: n.id })}>
        <span className="ai-chip c-agent"><Bot size={12} /> Orchestrator</span>
        <b>PlotStar Orchestrator</b>
        <StatusBadge s={n.status} />
      </button>
      <p className="ai-goal"><span>Goal</span>{s.kind === 'site-evaluation' ? 'Produce a scored, evidence-backed recommendation for this site.' : s.title}</p>
      <div className="ai-sub">
        <span className="ai-chip c-model"><Brain size={11} /> {modelName(n)}</span>
        <span>{models.length} model call{models.length === 1 ? '' : 's'} · {sec(n.ms)}</span>
      </div>
      {s.plan.length > 0 && (
        <ol className="ai-plan" aria-label="Plan (write_todos)" title="The orchestrator's own plan, written with the write_todos tool">
          {s.plan.map((t, i) => {
            // the plan is what the orchestrator last wrote with write_todos; once the run stops, nothing is still in progress
            const st = t.status === 'in_progress' && n.status !== 'running' ? 'stale' : t.status;
            return <li key={i} className={`p-${st}`}>{st === 'completed' ? <CircleCheck size={12} /> : st === 'in_progress' ? <Loader2 size={12} className="ai-spin" /> : <ClipboardList size={12} />}{t.content}</li>;
          })}
        </ol>
      )}
      <div className="ai-calls">{own.filter((x) => x.kind !== 'compute').slice(-6).map((c) => <CallChip key={c.id} n={c} onPick={onPick} />)}</div>
    </div>
  );
}

function AgentCard({ n, s, nodes, picked, onPick, now }: { n: AgentNode; s: RunState; nodes: AgentNode[]; picked: boolean; onPick: (p: Pick) => void; now: number }) {
  const calls = nodes.filter((c) => c.parent === n.id);
  const f = s.findings[n.name] as Finding | undefined;
  const mcp = calls.filter((c) => c.kind === 'mcp').length;
  const live = n.status === 'running' && s.startedAt ? ((now - s.startedAt) / 1000 - n.start) * 1000 : null;
  return (
    <div data-gid={n.id} className={`ai-card ai-agent st-${n.status} ${picked ? 'picked' : ''}`}>
      <button className="ai-card-head" onClick={() => onPick({ kind: 'node', id: n.id })}>
        <span className="ai-chip c-agent"><Bot size={12} /> Deep Agent</span>
        <b>{title(n.name)}</b>
        <StatusBadge s={n.status} />
      </button>
      {n.objective && <p className="ai-goal"><span>Task</span>{n.objective}</p>}
      <div className="ai-sub">
        <span className="ai-chip c-model"><Brain size={11} /> {modelName(n)}</span>
        <span>{sec(n.ms ?? (live != null ? Math.round(live) : null))} · {calls.filter((c) => c.kind === 'model').length} model · {calls.length - calls.filter((c) => c.kind === 'model').length} tools{mcp ? ` (${mcp} MCP)` : ''}</span>
      </div>
      <div className="ai-calls">
        {calls.slice(0, 9).map((c) => <CallChip key={c.id} n={c} onPick={onPick} />)}
        {calls.length > 9 && <span className="ai-more">+{calls.length - 9} more</span>}
      </div>
      {f && (
        <div className={`ai-finding f-${f.status.replace(/\s/g, '-')}`}>
          <b>{f.status}</b><span>{f.summary}</span>
          <small>Confidence {f.confidence} · {f.evidence.length} evidence item{f.evidence.length === 1 ? '' : 's'}</small>
        </div>
      )}
    </div>
  );
}

function StepCard({ n, s, picked, onPick }: { n: AgentNode; s: RunState; picked: boolean; onPick: (p: Pick) => void }) {
  const isScore = n.name === 'compute_site_score';
  return (
    <button data-gid={n.id} className={`ai-card ai-step st-${n.status} ${picked ? 'picked' : ''}`} onClick={() => onPick({ kind: 'node', id: n.id })}>
      <span className={`ai-chip ${isScore ? 'c-compute' : 'c-tool'}`}><KindIcon k={n.kind} size={12} /> {isScore ? 'Deterministic computation' : 'Action'}</span>
      <b>{isScore ? 'Score synthesis' : n.label}</b>
      {isScore && s.score ? <span className="ai-step-out">{s.score.score ?? '—'} · {s.score.verdict} · coverage {Math.round(s.score.coverage * 100)}%</span> : <span className="ai-step-out">{n.output ?? sec(n.ms)}</span>}
      <StatusBadge s={n.status} />
    </button>
  );
}

function DecisionCard({ s }: { s: RunState }) {
  const v = s.verification;
  return (
    <div data-gid="final" className={`ai-card ai-final st-${s.status === 'done' ? 'done' : s.status === 'error' ? 'error' : 'idle'}`}>
      <div className="ai-card-head as-div">
        <span className="ai-chip c-final"><CircleCheck size={12} /> {s.kind === 'site-evaluation' ? 'Final decision' : 'Answer'}</span>
        {s.score && <b>{s.score.verdict} · {s.score.score ?? '—'}</b>}
        {v && <span className={`ai-verify ${v.grounded ? 'ok' : 'warn'}`}><ShieldCheck size={11} /> {v.grounded ? `${v.numbers_checked} numbers verified` : `${v.unverified_numbers.length} unverified number(s)`}</span>}
      </div>
      {s.answer ? <Markdown text={s.answer} className="ai-answer" /> : <p className="ai-dim">{s.status === 'error' ? 'The run failed before an answer.' : 'Waiting for the orchestrator to combine the findings…'}</p>}
    </div>
  );
}

function CallChip({ n, onPick }: { n: AgentNode; onPick: (p: Pick) => void }) {
  const cls = n.kind === 'model' ? 'c-model' : n.kind === 'compute' ? 'c-compute' : n.kind === 'plan' ? 'c-plan' : 'c-tool';
  return (
    <button className={`ai-chip ai-call ${cls} st-${n.status}`} onClick={(e) => { e.stopPropagation(); onPick({ kind: 'node', id: n.id }); }}
      title={`${KIND_LABEL[n.kind]} · ${n.label}${n.ms != null ? ` · ${sec(n.ms)}` : ''}`}>
      <KindIcon k={n.kind} size={11} />
      <span>{n.kind === 'model' ? 'model' : n.label}</span>
      {n.kind === 'mcp' && <em>MCP</em>}
      {n.status === 'running' ? <Loader2 size={10} className="ai-spin" /> : n.status === 'error' ? <CircleAlert size={10} /> : <small>{sec(n.ms)}</small>}
    </button>
  );
}

// --------------------------------------------------------------------------------------------------- timeline

function Timeline({ s, nodes, onPick, pick, now }: { s: RunState; nodes: AgentNode[]; onPick: (p: Pick) => void; pick: Pick; now: number }) {
  const t = (s.startedAt ? (now - s.startedAt) / 1000 : 0);
  const total = Math.max(1, ...nodes.map((n) => n.end ?? t));
  const depth = (n: AgentNode) => { let d = 0, p = n.parent; while (p && d < 6) { d++; p = s.nodes[p]?.parent ?? null; } return d; };
  return (
    <div className="ai-timeline">
      <div className="ai-tl-axis">{[0, 0.25, 0.5, 0.75, 1].map((f) => <span key={f} style={{ left: `${f * 100}%` }}>{(f * total).toFixed(0)} s</span>)}</div>
      {nodes.map((n) => {
        const end = n.end ?? t, left = (n.start / total) * 100, width = Math.max(0.6, ((end - n.start) / total) * 100);
        return (
          <button key={n.id} className={`ai-tl-row ${pick?.kind === 'node' && pick.id === n.id ? 'picked' : ''}`} onClick={() => onPick({ kind: 'node', id: n.id })}>
            <span className="ai-tl-name" style={{ paddingLeft: depth(n) * 14 }}>
              <span className={`ai-dot k-${n.kind}`}><KindIcon k={n.kind} size={10} /></span>
              {n.kind === 'agent' ? title(n.name) : n.kind === 'model' ? `Model · ${modelName(n)}` : n.label}
            </span>
            <span className="ai-tl-track"><i className={`k-${n.kind} st-${n.status}`} style={{ left: `${left}%`, width: `${width}%` }} /></span>
            <span className="ai-tl-ms">{sec(n.ms)}</span>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------------------------------ evidence & decisions

function EvidenceView({ s, onPick }: { s: RunState; onPick: (p: Pick) => void }) {
  const ev = Object.values(s.evidence);
  const eChip = (id: string | null) => id ? <button className="ai-eid" onClick={() => onPick({ kind: 'evidence', id })}>{id}</button> : <span className="ai-gap">gap</span>;
  return (
    <div className="ai-evidence">
      {s.score && <ScoreCard sc={s.score} eChip={eChip} />}
      {s.answer && (
        <section className="ai-block"><h3>Recommendation</h3><Markdown text={s.answer} className="ai-answer" />
          {s.verification && <p className={`ai-verify-line ${s.verification.grounded ? 'ok' : 'warn'}`}><ShieldCheck size={13} /> {s.verification.note}</p>}
        </section>
      )}
      {Object.keys(s.findings).length > 0 && (
        <section className="ai-block"><h3>What each specialist found</h3>
          <div className="ai-findings">{Object.values(s.findings).map((f) => (
            <article key={f.agent} className={`ai-fcard f-${f.status.replace(/\s/g, '-')}`}>
              <header><Bot size={13} /><b>{title(f.agent)}</b><span className="ai-fstatus">{f.status}</span></header>
              <p className="ai-fsum">{f.summary}</p>
              <List t="Findings" xs={f.findings} /><List t="Calculations (by tools)" xs={f.calculations} /><List t="Assumptions" xs={f.assumptions} />
              <List t="Risks" xs={f.risks} /><List t="Next steps" xs={f.next_steps} />
              <footer>Confidence <b>{f.confidence}</b> · {f.confidence_reason}<div className="ai-ev-row">{f.evidence.map((r) => <span key={r.id}>{eChip(r.id)} {r.what}</span>)}</div></footer>
            </article>
          ))}</div>
        </section>
      )}
      <section className="ai-block"><h3>Evidence records ({ev.length})</h3>
        {ev.length === 0 ? <p className="ai-dim">No tool has returned evidence yet.</p> : (
          <table className="ai-table"><thead><tr><th>Id</th><th>Tool</th><th>Source</th><th>Label</th><th>Gathered by</th><th /></tr></thead>
            <tbody>{ev.map((e) => (
              <tr key={e.id}><td>{eChip(e.id)}</td><td>{e.tool}</td><td>{e.provider.startsWith('costar') ? <span className="ai-chip c-tool"><Database size={10} /> CoStar MCP</span> : 'GeoStar engine'}</td>
                <td>{e.label ?? '—'}</td><td>{e.agent ? title(e.agent) : '—'}</td>
                <td>{e.redacted && <span className="ai-priv" title="CoStar descriptive fields were withheld from the model; the full record is shown here">model saw a redacted view</span>}</td></tr>
            ))}</tbody></table>
        )}
      </section>
    </div>
  );
}

function List({ t, xs }: { t: string; xs: string[] }) {
  if (!xs?.length) return null;
  return <div className="ai-list"><small>{t}</small><ul>{xs.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
}

function ScoreCard({ sc, eChip }: { sc: Score; eChip: (id: string | null) => ReactNode }) {
  return (
    <section className="ai-block ai-score">
      <div className="ai-score-top">
        <div className={`ai-score-big v-${sc.verdict.replace(/\s/g, '-').toLowerCase()}`}><b>{sc.score ?? '—'}</b><span>{sc.verdict}</span></div>
        <div><p>{sc.verdict_reason}</p>
          <p className="ai-dim">Coverage {Math.round(sc.coverage * 100)}% of the scoring weight · confidence {sc.confidence}. Computed by deterministic code from the evidence below; no model output enters the arithmetic.</p>
          {sc.gates.length > 0 && <div className="ai-gates">{sc.gates.map((g) => <span key={g.gate} className={`g-${g.status.replace(/\s/g, '-')}`}>{g.status === 'Pass' ? <Check size={11} /> : <CircleAlert size={11} />} {g.gate}</span>)}</div>}
        </div>
      </div>
      <table className="ai-table ai-crit">
        <thead><tr><th>Pillar · criterion</th><th>Reading</th><th>Score</th><th>Weight</th><th>Evidence</th><th>Agent</th></tr></thead>
        <tbody>{sc.pillars.map((p) => [
          <tr key={p.key} className="ai-pillar"><td>{p.label}</td><td /><td><Bar v={p.score} /></td><td>{Math.round(p.effective_weight * 100)}%</td><td /><td>{title(p.agent)}</td></tr>,
          ...p.criteria.map((c) => (
            <tr key={`${p.key}-${c.key}`}><td title={c.rule}>{c.label}<small>{c.rule}</small></td><td>{c.reading}</td><td><Bar v={c.score} /></td><td /><td>{eChip(c.evidence)}</td><td>{c.agent ? title(c.agent) : '—'}</td></tr>
          )),
        ])}</tbody>
      </table>
      {sc.gaps.length > 0 && <div className="ai-gaps"><b>Evidence gaps</b>{sc.gaps.map((g) => <p key={g.criterion}><CircleAlert size={12} /> {g.criterion}: {g.reason}</p>)}</div>}
      {sc.conflicts.length > 0 && <div className="ai-gaps warn"><b>Conflicts the orchestrator was told about</b>{sc.conflicts.map((c) => <p key={c.agent}><CircleAlert size={12} /> {c.note}</p>)}</div>}
    </section>
  );
}

function Bar({ v }: { v: number | null }) {
  if (v == null) return <span className="ai-gap">no evidence</span>;
  return <span className="ai-bar"><i style={{ width: `${v}%` }} /><em>{Math.round(v)}</em></span>;
}

// ------------------------------------------------------------------------------------------------------ detail

function NodeDetail({ n, s, onPick }: { n: AgentNode; s: RunState; onPick: (p: Pick) => void }) {
  const children = s.order.map((id) => s.nodes[id]).filter((c) => c?.parent === n.id);
  const f = n.kind === 'agent' ? s.findings[n.name] : undefined;
  return (
    <div className="ai-dt">
      <span className={`ai-chip ${n.kind === 'agent' ? 'c-agent' : n.kind === 'model' ? 'c-model' : n.kind === 'compute' ? 'c-compute' : 'c-tool'}`}><KindIcon k={n.kind} size={12} /> {KIND_LABEL[n.kind]}</span>
      <h3>{n.kind === 'agent' ? title(n.name) : n.label}</h3>
      <dl>
        <dt>Status</dt><dd><StatusBadge s={n.status} />{n.error && <span className="ai-err"> {n.error}</span>}</dd>
        <dt>Timing</dt><dd>started {n.start.toFixed(1)} s · {sec(n.ms)}</dd>
        {n.kind !== 'agent' && n.agent && <><dt>Called by</dt><dd>{title(n.agent)}</dd></>}
        {n.kind === 'agent' && n.role && <><dt>Responsibility</dt><dd>{n.role}</dd></>}
        {(n.kind === 'model' || n.kind === 'agent') && modelName(n) && <><dt>Model</dt><dd>{typeof n.model === 'object' && n.model ? `${n.model.provider} · ` : 'anthropic · '}{modelName(n)}</dd></>}
        {n.tokens && <><dt>Tokens</dt><dd>{n.tokens.input ?? '?'} in · {n.tokens.output ?? '?'} out</dd></>}
        {n.provider && <><dt>Provider</dt><dd>{n.provider}</dd></>}
        {n.delegation_id && <><dt>Delegation</dt><dd><code>{n.delegation_id}</code> (the orchestrator&apos;s <code>task</code> call)</dd></>}
        <dt>LangSmith run</dt><dd><code>{n.lc_run_id}</code></dd>
      </dl>
      {n.objective && <><h4>Task it was given</h4><p className="ai-pre">{n.objective}</p></>}
      {n.args && Object.keys(n.args).length > 0 && (
        <><h4>Validated input</h4><table className="ai-table ai-kv"><tbody>{Object.entries(n.args).map(([k, v]) => <tr key={k}><td>{k}</td><td><code>{typeof v === 'string' ? v : JSON.stringify(v)}</code></td></tr>)}</tbody></table></>
      )}
      {n.kind === 'model' && n.input && <><h4>Prompt preview</h4><p className="ai-pre">{n.input}</p></>}
      {n.output && <><h4>{n.kind === 'model' ? 'Output preview' : 'Output summary'}</h4><p className="ai-pre">{n.output}</p></>}
      {n.evidence.length > 0 && <><h4>Evidence</h4><div className="ai-ev-row">{n.evidence.map((e) => <button key={e} className="ai-eid" onClick={() => onPick({ kind: 'evidence', id: e })}>{e}</button>)}</div></>}
      {f && <><h4>Structured findings</h4><p className="ai-pre">{f.summary}</p><List t="Findings" xs={f.findings} /><List t="Risks" xs={f.risks} /><List t="Next steps" xs={f.next_steps} /></>}
      {children.length > 0 && <><h4>Calls ({children.length})</h4><div className="ai-calls">{children.map((c) => <CallChip key={c.id} n={c} onPick={onPick} />)}</div></>}
    </div>
  );
}

function EvidenceDetail({ runId, e, id }: { runId: string; e?: Evidence; id: string }) {
  const [full, setFull] = useState<Evidence | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setFull(null); setErr(null);
    fetch(evidenceUrl(runId, id)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))).then(setFull).catch((x) => setErr(String(x)));
  }, [runId, id]);
  const rec = full ?? e;
  return (
    <div className="ai-dt">
      <span className={`ai-chip ${rec?.provider?.startsWith('costar') ? 'c-tool' : 'c-compute'}`}><Database size={12} /> Evidence {id}</span>
      <h3>{rec?.tool ?? id}</h3>
      {rec && (
        <dl>
          <dt>Source</dt><dd>{rec.provider.startsWith('costar') ? 'CoStar MCP server (GeoStar, in-process)' : 'GeoStar engine'}</dd>
          <dt>Label</dt><dd>{rec.label ?? '—'}</dd>
          <dt>Gathered by</dt><dd>{rec.agent ? title(rec.agent) : '—'}</dd>
          <dt>References</dt><dd>{rec.source_count} source reference{rec.source_count === 1 ? '' : 's'}</dd>
          {rec.redacted && <><dt>Privacy</dt><dd>The model saw a redacted view (no CoStar names, addresses, prices, rents or coordinates). The full record below stays in GeoStar.</dd></>}
        </dl>
      )}
      {err && <p className="ai-err">Could not load the record ({err}).</p>}
      {full ? <>
        {full.redacted && <><h4>What the model saw</h4><pre className="ai-json">{JSON.stringify(full.view, null, 2).slice(0, 6000)}</pre></>}
        <h4>Full tool output</h4><pre className="ai-json">{JSON.stringify(full.data, null, 2).slice(0, 20000)}</pre>
        {full.sources.length > 0 && <><h4>Sources</h4><ul className="ai-src">{full.sources.slice(0, 20).map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      </> : !err && <p className="ai-dim"><Loader2 size={12} className="ai-spin" /> Loading the record…</p>}
    </div>
  );
}
