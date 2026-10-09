/**
 * Take-home pay, as a sheet over the Budget: the Pay Schedules the
 * Household counts on (who, how much lands per paycheck, how often, and a
 * payday), each editable in place, then every month's pay against spending.
 */

import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { PayCadence, PaySchedule } from '@/lib/model/types'
import type { TakeHome } from '@/lib/model/pay'
import type { IncomeMonth } from '@/components/charts/IncomeMonths'
import { useBook } from '@/lib/ledger/book'
import { newPayId, useDeletePay, useSavePay } from '@/lib/ledger/useLedger'
import { PAY_CADENCES, PAY_CADENCE_LABELS } from '@/lib/model/types'
import { monthlyPay, payByMonth } from '@/lib/model/pay'
import {
  dayLabel,
  monthLabel,
  monthRange,
  relativeDays,
  shiftMonth,
} from '@/lib/model/dates'
import { dollars, parseDollars, signedDollars } from '@/lib/model/money'
import { cn } from '@/lib/utils'
import { Sheet } from '@/components/shared/Sheet'
import { IncomeMonths } from '@/components/charts/lazy'

const MAX_MONTHS = 24

export function PaySheet({
  pay,
  spentTypical,
  onClose,
}: {
  pay: TakeHome
  /** Typical spending per month, planned bills included. */
  spentTypical: number
  onClose: () => void
}) {
  const book = useBook()
  const ledger = book.ix.ledger
  const months = useMemo(() => {
    const last = shiftMonth(book.today.slice(0, 7), -1)
    const first = book.months[0] ?? last
    return monthRange(last, MAX_MONTHS).filter((m) => m >= first)
  }, [book.today, book.months])
  const byMonth = useMemo(() => {
    const index = new Map(months.map((m, i) => [m, i]))
    const paid = payByMonth(ledger.pay, months)
    const out: Array<IncomeMonth> = months.map((month, i) => ({
      month,
      received: paid[i],
      spent: 0,
    }))
    for (const t of ledger.txns) {
      const k = index.get(t.month)
      if (k !== undefined) out[k].spent += t.amount
    }
    return out
  }, [months, ledger])

  return (
    <Sheet title="Take-home pay" onClose={onClose}>
      <section className="space-y-2 rounded-xl border border-border bg-surface px-3 py-2 text-[13px]">
        <p>
          <span className="text-xl font-extrabold tracking-tight">
            {dollars(pay.monthly)}
          </span>
          <span className="text-xs text-muted"> /mo take-home</span>
        </p>
        <p className="text-[11px] text-muted">
          What lands in the bank per paycheck, after taxes and deductions. A
          monthly figure counts paychecks per year (every 2 weeks is 26), so a
          month with a third paycheck doesn’t move it.
        </p>
        <ul className="divide-y divide-border">
          {pay.schedules.map((r) => (
            <li key={r.schedule.id} className="py-2">
              <PayForm
                value={r.schedule}
                summary={`${dollars(r.monthly)}/mo · next ${dayLabel(r.next)} (${relativeDays(book.today, r.next)})`}
              />
            </li>
          ))}
          <li className="pt-2">
            <PayForm today={book.today} />
          </li>
        </ul>
      </section>

      {pay.monthly > 0 && (
        <>
          <IncomeMonths
            months={byMonth}
            typicalLeft={pay.monthly - spentTypical}
          />
          <MonthTable months={byMonth} />
        </>
      )}
    </Sheet>
  )
}

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1)

/**
 * One Pay Schedule. An existing one saves as each field changes; a new one
 * (no `value`) adds itself with its button.
 */
