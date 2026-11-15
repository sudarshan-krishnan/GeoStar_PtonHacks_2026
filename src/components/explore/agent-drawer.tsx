'use client';
// "Ask the agent": a LangChain deep agent that plans, delegates to sub-agents and calls the real tools.
// The panel shows its plan and every tool call as it happens.
import { useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';

type Step = { kind: 'approval'; actions: { name: string; args: Record<string, unknown> }[]; decided?: string } | { kind: 'plan'; todos: { content: string; status: string }[] } | { kind: 'tool'; label: string; done: boolean };
interface Turn { role: 'user' | 'assistant'; content: string; steps?: Step[]; model?: string }

const LABEL: Record<string, (a: Record<string, unknown>) => string> = {
  get_run: () => 'Read the optimizer result',
  run_what_if: (a) => `Re-ran the optimizer with ${String(a.changes_json ?? '').slice(0, 90)}`,
  run_optimizer: (a) => `Ran the optimizer for ${a.mw_it} MW`,
  grid_day: () => 'Read the ERCOT grid day',
  search_sites: (a) => `Searched ${a.market ?? 'Houston'} properties`,
  site_detail: (a) => `Looked up ${a.parcel_id}`,
  local_conditions: () => 'Fetched climate, solar, census and power price',
  trigger_grid_event: () => 'Started a grid event on the test machines',
  write_file: (a) => `Saved a note: ${a.file_path ?? ''}`,
  read_file: (a) => `Read ${a.file_path ?? 'a file'}`,
  ls: () => 'Checked saved notes',
  task: (a) => `Delegated to ${a.subagent_type ?? 'a sub-agent'}: ${String(a.description ?? '').slice(0, 80)}`,
};
const SUGGEST = ['Test the plan: trigger a grid event on the machines', 'Why this site and not the cheapest one?', 'What if the utility only supplies 70% here and nothing is flexible?', 'Which rejected site came closest, and what ruled it out?', 'What is the area around the recommended site like?'];

export function AgentDrawer({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const thread = useRef<string>(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));

  async function send(text: string, resume?: 'approve' | 'reject') {
    if ((!resume && !text.trim()) || busy) return;
    if (!resume) setTurns((ts) => [...ts, { role: 'user', content: text }, { role: 'assistant', content: '', steps: [] }]);
    else setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, content: '', steps: (t.steps ?? []).map((s) => (s.kind === 'approval' ? { ...s, decided: resume } : s)) } : t)));
    setInput(''); setBusy(true);
    const patch = (f: (t: Turn) => Turn) => setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? f(t) : t)));
    try {
      const r = await fetch(`${PUBLIC_DATA_API}/agent/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resume ? { run_id: runId, thread_id: thread.current, resume } : { run_id: runId, thread_id: thread.current, messages: [{ role: 'user', content: text }] }) });
      if (!r.ok || !r.body) throw new Error(`agent failed (${r.status})`);
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const p of parts) {
          if (!p.startsWith('data: ')) continue;
          const ev = JSON.parse(p.slice(6));
          if (ev.type === 'plan') patch((t) => ({ ...t, steps: [...(t.steps ?? []).filter((s) => s.kind !== 'plan'), { kind: 'plan', todos: ev.todos }] }));
          else if (ev.type === 'approval') patch((t) => ({ ...t, content: ' ', steps: [...(t.steps ?? []), { kind: 'approval', actions: ev.actions }] }));
          else if (ev.type === 'tool') patch((t) => ({ ...t, steps: [...(t.steps ?? []), { kind: 'tool', label: (LABEL[ev.name] ?? (() => ev.name))(ev.args ?? {}), done: false }] }));
          else if (ev.type === 'result') patch((t) => { const s = [...(t.steps ?? [])]; const i = s.findIndex((x) => x.kind === 'tool' && !x.done); if (i >= 0) s[i] = { ...(s[i] as Extract<Step, { kind: 'tool' }>), done: true }; return { ...t, steps: s }; });
          else if (ev.type === 'answer') patch((t) => ({ ...t, content: ev.text, model: ev.model, steps: (t.steps ?? []).map((s) => (s.kind === 'tool' ? { ...s, done: true } : s)) }));
          else if (ev.type === 'error') patch((t) => ({ ...t, content: `The agent hit an error: ${ev.text}` }));
          end.current?.scrollIntoView({ behavior: 'smooth' });
        }
      }
    } catch (e) {
      patch((t) => ({ ...t, content: (e as Error).message }));
    } finally { setBusy(false); }
  }

  return (
    <div className="ws-drawer-bg" onClick={onClose}>
      <div className="ws-drawer narrow ag" onClick={(e) => e.stopPropagation()}>
        <div className="ws-drawer-head"><h2>Ask the agent</h2><button className="ws-btn sm" onClick={onClose}><X size={12} /> Close</button></div>
        <div className="ws-drawer-body ag-body">
          {turns.length === 0 && (
            <div className="ag-empty">
              <p>A LangChain deep agent. It plans, hands work to two specialist sub-agents (site research and scenarios), and calls the real screening and optimizer tools. It only reports numbers those tools return.</p>
              {SUGGEST.map((s) => <button key={s} onClick={() => void send(s)}>{s}</button>)}
              {!runId && <small>Run a search first so it has a result to work from.</small>}
            </div>
          )}
          {turns.map((t, i) => t.role === 'user' ? <div key={i} className="ag-user">{t.content}</div> : (
            <div key={i} className="ag-bot">
              {(t.steps ?? []).map((s, j) => s.kind === 'plan' ? (
                <div key={j} className="ag-plan"><b>Plan</b>{s.todos.map((d, k) => <span key={k} className={d.status}>{d.status === 'completed' ? '✓' : d.status === 'in_progress' ? '▸' : '○'} {d.content}</span>)}</div>
              ) : s.kind === 'approval' ? (
                <div key={j} className="ag-approve"><b>Approval needed</b><span>The agent wants to start a grid event on the live test machines{s.actions[0]?.args?.duration_s ? ` for ${String(s.actions[0].args.duration_s)} s` : ''}.</span>
                  {s.decided ? <em>{s.decided === 'approve' ? 'Approved' : 'Declined'}</em> : <div><button className="ws-btn primary" disabled={busy} onClick={() => void send('', 'approve')}>Approve</button><button className="ws-btn" disabled={busy} onClick={() => void send('', 'reject')}>Decline</button></div>}
                </div>
              ) : <div key={j} className={`ag-step ${s.done ? 'done' : ''}`}><i />{s.label}</div>)}
              {t.content.trim() ? <div className="ag-answer">{t.content}</div> : t.content === ' ' ? null : <div className="ag-step"><i />Working…</div>}
              {t.model && <small>{t.model === 'deterministic' ? 'No language model: built from the optimizer outputs.' : `LangChain deep agent · Claude (${t.model})`}</small>}
            </div>
          ))}
          <div ref={end} />
        </div>
        <form className="ag-input" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about sites, costs or a what-if…" disabled={busy} />
          <button className="ws-btn primary" disabled={busy || !input.trim()}><Send size={13} /></button>
        </form>
      </div>
    </div>
  );
}
