import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HOUSEHOLD_INVITE_KEY } from '@/lib/households/useHousehold'
import { getHouseholdInvite, joinHousehold } from '@/lib/households/server'
import { useSession } from '@/lib/ledger/useLedger'
import { signOut } from '@/lib/auth/client'

export function JoinHousehold({ token }: { token: string }) {
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const member =
    session?.status === 'member' || session?.status === 'no-household'
      ? session.member
      : null
  const invite = useQuery({
    queryKey: [...HOUSEHOLD_INVITE_KEY, token, member?.id],
    queryFn: () => getHouseholdInvite({ data: { token } }),
    enabled: Boolean(member),
    retry: false,
  })
  const join = useMutation({
    mutationFn: () => joinHousehold({ data: { token } }),
    onSuccess: () => {
      queryClient.clear()
      window.location.replace('/')
    },
  })
  const alreadyJoined = session?.status === 'member'
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <section className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <h1 className="text-xl font-extrabold">Household invitation</h1>
        <p className="text-xs text-muted">Signed in as {member?.email}</p>
        {invite.isPending && (
          <p role="status" className="text-sm text-muted">
            Checking invitation…
          </p>
        )}
        {invite.isError && (
          <p role="alert" className="text-sm text-danger">
            {invite.error.message}. Make sure you’re signed in with the invited
            Google account, or ask the owner for a new link.
          </p>
        )}
        {invite.data && (
          <>
            <p className="text-sm">
              You’re invited to <strong>{invite.data.name}</strong>.
            </p>
            <p className="text-sm text-muted">
              Everyone in the Household can see and edit its purchases, balances
              and budget.
            </p>
            {alreadyJoined ? (
              <p role="alert" className="text-sm text-muted">
                You’re already in {session.household.name}, so you can’t join
                another Household.
              </p>
            ) : (
              <button
                type="button"
                disabled={join.isPending}
                onClick={() => join.mutate()}
                className="min-h-11 w-full rounded-full bg-foreground px-5 text-sm font-semibold text-background disabled:opacity-50"
              >
                {join.isPending ? 'Joining…' : 'Accept invitation'}
              </button>
            )}
          </>
        )}
        {join.isError && (
          <p role="alert" className="text-sm text-danger">
            {join.error.message}
          </p>
        )}
        <button
          type="button"
          className="text-sm font-semibold text-muted"
          onClick={() =>
            void signOut().then(() => {
              queryClient.clear()
              window.location.reload()
            })
          }
        >
          Use a different Google account
        </button>
        {alreadyJoined && (
          <Link to="/" className="block text-sm font-semibold">
            Back to my Household
          </Link>
        )}
      </section>
    </main>
  )
}
