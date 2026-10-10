/**
 * What's ahead, on Plan: the months Planned Expenses make heavy, then each
 * Plan once, by when it's next due (late, coming up, later, paused), each
 * opening a sheet with its payments and settings; and bills from history
 * that look like they should be planned.
 */

import { useMemo, useState } from 'react'
import { ChevronRight, Plus, Sparkles } from 'lucide-react'
import { PlanForm } from './PlanForm'
import { PlanSheet } from './PlanSheet'
import type { Plan } from '@/lib/model/types'
import type { PlanLine, PlanStatus } from '@/lib/model/plans'
import { useBook } from '@/lib/ledger/book'
import { newPlanId } from '@/lib/ledger/useLedger'
import { forecast } from '@/lib/model/forecast'
import { suggestPlans } from '@/lib/model/detect'
import {
  COMING_UP_DAYS,
  setAside as isSetAside,
  monthlySetAside,
  planLines,
} from '@/lib/model/plans'
import { addDays, dayLabel, monthLabel, relativeDays } from '@/lib/model/dates'
import { dollars } from '@/lib/model/money'
import { CADENCE_LABELS } from '@/lib/model/types'
import { cn } from '@/lib/utils'
import { ForecastChart } from '@/components/charts/lazy'

export function UpcomingScreen() {
  const book = useBook()
  const months = useMemo(
    () => forecast(book.ix, book.today.slice(0, 7), 12, book.occurrences),
    [book],
  )
  const lines = useMemo(
    () => planLines(book.ix.ledger.plans, book.occurrences, book.today),
    [book],
  )
  const suggestions = useMemo(() => suggestPlans(book.ix, book.today), [book])
  const [adding, setAdding] = useState<Plan | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const viewed = book.ix.ledger.plans.find((p) => p.id === viewing)
  const setAside = book.ix.ledger.plans
    .filter((p) => p.active)
    .reduce((n, p) => n + monthlySetAside(p), 0)

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold tracking-tight">
            Planned bills
          </h2>
          <p className="text-xs text-muted">
            Bills you know are coming. Monthly ones count toward their
            category’s target. Less frequent ones stay out of targets and are
            budgeted on their due dates.
            {setAside > 0 && (
              <>
                {' '}
                Set aside{' '}
                <strong className="text-planned">
                  {dollars(setAside)} a month
                </strong>
                .
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            setAdding({
              id: newPlanId(),
              name: '',
              category: 'Insurance',
              store: null,
              amount: 0,
              cadence: 'semiannual',
              anchor: addDays(book.today, 30),
              active: true,
            })
          }
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full bg-foreground px-3 text-xs font-semibold text-background"
        >
          <Plus size={15} aria-hidden /> Add
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <Forecast months={months} />

        <div className="space-y-3">
          {adding && <PlanForm plan={adding} onDone={() => setAdding(null)} />}
          {GROUPS.map((g) => {
            const list = lines.filter((l) => l.status === g.status)
            if (!list.length) return null
            return (
              <section key={g.status}>
                <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
                  {g.title}{' '}
                  <span className="ml-1 font-normal tracking-normal normal-case">
                    {g.hint}
                  </span>
                </h3>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                  {list.map((l) => (
                    <PlanRow
                      key={l.plan.id}
                      line={l}
                      today={book.today}
                      onOpen={() => setViewing(l.plan.id)}
                    />
                  ))}
                </ul>
              </section>
            )
          })}
          {!lines.length && !adding && (
            <p className="rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted">
              No planned bills yet. Tap <strong>Add</strong> or pick a
              suggestion below.
            </p>
          )}

          {suggestions.length > 0 && (
            <section>
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
                <Sparkles size={14} className="text-planned" aria-hidden />
                Looks like a planned bill
              </h3>
              <p className="mb-1 text-xs text-muted">
                Big charges from the same store every few months.
              </p>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {suggestions.map((s) => (
                  <li
                    key={`${s.category}-${s.store}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-[13px]"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {s.store}{' '}
                        <span className="font-normal text-muted">
                          · {s.category}
                        </span>
                      </p>
                      <p className="text-xs text-muted">
                        {CADENCE_LABELS[s.cadence]}:{' '}
                        {s.charges
                          .slice(-4)
                          .map(
                            (c) =>
                              `${dollars(c.amount)} ${monthLabel(c.month)}`,
                          )
                          .join(', ')}
                        . Next about {dayLabel(s.nextDue)}.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAdding({
                          id: newPlanId(),
                          name: s.store,
                          category: s.category,
                          store: s.store,
                          amount: s.amount,
                          cadence: s.cadence,
                          anchor: s.nextDue,
                          active: true,
                        })
                      }
                      className="min-h-9 rounded-full border border-border px-3 text-xs font-semibold"
                    >
                      Plan for it
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
      {viewed && <PlanSheet plan={viewed} onClose={() => setViewing(null)} />}
    </div>
  )
}

const GROUPS: ReadonlyArray<{
  status: PlanStatus
  title: string
  hint: string
}> = [
  { status: 'late', title: 'Late', hint: 'due, no payment yet' },
  { status: 'soon', title: 'Coming up', hint: `next ${COMING_UP_DAYS} days` },
  { status: 'later', title: 'Later', hint: '' },
  { status: 'paused', title: 'Paused', hint: 'not budgeted' },
]

/** One Plan: what it is and costs, and when it's next due. Tap for more. */
function PlanRow({
  line: { plan, status, next, more, lastPaid },
  today,
  onOpen,
}: {
  line: PlanLine
  today: string
  onOpen: () => void
}) {
  const aside = monthlySetAside(plan)
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-sunken',
          status === 'paused' && 'opacity-60',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {plan.name}{' '}
            <span className="font-normal text-muted">· {plan.category}</span>
          </span>
          <span className="block text-xs text-muted">
            {dollars(plan.amount)} {CADENCE_LABELS[plan.cadence].toLowerCase()}
            {aside > 0 && (
              <span className="text-planned"> · {dollars(aside)}/mo</span>
            )}
            {!isSetAside(plan) && ' · in target'}
            {lastPaid &&
              ` · paid ${dollars(lastPaid.amount)} ${dayLabel(lastPaid.date)}`}
          </span>
        </span>
        {next && (
          <span className="shrink-0 text-right">
            <span className="block font-semibold">{dayLabel(next)}</span>
            <span
              className={cn(
                'block text-xs',
                status === 'late'
                  ? 'font-semibold text-over'
                  : status === 'soon'
                    ? 'text-planned'
                    : 'text-muted',
              )}
            >
              {relativeDays(today, next)}
              {more > 0 && ` · +${more} more`}
            </span>
          </span>
        )}
        <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden />
      </button>
    </li>
  )
}

function Forecast({ months }: { months: ReturnType<typeof forecast> }) {
  const [open, setOpen] = useState<string | null>(null)
  const opened = months.find((m) => m.month === open)
  return (
    <section>
      <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
        Next 12 months
      </h3>
      <ForecastChart months={months} onSelect={setOpen} />
      {opened && (
        <div className="mt-1 rounded-xl border border-border bg-surface px-3 py-2 text-[13px]">
          <p className="font-semibold">
            {monthLabel(opened.month, true)}: {dollars(opened.everyday)}{' '}
            everyday + {dollars(opened.planned)} planned
            {opened.housing ? ` (+ ${dollars(opened.housing)} housing)` : ''}
          </p>
          <ul className="text-xs text-muted">
            {opened.occurrences.map((o) => (
              <li key={`${o.plan.id}-${o.due}`}>
                {dayLabel(o.due)} · {o.plan.name} ·{' '}
                {dollars(o.paidBy ? o.paidBy.amount : o.plan.amount)}
                {o.paidBy ? ' (paid)' : ''}
              </li>
            ))}
            {!opened.occurrences.length && <li>No planned bills.</li>}
          </ul>
        </div>
      )}
    </section>
  )
}
