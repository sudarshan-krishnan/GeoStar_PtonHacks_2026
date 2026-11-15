import type { Metadata } from 'next';
import { DashboardTwo } from '@/components/dashboard-2/dashboard';
import './dashboard.css';
import './protection.css';
import './smart-blocks.css';
import './command.css';

export const metadata: Metadata = {
  title: 'Smart Blocks',
  description:
    'Smart Blocks: locate, design, protect and deploy infrastructure in one connected workspace.',
};

export default function DashboardTwoPage() {
  return <DashboardTwo />;
}
