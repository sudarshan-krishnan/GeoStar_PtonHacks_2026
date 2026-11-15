'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Layers3,
  MapPin,
  ShieldCheck,
  PanelLeft,
  Radar,
} from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

export type Module = 'locate' | 'design' | 'protect' | 'deploy';
export type Status = 'pending' | 'active' | 'completed';

export function StatusIndicator({ status }: { status: Status }) {
  return (
    <span className={`d2-status d2-status-${status}`}>
      {status === 'completed' ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : <i />}
      <span className="d2-sr-only">
        {status === 'completed' ? 'Completed' : status === 'active' ? 'In progress' : 'Pending'}
      </span>
    </span>
  );
}

/**
 * Liquid-glass indicator: measures the active item inside `container` and exposes its box as
 * CSS variables (--sb-ix, --sb-iy, --sb-iw, --sb-ih), so one glass pill can glide between items.
 */
function useGlassIndicator(container: RefObject<HTMLElement | null>, key: unknown) {
  useLayoutEffect(() => {
    const host = container.current;
    if (!host) return;
    const place = () => {
      const active = host.querySelector<HTMLElement>('[aria-current]');
      if (!active) {
        host.style.setProperty('--sb-io', '0');
        return;
      }
      const a = active.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      host.style.setProperty('--sb-ix', `${a.left - h.left}px`);
      host.style.setProperty('--sb-iy', `${a.top - h.top}px`);
      host.style.setProperty('--sb-iw', `${a.width}px`);
      host.style.setProperty('--sb-ih', `${a.height}px`);
      host.style.setProperty('--sb-io', '1');
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(host);
    return () => observer.disconnect();
  }, [container, key]);
}

/** Smart Blocks mark: three stacked glass blocks, amber and electric blue. */
export function SmartBlocksMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="sb-mark-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd27a" />
          <stop offset="1" stopColor="#f08a00" />
        </linearGradient>
        <linearGradient id="sb-mark-b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8fc1ff" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <path d="M16 3.5 26.5 9 16 14.5 5.5 9Z" fill="url(#sb-mark-a)" />
      <path d="M5.5 9 16 14.5V27L5.5 21.5Z" fill="#f5a524" opacity=".55" />
      <path d="M26.5 9 16 14.5V27l10.5-5.5Z" fill="url(#sb-mark-b)" opacity=".9" />
      <path d="M16 14.5V27" stroke="#fff" strokeOpacity=".7" strokeWidth=".8" />
      <path
        d="M16 3.5 26.5 9 16 14.5 5.5 9Z"
        fill="none"
        stroke="#fff"
        strokeOpacity=".8"
        strokeWidth=".8"
      />
    </svg>
  );
}

const modules = [
  { id: 'locate', label: 'Locate', detail: 'Site intelligence', icon: MapPin },
  { id: 'design', label: 'Design', detail: 'Aerial survey and twin', icon: Layers3 },
  { id: 'protect', label: 'Protect', detail: 'Alerts and response', icon: ShieldCheck },
  { id: 'deploy', label: 'Deploy', detail: 'Live command center', icon: Radar },
] as const;

export function Sidebar({
  active,
  complete,
  onSelect,
  children,
  statuses,
}: {
  active: Module;
  complete: boolean;
  onSelect: (module: Module) => void;
  children: ReactNode;
  statuses?: Partial<Record<Module, Status>>;
}) {
  const nav = useRef<HTMLElement>(null);
  useGlassIndicator(nav, active);
  return (
    <aside className="d2-sidebar">
      <Link href="/dashboard-2" className="d2-brand" aria-label="Smart Blocks home">
        <span className="d2-brand-icon">
          <SmartBlocksMark />
        </span>
        <span>
          Smart Blocks<small>Infrastructure intelligence</small>
        </span>
      </Link>
      <div className="d2-sidebar-body">
        <p className="d2-overline">YOUR WORKSPACE</p>
        <nav aria-label="Planning modules" className="d2-modules sb-indicator-host" ref={nav}>
          <span className="sb-indicator" aria-hidden="true" />
          {modules.map(({ id, label, detail, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onSelect(id)}
              aria-current={active === id ? 'page' : undefined}
              className={`d2-module ${active === id ? 'is-active' : ''}`}
            >
              <span className="sb-module-icon">
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              </span>
              <span>
                {label}
                <small>{detail}</small>
              </span>
              <StatusIndicator
                status={
                  statuses?.[id] ||
                  (id === 'locate' ? (complete ? 'completed' : 'active') : 'pending')
                }
              />
            </button>
          ))}
        </nav>
        <div className="d2-sidebar-project">{children}</div>
      </div>
      <div className="d2-sidebar-bottom">
        <div className="d2-workspace-name">
          <PanelLeft size={17} />
          <span>
            Planning studio<small>Local workspace · simulation</small>
          </span>
          <span className="d2-local-dot" />
        </div>
        <Link href="/projects">
          <ArrowLeft size={14} /> Original dashboard
        </Link>
      </div>
    </aside>
  );
}

export function StepNavigation({
  step,
  completed,
  onSelect,
  busy,
  names = ['Describe', 'Pick', 'Finalize'],
  label = 'Locate',
  linear = true,
}: {
  step: number;
  completed: boolean[];
  onSelect: (step: number) => void;
  busy: boolean;
  names?: string[];
  label?: string;
  /** When false, every step stays selectable instead of unlocking in order. */
  linear?: boolean;
}) {
  const list = useRef<HTMLOListElement>(null);
  useGlassIndicator(list, `${label}-${step}`);
  return (
    <nav className="d2-stepbar" aria-label={`${label} steps`}>
      <ol ref={list} className="sb-indicator-host">
        <li className="sb-indicator" aria-hidden="true" />
        {names.map((name, index) => (
          <li key={name}>
            {index > 0 && <ChevronRight className="d2-step-chevron" size={15} aria-hidden="true" />}
            <button
              aria-current={step === index ? 'step' : undefined}
              className={step === index ? 'is-active' : ''}
              disabled={busy || (linear && index > 0 && !completed[index - 1])}
              onClick={() => onSelect(index)}
            >
              <StatusIndicator
                status={completed[index] ? 'completed' : step === index ? 'active' : 'pending'}
              />
              <span>{name}</span>
            </button>
          </li>
        ))}
      </ol>
      <span className="d2-step-count">
        <span className="sb-step-meter" aria-hidden="true">
          <i style={{ width: `${((step + 1) / names.length) * 100}%` }} />
        </span>
        {label.toUpperCase()} <span>/</span> 0{step + 1}
        <span className="sb-step-total"> of 0{names.length}</span>
      </span>
    </nav>
  );
}

export function PrimaryCard({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`d2-primary ${className}`}>{children}</section>;
}

export function Placeholder({ module }: { module: 'design' | 'protect' }) {
  const Icon = module === 'design' ? Layers3 : ShieldCheck;
  const title = module === 'design' ? 'Design' : 'Protect';
  return (
    <PrimaryCard className="d2-placeholder">
      <span className="d2-placeholder-icon">
        <Icon size={48} strokeWidth={1.2} />
      </span>
      <p className="d2-overline">THE NEXT CHAPTER</p>
      <h1>{title}</h1>
      <span className="d2-coming">Coming Soon</span>
      <p>
        {module === 'design'
          ? 'A thoughtful space to bring your vision into focus.'
          : 'Peace of mind, built into every possibility.'}
      </p>
    </PrimaryCard>
  );
}
