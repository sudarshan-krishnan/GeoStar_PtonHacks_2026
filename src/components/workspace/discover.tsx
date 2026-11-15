'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Globe,
  Leaf,
  MapPin,
  School,
  Settings2,
  ShieldAlert,
  Sparkles,
  TrainFront,
  Utensils,
  X,
} from 'lucide-react';
import type { AmenityResult, Project, Requirements } from '@/lib/types';
import {
  failsHardGate,
  finances,
  isRealSite,
  money,
  number,
  rankSites,
  scoreSite,
  siteRationale,
  typeLabels,
} from '@/lib/engine';
import { Button } from '../ui/button';
import { AerialPanel, GateBadge, LabelTag, MatterportPanel, PowerPanel, ScreeningPanel } from './site-evidence';
import type { Mutate } from './workspace';
const SiteMap = dynamic(() => import('./site-map'), {
  ssr: false,
  loading: () => (
    <div className="map-container loading-panel">Loading your geographical perspective…</div>
  ),
});
export function Discover({
  p,
  mutate,
  busy,
  onContinue,
}: {
  p: Project;
  mutate: Mutate;
  busy: boolean;
  onContinue: () => void;
}) {
  const ranked = rankSites(p.sites, p.weights),
    [active, setActive] = useState(p.selectedSiteId || ranked[0].id),
    [r, setR] = useState<Requirements>(p.requirements),
    [name, setName] = useState(p.name),
    [edit, setEdit] = useState(false),
    [weights, setWeights] = useState(p.weights),
    [showWeights, setShowWeights] = useState(false),
    [amenities, setAmenities] = useState<AmenityResult | null>(null),
    [lookup, setLookup] = useState(false),
    [scenario, setScenario] = useState(0),
    [compared, setCompared] = useState<string[]>(p.sites.map((s) => s.id));
  const real = p.sites.some(isRealSite),
    passing = p.sites.filter((s) => !failsHardGate(s)).length;
  const site = p.sites.find((s) => s.id === active) || ranked[0],
    f = finances(p.type, p.requirements, site, undefined, 1 + scenario / 100);
  async function select() {
    const next = await mutate({ action: 'select-site', siteId: site.id });
    if (next) onContinue();
  }
  function changeSite(id: string) {
    setActive(id);
    setAmenities(null);
  }
  async function fetchAmenities() {
    setLookup(true);
    try {
      const response = await fetch(`/api/projects/${p.id}/amenities?siteId=${site.id}`);
      const d = await response.json();
      if (!response.ok) throw new Error(d.error);
      setAmenities(d);
    } catch {
      setAmenities({
        source: 'Illustrative fallback',
        fetchedAt: new Date().toISOString(),
        message: 'The external lookup failed. Candidate counts remain illustrative.',
        points: [],
      });
    } finally {
      setLookup(false);
    }
  }
  return (
    <div className="discover-layout">
      <section className="brief-bar">
        <div className="brief-icon">
          <Sparkles size={21} />
        </div>
        <div>
          <span className="eyebrow">YOUR DEVELOPMENT BRIEF</span>
          <p>{p.brief}</p>
          <div className="brief-tags">
            <span>{typeLabels[p.type]}</span>
            <span>
              {number(p.requirements.capacity)}{' '}
              {p.type === 'data-center'
                ? 'MW'
                : p.type === 'park'
                  ? 'visitors'
                  : p.type === 'commercial'
                    ? 'sq ft'
                    : 'beds'}
            </span>
            <span>{money(p.requirements.budget)} budget</span>
            <span>{p.requirements.location}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEdit(true)}>
          <Settings2 size={15} /> Edit brief
        </Button>
      </section>
      <div className="discover-toolbar">
        <div>
          {real ? (
            <>
              <h2>
                {p.sites.length} real properties. {passing} clear the hard gates.
              </h2>
              <span>
                <i className="demo-dot" /> COSTAR DATA EXTRACT · SCREENED WITH FEMA, WRI AQUEDUCT, OSM ·{' '}
                {p.requirements.location.toUpperCase()}
              </span>
            </>
          ) : (
            <>
              <h2>Four places. A world of possibility.</h2>
              <span>
                <i className="demo-dot" /> ILLUSTRATIVE CANDIDATES · NOT VERIFIED LISTINGS
              </span>
            </>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowWeights(!showWeights)}>
          <Settings2 size={15} /> Scoring priorities <ChevronDown size={13} />
        </Button>
      </div>
      {showWeights && (
        <section className="panel weights-panel">
          <div>
            <h3>What matters most?</h3>
            <p>
              Weights are specific to {typeLabels[p.type].toLowerCase()}. Total is normalized
              automatically.
            </p>
          </div>
          <div className="weight-inputs">
            {Object.entries(weights).map(([key, value]) => (
              <label key={key}>
                <span className="capitalize">
                  {key} <b>{value}</b>
                </span>
                <input
                  aria-label={`${key} weight`}
                  type="range"
                  min="0"
                  max="100"
                  value={value}
                  onChange={(e) => setWeights({ ...weights, [key]: +e.target.value })}
                />
              </label>
            ))}
          </div>
          <Button
            size="sm"
            disabled={busy || Object.values(weights).every((v) => v === 0)}
            onClick={() => void mutate({ action: 'weights', weights })}
          >
            Apply priorities
          </Button>
        </section>
      )}
      {!real && !/princeton|plainsboro|west windsor/i.test(p.requirements.location) && (
        <div className="notice warning">
          Your requested location is outside the Princeton demo region. These candidates do not
          represent {p.requirements.location}.
        </div>
      )}
      <div className="discover-main">
        <div className="discover-left">
          <SiteMap
            sites={p.sites}
            selectedId={site.id}
            weights={p.weights}
            onSelect={changeSite}
            amenities={amenities}
          />
          <div className="candidate-grid">
            {ranked.map((s, i) => (
              <article className={`candidate-card ${site.id === s.id ? 'active' : ''}`} key={s.id}>
                <button className="candidate-main" onClick={() => changeSite(s.id)}>
                  <div className="candidate-top">
                    <span className="candidate-letter">
                      {isRealSite(s) ? String.fromCharCode(65 + p.sites.indexOf(s)) : s.id.slice(-1).toUpperCase()}
                    </span>
                    {s.screen && <GateBadge status={s.screen.status} />}
                    {failsHardGate(s) ? (
                      <span className="candidate-rank">EXCLUDED</span>
                    ) : i === 0 ? (
                      <span className="recommended">
                        <Sparkles size={11} /> TOP MATCH
                      </span>
                    ) : (
                      <span className="candidate-rank">RANK {i + 1}</span>
                    )}
                    <b className="candidate-score">
                      {scoreSite(s, p.weights)}
                      <small>/100</small>
                    </b>
                  </div>
                  <h3>{s.name}</h3>
                  <p>
                    <MapPin size={12} />
                    {s.area}
                  </p>
                  <div className="candidate-stats">
                    <span>
                      <small>SITE AREA</small>
                      <b>
                        {s.lotAcres != null
                          ? `${s.lotAcres.toFixed(1)} ac`
                          : `${((s.width * s.depth) / 10000).toFixed(2)} ha`}
                      </b>
                    </span>
                    <span>
                      <small>{isRealSite(s) ? 'ACQUISITION' : 'LAND ESTIMATE'}</small>
                      <b>
                        {money(s.landCost)} {s.labels?.landCost && <LabelTag label={s.labels.landCost} />}
                      </b>
                    </span>
                  </div>
                  <div className="candidate-bars">
                    {Object.keys(p.weights)
                      .slice(0, 3)
                      .map((k) => (
                        <div key={k}>
                          <span>{k}</span>
                          <i>
                            <em style={{ width: `${s.metrics[k]}%` }} />
                          </i>
                          <b>{s.metrics[k]}</b>
                        </div>
                      ))}
                  </div>
                </button>
                <label className="candidate-compare">
                  <input
                    type="checkbox"
                    checked={compared.includes(s.id)}
                    onChange={() =>
                      setCompared((v) =>
                        v.includes(s.id) ? v.filter((x) => x !== s.id) : [...v, s.id],
                      )
                    }
                  />
                  Include in comparison
                  {p.selectedSiteId === s.id && (
                    <span>
                      <Check size={12} /> Selected
                    </span>
                  )}
                </label>
              </article>
            ))}
          </div>
        </div>
        <aside className="site-detail panel">
          <div className="site-detail-head">
            <span className="eyebrow">A CLOSER LOOK</span>
            <span className="site-score-large">
              {scoreSite(site, p.weights)}
              <small>/100</small>
            </span>
            <h2>{site.name}</h2>
            <p>
              <MapPin size={13} />
              {site.area}
            </p>
          </div>
          <div className="detail-section">
            <div className="ai-insight">
              <Sparkles size={16} />
              <span>GEOSTAR PERSPECTIVE</span>
            </div>
            <p>{siteRationale(site, p.type, p.weights)}</p>
          </div>
          {isRealSite(site) ? (
            <>
              {site.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="costar-photo" src={site.photoUrl} alt={`CoStar photo of ${site.name}`} />
              )}
              <p className="method-line provenance-line">
                {site.context}
                <br />
                {site.provenance}
                {site.landCostBasis ? ` Acquisition basis: ${site.landCostBasis}.` : ''}
              </p>
              <ScreeningPanel site={site} />
              <PowerPanel site={site} />
              <AerialPanel site={site} />
              <MatterportPanel site={site} />
            </>
          ) : (
            <>
          <div className="detail-section">
                <div className="detail-heading">
                  <h3>The neighborhood</h3>
                  <span>DEMO COUNTS</span>
                </div>
                <div className="amenity-grid">
                  {[
                    { label: 'Schools', key: 'schools', icon: School },
                    { label: 'Dining', key: 'restaurants', icon: Utensils },
                    { label: 'Parks', key: 'parks', icon: Leaf },
                    { label: 'Transit', key: 'transit', icon: TrainFront },
                  ].map((a) => (
                    <div key={a.key}>
                      <a.icon size={16} />
                      <b>{site.amenities[a.key as keyof typeof site.amenities]}</b>
                      <span>{a.label}</span>
                    </div>
                  ))}
                </div>
                <div className="population-line">
                  <span>Illustrative local population</span>
                  <b>{number(site.amenities.population)}</b>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="full-width"
                  disabled={lookup}
                  onClick={() => void fetchAmenities()}
                >
                  <Globe size={14} />
                  {lookup ? 'Looking up mapped places…' : 'Look up live OSM amenities'}
                </Button>
                {amenities && (
                  <div className="lookup-result">
                    <b>
                      {amenities.source} · {amenities.points.length} mapped places
                    </b>
                    <p>{amenities.message}</p>
                    <small>{new Date(amenities.fetchedAt).toLocaleString()}</small>
                    {amenities.points.slice(0, 6).map((a, i) => (
                      <span key={`${a.id}-${i}`}>
                        {a.name} · {a.type}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          <div className="detail-section">
            <div className="detail-heading">
              <h3>Look before you leap</h3>
              <ShieldAlert size={17} />
            </div>
            {site.risks.map((r) => (
              <p key={r} className="risk-line">
                <span /> {r}
              </p>
            ))}
          </div>
          <div className="site-select">
            <Button className="full-width" disabled={busy || failsHardGate(site)} onClick={() => void select()}>
              {p.selectedSiteId === site.id && !p.approvedDesignId
                ? 'Continue to design'
                : 'Select this site'}
              <ArrowRight size={16} />
            </Button>
            <p>
              {failsHardGate(site)
                ? 'This site fails a hard gate and cannot be selected.'
                : p.approvedDesignId
                ? 'Selecting again starts a revised concept and replaces its sensor plan and incident view.'
                : 'Your next step: explore three conceptual designs.'}
            </p>
          </div>
        </aside>
      </div>
      <section className="panel financial-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">LET’S RUN THE NUMBERS</div>
            <h2>
              {p.type === 'park'
                ? 'Community value. Clearer costs.'
                : 'A clearer view of the investment.'}
            </h2>
            <p>{site.name} · Balanced concept · Unlevered planning estimates</p>
          </div>
          <span className="badge">{real ? 'USD · MODELED · TEAM ASSUMPTIONS' : 'USD · ILLUSTRATIVE'}</span>
        </div>
        <div className="finance-stat-grid">
          <Stat label="Total investment" value={money(f.total)} />
          <Stat
            label={p.type === 'park' ? 'Annual upkeep' : 'Annual revenue'}
            value={money(p.type === 'park' ? f.expenses : f.revenue)}
          />
          <Stat label="Net operating income" value={money(f.noi)} />
          <Stat
            label={p.type === 'park' ? 'Public capacity' : 'Operating yield'}
            value={
              p.type === 'park' ? `${number(f.socialReach || 0)} people` : `${f.yield.toFixed(2)}%`
            }
          />
          <Stat
            label="Simple payback"
            value={f.payback ? `${f.payback.toFixed(1)} years` : 'Not applicable'}
          />
          <Stat label="Budget headroom" value={money(f.budgetGap)} warning={f.budgetGap < 0} />
        </div>
        <div className="finance-bottom">
          <div className="cost-breakdown">
            <span style={{ flex: f.land, background: '#264c3c' }} />
            <span style={{ flex: f.construction, background: '#adc479' }} />
            <div>
              <span>
                <i style={{ background: '#264c3c' }} />
                Land {money(f.land)}
              </span>
              <span>
                <i style={{ background: '#adc479' }} />
                Development {money(f.construction)}
              </span>
            </div>
          </div>
          <label className="scenario-control">
            <span>
              WHAT IF LAND PRICES CHANGE?{' '}
              <b>
                {scenario > 0 ? '+' : ''}
                {scenario}%
              </b>
            </span>
            <input
              type="range"
              min="-40"
              max="60"
              step="5"
              aria-label="Land price scenario"
              value={scenario}
              onChange={(e) => setScenario(+e.target.value)}
            />
            <small>Scenario only. Saved assumptions remain unchanged.</small>
          </label>
        </div>
        <p className="small-note">
          Development includes construction, parking, equipment where applicable, and 22% soft cost
          / contingency. Revenue is limited to target capacity and concept capacity. Yield = annual
          NOI ÷ total cost; excludes financing, taxes, appreciation, and resale. Parks have no
          rental revenue in this model.
        </p>
      </section>
      <section className="panel comparison-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">EXPLORE THE TRADEOFFS</div>
            <h2>Side by side. Decision by decision.</h2>
          </div>
          <span className="badge">{compared.length} SITES</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Candidate site</th>
                <th>Score</th>
                <th>Land</th>
                <th>Total cost</th>
                <th>Annual NOI</th>
                <th>Yield</th>
                <th>Key unknown</th>
              </tr>
            </thead>
            <tbody>
              {ranked
                .filter((s) => compared.includes(s.id))
                .map((s) => {
                  const f = finances(p.type, p.requirements, s);
                  return (
                    <tr
                      key={s.id}
                      onClick={() => changeSite(s.id)}
                      className={s.id === site.id ? 'highlight-row' : ''}
                    >
                      <td>
                        <b>{s.name}</b>
                        <small>{s.area}</small>
                      </td>
                      <td>
                        <b>{scoreSite(s, p.weights)}</b>
                      </td>
                      <td>{money(f.land)}</td>
                      <td>{money(f.total)}</td>
                      <td>{money(f.noi)}</td>
                      <td>{p.type === 'park' ? 'Public benefit' : `${f.yield.toFixed(2)}%`}</td>
                      <td className="risk-cell">{s.risks[0]}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          {!compared.length && (
            <p className="empty-inline">Select candidates above to compare them here.</p>
          )}
        </div>
      </section>
      {edit && (
        <div className="modal-backdrop">
          <section
            className="modal requirements-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="requirements-title"
          >
            <button
              className="modal-close"
              aria-label="Close requirements"
              onClick={() => setEdit(false)}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">REFINE YOUR VISION</div>
            <h2 id="requirements-title">The development brief.</h2>
            <p>
              These assumptions drive every calculation. Changing requirements clears unapproved
              design alternatives.
            </p>
            {p.approvedDesignId && (
              <div className="notice warning">
                An approved design locks the brief. Reselect the site to start a revised concept
                first.
              </div>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (await mutate({ action: 'requirements', requirements: r, name })) setEdit(false);
              }}
            >
              <div className="form-grid">
                <label className="span-2">
                  Project name
                  <input
                    value={name}
                    maxLength={120}
                    required
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="span-2">
                  Location
                  <input
                    value={r.location}
                    maxLength={120}
                    required
                    onChange={(e) => setR({ ...r, location: e.target.value })}
                  />
                </label>
                {[
                  {
                    key: 'capacity',
                    label:
                      p.type === 'data-center'
                        ? 'Power target (MW)'
                        : p.type === 'park'
                          ? 'Target visitors'
                          : p.type === 'commercial'
                            ? 'Target area (sq ft)'
                            : 'Target beds',
                    min: 1,
                    max: 100000,
                  },
                  { key: 'budget', label: 'Budget (USD)', min: 10000, max: 1e12 },
                  { key: 'floors', label: 'Floors', min: 1, max: 40 },
                  {
                    key: 'monthlyRate',
                    label:
                      p.type === 'data-center'
                        ? 'Revenue / MW / month ($)'
                        : p.type === 'commercial'
                          ? 'Rent / sq ft / month ($)'
                          : 'Rent / bed / month ($)',
                    min: 0,
                    max: 1e7,
                  },
                  { key: 'occupancy', label: 'Occupancy (0–1)', min: 0, max: 1, step: 0.01 },
                  {
                    key: 'expenseRatio',
                    label: 'Expense ratio (0–0.99)',
                    min: 0,
                    max: 0.99,
                    step: 0.01,
                  },
                  { key: 'parking', label: 'Parking spaces', min: 0, max: 5000 },
                  { key: 'setback', label: 'Conceptual setback (m)', min: 0, max: 60 },
                ].map((field) => (
                  <label key={field.key}>
                    {field.label}
                    <input
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={field.step || 1}
                      required
                      value={r[field.key as keyof Requirements]}
                      onChange={(e) => setR({ ...r, [field.key]: +e.target.value })}
                    />
                  </label>
                ))}
              </div>
              <Button className="full-width" disabled={busy || !!p.approvedDesignId}>
                Save requirements <Check size={16} />
              </Button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
export function Stat({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className={`stat ${warning ? 'stat-warning' : ''}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
