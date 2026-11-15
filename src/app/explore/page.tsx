import type { Metadata } from 'next';
import { Flow } from '@/components/explore/flow';
import './explore.css';
import './workspace.css';

export const metadata: Metadata = {
  title: 'Site selection · PlotStar',
  description: 'Find buildable data center sites on real CoStar properties.',
};

export default function ExplorePage() {
  return <Flow />;
}
