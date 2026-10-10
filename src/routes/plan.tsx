import { createFileRoute } from '@tanstack/react-router'
import { validatePlanSearch } from '@/lib/ledger/search'
import { PlanScreen } from '@/components/budget/PlanScreen'

export const Route = createFileRoute('/plan')({
  validateSearch: validatePlanSearch,
  component: PlanRoute,
})

function PlanRoute() {
  const { tab, ...lens } = Route.useSearch()
  return <PlanScreen lens={lens} tab={tab ?? 'budget'} />
}
