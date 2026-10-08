import { createFileRoute } from '@tanstack/react-router'
import { AgentsScreen } from '@/components/agents/AgentsScreen'

export const Route = createFileRoute('/agents')({
  component: AgentsScreen,
})
