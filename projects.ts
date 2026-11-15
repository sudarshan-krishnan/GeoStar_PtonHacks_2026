import Link from 'next/link';
import {
  ArrowUpRight,
  ArrowRight,
  MapPin,
  Box,
  ShieldCheck,
  Building2,
  Wallet,
  Users,
  Leaf,
  Zap,
  ScanLine,
  Sparkles,
  Check,
  ChevronRight,
} from 'lucide-react';
import { Brand, Star } from '@/components/brand';
import { CityArt } from '@/components/city-art';
import { Button } from '@/components/ui/button';
export default function Home() {
  return (
    <main className="landing">
      <nav className="landing-nav">
        <Brand />
        <div className="nav-links">
          <a href="#platform">The platform</a>
          <a href="#possibilities">Built for you</a>
          <a href="#intelligence">Our approach</a>
        </div>
        <Button asChild variant="secondary">
          <Link href="/studio">
            Open the studio <ArrowUpRight size={16} />
          </Link>
        </Button>
      </nav>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="pulse-dot" /> DATA CENTERS · HOUSTON · REAL COSTAR PROPERTIES
          </div>
          <h1>
            Where to build.
            <br />
            How to run it.
            <br />
            <span>Prove it.</span>
            <Star className="hero-star" />
          </h1>
          <p>
            Data centers get dropped into towns on cost alone. PlotStar checks every real site for
            money, people and planet at the same time, moves the heavy work into clean, cheap hours,
            and proves the savings on a real meter.
          </p>
          <div className="hero-actions">
            <Button asChild>
              <Link href="/studio">
                Start a project <ArrowUpRight size={18} />
              </Link>
            </Button>
            <Link href="/explore" className="text-link">
              See the Houston search <ArrowRight size={17} />
            </Link>
          </div>
          <div className="hero-note">
            <span className="mini-stack">
              <MapPin size={13} />
              <Box size={13} />
              <ShieldCheck size={13} />
            </span>{' '}
            Money · People · Planet. Pass or fail, never averaged.
          </div>
        </div>
        <div className="hero-visual">
          <div className="visual-grid" />
          <div className="visual-topline">
            <span>
              <span className="pulse-dot" /> PLOTSTAR INTELLIGENCE
            </span>
            <span>HOUSTON, TX ↗</span>
          </div>
          <CityArt />
          <div className="visual-bottom">
            <span>YOUR VISION. A CLEARER PATH.</span>
            <span>29.7604° N · 95.3698° W</span>
          </div>
          <div className="hero-visual-tag">
            <ShieldCheck size={18} />
            <span>
              Every number.
              <br />
              <b>Sourced.</b>
            </span>
            <span className="tag-line" />
          </div>
        </div>
      </section>
      <div className="trust-strip">
        <span>BUILT ON REAL DATA</span>
        <span>
          <Building2 size={18} /> CoStar properties
        </span>
        <span>
          <ScanLine size={18} /> Vexcel aerial + 3D
        </span>
        <span>
          <Zap size={18} /> ERCOT grid day + live meters
        </span>
      </div>
      <section id="platform" className="platform-section">
        <div className="section-heading">
          <div>
            <div className="eyebrow">ONE PLATFORM. FROM THE GROUND UP.</div>
            <h2>
              Two questions.
              <br />
              <span>Real numbers.</span>
            </h2>
          </div>
          <p>
            Where should it go, and how should it run.
            <br />
            One screen. One honest decision.
          </p>
        </div>
        <div className="stage-cards">
          {[
            {
              n: '01',
              title: 'Where',
              sub: 'Money. People. Planet.',
              text: 'Every real CoStar site is checked for homes, floods, water and power. People and planet are pass/fail gates, so the cheapest site loses if it fails one.',
              icon: MapPin,
              href: '/explore',
              class: 'discover-mini',
            },
            {
              n: '02',
              title: 'How to run',
              sub: 'Clean, cheap hours.',
              text: 'One optimizer picks the site, the cooling and the hourly schedule together, moving heavy jobs into the hours when ERCOT power is clean and cheap.',
              icon: Box,
              href: '/explore',
              class: 'design-mini',
            },
            {
              n: '03',
              title: 'Prove it',
              sub: 'On a real meter.',
              text: 'Two machines run the same job, cost-first and PlotStar. Press the grid-emergency button and watch measured watts fall while the job still finishes.',
              icon: ShieldCheck,
              href: '/explore',
              class: 'protect-mini',
            },
          ].map((s, i) => (
            <Link href={s.href} className="stage-card" key={s.n}>
              <div className="stage-card-top">
                <span>
                  {s.n} / {s.title.toUpperCase()}
                </span>
                <s.icon size={20} />
              </div>
              <div className={`stage-mini ${s.class}`}>
                {i === 0 ? (
                  <>
                    <span className="map-road r1" />
                    <span className="map-road r2" />
                    <span className="map-road r3" />
                    <span className="parcel p1" />
                    <span className="parcel p2" />
                    <div className="mini-map-label">
                      <MapPin size={14} /> The next great place.
                    </div>
                  </>
                ) : i === 1 ? (
                  <div className="iso-mini">
                    <i />
                    <i />
                    <i />
                  </div>
                ) : (
                  <div className="sensor-mini">
                    <div className="sensor-orbit" />
                    <ShieldCheck size={48} />
                    <span className="mini-sensor a" />
                    <span className="mini-sensor b" />
                    <span className="mini-sensor c" />
                  </div>
                )}
              </div>
              <h3>
                {s.title} <ArrowUpRight size={20} />
              </h3>
              <h4>{s.sub}</h4>
              <p>{s.text}</p>
            </Link>
          ))}
        </div>
      </section>
      <section id="possibilities" className="possibilities">
        <div>
          <div className="eyebrow">THE THREE PILLARS</div>
          <h2>A site only wins if it wins all three.</h2>
        </div>
        <div className="use-cases">
          {[
            { icon: Wallet, name: 'Money', detail: 'Land, power price, distance to the grid' },
            { icon: Users, name: 'People', detail: 'Homes nearby, water, noise. Pass or fail.' },
            { icon: Leaf, name: 'Planet', detail: 'Grid carbon by the hour, water stress, cooling' },
          ].map((s) => (
            <Link href="/explore" key={s.name}>
              <s.icon size={25} />
              <h3>{s.name}</h3>
              <p>{s.detail}</p>
              <ArrowUpRight size={17} />
            </Link>
          ))}
        </div>
      </section>
      <section id="intelligence" className="intelligence-section">
        <div className="intelligence-orbit">
          <Star />
          <span className="orbit-word a">MONEY</span>
          <span className="orbit-word b">PEOPLE</span>
          <span className="orbit-word c">PLANET</span>
        </div>
        <div>
          <div className="eyebrow">NOTHING TYPED IN BY HAND</div>
          <h2>
            Every number
            <br />
            has a source.
          </h2>
          <p>
            CoStar, Vexcel, FEMA, WRI Aqueduct, OpenStreetMap, ERCOT, or our own meter. Each figure
            carries a label: Sourced, Estimated, Simulated or Measured.
          </p>
          <ul>
            <li>
              <Check size={17} /> Real CoStar properties, Vexcel aerial and 3D, Matterport inside
            </li>
            <li>
              <Check size={17} /> ERCOT day-ahead prices and fuel-mix carbon, hour by hour
            </li>
            <li>
              <Check size={17} /> Measured watts from the machines; simulation is always labeled
            </li>
          </ul>
          <Link href="/explore" className="text-link">
            Open the workspace <ChevronRight size={17} />
          </Link>
        </div>
      </section>
      <section className="landing-cta">
        <Star />
        <div>
          <div className="eyebrow">A COMPANY NEEDS 20 MW IN HOUSTON.</div>
          <h2>Find the win-win-win site.</h2>
        </div>
        <Button asChild variant="secondary">
          <Link href="/explore">
            Find a site <ArrowUpRight size={18} />
          </Link>
        </Button>
      </section>
      <footer className="landing-footer">
        <Brand />
        <span>Where should it go. How should it run. Prove it.</span>
        <p>© {new Date().getFullYear()} PlotStar · Conceptual intelligence. Human ambition.</p>
        <Link href="/explore">
          Open workspace <ArrowUpRight size={14} />
        </Link>
      </footer>
    </main>
  );
}
