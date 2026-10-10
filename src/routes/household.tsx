import { createFileRoute } from '@tanstack/react-router'
import { HouseholdScreen } from '@/components/households/HouseholdScreen'

export const Route = createFileRoute('/household')({
  component: HouseholdScreen,
})
