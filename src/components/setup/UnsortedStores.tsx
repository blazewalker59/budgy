/**
 * The Stores whose purchases came in Uncategorized, the most money first.
 * Choosing a Category files the Store there for good: the store-wide Store
 * Rule a Move makes with "Always", past purchases and future ones.
 */
import { useMemo, useState } from 'react'
import { useBook } from '@/lib/ledger/book'
import { useSetStoreRule } from '@/lib/ledger/useLedger'
import { ANY_SOURCE } from '@/lib/model/ledger'
import { unsortedStores } from '@/lib/model/sorting'
import { dayLabel } from '@/lib/model/dates'
import { dollars } from '@/lib/model/money'
import { CategorySelect } from '@/components/shared/CategorySelect'

const PAGE = 15

export function UnsortedStores() {
  const { ix } = useBook()
  const setRule = useSetStoreRule()
  const [more, setMore] = useState(false)
  const stores = useMemo(() => unsortedStores(ix), [ix])
  if (!stores.length)
    return (
      <p role="status" className="text-sm text-accent">
        Nothing left to sort.
      </p>
    )
  const shown = more ? stores : stores.slice(0, PAGE)
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-3 py-1.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          To sort · {stores.length} {stores.length === 1 ? 'store' : 'stores'}
        </h2>
      </div>
      <ul className="divide-y divide-border">
        {shown.map((s) => (
          <li
            key={s.store}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 text-[13px]"
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold">{s.store}</span>
              <span className="block text-[11px] text-muted">
                {s.purchases} {s.purchases === 1 ? 'purchase' : 'purchases'} ·{' '}
                {dollars(s.spent)} · last {dayLabel(s.last)}
              </span>
            </span>
            <CategorySelect
              value=""
              label={`Category for ${s.store}`}
              className="w-44"
              onChange={(category) =>
                setRule.mutate({
                  sourceCategory: ANY_SOURCE,
                  store: s.store,
                  category,
                })
              }
            />
          </li>
        ))}
      </ul>
      {stores.length > PAGE && (
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          className="min-h-11 w-full border-t border-border text-xs font-semibold text-muted"
        >
          {more ? 'Show fewer' : `Show all ${stores.length}`}
        </button>
      )}
    </section>
  )
}
