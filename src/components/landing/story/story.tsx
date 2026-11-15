'use client';
// GeoStar landing. One story told in three acts, most important first (inverted pyramid):
// the promise on a real parcel, the three things GeoStar does, why now, then each act in depth with the real
// engine woven between them (real.tsx), then HAVEN, the sources, and the close.
// The light shifts from day (Find) to dusk (Design) to night (Protect), because that is when HAVEN works.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, Command, CornerDownLeft, MapPin, PencilRuler, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { Star } from '@/components/brand';
import { TYPES, type TypeStory } from './data';
import { Design, Find, Haven, Protect } from './acts';
import { LiveNumbers, LivePlan, RealHero, Sources, WhyNow, useLive } from './real';

export const CHAPTERS = [
  { id: 'find', n: 'I', label: 'Find', icon: MapPin },
  { id: 'design', n: 'II', label: 'Design', icon: PencilRuler },
  { id: 'protect', n: 'III', label: 'Protect', icon: ShieldCheck },
  { id: 'haven', n: '+', label: 'HAVEN', icon: Sparkles },
] as const;
type ChapterId = (typeof CHAPTERS)[number]['id'];

export function Story() {
  const root = useRef<HTMLDivElement>(null);
  const [typeId, setTypeId] = useState<TypeStory['id']>('data-center');
  const type = useMemo(() => TYPES.find((t) => t.id === typeId) ?? TYPES[0], [typeId]);
  const [chapter, setChapter] = useState<ChapterId | null>(null);
  const [docked, setDocked] = useState(false);
  const [palette, setPalette] = useState(false);
  const live = useLive();

  // Reveal-on-scroll, chapter tracking, dock visibility and the reading-progress line.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reveal = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), reveal.unobserve(e.target))),
      { rootMargin: '0px 0px -12% 0px' },
    );
    el.querySelectorAll('[data-reveal]').forEach((n) => reveal.observe(n));
    const chapters = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && setChapter(e.target.id as ChapterId)),
      { rootMargin: '-45% 0px -50% 0px' },
    );
    el.querySelectorAll('[data-chapter]').forEach((n) => chapters.observe(n));
    const hero = el.querySelector('[data-hero]');
    const dock = new IntersectionObserver(([e]) => {
      setDocked(!e.isIntersecting);
      if (e.isIntersecting) setChapter(null);
    }, { threshold: 0.15 });
    if (hero) dock.observe(hero);
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - innerHeight;
        el.style.setProperty('--read', String(max > 0 ? scrollY / max : 0));
      });
    };
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
    return () => { reveal.disconnect(); chapters.disconnect(); dock.disconnect(); removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="ps" ref={root} data-tone={chapter === 'protect' || chapter === 'haven' ? 'dark' : 'light'}>
      <a className="ps-skip" href="#find">Skip to the story</a>
      <TopBar chapter={chapter} onPalette={() => setPalette(true)} />
      <RealHero type={type} onType={setTypeId} live={live} />
      <Pyramid />
      <WhyNow />
      <Find type={type} onType={setTypeId} />
      <LivePlan live={live} />
      <Design type={type} onType={setTypeId} />
      <LiveNumbers live={live} />
      <Protect />
      <Haven />
      <Sources />
      <Close />
      <Dock show={docked} chapter={chapter} onPalette={() => setPalette(true)} />
      {palette && <Palette onClose={() => setPalette(false)} onType={setTypeId} />}
    </div>
  );
}

export function Wordmark() {
  return (
    <Link href="/" className="ps-mark" aria-label="GeoStar home">
      <Star className="ps-mark-star" />
      <span>Geo<b>Star</b></span>
    </Link>
  );
}

function TopBar({ chapter, onPalette }: { chapter: ChapterId | null; onPalette: () => void }) {
  return (
    <header className="ps-top">
      <Wordmark />
      <nav aria-label="Story chapters" className="ps-top-links">
        {CHAPTERS.map((c) => (
          <a key={c.id} href={`#${c.id}`} aria-current={chapter === c.id ? 'true' : undefined}>{c.label}</a>
        ))}
      </nav>
      <button type="button" className="ps-kbd-btn" onClick={onPalette} aria-label="Open the command menu">
        <Search size={14} /><span>Jump to…</span><kbd>Ctrl K</kbd>
      </button>
      <Link href="/studio" className="ps-btn ps-btn-ink ps-btn-sm">Start a project <ArrowRight size={14} /></Link>
      <i className="ps-read" aria-hidden="true" />
    </header>
  );
}

