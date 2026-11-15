import type { Metadata } from 'next';
import { AgentView } from '@/components/studio/agent-view';
import '../studio.css';
import './agent.css';

export const metadata: Metadata = {
  title: 'Agent · PlotStar',
  description: 'How PlotStar\'s AI works: a live LangGraph pipeline with LangSmith tracing.',
};

export default function AgentPage() {
  return <AgentView />;
}
