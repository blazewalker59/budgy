import { createFileRoute } from '@tanstack/react-router'
import { AdminScreen } from '@/components/demo/AdminScreen'

/** The demo sandbox. The Gate (__root.tsx) shows it only to admins, and
 * every server function it calls checks again (docs/adr/0015). */
export const Route = createFileRoute('/admin')({
  head: () => ({ meta: [{ name: 'referrer', content: 'no-referrer' }] }),
  component: AdminScreen,
})
