/**
 * Possible duplicates, on Accounts → Updates: a bank sync added a purchase
 * that looks like one already here under another name. Merge keeps the one
 * already here (and its filing); Keep both stops asking.
 */

import { useMemo } from 'react'
import type { DuplicatePair } from '@/lib/model/duplicates'
import type { Txn } from '@/lib/model/types'
import { useBook } from '@/lib/ledger/book'
import { useKeepDuplicate, useMergeDuplicate } from '@/lib/ledger/useLedger'
import { possibleDuplicates } from '@/lib/model/duplicates'
import { categoryOf } from '@/lib/model/ledger'
import { dayLabel } from '@/lib/model/dates'
import { money } from '@/lib/model/money'

export function Duplicates() {
  const { ix } = useBook()
  const pairs = useMemo(() => possibleDuplicates(ix), [ix])
  if (!pairs.length) return null
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <h2 className="border-b border-border px-3 py-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
        Possible duplicates · {pairs.length}
        <span className="ml-1.5 font-normal tracking-normal normal-case">
          a bank sync added these beside purchases already here
        </span>
      </h2>
      <ul className="divide-y divide-border">
        {pairs.map((p) => (
          <Pair key={p.key} pair={p} />
        ))}
      </ul>
    </section>
  )
}

function Pair({ pair }: { pair: DuplicatePair }) {
  const merge = useMergeDuplicate()
  const keep = useKeepDuplicate()
  const ids = { synced: pair.synced.id, other: pair.other.id }
  const busy = merge.isPending || keep.isPending
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 text-[13px] sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-xs text-muted">
          <span className="font-semibold text-foreground tabular-nums">
            {money(pair.synced.amount)}
          </span>{' '}
          on {pair.synced.account}
        </p>
        <Side label="Already here" txn={pair.other} />
        <Side label="From the bank" txn={pair.synced} />
        {(merge.error || keep.error) && (
          <p className="text-xs text-over">
            {(merge.error ?? keep.error)?.message ?? 'That didn’t save.'}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => merge.mutate(ids)}
          className="min-h-9 flex-1 rounded-full bg-accent px-4 text-[13px] font-semibold text-surface disabled:opacity-50 sm:flex-none"
        >
          Merge
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => keep.mutate(ids)}
          className="min-h-9 flex-1 rounded-full bg-sunken px-4 text-[13px] font-semibold disabled:opacity-50 sm:flex-none"
        >
          Keep both
        </button>
      </div>
    </li>
  )
}

function Side({ label, txn }: { label: string; txn: Txn }) {
  const { ix } = useBook()
  return (
    <p className="flex min-w-0 items-baseline gap-2">
      <span className="w-24 shrink-0 text-[11px] font-semibold tracking-wide text-muted uppercase">
        {label}
      </span>
      <span className="min-w-0 truncate">
        <span className="font-semibold">{txn.store}</span>
        <span className="text-muted">
          {' '}
          · {dayLabel(txn.date)} · {categoryOf(ix, txn)}
          {txn.description.toLowerCase() !== txn.store.toLowerCase() &&
            ` · ${txn.description}`}
        </span>
      </span>
    </p>
  )
}
