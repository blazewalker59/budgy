import { createFileRoute } from '@tanstack/react-router'
import { validateSetupSearch } from '@/lib/ledger/search'
import { SetupScreen } from '@/components/setup/SetupScreen'

export const Route = createFileRoute('/setup')({
  validateSearch: validateSetupSearch,
  component: SetupRoute,
})

function SetupRoute() {
  const { step } = Route.useSearch()
  return <SetupScreen step={step} />
}
