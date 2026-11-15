import { Workspace } from '@/components/workspace/workspace';
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  return <Workspace id={(await params).id} />;
}
