'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  FolderOpen,
  MapPin,
  Box,
  ShieldCheck,
  Sparkles,
  Building2,
  Cpu,
  Trees,
  Search,
  X,
  Check,
  FileText,
  GitCompareArrows,
} from 'lucide-react';
import { Brand, Star } from './brand';
import { Button } from './ui/button';
import { CityArt } from './city-art';
import type { Project } from '@/lib/types';
import { finances, money, rankSites, scoreSite, typeLabels } from '@/lib/engine';
const prompts = [
  {
    title: 'A home for the next generation',
    type: 'Student living',
    icon: Building2,
    brief:
      'Find a student dormitory near Princeton, with 200 beds, good walkability and strong investment returns. Budget $28 million.',
  },
  {
    title: 'Infrastructure for what’s next',
    type: '100 MW data center',
    icon: Cpu,
    brief:
      'Find a suitable location for a 100 MW data center near Princeton with electrical infrastructure and minimal environmental conflicts. Budget $900 million.',
  },
  {
    title: 'More room for community',
    type: 'Community park',
    icon: Trees,
    brief:
      'Create a community park near Princeton for 500 visitors, prioritizing underserved neighborhoods, schools and green space. Budget $8 million.',
  },
];
export function Dashboard() {
  const router = useRouter(),
    params = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [brief, setBrief] = useState(
      params.get('type') === 'commercial'
        ? 'Plan a commercial retail development near Princeton with 10000 sqft, strong customer access and a $28 million budget.'
        : '',
    ),
    [creating, setCreating] = useState(false),
    [showNew, setShowNew] = useState(params.has('new')),
    [compare, setCompare] = useState<string[]>([]),
    [showCompare, setShowCompare] = useState(false);
  useEffect(() => {
    fetch('/api/projects')
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setProjects(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function create(value = brief) {
    setCreating(true);
    setError('');
    try {
      const r = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: value }),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error);
      router.push(`/projects/${p.id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }
  const filtered = projects.filter((p) =>
    `${p.name} ${p.type}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand light />
        <div className="workspace-label">DEVELOPMENT WORKSPACE</div>
        <Link className="side-nav active" href="/projects">
          <FolderOpen size={18} /> All projects <span>{projects.length}</span>
        </Link>
        <button className="side-nav" onClick={() => setShowNew(true)}>
          <Plus size={18} /> New development
        </button>
        <div className="side-section-label">YOUR DEMONSTRATIONS</div>
        {prompts.map((p, i) => (
          <Link className="side-nav side-demo" href={`/projects/demo-${i + 1}`} key={p.type}>
            <p.icon size={17} />
            <span>{p.type}</span>
            <ArrowUpRight size={13} />
          </Link>
        ))}
        <div className="sidebar-bottom">
          <div className="guardian-mark">
            <ShieldCheck size={19} />
            <div>
              HAVEN intelligence<small>Built into every possibility.</small>
            </div>
            <span className="pulse-dot" />
          </div>
          <div className="profile">
            <span>PS</span>
            <div>
              PlotStar studio<small>Local development workspace</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div>
            Workspace <span>/</span> <b>All projects</b>
          </div>
          <div className="topbar-right">
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard-2">
                Open Dashboard 2 <ArrowUpRight size={14} />
              </Link>
            </Button>
            <span className="saved-indicator">
              <span className="pulse-dot" /> SQLite connected
            </span>
            <span className="avatar">PS</span>
          </div>
        </header>
        <main className="dashboard">
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR NEXT POSSIBILITY STARTS HERE</div>
              <h1>
                A place for big ideas<span>.</span>
              </h1>
              <p>From the first question to a smarter building. Let’s make progress.</p>
            </div>
            <Button onClick={() => setShowNew(true)}>
              <Plus size={17} /> New project
            </Button>
          </div>
          <section className="dashboard-welcome">
            <div>
              <span className="badge badge-dark">
                <Sparkles size={13} /> INTELLIGENCE, FROM THE GROUND UP
              </span>
              <h2>
                What do you have
                <br />
                in mind?
              </h2>
              <p>Describe your vision. We’ll help you find its place.</p>
              <Button variant="secondary" onClick={() => setShowNew(true)}>
                Describe a development <ArrowUpRight size={17} />
              </Button>
            </div>
            <CityArt small />
            <div className="welcome-steps">
              <span>
                <MapPin /> Discover
              </span>
              <i />
              <span>
                <Box /> Design
              </span>
              <i />
              <span>
                <ShieldCheck /> Protect
              </span>
            </div>
          </section>
          <div className="project-list-heading">
            <div>
              <h2>
                Your developments <span>{projects.length}</span>
              </h2>
              <p>Every stage, every decision, all in one place.</p>
            </div>
            <div className="list-tools">
              {compare.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCompare(true)}
                  disabled={compare.length < 2}
                >
                  <GitCompareArrows size={15} /> Compare ({compare.length})
                </Button>
              )}
              <label className="search-field">
                <Search size={16} />
                <input
                  aria-label="Search projects"
                  placeholder="Find a project…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
          </div>
          {error && (
            <div role="alert" className="notice error">
              {error}
            </div>
          )}
          {loading ? (
            <div className="loading-panel">Gathering your developments…</div>
          ) : (
            <div className="project-grid">
              {filtered.map((p, i) => {
                const site =
                  p.sites.find((s) => s.id === p.selectedSiteId) ||
                  rankSites(p.sites, p.weights)[0];
                const f = finances(
                  p.type,
                  p.requirements,
                  site,
                  p.designs.find((d) => d.id === p.approvedDesignId),
                );
                return (
                  <article className="project-card" key={p.id}>
                    <div className={`project-cover cover-${p.type}`}>
                      <div className="cover-contours" />
                      {p.type === 'park' ? (
                        <Trees size={60} />
                      ) : p.type === 'data-center' ? (
                        <Cpu size={60} />
                      ) : (
                        <Building2 size={60} />
                      )}
                      <span className="project-type">{typeLabels[p.type]}</span>
                      <button
                        className={`compare-check ${compare.includes(p.id) ? 'checked' : ''}`}
                        aria-label={`Compare ${p.name}`}
                        onClick={() =>
                          setCompare((v) =>
                            v.includes(p.id) ? v.filter((x) => x !== p.id) : [...v, p.id],
                          )
                        }
                      >
                        {compare.includes(p.id) ? <Check size={14} /> : <Plus size={14} />}
                      </button>
                    </div>
                    <div className="project-card-body">
                      <div className="project-meta">
                        <span className="status-pill">
                          {p.stage === 'discover'
                            ? 'Exploring sites'
                            : p.stage === 'design'
                              ? 'Shaping the concept'
                              : 'Monitoring ready'}
                        </span>
                        <span>
                          {p.id.startsWith('demo-')
                            ? 'DEMO PROJECT'
                            : `PROJECT ${String(i + 1).padStart(2, '0')}`}
                        </span>
                      </div>
                      <Link className="project-title" href={`/projects/${p.id}`}>
                        <h3>{p.name.split(' · ')[0]}</h3>
                        <ArrowUpRight size={19} />
                      </Link>
                      <p>
                        <MapPin size={13} />
                        {p.requirements.location}
                      </p>
                      <div className="project-card-stats">
                        <div>
                          <small>PROJECT BUDGET</small>
                          <b>{money(p.requirements.budget)}</b>
                        </div>
                        <div>
                          <small>{p.type === 'park' ? 'ANNUAL UPKEEP' : 'MODELED YIELD'}</small>
                          <b>{p.type === 'park' ? money(f.expenses) : `${f.yield.toFixed(1)}%`}</b>
                        </div>
                      </div>
                      <div className="project-progress">
                        {['discover', 'design', 'protect'].map((s, j) => (
                          <span
                            className={
                              j <= ['discover', 'design', 'protect'].indexOf(p.stage) ? 'done' : ''
                            }
                            key={s}
                          >
                            <i />
                            {s}
                          </span>
                        ))}
                      </div>
                      <Link className="open-project" href={`/projects/${p.id}`}>
                        Open development <ArrowRight size={16} />
                      </Link>
                    </div>
                  </article>
                );
              })}
              <button className="new-project-card" onClick={() => setShowNew(true)}>
                <span>
                  <Plus size={26} />
                </span>
                <h3>Make room for your next idea.</h3>
                <p>Start a new development</p>
              </button>
            </div>
          )}
          <div className="dashboard-footnote">
            <ShieldCheck size={16} />
            <span>
              Your progress is saved locally. Demo property and market data are illustrative.
              Conceptual planning requires professional validation.
            </span>
          </div>
        </main>
      </div>
      {showNew && (
        <div className="modal-backdrop">
          <section
            className="modal new-project-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-title"
          >
            <button
              className="modal-close"
              aria-label="Close new project"
              onClick={() => setShowNew(false)}
            >
              <X size={20} />
            </button>
            <Star className="modal-star" />
            <div className="eyebrow">START WITH A POSSIBILITY</div>
            <h2 id="new-title">What will you build?</h2>
            <p>
              Tell us the development type, location, capacity, and budget. You can refine
              everything in your workspace.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <textarea
                aria-label="Development brief"
                placeholder="Find me a site for a 200-bed student dormitory near Princeton, with great walkability and a $28 million budget…"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                minLength={12}
                maxLength={4000}
                required
                autoFocus
              />
              <div className="brief-footer">
                <span>
                  <Sparkles size={14} /> Structured brief + tailored site scoring
                </span>
                <Button disabled={creating || brief.trim().length < 12} type="submit">
                  {creating ? 'Building your workspace…' : 'Find the possibilities'}
                  <ArrowRight size={16} />
                </Button>
              </div>
            </form>
            <div className="example-label">OR START WITH A DEMONSTRATION</div>
            <div className="prompt-examples">
              {prompts.map((p) => (
                <button
                  key={p.type}
                  disabled={creating}
                  onClick={() => {
                    setBrief(p.brief);
                    void create(p.brief);
                  }}
                >
                  <p.icon size={20} />
                  <span>
                    {p.type}
                    <small>{p.title}</small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <p className="small-note">
              The candidate dataset covers the Princeton demo region. Other requested locations are
              preserved in your brief and explicitly flagged as outside demo coverage.
            </p>
          </section>
        </div>
      )}
      {showCompare && (
        <div className="modal-backdrop">
          <section
            className="modal compare-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Compare projects"
          >
            <button
              className="modal-close"
              aria-label="Close comparison"
              onClick={() => setShowCompare(false)}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">A WIDER PERSPECTIVE</div>
            <h2>Compare your possibilities.</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Development</th>
                    <th>Type</th>
                    <th>Budget</th>
                    <th>Site score</th>
                    <th>Total cost</th>
                    <th>Operating yield</th>
                    <th>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {projects
                    .filter((p) => compare.includes(p.id))
                    .map((p) => {
                      const site =
                          p.sites.find((s) => s.id === p.selectedSiteId) ||
                          rankSites(p.sites, p.weights)[0],
                        f = finances(
                          p.type,
                          p.requirements,
                          site,
                          p.designs.find((d) => d.id === p.approvedDesignId),
                        );
                      return (
                        <tr key={p.id}>
                          <td>
                            <Link href={`/projects/${p.id}`}>{p.name}</Link>
                          </td>
                          <td>{typeLabels[p.type]}</td>
                          <td>{money(p.requirements.budget)}</td>
                          <td>{scoreSite(site, p.weights)}</td>
                          <td>{money(f.total)}</td>
                          <td>{p.type === 'park' ? 'Public benefit' : `${f.yield.toFixed(2)}%`}</td>
                          <td>{p.stage}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <p className="small-note">
              Uses each project’s selected site or leading candidate and approved or balanced
              concept. Park outcomes should be assessed as public benefit.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