function PayForm({
  value,
  summary,
  today,
}: {
  value?: PaySchedule
  summary?: string
  today?: string
}) {
  const savePay = useSavePay()
  const deletePay = useDeletePay()
  const blank: PaySchedule = {
    id: '',
    name: '',
    amount: 0,
    cadence: 'biweekly',
    anchor: today ?? '',
    secondDay: null,
  }
  const [draft, setDraft] = useState<PaySchedule>(value ?? blank)
  const [amount, setAmount] = useState(value ? String(value.amount / 100) : '')
  const cents = parseDollars(amount)
  const valid = draft.name.trim() !== '' && cents !== null && cents > 0
  const isNew = !value

  const update = (patch: Partial<PaySchedule>) => {
    const next = { ...draft, ...patch }
    if (next.cadence === 'semimonthly' && next.secondDay === null)
      next.secondDay = 31
    if (next.cadence !== 'semimonthly') next.secondDay = null
    setDraft(next)
    return next
  }
  const save = (next: PaySchedule) => {
    if (isNew || !next.name.trim() || cents === null || cents <= 0) return
    const s = { ...next, name: next.name.trim(), amount: cents }
    if (JSON.stringify(s) !== JSON.stringify(value)) savePay.mutate(s)
  }

  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!isNew || !valid) return
        savePay.mutate({
          ...draft,
          id: newPayId(),
          name: draft.name.trim(),
          amount: cents,
        })
        setDraft(blank)
        setAmount('')
      }}
    >
      <div className="flex items-center gap-1.5">
        <input
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
          onBlur={() => save(draft)}
          placeholder={isNew ? 'Whose pay (e.g. Blaze)' : 'Name'}
          maxLength={60}
          aria-label="Whose pay"
          className="field min-w-0 flex-1 font-semibold"
        />
        <label className="flex items-center gap-1">
          <span className="text-xs text-muted">$</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={() => save(draft)}
            onKeyDown={(e) => {
              if (!isNew && e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
            inputMode="decimal"
            placeholder="per check"
            aria-label="Take-home per paycheck"
            className="field w-24 text-right tabular-nums"
          />
        </label>
        {!isNew && (
          <button
            type="button"
            onClick={() => deletePay.mutate({ id: draft.id })}
            aria-label={`Remove ${draft.name}`}
            className="rounded p-1 text-muted hover:bg-sunken hover:text-over"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <select
          value={draft.cadence}
          onChange={(e) =>
            save(update({ cadence: e.target.value as PayCadence }))
          }
          aria-label="How often"
          className="field"
        >
          {PAY_CADENCES.map((c) => (
            <option key={c} value={c}>
              {PAY_CADENCE_LABELS[c]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-muted">
          {draft.cadence === 'semimonthly' ? 'on' : 'a payday'}
          <input
            type="date"
            value={draft.anchor}
            onChange={(e) =>
              e.target.value && save(update({ anchor: e.target.value }))
            }
            aria-label="A payday"
            className="field text-foreground"
          />
        </label>
        {draft.cadence === 'semimonthly' && (
          <label className="flex items-center gap-1 text-muted">
            and the
            <select
              value={draft.secondDay ?? 31}
              onChange={(e) =>
                save(update({ secondDay: Number(e.target.value) }))
              }
              aria-label="Other payday of the month"
              className="field text-foreground"
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d === 31 ? 'last day' : ordinal(d)}
                </option>
              ))}
            </select>
          </label>
        )}
        {isNew ? (
          <button
            type="submit"
            disabled={!valid}
            className="ml-auto inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1 font-semibold text-background disabled:opacity-40"
          >
            <Plus size={13} aria-hidden /> Add pay
          </button>
        ) : (
          summary && <span className="ml-auto text-muted">{summary}</span>
        )}
      </div>
      {isNew && valid && (
        <p className="text-[11px] text-muted">
          {dollars(monthlyPay({ ...draft, amount: cents }))}/mo
        </p>
      )}
    </form>
  )
}

function ordinal(n: number): string {
  const s =
    n % 100 >= 11 && n % 100 <= 13
      ? 'th'
      : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${s}`
}

function MonthTable({ months }: { months: Array<IncomeMonth> }) {
  const [all, setAll] = useState(false)
  const rows = [...months].reverse()
  const shown = all ? rows : rows.slice(0, 6)
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface text-[13px]">
      <div className="grid grid-cols-4 gap-x-2 border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <span>Month</span>
        <span className="text-right">Pay</span>
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
