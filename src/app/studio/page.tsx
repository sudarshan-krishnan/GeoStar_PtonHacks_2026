import type { Metadata } from 'next';
import { Studio } from '@/components/studio/studio';
import '../explore/explore.css';
import '../explore/workspace.css';
import './studio.css';
import './studio-polish.css';

export const metadata: Metadata = {
  title: 'Studio · PlotStar',
  description: 'From a data center brief to three measured layouts on a real site.',
};

export default function StudioPage() {
  return <Studio />;
}
