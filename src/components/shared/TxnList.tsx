/**
 * Transactions you can act on: Move one to another Category, or note why.
 * Laid out as rows that stack on a phone.
 */

import { useState } from 'react'
import { CategorySelect } from './CategorySelect'
import type { Txn } from '@/lib/model/types'
import { useBook } from '@/lib/ledger/book'
import { useMoveTxn, useNoteTxn } from '@/lib/ledger/useLedger'
import { categoryOf, ownerOf, storeCategory } from '@/lib/model/ledger'
import { dayLabel } from '@/lib/model/dates'
import { money } from '@/lib/model/money'
import { ownerColor } from '@/lib/format'

export function TxnList({
  txns,
  limit = 200,
}: {
  txns: Array<Txn>
  limit?: number
}) {
  const [all, setAll] = useState(false)
  const shown = all ? txns : txns.slice(0, limit)
  if (!txns.length)
    return <p className="px-3 py-4 text-sm text-muted">No purchases.</p>
  return (
    <div className="divide-y divide-border">
      {shown.map((t) => (
        <TxnRow key={t.id} txn={t} />
      ))}
      {txns.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="w-full px-3 py-3 text-sm font-medium text-accent"
        >
          Show all {txns.length}
        </button>
      )}
    </div>
  )
}

function TxnRow({ txn }: { txn: Txn }) {
  const { ix, plannedIds } = useBook()
  const move = useMoveTxn()
  const note = useNoteTxn()
  const usual = storeCategory(ix, txn)
  const category = categoryOf(ix, txn)
  const owner = ownerOf(ix, txn)
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[4rem_1fr_7rem_11rem_12rem] sm:items-center">
      <span className="hidden text-sm text-muted sm:block">
        {dayLabel(txn.date)}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">
          {txn.store}
          {txn.category && (
            <span className="ml-1.5 rounded bg-planned-soft px-1 text-[11px] font-medium text-planned">
              moved
            </span>
          )}
          {plannedIds.has(txn.id) && (
            <span className="ml-1.5 rounded bg-planned-soft px-1 text-[11px] font-medium text-planned">
              planned
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted">
          <span className="sm:hidden">{dayLabel(txn.date)} · </span>
          <span
            className="mr-1 inline-block size-2 rounded-full align-middle"
            style={{ background: ownerColor(owner) }}
            title={owner}
          />
          {txn.account} · {txn.description}
        </p>
      </div>
      <span
        className={`text-right text-sm font-semibold sm:order-none ${txn.amount < 0 ? 'text-accent' : ''}`}
      >
        {txn.amount < 0 ? `+${money(-txn.amount)}` : money(txn.amount)}
      </span>
      <CategorySelect
        label={`Category for ${txn.store} on ${dayLabel(txn.date)}`}
        value={category}
        defaultValue={usual}
        onChange={(c) =>
          move.mutate({ id: txn.id, category: c === usual ? null : c })
        }
        className="col-span-2 w-full sm:col-span-1"
      />
      <input
        type="text"
        key={txn.note ?? ''}
        defaultValue={txn.note ?? ''}
        maxLength={200}
        placeholder="Add a note"
        aria-label={`Note for ${txn.store} on ${dayLabel(txn.date)}`}
        className={`field col-span-2 w-full sm:col-span-1 ${txn.note ? 'has-value' : ''}`}
        onBlur={(e) => {
          const next = e.target.value.trim()
          if (next !== (txn.note ?? ''))
            note.mutate({ id: txn.id, note: next || null })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
    </div>
  )
}
