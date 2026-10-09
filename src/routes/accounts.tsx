import { createFileRoute } from '@tanstack/react-router'
import { validateLensSearch } from '@/lib/ledger/search'
import { AccountsScreen } from '@/components/accounts/AccountsScreen'

export const Route = createFileRoute('/accounts')({
  validateSearch: validateLensSearch,
  component: AccountsRoute,
})

function AccountsRoute() {
  return <AccountsScreen lens={Route.useSearch()} />
}
