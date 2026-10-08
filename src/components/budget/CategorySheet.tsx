/**
 * One Category over time, as a sheet over the Budget: its months as a
 * chart, the same months as numbers, and the Stores behind them.
 */

import { useMemo } from 'react'
import type { TrendMonth } from '@/components/charts/CategoryTrend'
import { useBook } from '@/lib/ledger/book'
import { categoryOf, targetFor } from '@/lib/model/ledger'
import { categoryHistory } from '@/lib/model/month'
import { monthLabel, monthRange, shiftMonth } from '@/lib/model/dates'
import { dollars, signedDollars } from '@/lib/model/money'
import { cn } from '@/lib/utils'
import { Sheet } from '@/components/shared/Sheet'
import { CategoryTrend } from '@/components/charts/lazy'

/** At most this many months back, so the bars stay readable on a phone. */
const MAX_MONTHS = 24

export function CategorySheet({
  name,
  span,
  onClose,
}: {
  name: string
  /** Months the typical month averages, newest last. */
  span: number
  onClose: () => void
}) {
  const book = useBook()
  const { ix } = book
  const thisMonth = book.today.slice(0, 7)
  const months = useMemo(() => {
    const last = shiftMonth(thisMonth, -1)
    const first = book.months[0] ?? last
    return monthRange(last, MAX_MONTHS).filter((m) => m >= first)
  }, [thisMonth, book.months])

  const h = useMemo(
    () => categoryHistory(ix, months, book.plannedIds).get(name),
    [ix, months, book.plannedIds, name],
  )
  const typical = useMemo(
    () =>
      categoryHistory(ix, months.slice(-span), book.plannedIds).get(name)
        ?.typical ?? 0,
    [ix, months, span, book.plannedIds, name],
  )
  const target = targetFor(ix, name, thisMonth)
  const trend: Array<TrendMonth> = months.map((month, i) => ({
    month,
    everyday: h?.monthly[i] ?? 0,
    planned: (h?.allMonthly[i] ?? 0) - (h?.monthly[i] ?? 0),
  }))

  const stores = useMemo(() => {
    const inRange = new Set(months)
    const map = new Map<
      string,
      { store: string; amount: number; count: number }
    >()
    for (const t of ix.ledger.txns) {
      if (!inRange.has(t.month) || categoryOf(ix, t) !== name) continue
      const s = map.get(t.store) ?? { store: t.store, amount: 0, count: 0 }
      s.amount += t.amount
      s.count++
      map.set(t.store, s)
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, 8)
  }, [ix, months, name])

  return (
    <Sheet title={name} onClose={onClose}>
      <CategoryTrend months={trend} target={target} typical={typical} />

      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-[13px] tabular-nums">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="py-1.5 pl-3 font-semibold">Month</th>
              <th className="px-2 py-1.5 text-right font-semibold">Everyday</th>
              <th className="px-2 py-1.5 text-right font-semibold">Planned</th>
              <th className="py-1.5 pl-2 pr-3 text-right font-semibold">
                vs Target
              </th>
            </tr>
          </thead>
          <tbody>
            {[...trend].reverse().map((m) => {
              const t = targetFor(ix, name, m.month)
              return (
                <tr
                  key={m.month}
                  className="border-b border-border last:border-0"
                >
                  <td className="py-1 pl-3">{monthLabel(m.month)}</td>
                  <td className="px-2 py-1 text-right font-semibold">
                    {dollars(m.everyday)}
                  </td>
                  <td className="px-2 py-1 text-right text-planned">
                    {m.planned ? dollars(m.planned) : ''}
                  </td>
                  <td
                    className={cn(
                      'py-1 pl-2 pr-3 text-right',
                      t !== null && m.everyday > t ? 'text-over' : 'text-muted',
                    )}
                  >
                    {t === null ? '' : signedDollars(m.everyday - t)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {stores.length > 0 && (
        <section>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Biggest stores, {monthLabel(months[0])} –{' '}
            {monthLabel(months[months.length - 1])}
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-[13px]">
            {stores.map((s) => (
              <li
                key={s.store}
                className="flex justify-between gap-2 px-3 py-1"
              >
                <span className="truncate">
                  {s.store} <span className="text-muted">· {s.count}×</span>
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className="text-xs text-muted">
                    {dollars(s.amount / months.length)}/mo ·{' '}
                  </span>
                  <span className="font-semibold">{dollars(s.amount)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Sheet>
  )
}
