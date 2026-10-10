/**
 * Removing starting purchases (from the first bulk import): a button, then
 * a confirmation in place, since it can't be undone. For one Account, or
 * every Account when none is given.
 */

import { useState } from 'react'
import { useRemoveStarting } from '@/lib/ledger/useLedger'
import { ConfirmPanel } from '@/components/shared/Confirm'

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
    <ConfirmPanel
      question={`Remove ${what}${account ? ` from ${account}` : ''}?`}
      detail="Their categories and notes go too. This can’t be undone."
      action="Remove"
      onConfirm={() => {
        remove.mutate(account ? { account } : {})
        setConfirming(false)
      }}
      onCancel={() => setConfirming(false)}
    />
  )
}
