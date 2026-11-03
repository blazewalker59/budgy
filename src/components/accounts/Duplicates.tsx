/**
 * Possible duplicates, on Accounts → Updates: one purchase that looks to be
 * here twice, often under two names. Merge keeps one (and its filing);
 * Keep both stops asking.
 */

import { useMemo, useState } from 'react'
import { ChevronDown, Copy } from 'lucide-react'
import type { DuplicatePair } from '@/lib/model/duplicates'
import type { Txn } from '@/lib/model/types'
import { useBook } from '@/lib/ledger/book'
import { useKeepDuplicate, useMergeDuplicate } from '@/lib/ledger/useLedger'
import { possibleDuplicates } from '@/lib/model/duplicates'
import { categoryOf } from '@/lib/model/ledger'
import { dayLabel } from '@/lib/model/dates'
import { money } from '@/lib/model/money'
import { AccountRef } from '@/components/accounts/AccountName'

export function Duplicates() {
  const { ix } = useBook()
  const pairs = useMemo(() => possibleDuplicates(ix), [ix])
  const [open, setOpen] = useState(false)
  if (!pairs.length) return null
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-12 w-full items-center gap-2.5 px-3 text-left"
      >
        <Copy size={14} aria-hidden className="shrink-0 text-nice" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            {pairs.length === 1
              ? '1 possible duplicate'
              : `${pairs.length} possible duplicates`}
          </span>
          <span className="block truncate text-xs text-muted">
            The same purchase may be counted twice
          </span>
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <ul className="divide-y divide-border border-t border-border">
          {pairs.map((p) => (
            <Pair key={p.key} pair={p} />
          ))}
        </ul>
      )}
    </section>
  )
}

function Pair({ pair }: { pair: DuplicatePair }) {
  const { ix } = useBook()
  const merge = useMergeDuplicate()
  const keep = useKeepDuplicate()
  const ids = { goes: pair.goes.id, stays: pair.stays.id }
  const busy = merge.isPending || keep.isPending
  const { stays, goes } = pair
  // Most pairs are the same row twice; only say how they differ.
  const sameStore = stays.store.toLowerCase() === goes.store.toLowerCase()
  return (
    <li className="flex items-center gap-2 px-3 py-2 text-[13px]">
      <div className="min-w-0 flex-1">
        <p className="truncate">
          <span className="font-semibold tabular-nums">
            {money(stays.amount)}
          </span>{' '}
          <span className="font-semibold">{stays.store}</span>
          {!sameStore && <span className="text-muted"> / {goes.store}</span>}
          <span className="text-muted"> · {dayLabel(stays.date)}</span>
        </p>
        <p className="truncate text-xs text-muted">
          <AccountRef name={stays.account} /> · {categoryOf(ix, stays)} ·{' '}
          {sourceOf(stays)}
          {sourceOf(goes) !== sourceOf(stays) && ` + ${sourceOf(goes)}`}
        </p>
        {(merge.error || keep.error) && (
          <p className="text-xs text-over">
            {(merge.error ?? keep.error)?.message ?? 'That didn’t save.'}
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => merge.mutate(ids)}
        className="min-h-9 shrink-0 rounded-full bg-accent px-3 text-xs font-semibold text-surface disabled:opacity-50"
      >
        Merge
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => keep.mutate(ids)}
        className="min-h-9 shrink-0 rounded-full bg-sunken px-3 text-xs font-semibold disabled:opacity-50"
      >
        Keep both
      </button>
    </li>
  )
}

const sourceOf = (t: Txn) =>
  t.starting ? 'starting' : t.synced ? 'bank sync' : 'upload'
