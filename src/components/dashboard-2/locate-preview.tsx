'use client';

import { Component, useState, type ReactNode, type Ref } from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Compass,
  Grid2X2,
  Leaf,
  Map,
  MapPin,
  SlidersHorizontal,
  Sparkles,
  Wallet,
  Users,
} from 'lucide-react';
import { PrimaryCard } from './shell';
import {
  sampleProjectTypes,
  sampleSites,
  type PreviewProjectType,
  type SampleSite,
} from './sample-data';

type HeadingRef = { headingRef: Ref<HTMLHeadingElement> };

const ConceptModel = dynamic(() => import('./concepts/concept-model'), {
  ssr: false,
  loading: () => <div className="d2-concept-status">Sketching the concept…</div>,
});

class ConceptBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="d2-concept-status">3D preview unavailable in this browser.</div>
    ) : (
      this.props.children
    );
  }
}

/** Illustrative 3D sketch of the selected project type, not a replica of a real site. */
function ConceptPreview({ type }: { type: PreviewProjectType }) {
  const project = sampleProjectTypes.find((p) => p.id === type)!;
  return (
    <figure className="d2-concept" aria-label={`${project.label} concept sketch, drag to orbit`}>
      <div className="d2-concept-canvas">
        <ConceptBoundary key={type}>
          <ConceptModel type={type} />
        </ConceptBoundary>
      </div>
      <figcaption>
        <b>{project.label}</b>
        <span>Concept sketch · drag to orbit, scroll to zoom</span>
      </figcaption>
    </figure>
  );
}

export function DescribePreview({
  type,
  setType,
  brief,
  setBrief,
  city,
  setCity,
  onContinue,
  headingRef,
}: HeadingRef & {
  type: PreviewProjectType;
  setType: (type: PreviewProjectType) => void;
  brief: string;
  setBrief: (brief: string) => void;
  city: string;
  setCity: (city: string) => void;
  onContinue: () => void;
}) {
  return (
    <PrimaryCard className="d2-describe">
      <div className="d2-card-top">
        <span className="d2-kicker">
          <span /> A THOUGHTFUL FIRST STEP
        </span>
        <span className="d2-card-index">01 — 03</span>
      </div>
      <h1 ref={headingRef} tabIndex={-1}>
        Every great project{'\n'}starts with a place.
      </h1>
      <p className="d2-lede">
        Tell us what you have in mind.
        <br />
        Let’s give your next idea a little room.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onContinue();
        }}
      >
        <fieldset className="d2-types">
          <legend>What would you like to build?</legend>
          <div className="d2-type-grid">
            {sampleProjectTypes.map(({ id, label, icon: Icon, detail, brief: example }) => (
              <label className={`d2-type-card ${type === id ? 'is-selected' : ''}`} key={id}>
                <input
                  type="radio"
                  name="project-type"
                  checked={type === id}
                  onChange={() => {
                    setType(id);
                    setBrief(example);
                  }}
                />
                <span className="d2-type-icon">
                  <Icon size={25} strokeWidth={1.5} />
                </span>
                <span className="d2-type-copy">
                  <b>{label}</b>
                  <small>{detail}</small>
                </span>
                <span className="d2-radio-mark">
                  {type === id && <Check size={11} strokeWidth={3} />}
                </span>
              </label>
            ))}
          </div>
          <ConceptPreview type={type} />
        </fieldset>
        <label className="d2-city-field">
          <span>Where are you thinking?</span>
          <span className="d2-city-input">
            <MapPin size={16} />
            <select
              aria-label="Project location"
              value={city}
              onChange={(event) => setCity(event.target.value)}
            >
              <option>Houston, Texas</option>
              <option>Los Angeles, California</option>
              <option>Princeton, New Jersey</option>
            </select>
            <ChevronDown size={14} />
          </span>
        </label>
        <div className="d2-brief-label">
          <label htmlFor="d2-brief">A little about your vision</label>
          <span>Start with the big picture.</span>
        </div>
        <textarea
          id="d2-brief"
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          placeholder="What do you have in mind?"
        />
        <div className="d2-form-footer">
          <span>
            <Sparkles size={14} /> A preview of what’s possible.
          </span>
          <button className="d2-button" type="submit">
            Continue <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </PrimaryCard>
  );
}

