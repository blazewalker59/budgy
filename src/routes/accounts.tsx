import { createFileRoute } from '@tanstack/react-router'
import { AccountsScreen } from '@/components/accounts/AccountsScreen'

export const Route = createFileRoute('/accounts')({
  component: AccountsScreen,
})
