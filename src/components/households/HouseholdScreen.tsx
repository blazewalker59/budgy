import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { HOUSEHOLD_KEY, useHousehold } from '@/lib/households/useHousehold'
import {
  cancelHouseholdInvite,
  inviteToHousehold,
  removeHouseholdMember,
  transferHouseholdOwnership,
} from '@/lib/households/server'
import { SESSION_KEY, useSession } from '@/lib/ledger/useLedger'

export function HouseholdScreen() {
  const queryClient = useQueryClient()
  const session = useSession()
  const details = useHousehold()
  const [email, setEmail] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [confirmation, setConfirmation] = useState<{
    action: 'remove' | 'transfer'
    id: string
    name: string
  } | null>(null)
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: HOUSEHOLD_KEY }),
      queryClient.invalidateQueries({ queryKey: SESSION_KEY }),
    ])
  }
  const invite = useMutation({
    mutationFn: () => inviteToHousehold({ data: { email } }),
    onSuccess: async (created) => {
      setLink(`${window.location.origin}/join/${created.token}`)
      setCopied(false)
      setCopyError(false)
      setEmail('')
      await refresh()
    },
  })
  const manage = useMutation({
    mutationFn: (action: {
      action: 'remove' | 'transfer' | 'revoke'
      id: string
    }) => {
      if (action.action === 'revoke')
        return cancelHouseholdInvite({ data: { id: action.id } })
      if (action.action === 'transfer')
        return transferHouseholdOwnership({ data: { memberId: action.id } })
      return removeHouseholdMember({ data: { memberId: action.id } })
    },
    onSuccess: async () => {
      setConfirmation(null)
      setLink(null)
      await refresh()
    },
  })
  if (details.isPending)
    return (
      <p role="status" className="text-sm text-muted">
        Loading Household…
      </p>
    )
  if (details.isError)
    return (
      <p role="alert" className="text-sm text-danger">
        {details.error.message}
      </p>
    )
  const { household, members, invites } = details.data
  const memberId =
    session.data?.status === 'member' ? session.data.member.id : null
  const owner = household.role === 'owner'
  const busy = invite.isPending || manage.isPending
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header>
        <h1 className="text-lg font-extrabold tracking-tight">
          {household.name}
        </h1>
        <p className="text-sm text-muted">
          Your Household shares one private Ledger. Every Member can view and
          edit it; the owner manages membership.
        </p>
      </header>
      <section className="space-y-3 rounded-xl border border-border bg-surface p-3">
        <h2 className="text-sm font-bold">Members</h2>
        <ul className="space-y-3">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <div>
                <p className="text-sm font-semibold">
                  {member.name ?? (member.id === memberId ? 'You' : 'Member')}
                  {member.id === memberId ? ' (you)' : ''}
                </p>
                <p className="text-xs text-muted">
                  {member.email} ·{' '}
                  {member.role === 'owner' ? 'Owner' : 'Member'}
                </p>
              </div>
              {owner && member.role === 'member' && member.id !== memberId && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    className="min-h-11 rounded-full border border-border px-3 text-xs font-semibold disabled:opacity-50"
                    onClick={() =>
                      setConfirmation({
                        action: 'transfer',
                        id: member.id,
                        name: member.name ?? 'this Member',
                      })
                    }
                  >
                    Make owner
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="min-h-11 rounded-full px-3 text-xs font-semibold text-danger disabled:opacity-50"
                    onClick={() =>
                      setConfirmation({
                        action: 'remove',
                        id: member.id,
                        name: member.name ?? 'this Member',
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {confirmation && (
          <div className="space-y-2 rounded-lg border border-border bg-background p-3">
            <p className="text-sm">
              {confirmation.action === 'remove'
                ? `Remove ${confirmation.name}? Their access and agent tokens will stop working. Purchases and notes stay in the Ledger.`
                : `Make ${confirmation.name} the owner? You’ll remain a Member, but will no longer manage invitations or membership.`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50"
                data-haptic={
                  confirmation.action === 'remove' ? 'warning' : undefined
                }
                onClick={() => manage.mutate(confirmation)}
              >
                {manage.isPending ? 'Saving…' : 'Confirm'}
              </button>
              <button
                type="button"
                disabled={busy}
                className="min-h-11 rounded-full px-4 text-sm"
                onClick={() => setConfirmation(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
      {owner && (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-3">
          <h2 className="text-sm font-bold">Invite someone</h2>
          <p className="text-xs text-muted">
            Use their Google account’s email. The link works once, expires in
            seven days, and can be revoked. Share it yourself; Budgy doesn’t
            send email.
          </p>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              invite.mutate()
            }}
          >
            <label className="sr-only" htmlFor="invite-email">
              Google account email
            </label>
            <input
              id="invite-email"
              className="field min-w-48 flex-1"
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="partner@example.com"
            />
            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50"
            >
              {invite.isPending ? 'Creating…' : 'Create invite link'}
            </button>
          </form>
          {link && (
            <div
              role="status"
              className="space-y-2 rounded-lg bg-accent-soft p-3"
            >
              <p className="text-sm font-semibold">
                Copy this link now—it won’t be shown again.
              </p>
              <input
                aria-label="Invitation link"
                readOnly
                value={link}
                className="field w-full text-xs"
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                className="min-h-11 rounded-full border border-border px-4 text-sm font-semibold"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(link)
                    .then(() => setCopied(true))
                    .catch(() => setCopyError(true))
                }
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
              {copyError && (
                <p className="text-xs text-muted">
                  Select the link above and copy it manually.
                </p>
              )}
            </div>
          )}
          {invites.length > 0 && (
            <ul className="space-y-2">
              {invites.map((pending) => (
                <li
                  key={pending.id}
                  className="flex items-center justify-between gap-2"
                >
                  <div>
                    <p className="text-sm">{pending.email}</p>
                    <p className="text-xs text-muted">
                      Expires {new Date(pending.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    className="min-h-11 rounded-full px-3 text-xs font-semibold text-danger disabled:opacity-50"
                    onClick={() =>
                      manage.mutate({ action: 'revoke', id: pending.id })
                    }
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {!owner && !members.some((m) => m.role === 'owner') && (
        <p role="status" className="text-sm text-muted">
          The owner of this migrated Household still needs to be assigned before
          invitations can be managed.
        </p>
      )}
      {(invite.isError || manage.isError) && (
        <p role="alert" className="text-sm text-danger">
          {invite.error?.message ?? manage.error?.message}
        </p>
      )}
    </div>
  )
}
