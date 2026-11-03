/**
 * The bank's own categories ("Restaurants") that aren't one of the
 * Household's, and what each means. Choosing one files its purchases still
 * Uncategorized, and every later import, there (docs/adr/0013).
 */
import {
  useBankCategories,
  useFileBankCategory,
} from '@/lib/ledger/useBankCategories'
import { dollars } from '@/lib/model/money'
import { CategorySelect } from '@/components/shared/CategorySelect'

export function BankCategories({ limit }: { limit?: number }) {
  const list = useBankCategories()
  const file = useFileBankCategory()
  if (list.isError)
    return (
      <p role="alert" className="text-xs text-over">
        {list.error.message}
      </p>
    )
  const rows = list.data ?? []
  if (!rows.length) return null
  const shown = limit ? rows.slice(0, limit) : rows
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-3 py-1.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Bank categories
          <span className="ml-1.5 font-normal normal-case tracking-normal">
            what your bank calls them, and where they go
          </span>
        </h2>
      </div>
      <ul className="divide-y divide-border">
        {shown.map((c) => (
          <li
            key={c.name}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 text-[13px]"
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold">{c.name}</span>
              <span className="block text-[11px] text-muted">
                {c.purchases} {c.purchases === 1 ? 'purchase' : 'purchases'} ·{' '}
                {dollars(c.spent)}
                {c.unsorted > 0 && ` · ${c.unsorted} to sort`}
              </span>
            </span>
            <CategorySelect
              value={c.means ?? ''}
              label={`Category for ${c.name}`}
              className="w-44"
              onChange={(category) => file.mutate({ name: c.name, category })}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
