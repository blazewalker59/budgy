import { createFileRoute } from '@tanstack/react-router'
import { validateLensSearch } from '@/lib/ledger/search'
import { PlanScreen } from '@/components/budget/PlanScreen'

export const Route = createFileRoute('/plan')({
  validateSearch: validateLensSearch,
  component: PlanRoute,
})

function PlanRoute() {
  return <PlanScreen lens={Route.useSearch()} />
}
