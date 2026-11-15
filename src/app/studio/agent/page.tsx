import type { Metadata } from 'next';
import { AgentView } from '@/components/sponsors/langchain/agent-view';
import '../studio.css';
import '../agents.css';
import './agent.css';

export const metadata: Metadata = {
  title: 'Agent · GeoStar',
  description: 'How GeoStar\'s AI works: a Deep Agents orchestrator and six specialists, live, with LangSmith tracing.',
};

export default function AgentPage() {
  return <AgentView />;
}
