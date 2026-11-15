'use client';
// Studio · Design → Model: a 3D concept model of the property type picked in Define.
// The geometry is HAVEN's illustrative concept models (src/components/dashboard-2/concepts, from the `models`
// branch): none is a surveyed replica or a design generated for this parcel, and the page says so.
// "Use this model" saves the choice in the same facility workspace Protect and Deploy use.
import { Component, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Box, CircleAlert, CircleCheck, RotateCw } from 'lucide-react';
import type { useProtection } from '../../dashboard-2/use-protection';
import type { PreviewProjectType } from '../../dashboard-2/sample-data';
import type { ProjectKind } from '../types';

const ConceptModel = dynamic(() => import('../../dashboard-2/concepts/concept-model'), {
  ssr: false,
  loading: () => <div className="st-concept-status">Sketching the concept…</div>,
});

class ConceptBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="st-concept-status">3D preview unavailable in this browser.</div> : this.props.children;
  }
}

/** Define's project types → the concept model drawn for each. */
export const CONCEPTS: Record<ProjectKind, { type: PreviewProjectType; name: string; detail: string }> = {
  'data-center': { type: 'data-center', name: 'Atlas Data Center', detail: 'Generic campus · 96 rack cabinets' },
  wind: { type: 'wind', name: 'Ridgeway Wind Farm', detail: '9 turbines · collector and operations yard' },
  solar: { type: 'solar', name: 'Sunridge Solar Farm', detail: '640 PV modules · 8 array blocks' },
  student: { type: 'residential', name: 'HAVEN residence hall', detail: 'Six-storey student hall' },
  park: { type: 'park', name: 'Meadow Community Park', detail: 'Neighbourhood park · gardens and recreation' },
  commercial: { type: 'commercial', name: 'Princeton · JRR / LAS', detail: 'Mid-rise campus building' },
};

/** The Model tab. Studio owns the facility workspace so Model, Protect and Deploy share it. */
export function FacilityModel({ protection, kind, kindLabel, onProtect }: {
  protection: ReturnType<typeof useProtection>; kind: ProjectKind; kindLabel: string; onProtect: () => void;
}) {
  const { state, busy, act } = protection;
  const concept = CONCEPTS[kind];

  return (
    <div className="st-card st-model">
      <div className="st-model-head">
        <div>
          <h3><Box size={16} /> {concept.name}</h3>
          <span className="st-muted st-small">{kindLabel} concept · {concept.detail} · drag to orbit, scroll to zoom</span>
        </div>
        <span className="st-tag st-tag-simulated">Concept sketch</span>
      </div>
      <figure className="st-concept" aria-label={`${kindLabel} concept model, drag to orbit`}>
        <ConceptBoundary key={kind}>
          <ConceptModel type={concept.type} />
        </ConceptBoundary>
      </figure>
      {protection.error && (
        <div className="st-error st-model-error"><CircleAlert size={14} /> {protection.error}
          <button className="st-btn" onClick={() => void protection.reload()}><RotateCw size={13} /> Reload</button></div>
      )}
      <dl className="st-model-details">
        <div><dt>Facility</dt><dd>{state.facility.name}</dd></div>
        <div><dt>Property type</dt><dd>{kindLabel}</dd></div>
        <div><dt>Model</dt><dd>{concept.name}</dd></div>
      </dl>
      <p className="st-muted st-small">
        An illustrative {kindLabel.toLowerCase()} concept model, not a design generated for the selected parcel. Choose it to
        carry this facility into Protect.
      </p>
      <div className="st-model-foot">
        <span className={state.modelAccepted ? 'st-model-saved' : 'st-muted st-small'}>
          {state.modelAccepted ? <><CircleCheck size={14} /> Model selection saved</> : 'One facility. One connected twin.'}
        </span>
        <button className="st-btn primary" disabled={busy || !protection.loaded}
          onClick={async () => { if (state.modelAccepted || (await act({ action: 'accept-model' }))) onProtect(); }}>
          {busy ? 'Saving model…' : !protection.loaded ? 'Loading…' : state.modelAccepted ? 'Continue to Protect' : 'Use this model'}
        </button>
      </div>
    </div>
  );
}
