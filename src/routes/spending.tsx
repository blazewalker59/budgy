import { createFileRoute } from '@tanstack/react-router'
import { validateSpendingSearch } from '@/lib/ledger/search'
import { SpendingScreen } from '@/components/spending/SpendingScreen'

export const Route = createFileRoute('/spending')({
  validateSearch: validateSpendingSearch,
  component: SpendingRoute,
})

function SpendingRoute() {
  return <SpendingScreen search={Route.useSearch()} />
}
