import { Suspense } from 'react';
import { Dashboard } from '@/components/dashboard';
export default function Projects() {
  return (
    <Suspense fallback={<div className="loading-screen">Opening your workspace…</div>}>
      <Dashboard />
    </Suspense>
  );
}
