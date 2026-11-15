'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  Box,
  Check,
  FileText,
  FolderOpen,
  MapPin,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { Brand } from '../brand';
import { Button } from '../ui/button';
import type { Project } from '@/lib/types';
import { typeLabels } from '@/lib/engine';
import { Discover } from './discover';
import { DesignStudio } from './design-studio';
import { Protect } from './protect';
import { Report } from './report';
export type Mutate = (
  body: Record<string, unknown>,
  endpoint?: string,
  method?: string,
) => Promise<Project | null>;
export function Workspace({ id }: { id: string }) {
  const [p, setP] = useState<Project | null>(null),
    [tab, setTab] = useState('discover'),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [assistant, setAssistant] = useState(false),
    [question, setQuestion] = useState(''),
    [thinking, setThinking] = useState(false),
    [connected, setConnected] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${id}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (alive) {
          setP(d);
          setTab(d.stage);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  useEffect(() => {
    if (tab !== 'protect' || !p) return;
    const s = new EventSource(`/api/projects/${id}/events`);
    s.onopen = () => setConnected(true);
    s.onerror = () => setConnected(false);
    s.addEventListener('project', (e) => setP(JSON.parse(e.data)));
    return () => {
      s.close();
      setConnected(false);
    };
  }, [tab, id, !!p]);
  const mutate: Mutate = useCallback(
    async (body, endpoint = '', method = 'PATCH') => {
      setBusy(true);
      setError('');
      try {
        const r = await fetch(`/api/projects/${id}${endpoint}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setP(d);
        return d;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [id],
  );
  async function ask(value = question) {
    if (!value.trim() || thinking) return;
    setQuestion('');
    setThinking(true);
    setError('');
    try {
      const r = await fetch(`/api/projects/${id}/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: value }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setP(d.project);
    } catch (e) {
      setError((e as Error).message);
      setQuestion(value);
    } finally {
      setThinking(false);
    }
  }
  if (loading)
    return (
      <div className="loading-screen">
        <Sparkles />
        <h2>Opening the possibilities…</h2>
      </div>
    );
  if (!p)
    return (
      <div className="loading-screen">
        <h2>{error || 'Project not found'}</h2>
        <Link href="/projects">Back to projects</Link>
      </div>
    );
  const stages = [
    { id: 'discover', name: 'Discover', icon: MapPin, sub: 'Find your place' },
    { id: 'design', name: 'Design', icon: Box, sub: 'Shape the vision' },
    { id: 'protect', name: 'Protect', icon: ShieldCheck, sub: 'Connect & safeguard' },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand light />
        <Link className="back-projects" href="/projects">
          <ArrowLeft size={15} /> All developments
        </Link>
        <div className="project-sidebar-title">
          <span className="eyebrow">YOUR DEVELOPMENT</span>
          <h3>{p.name}</h3>
          <span className="badge badge-dark">{typeLabels[p.type]}</span>
        </div>
        <div className="side-section-label">PROJECT LIFECYCLE</div>
        {stages.map((s, i) => (
          <button
            key={s.id}
            className={`stage-nav ${tab === s.id ? 'active' : ''}`}
            onClick={() => setTab(s.id)}
          >
            <div className="stage-nav-icon">
              <s.icon size={18} />
            </div>
            <span>
              <b>{s.name}</b>
              <small>{s.sub}</small>
            </span>
            {(s.id === 'discover' && p.selectedSiteId) ||
            (s.id === 'design' && p.approvedDesignId) ? (
              <Check size={14} />
            ) : (
              <span className="stage-nav-num">0{i + 1}</span>
            )}
          </button>
        ))}
        <div className="side-divider" />
        <button
          className={`side-nav ${tab === 'report' ? 'active' : ''}`}
          onClick={() => setTab('report')}
        >
          <FileText size={18} /> Project report
        </button>
        <button className="side-nav" onClick={() => setAssistant(true)}>
          <Sparkles size={18} /> GeoStar assistant <span className="ai-tag">AI</span>
        </button>
        <div className="sidebar-bottom">
          <div className="project-saved">
            <span className="pulse-dot" />
            <div>
              Progress, preserved.<small>Saved in your local workspace</small>
            </div>
          </div>
          <div className="profile">
            <span>PS</span>
            <div>
              GeoStar studio<small>Connected development</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div>
            <Link href="/projects">Developments</Link>
            <span>/</span>
            <b>{p.name.split(' · ')[0]}</b>
            <span>/</span>
            <span className="capitalize">{tab}</span>
          </div>
          <div className="topbar-right">
            <span className="saved-indicator">
              <span className="pulse-dot" />
              {busy ? 'Saving…' : 'All changes saved'}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setTab('report')}>
              <FileText size={15} /> Report
            </Button>
            <span className="avatar">PS</span>
          </div>
        </header>
        <main className="workspace-content">
          <div className="workspace-page-heading">
            <div>
              <div className="eyebrow">
                {tab === 'discover'
                  ? '01 / SITE INTELLIGENCE'
                  : tab === 'design'
                    ? '02 / CONCEPT ARCHITECT'
                    : tab === 'protect'
                      ? '03 / HAVEN INTELLIGENCE'
                      : 'YOUR INVESTMENT & PLANNING REPORT'}
              </div>
              <h1>
                {tab === 'discover'
                  ? 'Good things start in the right place.'
                  : tab === 'design'
                    ? 'Give your vision a new dimension.'
                    : tab === 'protect'
                      ? 'A little foresight. A lot more confidence.'
                      : 'The whole picture, in one place.'}
              </h1>
              <p>
                {tab === 'discover'
                  ? 'Explore your candidates. Understand the tradeoffs. Find your next possibility.'
                  : tab === 'design'
                    ? 'Explore, refine, and compare conceptual alternatives for your selected site.'
                    : tab === 'protect'
                      ? 'Plan your sensor network and explore event-driven building intelligence.'
                      : 'A connected view of every decision, assumption, and outstanding question.'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setAssistant(true)}>
              <Sparkles size={15} /> Ask GeoStar
            </Button>
          </div>
          {error && (
            <div className="notice error" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {tab === 'discover' && (
            <Discover p={p} mutate={mutate} busy={busy} onContinue={() => setTab('design')} />
          )}
          {tab === 'design' && (
            <DesignStudio
              p={p}
              mutate={mutate}
              busy={busy}
              onContinue={() => setTab('protect')}
              onDiscover={() => setTab('discover')}
            />
          )}
          {tab === 'protect' && (
            <Protect
              p={p}
              mutate={mutate}
              busy={busy}
              connected={connected}
              onDesign={() => setTab('design')}
            />
          )}
          {tab === 'report' && <Report p={p} />}
          <footer className="workspace-footer">
            <span>
              <ShieldCheck size={14} /> Conceptual planning. Informed decisions.
            </span>
            <span>Illustrative data · Professional review required</span>
          </footer>
        </main>
      </div>
      {!assistant && (
        <button className="assistant-fab" onClick={() => setAssistant(true)}>
          <Sparkles size={19} />
          <span>Ask GeoStar</span>
          <span className="fab-dot" />
        </button>
      )}
      {assistant && (
        <aside className="assistant-panel" aria-label="GeoStar assistant">
          <header>
            <div>
              <Sparkles size={19} />
              <span>
                GeoStar intelligence<small>CONTEXTUAL TO YOUR PROJECT</small>
              </span>
            </div>
            <button aria-label="Close assistant" onClick={() => setAssistant(false)}>
              <X size={19} />
            </button>
          </header>
          <div className="assistant-messages">
            <div className="assistant-intro">
              <Sparkles />
              <h3>A clearer perspective.</h3>
              <p>
                I know your brief, site assumptions, saved designs, and monitoring events. What
                would you like to explore?
              </p>
            </div>
            {p.messages.map((m) => (
              <div className={`chat-message ${m.role}`} key={m.id}>
                <span>{m.role === 'user' ? 'YOU' : 'GEOSTAR'}</span>
                <p>{m.content}</p>
              </div>
            ))}
            {thinking && (
              <div className="chat-message assistant">
                <span>GEOSTAR</span>
                <p className="thinking">Connecting the dots…</p>
              </div>
            )}
          </div>
          <div className="assistant-suggestions">
            {[
              'Why is the top site better?',
              'What if land prices increase 20%?',
              'What if I add two more floors?',
              'Where should I place leak sensors?',
            ].map((q) => (
              <button disabled={thinking} key={q} onClick={() => void ask(q)}>
                {q}
                <ArrowUpRight size={13} />
              </button>
            ))}
          </div>
          <form
            className="assistant-form"
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
          >
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about your development…"
              aria-label="Ask about your project"
              maxLength={1500}
              minLength={3}
            />
            <Button
              size="icon"
              aria-label="Send question"
              disabled={thinking || question.trim().length < 3}
            >
              <ArrowUpRight size={19} />
            </Button>
          </form>
          <p className="assistant-disclaimer">
            Deterministic calculations. Optional LLM explanations.
            <br />
            Illustrative data; verify decisions with qualified professionals.
          </p>
        </aside>
      )}
    </div>
  );
}
