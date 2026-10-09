import { createFileRoute, redirect } from '@tanstack/react-router'

/** Upcoming is part of Plan now; old links and installed shortcuts land there. */
export const Route = createFileRoute('/upcoming')({
  beforeLoad: () => {
    throw redirect({ to: '/plan' })
  },
})