function Pyramid() {
  const items = [
    { id: 'find', n: '01', t: 'Find the right place', d: 'Every factor that decides a site, weighed the way your project needs it. Power and water for a data center. Schools, parks and the river for homes.', icon: MapPin },
    { id: 'design', n: '02', t: 'Design what goes on it', d: 'A building modelled on the parcel. Edit it, finalize it, and hand engineers a CAD file. Walk it as a Gaussian splat before ground is broken.', icon: PencilRuler },
    { id: 'protect', n: '03', t: 'Protect it for life', d: 'Sensors where buildings really fail: hidden leaks, hot circuits, smoke. HAVEN watches them and tells the right person in plain words.', icon: ShieldCheck },
  ];
  return (
    <section className="ps-pyr" aria-label="What GeoStar does">
      <p className="ps-pyr-lead" data-reveal>GeoStar does three things, in the order a building lives them.</p>
      <ol className="ps-pyr-list">
        {items.map((it, i) => (
          <li key={it.id} data-reveal style={{ '--i': i } as CSSProperties}>
            <a href={`#${it.id}`} className="ps-neu ps-pyr-card">
              <span className="ps-pyr-n">{it.n}</span>
              <span className="ps-pyr-ico" aria-hidden="true"><it.icon size={20} strokeWidth={1.6} /></span>
              <h2>{it.t}</h2>
              <p>{it.d}</p>
              <span className="ps-pyr-go">Read act {i + 1} <ArrowRight size={14} /></span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------------------------------------------------------------- close */

function Close() {
  return (
    <section className="ps-close" aria-labelledby="ps-close-title">
      <div className="ps-close-inner" data-reveal>
        <Star className="ps-close-star" />
        <h2 id="ps-close-title">Every building starts as a plot.<br /><em>Start yours well.</em></h2>
        <p>Pick a project type, choose a city and GeoStar walks you from the map to the model to the sensors.</p>
        <div className="ps-actions ps-actions-c">
          <Link href="/studio" className="ps-btn ps-btn-lime">Start a project <ArrowRight size={16} /></Link>
          <Link href="/explore" className="ps-btn ps-btn-ghost-light">Explore the map</Link>
        </div>
      </div>
      <footer className="ps-foot">
        <Wordmark />
        <nav aria-label="Product">
          <Link href="/projects">Projects dashboard</Link>
          <Link href="/explore">Explore</Link>
          <Link href="/studio">Data center studio</Link>
        </nav>
        <small>© {new Date().getFullYear()} GeoStar. Concept models and planning evidence, not engineering design.</small>
      </footer>
    </section>
  );
}

/* ---------------------------------------------------------------- global action bar */

function Dock({ show, chapter, onPalette }: { show: boolean; chapter: ChapterId | null; onPalette: () => void }) {
  const idx = CHAPTERS.findIndex((c) => c.id === chapter);
  return (
    <div className={`ps-dock ps-glass ${show ? 'show' : ''}`} role="toolbar" aria-label="Story navigation" aria-hidden={!show} inert={!show}>
      <ol className="ps-dock-steps">
        {CHAPTERS.map((c, i) => (
          <li key={c.id} className={i < idx ? 'past' : i === idx ? 'now' : ''}>
            <a href={`#${c.id}`} aria-current={i === idx ? 'step' : undefined}>
              <c.icon size={15} strokeWidth={1.8} aria-hidden="true" />
              <span>{c.label}</span>
            </a>
          </li>
        ))}
      </ol>
      <button type="button" className="ps-dock-k" onClick={onPalette} aria-label="Open the command menu"><Command size={15} /></button>
      <Link href="/studio" className="ps-btn ps-btn-ink ps-btn-sm">Start <ArrowRight size={14} /></Link>
    </div>
  );
}

type Action = { id: string; group: string; label: string; hint?: string; run: () => void };

function Palette({ onClose, onType }: { onClose: () => void; onType: (id: TypeStory['id']) => void }) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const go = useCallback((href: string) => () => { onClose(); location.assign(href); }, [onClose]);
  const jump = useCallback((id: string) => () => { onClose(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); }, [onClose]);

  const actions: Action[] = useMemo(() => [
    { id: 'start', group: 'Go', label: 'Start a project', hint: 'Find, design, protect', run: go('/studio') },
    { id: 'explore', group: 'Go', label: 'Explore the map', hint: 'Real parcels, public data', run: go('/explore') },
    { id: 'studio', group: 'Go', label: 'Open the data center studio', run: go('/studio') },
    { id: 'projects', group: 'Go', label: 'Open the projects dashboard', run: go('/projects') },
    { id: 'agents', group: 'Go', label: 'How the AI works', hint: 'Deep Agents, live', run: go('/studio/agent') },
    { id: 'data', group: 'Go', label: 'The data platform', hint: 'MongoDB Atlas', run: go('/studio/data') },
    ...CHAPTERS.map((c) => ({ id: `ch-${c.id}`, group: 'Read', label: `${c.label}`, hint: `Act ${c.n}`, run: jump(c.id) })),
    ...TYPES.map((t) => ({ id: `ty-${t.id}`, group: 'Show me', label: `Rank sites for ${t.label.toLowerCase()}`, run: () => { onType(t.id); jump('find')(); } })),
  ], [go, jump, onType]);

  const list = actions.filter((a) => (a.label + ' ' + (a.hint ?? '') + ' ' + a.group).toLowerCase().includes(q.trim().toLowerCase()));
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => setAt(0), [q]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setAt((a) => Math.min(list.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') list[at]?.run();
  };

  let lastGroup = '';
  return (
    <div className="ps-pal-scrim" onMouseDown={onClose}>
      <div className="ps-pal ps-glass" role="dialog" aria-modal="true" aria-label="Command menu" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <label className="ps-pal-in">
          <Search size={16} aria-hidden="true" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Where to? Try “solar” or “protect”"
            role="combobox"
            aria-expanded="true"
            aria-controls="ps-pal-list"
            aria-activedescendant={list[at] ? `pal-${list[at].id}` : undefined}
          />
          <kbd>Esc</kbd>
        </label>
        <ul id="ps-pal-list" role="listbox" className="ps-pal-list">
          {list.length === 0 && <li className="ps-pal-empty">Nothing matches “{q}”.</li>}
          {list.map((a, i) => {
            const head = a.group !== lastGroup ? (lastGroup = a.group) : null;
            return (
              <li key={a.id} role="presentation">
                {head && <span className="ps-pal-group">{head}</span>}
                <div id={`pal-${a.id}`} role="option" aria-selected={i === at} className="ps-pal-item" onMouseEnter={() => setAt(i)} onClick={a.run}>
                  <span>{a.label}</span>{a.hint && <small>{a.hint}</small>}
                  {i === at && <CornerDownLeft size={14} className="ps-pal-enter" aria-hidden="true" />}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
