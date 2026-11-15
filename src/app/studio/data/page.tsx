import type { Metadata } from 'next';
import { DataView } from '@/components/studio/data-view';
import '../studio.css';
import './data.css';

export const metadata: Metadata = {
  title: 'Data · PlotStar',
  description: 'PlotStar\'s MongoDB Atlas data platform, live: schema, search, vectors, geo, analytics and change streams.',
};

export default function DataPage() {
  return <DataView />;
}
