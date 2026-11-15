'use client';
// Real-data panels for CoStar sites: hard-gate results, power signals, Vexcel aerial, Matterport tour.
import { useEffect, useState } from 'react';
import { Box, CircleCheck, CircleHelp, CircleX, ExternalLink, Zap } from 'lucide-react';
import type { DataLabel, GateResult, Site } from '@/lib/types';
import { matterportEmbedUrl, PUBLIC_DATA_API, siteDetailUrl, vexcelMetaUrl, vexcelOrthoUrl } from '@/lib/plotstar-api';

export function LabelTag({ label }: { label: DataLabel }) {
  return <span className={`data-label data-label-${label.toLowerCase().replace(/[^a-z]/g, '')}`}>{label}</span>;
}

export function GateBadge({ status }: { status: 'Pass' | 'Fail' | 'Needs review' }) {
  const Icon = status === 'Pass' ? CircleCheck : status === 'Fail' ? CircleX : CircleHelp;
  return (
    <span className={`gate-badge gate-${status === 'Needs review' ? 'review' : status.toLowerCase()}`}>
      <Icon size={12} /> {status === 'Needs review' ? 'Review' : status}
    </span>
  );
}

function GateRow({ g }: { g: GateResult }) {
  return (
    <div className="gate-row">
      <div className="gate-row-head">
        <b>{g.gate}</b>
        <GateBadge status={g.status} />
      </div>
      <p>{g.reason}</p>
      <small>
        <LabelTag label={g.label} /> {g.source}
        {g.retrieved_at ? ` · ${new Date(g.retrieved_at).toLocaleDateString()}` : ''}
      </small>
    </div>
  );
}

export function ScreeningPanel({ site }: { site: Site }) {
  if (!site.screen) return null;
  const s = site.screen;
  return (
    <div className="detail-section">
      <div className="detail-heading">
        <h3>Hard gates</h3>
        <GateBadge status={s.status} />
      </div>
      {s.gates.map((g) => (
        <GateRow key={g.gate} g={g} />
      ))}
      {s.status === 'Fail' && (
        <p className="gate-note">Community and environmental limits are pass/fail. A failed gate cannot be offset by price.</p>
      )}
    </div>
  );
}

export function PowerPanel({ site }: { site: Site }) {
  const p = site.screen?.power;
  if (!p) return null;
  const sub = p.nearest_substation;
  return (
    <div className="detail-section">
      <div className="detail-heading">
        <h3>Power readiness</h3>
        <Zap size={16} />
      </div>
      <div className="power-grid">
        <div>
          <small>Existing building service</small>
          <b>{p.building_service_mw != null ? `~${p.building_service_mw} MW` : 'Unknown'}</b>
          <LabelTag label={p.building_service_label} />
        </div>
        <div>
          <small>Nearest transmission substation</small>
          <b>{sub ? `${sub.distance_km} km · ${sub.max_kv ?? '?'} kV` : 'Unknown'}</b>
          <LabelTag label={sub ? 'Estimated' : 'Unknown'} />
        </div>
      </div>
      {p.building_service_method && <p className="method-line">Method: {p.building_service_method}</p>}
      {sub && (
        <p className="method-line">
          {sub.name || sub.osm_id}
          {sub.operator ? ` (${sub.operator})` : ''} · {p.substation_source}
        </p>
      )}
      <div className="utility-confirm">
        <b>Requires utility confirmation</b>
        {p.requires_utility_confirmation.map((x) => (
          <span key={x}>{x}</span>
        ))}
      </div>
    </div>
  );
}

type OrthoMeta = { collection?: string; 'last-capture-date'?: string; 'min-gsd'?: string; 'camera-technology'?: string };

export function AerialPanel({ site }: { site: Site }) {
  const [meta, setMeta] = useState<OrthoMeta | null>(null);
  const [failed, setFailed] = useState(false);
  const pid = site.parcelId!;
  useEffect(() => {
    let alive = true;
    fetch(vexcelMetaUrl(pid))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((m) => alive && setMeta(m))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [pid]);
  return (
    <div className="detail-section">
      <div className="detail-heading">
        <h3>Aerial view</h3>
        <LabelTag label={failed ? 'Unknown' : 'Sourced'} />
      </div>
      {failed ? (
        <p className="method-line">Vexcel imagery unavailable for this point.</p>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="aerial-img" src={vexcelOrthoUrl(pid)} alt={`Vexcel aerial image of ${site.name}`} />
      )}
      {meta && (
        <p className="method-line">
          Vexcel {meta.collection} · captured {meta['last-capture-date']?.replace(/ \d\d:\d\d:\d\d UTC/, '')} ·{' '}
          {meta['min-gsd'] ? `${(Number(meta['min-gsd']) * 100).toFixed(0)} cm/pixel` : ''}
        </p>
      )}
    </div>
  );
}

export function MatterportPanel({ site }: { site: Site }) {
  const [ids, setIds] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);
  const pid = site.parcelId!;
  useEffect(() => {
    let alive = true;
    fetch(siteDetailUrl(pid))
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const list: string[] = d.matterport_model_ids ?? [];
        setIds(list);
        if (list[0])
          fetch(`${PUBLIC_DATA_API}/matterport/models/${list[0]}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((m) => alive && setThumb(m?.image?.url ?? null))
            .catch(() => {});
      })
      .catch(() => alive && setIds([]));
    return () => {
      alive = false;
    };
  }, [pid]);
  if (!ids) return null;
  if (!ids.length)
    return (
      <div className="detail-section">
        <p className="method-line">No Matterport scan recorded for this property.</p>
      </div>
    );
  return (
    <div className="detail-section">
      <div className="detail-heading">
        <h3>Inside the building</h3>
        <Box size={16} />
      </div>
      {open ? (
        <iframe
          className="matterport-frame"
          src={matterportEmbedUrl(ids[0])}
          allow="xr-spatial-tracking; fullscreen"
          allowFullScreen
          title={`Matterport 3D tour of ${site.name}`}
        />
      ) : (
        <button className="matterport-thumb" onClick={() => setOpen(true)}>
          {thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="Matterport preview" />
          )}
          <span>Open 3D tour · {ids.length} scan{ids.length > 1 ? 's' : ''}</span>
        </button>
      )}
      <a className="method-line" href={matterportEmbedUrl(ids[0])} target="_blank" rel="noreferrer">
        Matterport (CoStar 3D capture) <ExternalLink size={11} />
      </a>
    </div>
  );
}
