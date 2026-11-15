import type { Metadata } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import { Studio } from '@/components/studio/studio';
import '../explore/explore.css';
import '../explore/workspace.css';
import './studio.css';
import './studio-polish.css';
import './discover.css';
import './analyze.css';
// Design step: the workspace facility twin keeps its own (scoped) styles
import '../dashboard-2/dashboard.css';
import '../dashboard-2/protection.css';
import '../dashboard-2/smart-blocks.css';
import '../dashboard-2/command.css';
import '../dashboard-2/geostar.css';
import './design.css';
import './design-theme.css';
import './agents.css';
import './geostar.css';
import './shell.css';

// Same type as the landing page and the workspace.
const sans = Geist({ subsets: ['latin'], variable: '--ps-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--ps-mono' });
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--ps-serif' });

export const metadata: Metadata = {
  title: 'Studio · GeoStar',
  description: 'From a data center brief to three measured layouts on a real site.',
};

export default function StudioPage() {
  return (
    <div className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <Studio />
    </div>
  );
}
