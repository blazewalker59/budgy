/**
 * One place every failed Ledger save is said out loud. The edit hooks report
 * it (src/lib/ledger/useLedger.ts); screens don't each grow their own alert.
 */
import { useSyncExternalStore } from 'react'
import {
  clearSaveError,
  currentSaveError,
  subscribeSaveError,
} from '@/lib/ledger/useLedger'

export function LedgerSaveError() {
  const message = useSyncExternalStore(
    subscribeSaveError,
    currentSaveError,
    () => null,
  )
  if (!message) return null
  return (
    <div
      role="alert"
      className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-over/40 bg-over-soft px-3 py-2 text-[13px]"
    >
      <p>{message}</p>
      <button
        type="button"
        onClick={() => clearSaveError()}
        className="shrink-0 font-semibold"
      >
        Dismiss
      </button>
    </div>
  )
}
