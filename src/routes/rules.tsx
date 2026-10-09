import { createFileRoute, redirect } from '@tanstack/react-router'

/** Filing rules are a tab on Accounts. */
export const Route = createFileRoute('/rules')({
  beforeLoad: () => {
    throw redirect({ to: '/accounts', search: { tab: 'rules' } })
  },
})
