'use client';
// The compact live indicator: "Analyzing site — 3 agents active". Clicking it opens Agent Intelligence.
import { Bot, Check, CircleAlert, Loader2, Network, ShieldCheck } from 'lucide-react';
import { activeAgents, type RunState } from './use-agent-run';

export function AgentStatusPill({ s, onOpen }: { s: RunState; onOpen: () => void }) {
  const n = activeAgents(s);
  const running = s.status === 'running' || s.status === 'starting';
  const label = s.status === 'awaiting_approval' ? 'Agents need your approval'
    : running ? `${s.kind === 'conversation' ? 'Answering' : 'Analyzing site'}${n ? ` — ${n} agent${n === 1 ? '' : 's'} active` : ' — orchestrator planning'}`
    : s.status === 'done' ? (s.score ? `Agents: ${s.score.verdict} · ${s.score.score ?? '—'}` : 'Agents: answered')
    : s.status === 'error' ? 'Agents: run failed' : 'Agent Intelligence';
  const Icon = s.status === 'awaiting_approval' ? ShieldCheck : running ? Loader2 : s.status === 'done' ? Check : s.status === 'error' ? CircleAlert : Network;
  return (
    <button type="button" className={`ai-pill ai-pill-${s.status}`} onClick={onOpen} aria-live="polite" title="Open Agent Intelligence: the live graph of what the agents are doing">
      <Icon size={13} className={running ? 'ai-spin' : undefined} />
      <span>{label}</span>
      {running && n > 0 && <span className="ai-pill-dots" aria-hidden="true">{Array.from({ length: Math.min(n, 6) }, (_, i) => <Bot key={i} size={10} />)}</span>}
    </button>
  );
}
