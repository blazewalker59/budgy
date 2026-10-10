/**
 * One Plan, as a sheet over Plan: what it costs and how it counts, when
 * it's next due, each past due date with the payment that made it, and its
 * settings. Edit, pause or delete from here.
 */

import { useMemo, useState } from 'react'
import { PlanForm } from './PlanForm'
import type { Plan } from '@/lib/model/types'
import { useBook } from '@/lib/ledger/book'
import { useDeletePlan, useSavePlan } from '@/lib/ledger/useLedger'
import {
  setAside as isSetAside,
  matchWindowDays,
  monthlySetAside,
  planLines,
} from '@/lib/model/plans'
import { addDays, dayLabel, relativeDays } from '@/lib/model/dates'
import { dollars } from '@/lib/model/money'
import { CADENCE_LABELS } from '@/lib/model/types'
import { cn } from '@/lib/utils'
import { Sheet } from '@/components/shared/Sheet'
import { ConfirmPanel } from '@/components/shared/Confirm'

/** Past due dates shown before "Show all". */
const RECENT = 6

export function PlanSheet({
  plan,
  onClose,
}: {
  plan: Plan
  onClose: () => void
}) {
  const book = useBook()
  const [editing, setEditing] = useState(false)
  const mine = useMemo(
    () => book.occurrences.filter((o) => o.plan.id === plan.id),
    [book.occurrences, plan.id],
  )
  const line = useMemo(
    () => planLines([plan], mine, book.today)[0],
    [plan, mine, book.today],
  )
  // Due dates gone by, and any paid early; newest first.
  const past = mine.filter((o) => o.due <= book.today || o.paidBy).reverse()
  const aside = monthlySetAside(plan)
  return (
    <Sheet title={plan.name} onClose={onClose}>
      {(dismiss) =>
        editing ? (
          <PlanForm plan={plan} onDone={() => setEditing(false)} />
        ) : (
          <>
            <section className="space-y-1 rounded-xl border border-border bg-surface p-3">
              <p className="flex items-baseline justify-between gap-2">
                <span className="text-2xl font-extrabold tracking-tight tabular-nums">
                  {dollars(plan.amount)}
                </span>
                <span className="text-[13px] text-muted">
                  {CADENCE_LABELS[plan.cadence]}
                </span>
              </p>
              <p className="text-[13px]">
                {line.status === 'paused' ? (
                  <span className="text-muted">
                    Paused. It isn’t budgeted or matched to payments.
                  </span>
                ) : line.next ? (
                  <>
                    <span className="text-muted">Next due </span>
                    <strong>{dayLabel(line.next)}</strong>{' '}
                    <span
                      className={cn(
                        line.status === 'late'
                          ? 'font-semibold text-over'
                          : 'text-muted',
                      )}
                    >
                      {line.status === 'late'
                        ? `· late, no payment yet`
                        : `· ${relativeDays(book.today, line.next)}`}
                    </span>
                  </>
                ) : (
                  <span className="text-muted">Nothing more due.</span>
                )}
              </p>
              <p className={cn('text-xs text-muted', !plan.active && 'hidden')}>
                {isSetAside(plan) ? (
                  <>
                    Kept out of targets, budgeted on its due dates.
                    {aside > 0 && (
                      <>
                        {' '}
                        Set aside{' '}
                        <strong className="text-planned">
                          {dollars(aside)} a month
                        </strong>
                        .
                      </>
                    )}
                  </>
                ) : (
                  `Counts toward the ${plan.category} target.`
                )}
              </p>
            </section>

            <Settings plan={plan} onEdit={() => setEditing(true)} />

            {plan.active && <History past={past} today={book.today} />}

            <Manage plan={plan} onDeleted={dismiss} />
          </>
        )
      }
    </Sheet>
  )
}

function Settings({ plan, onEdit }: { plan: Plan; onEdit: () => void }) {
  const rows: Array<[string, string]> = [
    ['Category', plan.category],
    ['Paid to', plan.store ?? 'Any store, matched by amount'],
  ]
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface text-[13px]">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <h2 className="text-[11px] font-semibold tracking-wide text-muted uppercase">
          Settings
        </h2>
        <button
          type="button"
          onClick={onEdit}
          className="min-h-9 px-1 font-semibold text-accent"
        >
          Edit
        </button>
      </div>
      <dl className="divide-y divide-border">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 px-3 py-2">
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 truncate text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

type Occurrences = ReturnType<typeof useBook>['occurrences']

/** Each past due date with the payment that made it, newest first. */
function History({ past, today }: { past: Occurrences; today: string }) {
  const [all, setAll] = useState(false)
  const shown = all ? past : past.slice(0, RECENT)
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface text-[13px]">
      <h2 className="border-b border-border px-3 py-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
        History
      </h2>
      <ul className="divide-y divide-border">
        {shown.map((o) => {
          const waiting =
            !o.paidBy && o.due >= addDays(today, -matchWindowDays(o.plan))
          return (
            <li
              key={o.due}
              className="flex items-baseline justify-between gap-3 px-3 py-2"
            >
              <span className="text-muted">
                Due {dayLabel(o.due)} ’{o.due.slice(2, 4)}
              </span>
              {o.paidBy ? (
                <span className="min-w-0 text-right">
                  <span className="font-semibold tabular-nums">
                    {dollars(o.paidBy.amount)}
                  </span>{' '}
                  <span className="text-xs text-muted">
                    paid {dayLabel(o.paidBy.date)} · {o.paidBy.store}
                  </span>
                </span>
              ) : (
                <span
                  className={cn(
                    'text-xs',
                    waiting ? 'text-muted' : 'font-semibold text-over',
                  )}
                >
                  {waiting ? 'Waiting for it' : 'No payment found'}
                </span>
              )}
            </li>
          )
        })}
        {!past.length && (
          <li className="px-3 py-2 text-muted">
            Nothing due yet. Payments show here as they come in.
          </li>
        )}
      </ul>
      {past.length > RECENT && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="w-full border-t border-border py-1.5 text-xs font-semibold text-accent"
        >
          {all ? 'Show fewer' : `Show all ${past.length}`}
        </button>
      )}
    </section>
  )
}

/** Pause or resume, and, at the bottom, delete (asked first). */
function Manage({ plan, onDeleted }: { plan: Plan; onDeleted: () => void }) {
  const save = useSavePlan()
  const remove = useDeletePlan()
  const [confirming, setConfirming] = useState(false)
  if (confirming)
    return (
      <ConfirmPanel
        question={`Delete ${plan.name}?`}
        detail="Its payments stay in Spending, counted as everyday spending."
        action="Delete"
        onConfirm={() => {
          remove.mutate({ id: plan.id })
          onDeleted()
        }}
        onCancel={() => setConfirming(false)}
      />
    )
  return (
    <div className="flex flex-wrap gap-2 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => save.mutate({ ...plan, active: !plan.active })}
        className="min-h-9 rounded-full bg-sunken px-4 text-[13px] font-semibold"
      >
        {plan.active ? 'Pause' : 'Resume'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-9 rounded-full border border-over/40 px-4 text-[13px] font-semibold text-over hover:bg-over-soft"
      >
        Delete
      </button>
    </div>
  )
}
