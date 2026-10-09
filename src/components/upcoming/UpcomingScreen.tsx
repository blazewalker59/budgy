/**
 * What's ahead, on Plan: Planned Expenses on their due dates, the months
 * they make heavy, and bills from history that look like they should be
 * planned.
 */

import { useMemo, useState } from 'react'
import { Pause, Pencil, Play, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { Plan } from '@/lib/model/types'
import type { Occurrence } from '@/lib/model/plans'
import { useBook } from '@/lib/ledger/book'
import { newPlanId, useDeletePlan, useSavePlan } from '@/lib/ledger/useLedger'
import { forecast } from '@/lib/model/forecast'
import { suggestPlans } from '@/lib/model/detect'
import { upcoming } from '@/lib/model/month'
import { monthlySetAside } from '@/lib/model/plans'
import { addDays, dayLabel, monthLabel, relativeDays } from '@/lib/model/dates'
import { dollars, parseDollars } from '@/lib/model/money'
import { CADENCES, CADENCE_LABELS } from '@/lib/model/types'
import { cn } from '@/lib/utils'
import { CategorySelect } from '@/components/shared/CategorySelect'
import { ForecastChart } from '@/components/charts/lazy'

export function UpcomingScreen() {
  const book = useBook()
  const months = useMemo(
    () => forecast(book.ix, book.today.slice(0, 7), 12, book.occurrences),
    [book],
  )
  const soon = useMemo(
    () => upcoming(book.occurrences, book.today, addDays(book.today, 90)),
    [book],
  )
  const suggestions = useMemo(() => suggestPlans(book.ix, book.today), [book])
  const [editing, setEditing] = useState<Plan | null>(null)

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-extrabold tracking-tight">
          Planned bills
        </h2>
        <p className="text-xs text-muted">
          Big known bills, budgeted on their due dates instead of inflating a
          monthly Target.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <div className="space-y-3">
          <Forecast months={months} />

          <section>
            <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted">
              Next 90 days
            </h2>
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              {soon.length ? (
                <ul className="divide-y divide-border">
                  {soon.map((o) => (
                    <OccurrenceRow
                      key={`${o.plan.id}-${o.due}`}
                      o={o}
                      today={book.today}
                    />
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-2 text-sm text-muted">
                  Nothing planned in the next 90 days.
                </p>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-3">
          <section>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted">
                Planned bills
              </h2>
              <button
                type="button"
                onClick={() =>
                  setEditing({
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
                className="inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background"
              >
                <Plus size={15} aria-hidden /> Add
              </button>
            </div>
            {editing &&
              !book.ix.ledger.plans.some((p) => p.id === editing.id) && (
                <PlanForm plan={editing} onDone={() => setEditing(null)} />
              )}
            <div className="space-y-2">
              {book.ix.ledger.plans.map((p) =>
                editing?.id === p.id ? (
                  <PlanForm
                    key={p.id}
                    plan={editing}
                    onDone={() => setEditing(null)}
                  />
                ) : (
                  <PlanCard key={p.id} plan={p} onEdit={() => setEditing(p)} />
                ),
              )}
              {!book.ix.ledger.plans.length && !editing && (
                <p className="rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted">
                  No planned bills yet. Add one, or start from a suggestion
                  below.
                </p>
              )}
            </div>
          </section>

          {suggestions.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
                <Sparkles size={18} className="text-planned" aria-hidden />
                Looks like a planned bill
              </h2>
              <p className="mb-1 text-xs text-muted">
                Big charges from the same store every few months.
              </p>
              <div className="overflow-hidden rounded-xl border border-border bg-surface">
                <ul className="divide-y divide-border">
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
                          setEditing({
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
                        className="rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold"
                      >
                        Plan for it
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function Forecast({ months }: { months: ReturnType<typeof forecast> }) {
  const [open, setOpen] = useState<string | null>(null)
  const opened = months.find((m) => m.month === open)
  return (
    <section>
      <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted">
        Next 12 months
      </h2>
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

function OccurrenceRow({ o, today }: { o: Occurrence; today: string }) {
  const late = o.due < today
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-1.5">
      <div className="min-w-0">
        <p className="truncate font-semibold">{o.plan.name}</p>
        <p className="text-xs text-muted">
          {o.plan.category} · {dayLabel(o.due)}
        </p>
      </div>
      <div className="text-right">
        <p className="font-bold">{dollars(o.plan.amount)}</p>
        <p
          className={cn(
            'text-sm font-medium',
            late ? 'text-over' : 'text-planned',
          )}
        >
          {late
            ? `due ${relativeDays(today, o.due)}, not seen yet`
            : relativeDays(today, o.due)}
        </p>
      </div>
    </li>
  )
}

function PlanCard({ plan, onEdit }: { plan: Plan; onEdit: () => void }) {
  const book = useBook()
  const save = useSavePlan()
  const remove = useDeletePlan()
  const mine = book.occurrences.filter((o) => o.plan.id === plan.id)
  const next = mine.find((o) => !o.paidBy && o.due >= book.today)
  const lastPaid = [...mine].reverse().find((o) => o.paidBy)?.paidBy
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-1.5',
        !plan.active && 'opacity-60',
      )}
    >
      <div className="min-w-0">
        <p className="font-semibold">
          {plan.name}{' '}
          <span className="font-normal text-muted">· {plan.category}</span>
        </p>
        <p className="text-xs text-muted">
          {dollars(plan.amount)} {CADENCE_LABELS[plan.cadence].toLowerCase()}
          {next
            ? ` · next ${dayLabel(next.due)} (${relativeDays(book.today, next.due)})`
            : ''}
          {lastPaid
            ? ` · last paid ${dollars(lastPaid.amount)} ${dayLabel(lastPaid.date)}`
            : ''}
        </p>
        {monthlySetAside(plan) > 0 && plan.cadence !== 'monthly' && (
          <p className="text-xs text-planned">
            Set aside {dollars(monthlySetAside(plan))} a month
          </p>
        )}
      </div>
      <div className="flex gap-1">
        <IconButton label="Edit" onClick={onEdit}>
          <Pencil size={16} />
        </IconButton>
        <IconButton
          label={plan.active ? 'Pause' : 'Resume'}
          onClick={() => save.mutate({ ...plan, active: !plan.active })}
        >
          {plan.active ? <Pause size={16} /> : <Play size={16} />}
        </IconButton>
        <IconButton
          label="Delete"
          onClick={() => remove.mutate({ id: plan.id })}
        >
          <Trash2 size={16} />
        </IconButton>
      </div>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-foreground"
    >
      {children}
    </button>
  )
}

function PlanForm({ plan, onDone }: { plan: Plan; onDone: () => void }) {
  const { ix } = useBook()
  const save = useSavePlan()
  const [draft, setDraft] = useState(plan)
  const [amount, setAmount] = useState(
    plan.amount ? String(plan.amount / 100) : '',
  )
  const stores = useMemo(
    () => [...new Set(ix.ledger.txns.map((t) => t.store))].sort(),
    [ix],
  )
  const cents = parseDollars(amount)
  const valid = draft.name.trim() && cents && cents > 0
  return (
    <form
      className="mb-1 grid gap-3 rounded-xl border-2 border-planned/40 bg-surface p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        save.mutate({
          ...draft,
          name: draft.name.trim(),
          store: draft.store?.trim() || null,
          amount: cents,
        })
        onDone()
      }}
    >
      <Field label="Name">
        <input
          autoFocus
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Car insurance"
          maxLength={60}
          className="field w-full"
        />
      </Field>
      <Field label="Category">
        <CategorySelect
          label="Category"
          value={draft.category}
          onChange={(category) => setDraft({ ...draft, category })}
          className="w-full"
        />
      </Field>
      <Field label="Amount">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="1,250"
          className="field w-full"
        />
      </Field>
      <Field label="How often">
        <select
          value={draft.cadence}
          onChange={(e) =>
            setDraft({ ...draft, cadence: e.target.value as Plan['cadence'] })
          }
          className="field w-full"
        >
          {CADENCES.map((c) => (
            <option key={c} value={c}>
              {CADENCE_LABELS[c]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Next due">
        <input
          type="date"
          value={draft.anchor}
          onChange={(e) =>
            e.target.value && setDraft({ ...draft, anchor: e.target.value })
          }
          className="field w-full"
        />
      </Field>
      <Field label="Paid to (store, to spot the payment)">
        <input
          list="plan-stores"
          value={draft.store ?? ''}
          onChange={(e) =>
            setDraft({ ...draft, store: e.target.value || null })
          }
          placeholder="Any store, matched by amount"
          className="field w-full"
        />
        <datalist id="plan-stores">
          {stores.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-full px-4 py-1.5 text-sm font-medium text-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid}
          className="rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </form>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-muted">{label}</span>
      {children}
    </label>
  )
}
