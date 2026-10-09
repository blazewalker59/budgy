/**
 * Take-home pay, as a sheet over the Budget: each employer's usual
 * paycheck and schedule (what the monthly figure is built from), other
 * money that came in, and every month's take-home against spending.
 */

import { useMemo, useState } from 'react'
import type { TakeHome } from '@/lib/model/income'
import type { IncomeMonth } from '@/components/charts/IncomeMonths'
import { useBook } from '@/lib/ledger/book'
import { PAY_SCHEDULES } from '@/lib/model/income'
import { dayLabel, monthLabel, monthRange, shiftMonth } from '@/lib/model/dates'
import { dollars, signedDollars } from '@/lib/model/money'
import { cn } from '@/lib/utils'
import { Sheet } from '@/components/shared/Sheet'
import { IncomeMonths } from '@/components/charts/lazy'

const MAX_MONTHS = 24

export function IncomeSheet({
  pay,
  spentTypical,
  windowLabel,
  onClose,
}: {
  pay: TakeHome
  /** Typical spending per month, planned bills included. */
  spentTypical: number
  windowLabel: string
  onClose: () => void
}) {
  const book = useBook()
  const ledger = book.ix.ledger
  const months = useMemo(() => {
    const last = shiftMonth(book.today.slice(0, 7), -1)
    const first = [ledger.income[0]?.month, book.months[0]]
      .filter(Boolean)
      .sort()[0]
    return monthRange(last, MAX_MONTHS).filter((m) => !first || m >= first)
  }, [book.today, book.months, ledger.income])
  const byMonth = useMemo(() => {
    const index = new Map(months.map((m, i) => [m, i]))
    const out: Array<IncomeMonth> = months.map((month) => ({
      month,
      received: 0,
      spent: 0,
    }))
    for (const i of ledger.income) {
      const k = index.get(i.month)
      if (k !== undefined) out[k].received += i.amount
    }
    for (const t of ledger.txns) {
      const k = index.get(t.month)
      if (k !== undefined) out[k].spent += t.amount
    }
    return out
  }, [months, ledger])

  return (
    <Sheet title="Take-home pay" onClose={onClose}>
      <section className="rounded-xl border border-border bg-surface px-3 py-2 text-[13px]">
        <p className="flex flex-wrap items-baseline gap-x-3">
          <span>
            <span className="text-xl font-extrabold tracking-tight">
              {dollars(pay.monthly)}
            </span>
            <span className="text-xs text-muted"> /mo take-home</span>
          </span>
          {pay.other > 0 && (
            <span className="text-xs text-muted">
              + {dollars(pay.other)}/mo other income ({windowLabel} average)
            </span>
          )}
        </p>
        <p className="mt-0.5 text-[11px] text-muted">
          {pay.basis === 'paychecks'
            ? 'Each employer’s usual paycheck times how often it comes, so a month with an extra check or a bonus doesn’t move it. Bonuses, refunds and gifts are other income, not counted against the Budget.'
            : 'No regular paychecks found, so this averages every deposit.'}
        </p>
        {pay.sources.length > 0 && (
          <ul className="mt-1.5 divide-y divide-border">
            {pay.sources.map((s) => (
              <li
                key={s.payer}
                className={cn(
                  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 py-1',
                  s.ended && 'text-muted',
                )}
              >
                <span className="truncate font-semibold">{s.payer}</span>
                <span className="text-right tabular-nums font-semibold">
                  {s.ended ? 'stopped' : `${dollars(s.monthly)}/mo`}
                </span>
                <span className="truncate text-[11px] text-muted">
                  {dollars(s.perCheck)} {PAY_SCHEDULES[s.perYear]} · {s.account}
                </span>
                <span className="text-right text-[11px] text-muted">
                  last {dayLabel(s.last)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <IncomeMonths months={byMonth} typicalLeft={pay.monthly - spentTypical} />
      <MonthTable months={byMonth} />
    </Sheet>
  )
}

function MonthTable({ months }: { months: Array<IncomeMonth> }) {
  const [all, setAll] = useState(false)
  const rows = [...months].reverse()
  const shown = all ? rows : rows.slice(0, 6)
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface text-[13px]">
      <div className="grid grid-cols-4 gap-x-2 border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <span>Month</span>
        <span className="text-right">In</span>
        <span className="text-right">Spent</span>
        <span className="text-right">Left</span>
      </div>
      <ul className="divide-y divide-border tabular-nums">
        {shown.map((m) => (
          <li key={m.month} className="grid grid-cols-4 gap-x-2 px-3 py-1">
            <span>{monthLabel(m.month)}</span>
            <span className="text-right">{dollars(m.received)}</span>
            <span className="text-right">{dollars(m.spent)}</span>
            <span
              className={cn(
                'text-right font-semibold',
                m.received < m.spent ? 'text-over' : 'text-accent',
              )}
            >
              {signedDollars(m.received - m.spent)}
            </span>
          </li>
        ))}
      </ul>
      {rows.length > 6 && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="w-full border-t border-border py-1.5 text-xs font-semibold text-accent"
        >
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  )
}
