import { createFileRoute } from '@tanstack/react-router'
import { validateAccountsSearch } from '@/lib/ledger/search'
import { AccountsScreen } from '@/components/accounts/AccountsScreen'

export const Route = createFileRoute('/accounts')({
  validateSearch: validateAccountsSearch,
  component: AccountsRoute,
})

function AccountsRoute() {
  const { tab, ...lens } = Route.useSearch()
  return <AccountsScreen lens={lens} tab={tab ?? 'accounts'} />
}
