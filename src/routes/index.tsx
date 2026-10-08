import { createFileRoute } from '@tanstack/react-router'
import { validateViewSearch } from '@/lib/ledger/search'
import { MonthScreen } from '@/components/month/MonthScreen'

export const Route = createFileRoute('/')({
  validateSearch: validateViewSearch,
  component: MonthRoute,
})

function MonthRoute() {
  const { month, owner } = Route.useSearch()
  return <MonthScreen month={month} owner={owner} />
}
