import { createFileRoute } from '@tanstack/react-router'
import { SpendingScreen } from '@/components/spending/SpendingScreen'

export const Route = createFileRoute('/spending')({
  component: SpendingScreen,
})
