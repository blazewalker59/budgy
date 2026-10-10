import { createFileRoute } from '@tanstack/react-router'
import { JoinHousehold } from '@/components/households/JoinHousehold'

export const Route = createFileRoute('/join/$token')({
  head: () => ({ meta: [{ name: 'referrer', content: 'no-referrer' }] }),
  component: InvitationPage,
})

function InvitationPage() {
  const { token } = Route.useParams()
  return <JoinHousehold token={token} />
}
