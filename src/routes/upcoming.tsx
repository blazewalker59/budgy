import { createFileRoute, redirect } from '@tanstack/react-router'

/** Upcoming is Plan's Bills tab now; old links and shortcuts land there. */
export const Route = createFileRoute('/upcoming')({
  beforeLoad: () => {
    throw redirect({ to: '/plan', search: { tab: 'bills' } })
  },
})
