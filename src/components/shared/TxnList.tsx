/**
 * Transactions you can act on: Move one to another Category (then, if it
 * should always go there, make that the Store's rule), or note why. Laid
 * out as rows that stack on a phone, newest first. With `onPick`, a
 * purchase's Store and Account are filters to tap.
 */

import { useMemo, useState } from 'react'
import { CategorySelect } from './CategorySelect'
import type { Txn } from '@/lib/model/types'
import type { LensFilter } from '@/lib/model/lens'
import { useBook } from '@/lib/ledger/book'
import { useMoveTxn, useNoteTxn, useSetStoreRule } from '@/lib/ledger/useLedger'
import {
  ANY_SOURCE,
  categoryOf,
  everyTxn,
  ownerOf,
  ruleKey,
  storeCategory,
} from '@/lib/model/ledger'
import { dayLabel } from '@/lib/model/dates'
import { money } from '@/lib/model/money'
import { ownerColor } from '@/lib/format'

export function TxnList({
  txns,
  limit = 200,
  onPick,
}: {
  txns: Array<Txn>
  limit?: number
  /** Narrow the Lens to a purchase's Store or Account. */
  onPick?: (f: LensFilter) => void
}) {
  const [all, setAll] = useState(false)
  // Newest first, the larger first on the same day.
  const sorted = useMemo(
    () =>
      [...txns].sort(
        (a, b) => b.date.localeCompare(a.date) || b.amount - a.amount,
      ),
    [txns],
  )
  const shown = all ? sorted : sorted.slice(0, limit)
  if (!txns.length)
    return <p className="px-3 py-2 text-xs text-muted">No purchases.</p>
  return (
    <div className="@container divide-y divide-border">
      {shown.map((t) => (
        <TxnRow key={t.id} txn={t} onPick={onPick} />
      ))}
      {txns.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="w-full px-3 py-1.5 text-xs font-semibold text-accent"
        >
          Show all {txns.length}
        </button>
      )}
    </div>
  )
}

function TxnRow({
  txn,
  onPick,
}: {
  txn: Txn
  onPick?: (f: LensFilter) => void
}) {
  const { ix, plannedIds } = useBook()
  const move = useMoveTxn()
  const note = useNoteTxn()
  const setRule = useSetStoreRule()
  // After a Move: offer to file the Store there every time.
  const [offer, setOffer] = useState<string | null>(null)
  const usual = storeCategory(ix, txn)
  const category = categoryOf(ix, txn)
  const owner = ownerOf(ix, txn)
  return (
    <div className="grid grid-cols-2 items-center gap-x-2 gap-y-1 px-3 py-1.5 text-[13px] @2xl:grid-cols-[3rem_minmax(0,1fr)_5.5rem_9.5rem_minmax(0,0.8fr)]">
      <span className="hidden text-xs text-muted @2xl:block">
        {dayLabel(txn.date)}
      </span>
      <div className="min-w-0">
        <p className="truncate font-semibold">
          {onPick ? (
            <button
              type="button"
              onClick={() => onPick({ type: 'store', value: txn.store })}
              className="hover:text-accent hover:underline"
              title={`Filter to ${txn.store}`}
            >
              {txn.store}
            </button>
          ) : (
            txn.store
          )}
          {txn.category && (
            <span className="ml-1.5 rounded bg-planned-soft px-1 text-[10px] font-semibold text-planned">
              moved
            </span>
          )}
          {plannedIds.has(txn.id) && (
            <span className="ml-1.5 rounded bg-planned-soft px-1 text-[10px] font-semibold text-planned">
              planned
            </span>
          )}
        </p>
        <p className="truncate text-[11px] text-muted">
          <span className="@2xl:hidden">{dayLabel(txn.date)} · </span>
          <span
            className="mr-1 inline-block size-2 rounded-full align-middle"
            style={{ background: ownerColor(owner) }}
            title={owner}
          />
          {onPick ? (
            <button
              type="button"
              onClick={() => onPick({ type: 'account', value: txn.account })}
              className="hover:text-accent hover:underline"
              title={`Filter to ${txn.account}`}
            >
              {txn.account}
            </button>
          ) : (
            txn.account
          )}{' '}
          · {txn.description}
        </p>
      </div>
      <span
        className={`text-right font-semibold tabular-nums ${txn.amount < 0 ? 'text-accent' : ''}`}
      >
        {txn.amount < 0 ? `+${money(-txn.amount)}` : money(txn.amount)}
      </span>
      <CategorySelect
        label={`Category for ${txn.store} on ${dayLabel(txn.date)}`}
        value={category}
        defaultValue={usual}
        onChange={(c) => {
          move.mutate({ id: txn.id, category: c === usual ? null : c })
          const always = ix.rules.get(ruleKey(ANY_SOURCE, txn.store))?.category
          setOffer(c !== usual && c !== always ? c : null)
        }}
        className="w-full min-w-0"
      />
      <input
        type="text"
        key={txn.note ?? ''}
        defaultValue={txn.note ?? ''}
        maxLength={200}
        placeholder="Add a note"
        aria-label={`Note for ${txn.store} on ${dayLabel(txn.date)}`}
        className={`field w-full min-w-0 ${txn.note ? 'has-value' : ''}`}
        onBlur={(e) => {
          const next = e.target.value.trim()
          if (next !== (txn.note ?? ''))
            note.mutate({ id: txn.id, note: next || null })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      {offer && (
        <AlwaysFile
          store={txn.store}
          category={offer}
          onAlways={() => {
            setRule.mutate({
              sourceCategory: ANY_SOURCE,
              store: txn.store,
              category: offer,
            })
            setOffer(null)
          }}
          onDismiss={() => setOffer(null)}
        />
      )}
    </div>
  )
}

/** "Always file this Store here?", under a purchase just Moved. */
function AlwaysFile({
  store,
  category,
  onAlways,
  onDismiss,
}: {
  store: string
  category: string
  onAlways: () => void
  onDismiss: () => void
}) {
  const { ix } = useBook()
  const others = everyTxn(ix).filter(
    (t) =>
      t.store.toLowerCase() === store.toLowerCase() &&
      !t.category &&
      categoryOf(ix, t) !== category,
  ).length
  return (
    <div className="col-span-full flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-accent-soft px-2 py-1 text-xs">
      <span>
        Always put <strong>{store}</strong> in <strong>{category}</strong>?
        <span className="text-muted">
          {' '}
          {others
            ? `Also changes ${others} other ${others === 1 ? 'purchase' : 'purchases'} and future uploads.`
            : 'Future uploads too.'}
        </span>
      </span>
      <span className="ml-auto flex gap-1">
        <button
          type="button"
          onClick={onAlways}
          className="rounded-full bg-foreground px-2 py-0.5 font-semibold text-background"
        >
          Always
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full px-2 py-0.5 font-semibold text-muted hover:text-foreground"
        >
          Just this one
        </button>
      </span>
    </div>
  )
}
