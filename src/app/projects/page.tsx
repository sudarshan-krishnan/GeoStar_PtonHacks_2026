import { Suspense } from 'react';
import { Dashboard } from '@/components/workspace/dashboard';
export default function Projects() {
  return (
    <Suspense fallback={<div className="loading-screen">Opening your workspace…</div>}>
      <Dashboard />
    </Suspense>
  );
}
