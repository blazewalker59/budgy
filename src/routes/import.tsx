import { createFileRoute, redirect } from '@tanstack/react-router'

/** Purchases come in per Account now; old links land on Accounts. */
export const Route = createFileRoute('/import')({
  beforeLoad: () => {
    throw redirect({ to: '/accounts' })
  },
})
