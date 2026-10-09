import { createFileRoute, redirect } from '@tanstack/react-router'

/** Budget is part of Plan now; old links and installed shortcuts land there. */
export const Route = createFileRoute('/budget')({
  beforeLoad: () => {
    throw redirect({ to: '/plan' })
  },
})
