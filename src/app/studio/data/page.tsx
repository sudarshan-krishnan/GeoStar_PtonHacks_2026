import type { Metadata } from 'next';
import { DataView } from '@/components/sponsors/mongodb/data-view';
import '../studio.css';
import './data.css';

export const metadata: Metadata = {
  title: 'Data · GeoStar',
  description: 'GeoStar\'s MongoDB Atlas data platform, live: schema, search, vectors, geo, analytics and change streams.',
};

export default function DataPage() {
  return <DataView />;
}
