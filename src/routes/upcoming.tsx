import { createFileRoute } from '@tanstack/react-router'
import { UpcomingScreen } from '@/components/upcoming/UpcomingScreen'

export const Route = createFileRoute('/upcoming')({
  component: UpcomingScreen,
})
