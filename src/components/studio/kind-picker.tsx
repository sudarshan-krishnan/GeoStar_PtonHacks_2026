'use client';
// Define, first screen: what kind of property, which market, and the idea in a sentence.
// Only data centers have a layout engine behind them today. The other types go straight to a concept model in
// Design, and say so plainly.
import type { ReactNode } from 'react';
import { ArrowRight, Building2, Check, Cpu, MapPin, Store, Sun, Trees, Wind } from 'lucide-react';
import type { Brief, ProjectKind } from './types';

export const KINDS: { id: ProjectKind; label: string; detail: string; icon: typeof Cpu; ready: boolean; example: string }[] = [
  { id: 'data-center', label: 'Data center', detail: 'Infrastructure for what’s next', icon: Cpu, ready: true,
    example: 'A 20 MW data center with room to grow and a thoughtful approach to energy, water and the surrounding community.' },
  { id: 'wind', label: 'Wind farm', detail: 'A new direction for energy', icon: Wind, ready: false,
    example: 'A wind energy project with open land, grid access and a considered relationship with neighbouring communities.' },
  { id: 'solar', label: 'Solar farm', detail: 'Make more of every day', icon: Sun, ready: false,
    example: 'A solar energy project with space for panels, access to the grid and room for the landscape to thrive.' },
  { id: 'student', label: 'Student living', detail: 'A place to feel at home', icon: Building2, ready: false,
    example: 'Student housing for 200 residents, close to campus, everyday essentials and a walkable neighbourhood.' },
  { id: 'park', label: 'Community park', detail: 'Bring people together', icon: Trees, ready: false,
    example: 'A community park with welcoming green space, walking paths and room for neighbours to gather.' },
  { id: 'commercial', label: 'Commercial', detail: 'Give a business its place', icon: Store, ready: false,
    example: 'A commercial development with convenient access, flexible space and a strong connection to the neighbourhood.' },
];
const MARKETS: { value: Brief['market']; label: string }[] = [
  { value: 'Houston', label: 'Houston, Texas' }, { value: 'Los Angeles', label: 'Los Angeles, California' },
];

export function KindPicker({ kind, market, vision, onKind, onMarket, onVision, onContinue, children }: {
  kind: ProjectKind; market: Brief['market']; vision: string;
  onKind: (k: ProjectKind) => void; onMarket: (m: Brief['market']) => void; onVision: (v: string) => void;
  onContinue: () => void; children?: ReactNode;
}) {
  const pick = KINDS.find((k) => k.id === kind) ?? KINDS[0];
  return (
    <>
      <form className="st-card st-kind" onSubmit={(e) => { e.preventDefault(); onContinue(); }}>
        <fieldset className="st-kind-types">
          <legend>What would you like to build?</legend>
          <div className="st-kind-grid">
            {KINDS.map(({ id, label, detail, icon: Icon, ready }) => (
              <label key={id} className={`st-kind-card${kind === id ? ' on' : ''}${ready ? '' : ' later'}`}>
                <input type="radio" name="st-kind" checked={kind === id} onChange={() => onKind(id)} />
                <span className="st-kind-icon"><Icon size={20} strokeWidth={1.6} /></span>
                <span className="st-kind-copy"><b>{label}{!ready && <span className="st-tag st-tag-unknown">Concept model</span>}</b><small>{detail}</small></span>
                <span className="st-kind-mark" aria-hidden="true">{kind === id && <Check size={11} strokeWidth={3} />}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="st-field">
          <span>Where are you thinking?</span>
          <span className="st-kind-where">
            <MapPin size={15} />
            <select value={market} onChange={(e) => onMarket(e.target.value as Brief['market'])}>
              {MARKETS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </span>
          <small>CoStar data covers these two markets.</small>
        </label>

        <label className="st-field">
          <span className="st-kind-label">A little about your vision <em>Start with the big picture.</em></span>
          <textarea rows={3} value={vision} maxLength={600} placeholder={pick.example} onChange={(e) => onVision(e.target.value)} />
        </label>

        <div className="st-kind-foot">
          {pick.ready
            ? <span className="st-muted st-small">Next you set capacity, cooling and redundancy, then choose a real site.</span>
            : <span className="st-kind-note">Studio lays out data centers only. {pick.label} goes straight to its 3D concept model in Design.</span>}
          <button type="submit" className="st-btn primary big">{pick.ready ? 'Continue' : 'See the concept model'} <ArrowRight size={14} /></button>
        </div>
      </form>

      {children}
    </>
  );
}