function PreviewMap({
  selected,
  onSelect,
  city,
}: {
  selected: SampleSite;
  onSelect: (id: string) => void;
  city: string;
}) {
  return (
    <div className="d2-preview-map">
      <svg
        viewBox="0 0 700 450"
        preserveAspectRatio="xMidYMid slice"
        aria-label="Illustrative area map"
        role="img"
      >
        <defs>
          <pattern
            id="d2-blocks"
            width="86"
            height="68"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-14)"
          >
            <rect width="86" height="68" fill="#eff5e7" />
            <rect x="6" y="6" width="70" height="52" rx="5" fill="#f3f7ee" stroke="#dde5d6" />
            <path d="M0 64H86M82 0V68" stroke="#fff" strokeWidth="7" />
          </pattern>
        </defs>
        <rect width="700" height="450" fill="url(#d2-blocks)" />
        <path
          d="M520 -30C410 80 600 100 490 208S410 330 470 480"
          fill="none"
          stroke="#d6ef9c"
          strokeWidth="53"
        />
        <path
          d="M520 -30C410 80 600 100 490 208S410 330 470 480"
          fill="none"
          stroke="#eef5e3"
          strokeWidth="39"
        />
        <path d="M-40 120L740 310M160 -30L355 480" stroke="#c3cdbc" strokeWidth="26" />
        <path d="M-40 120L740 310M160 -30L355 480" stroke="#fbfcf7" strokeWidth="18" />
        <path d="M-20 335L725 90" stroke="#cfe0bb" strokeWidth="13" />
        <path d="M-20 335L725 90" stroke="#fbfcf7" strokeWidth="9" />
        <path
          d="M325 38L412 55L394 116L315 103Z M45 217L119 202L147 267L61 283Z M544 320L647 297L676 386L566 411Z"
          fill="#e0ecd0"
        />
        <path
          d="M191 113L245 97L268 151L213 170Z"
          fill={selected.id === 'northline' ? '#6fa24e' : '#cfe0bb'}
          stroke="#4f7f5b"
          strokeWidth="2"
        />
        <path
          d="M473 136L531 122L550 178L496 194Z M350 310L410 288L437 346L374 366Z M77 278L124 265L144 308L94 328Z"
          fill="#cfe0bb"
          stroke="#9fc46a"
          strokeWidth="1.5"
        />
        <g fill="#8e9a8c" fontSize="11" fontFamily="sans-serif" letterSpacing="2">
          <text x="70" y="63">
            NORTHWEST
          </text>
          <text x="527" y="79">
            EAST DISTRICT
          </text>
          <text x="255" y="410">
            SOUTH DISTRICT
          </text>
        </g>
        <text
          x="295"
          y="228"
          fill="#6b776e"
          fontSize="20"
          fontFamily="sans-serif"
          letterSpacing="4"
        >
          {city.split(',')[0].toUpperCase()}
        </text>
        <text x="545" y="366" fill="#8e9a8c" fontSize="10" fontFamily="sans-serif">
          GREENWAY
        </text>
      </svg>
      <span className="d2-map-label">
        <span /> AREA OVERVIEW
      </span>
      <span className="d2-map-compass">
        <Compass size={19} /> N
      </span>
      {sampleSites.map((site) => (
        <button
          key={site.id}
          aria-label={`Select ${site.name} on map`}
          aria-pressed={selected.id === site.id}
          className={`d2-map-pin ${selected.id === site.id ? 'is-selected' : ''}`}
          style={{ left: `${site.x}%`, top: `${site.y}%` }}
          onClick={() => onSelect(site.id)}
        >
          {site.letter}
          <span>{site.score}</span>
        </button>
      ))}
      <span className="d2-map-caption">Illustrative map · not to scale</span>
    </div>
  );
}

