import { createFileRoute } from '@tanstack/react-router'
import { validateOverviewSearch } from '@/lib/ledger/search'
import { MonthScreen } from '@/components/month/MonthScreen'

export const Route = createFileRoute('/')({
  validateSearch: validateOverviewSearch,
  component: OverviewRoute,
})

function OverviewRoute() {
  const { month, ...lens } = Route.useSearch()
  return <MonthScreen month={month} lens={lens} />
}
