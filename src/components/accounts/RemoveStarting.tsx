/**
 * Removing starting purchases (from the first bulk import): a button, then
 * a confirmation in place, since it can't be undone. For one Account, or
 * every Account when none is given.
 */

import { useState } from 'react'
import { useRemoveStarting } from '@/lib/ledger/useLedger'

export function RemoveStarting({
  account,
  count,
}: {
  account?: string
  count: number
}) {
  const remove = useRemoveStarting()
  const [confirming, setConfirming] = useState(false)
  const what = `${count.toLocaleString()} starting ${count === 1 ? 'purchase' : 'purchases'}`
  if (!confirming)
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="min-h-9 rounded-full border border-over/40 px-4 text-[13px] font-semibold text-over hover:bg-over-soft"
        >
          {account ? `Remove ${what}` : `Remove all ${count.toLocaleString()}`}
        </button>
        {remove.error && (
          <p className="text-xs text-over">Couldn’t remove them. Try again.</p>
        )}
      </div>
    )
  return (
    <div
      role="alertdialog"
      aria-label={`Remove ${what}`}
      className="space-y-2 rounded-lg border border-over/40 bg-over-soft p-3 text-[13px] text-foreground"
    >
      <p>
        <strong>
          Remove {what}
          {account ? ` from ${account}` : ''}?
        </strong>{' '}
        Their categories and notes go too. This can’t be undone.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            remove.mutate(account ? { account } : {})
            setConfirming(false)
          }}
          className="min-h-9 rounded-full bg-over px-4 font-semibold text-surface"
        >
          Remove
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="min-h-9 rounded-full bg-surface px-4 font-semibold"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