export function PickPreview({
  selected,
  onSelect,
  city,
  onContinue,
  headingRef,
}: HeadingRef & {
  selected: SampleSite;
  onSelect: (id: string) => void;
  city: string;
  onContinue: () => void;
}) {
  const [view, setView] = useState<'map' | 'list'>('map');
  const [showPriorities, setShowPriorities] = useState(false);
  const [priorities, setPriorities] = useState({ Money: 40, People: 30, Planet: 30 });
  return (
    <>
      <PrimaryCard className="d2-pick-preview">
        <div className="d2-card-top">
          <span className="d2-kicker">
            <span /> A PLACE WITH POTENTIAL
          </span>
          <span className="d2-card-index">02 — 03</span>
        </div>
        <h1 ref={headingRef} tabIndex={-1}>
          A few places.{'\n'}A clearer possibility.
        </h1>
        <p className="d2-lede">
          Take a look around. The right place is about more than a pin on a map.
        </p>
        <div className="d2-preview-toolbar">
          <div>
            <MapPin size={14} />
            <b>{city.split(',')[0]}</b>
            <span>4 sample locations</span>
          </div>
          <div>
            <button
              className={`d2-quiet-button ${showPriorities ? 'is-active' : ''}`}
              aria-expanded={showPriorities}
              onClick={() => setShowPriorities(!showPriorities)}
            >
              <SlidersHorizontal size={14} /> Priorities
            </button>
            <div className="d2-view-toggle" aria-label="Location view">
              <button
                aria-label="Map view"
                aria-pressed={view === 'map'}
                onClick={() => setView('map')}
              >
                <Map size={15} />
              </button>
              <button
                aria-label="List view"
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
              >
                <Grid2X2 size={15} />
              </button>
            </div>
          </div>
        </div>
        {showPriorities && (
          <div className="d2-preview-priorities">
            <p>
              What matters to you?
              <small>Explore the controls. Sample scores stay fixed in this preview.</small>
            </p>
            {Object.entries(priorities).map(([name, value]) => (
              <label key={name}>
                {name}
                <span>{value}%</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  aria-label={`${name} priority`}
                  value={value}
                  onChange={(event) =>
                    setPriorities({ ...priorities, [name]: +event.target.value })
                  }
                />
              </label>
            ))}
          </div>
        )}
        <div className={`d2-location-browser ${view === 'list' ? 'is-list' : ''}`}>
          {view === 'map' && <PreviewMap selected={selected} onSelect={onSelect} city={city} />}
          <div className="d2-location-list" aria-label="Sample locations">
            {sampleSites.map((site) => (
              <button
                key={site.id}
                className={`d2-location-row ${site.id === selected.id ? 'is-selected' : ''}`}
                aria-pressed={site.id === selected.id}
                onClick={() => onSelect(site.id)}
              >
                <span className="d2-location-letter">{site.letter}</span>
                <span className="d2-location-copy">
                  <b>{site.name}</b>
                  <small>{site.area}</small>
                  <span>
                    {site.acres} acres <i /> {site.price}
                  </span>
                </span>
                <span className="d2-location-score">
                  {site.score}
                  <small>match</small>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="d2-location-footer">
          <div>
            <span className="d2-overline">YOUR SELECTED LOCATION</span>
            <b>{selected.name}</b>
          </div>
          <button className="d2-button" onClick={onContinue}>
            Continue <ArrowRight size={16} />
          </button>
        </div>
      </PrimaryCard>
      <PrimaryCard className="d2-site-context">
        <div className="d2-context-heading">
          <div>
            <span className="d2-overline">A CLOSER LOOK</span>
            <h2>{selected.name}</h2>
          </div>
          <span className="d2-sample-tag">Sample data</span>
        </div>
        <p>{selected.note}</p>
        <div className="d2-pillar-grid">
          {[
            { name: 'Money', icon: Wallet, value: selected.money, detail: 'Cost & opportunity' },
            {
              name: 'People',
              icon: Users,
              value: selected.people,
              detail: 'Community & connection',
            },
            { name: 'Planet', icon: Leaf, value: selected.planet, detail: 'A lighter footprint' },
          ].map(({ name, icon: Icon, value, detail }) => (
            <div key={name}>
              <Icon size={19} />
              <span>
                {name}
                <small>{detail}</small>
              </span>
              <b>
                {value}
                <small>/100</small>
              </b>
            </div>
          ))}
        </div>
        <p className="d2-preview-footnote">
          Illustrative locations and fixed sample scores for design review.
        </p>
      </PrimaryCard>
    </>
  );
}

export function FinalizePreview({
  site,
  city,
  projectLabel,
  complete,
  onBack,
  onConfirm,
  onDesign,
  headingRef,
}: HeadingRef & {
  site: SampleSite;
  city: string;
  projectLabel: string;
  complete: boolean;
  onBack: () => void;
  onConfirm: () => void;
  onDesign: () => void;
}) {
  return (
    <PrimaryCard className="d2-finalize">
      <div className="d2-card-top">
        <span className="d2-kicker">
          <span /> {complete ? 'READY FOR THE NEXT CHAPTER' : 'A MOMENT OF CLARITY'}
        </span>
        <span className="d2-card-index">03 — 03</span>
      </div>
      <h1 ref={headingRef} tabIndex={-1}>
        {complete ? 'A place for\nyour next chapter.' : 'Your vision.\nA place to begin.'}
      </h1>
      <p className="d2-lede">One last look at the possibility you’ve chosen.</p>
      <div className="d2-preview-site-hero">
        <div className="d2-parcel-art" aria-hidden="true">
          <svg viewBox="0 0 200 140">
            <path d="M20 100L100 135L180 92L100 59Z" fill="#e7efdc" />
            <path d="M30 84L100 115L171 77L101 46Z" fill="#cfe0bb" stroke="#6fa24e" />
            <path d="M62 71L101 88L139 68L101 51Z" fill="#f5f9ef" stroke="#6fa24e" />
            <path
              d="M62 71V47L101 64V88M101 64L139 44V68M62 47L100 28L139 44L101 64"
              fill="#ecf3e3"
              stroke="#6fa24e"
            />
            <path d="M44 92L52 87M151 87L158 90" stroke="#4f7f5b" strokeWidth="3" />
          </svg>
        </div>
        <div>
          <span className="d2-sample-tag">Sample location</span>
          <h2>{site.name}</h2>
          <p>
            <MapPin size={13} /> {city} · {site.area}
          </p>
        </div>
        <span className="d2-site-match">
          {site.score}
          <small>match score</small>
        </span>
      </div>
      <div className="d2-review-grid">
        <div>
          <small>YOUR PROJECT</small>
          <b>{projectLabel}</b>
        </div>
        <div>
          <small>SITE AREA</small>
          <b>
            {site.acres}
            <span> acres</span>
          </b>
        </div>
        <div>
          <small>ACQUISITION</small>
          <b>{site.price}</b>
        </div>
        <div>
          <small>GRID CORRIDOR</small>
          <b>
            {site.access}
            <span> away</span>
          </b>
        </div>
      </div>
      <div className="d2-review-note">
        <Leaf size={18} />
        <div>
          <b>Room for a thoughtful beginning.</b>
          <p>{site.context}</p>
        </div>
      </div>
      {complete && (
        <div className="d2-success" role="status">
          <CheckCircle2 size={22} />
          <span>
            <b>Locate preview complete</b>
            <small>Your selection is ready to explore in the next module.</small>
          </span>
        </div>
      )}
      <div className="d2-form-footer">
        <button className="d2-back" onClick={onBack}>
          <ArrowLeft size={15} /> Back to sites
        </button>
        <button className="d2-button" onClick={complete ? onDesign : onConfirm}>
          {complete ? 'Explore Design' : 'Confirm selection'}
          {complete ? <ArrowRight size={16} /> : <Check size={16} />}
        </button>
      </div>
      <p className="d2-preview-footnote">
        Sample sites · selections are not saved.
      </p>
    </PrimaryCard>
  );
}
