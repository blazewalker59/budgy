/**
 * The Month: what we spent against the Budget, what Planned Expenses are
 * due, and where the money went, plainly enough to talk through together.
 */

import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, Copy } from 'lucide-react'
import type { CategoryMonth, MonthView, StoreMonth } from '@/lib/model/month'
import type { Occurrence } from '@/lib/model/plans'
import { useBook } from '@/lib/ledger/book'
import { monthView, upcoming } from '@/lib/model/month'
import { coverageGaps } from '@/lib/model/coverage'
import { addDays, dayLabel, monthLabel, relativeDays } from '@/lib/model/dates'
import { dollars, signedDollars } from '@/lib/model/money'
import { TAG_LABELS } from '@/lib/model/types'
import { TAG_BG } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Bar } from '@/components/shared/Bar'
import { MonthPicker, OwnerPicker } from '@/components/shared/Pickers'
import { TxnList } from '@/components/shared/TxnList'

export function MonthScreen({
  month: monthParam,
  owner,
}: {
  month?: string
  owner?: string
}) {
  const book = useBook()
  const navigate = useNavigate({ from: '/' })
  const thisMonth = book.today.slice(0, 7)
  const month = monthParam ?? thisMonth
  const months = useMemo(
    () => [...new Set([...book.months, thisMonth, month])].sort(),
    [book.months, thisMonth, month],
  )
  const view = useMemo(
    () =>
      monthView(book.ix, month, book.today, owner ?? null, book.occurrences),
    [book, month, owner],
  )
  const gaps = useMemo(
    () => coverageGaps(book.ix.ledger, month, book.today),
    [book, month],
  )
  const soon = useMemo(
    () => upcoming(book.occurrences, book.today, addDays(book.today, 60)),
    [book],
  )
  const isCurrent = month === thisMonth

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker
          month={month}
          months={months}
          onChange={(m) =>
            void navigate({
              search: (s) => ({ ...s, month: m === thisMonth ? undefined : m }),
            })
          }
        />
        <OwnerPicker
          owner={owner}
          onChange={(o) =>
            void navigate({ search: (s) => ({ ...s, owner: o }) })
          }
        />
      </div>

      {gaps.length > 0 && (
        <div className="flex gap-2 rounded-xl border border-nice/40 bg-surface p-3 text-sm">
          <AlertTriangle
            size={18}
            className="mt-0.5 shrink-0 text-nice"
            aria-hidden
          />
          <p>
            Probably missing purchases:{' '}
            {gaps.map((g, i) => (
              <span key={g.account}>
                {i > 0 && '; '}
                <strong>{g.account}</strong> has nothing after{' '}
                {g.last ? dayLabel(g.last) : 'this month'}
              </span>
            ))}
            . Import a newer export to fill it in.
          </p>
        </div>
      )}

      <Headline view={view} isCurrent={isCurrent} owner={owner} />

      {isCurrent && !owner && soon.length > 0 && (
        <ComingUp items={soon} today={book.today} />
      )}

      <Section
        title="Everyday categories"
        hint="Planned bills are counted separately, so they don’t blow a category’s Target."
      >
        <CategoryRows
          rows={view.everyday}
          pace={isCurrent ? view.elapsed : undefined}
        />
      </Section>

      <Stores stores={view.stores} total={view.totals.spent} month={month} />

      {view.housing.length > 0 && (
        <Section title="Housing" hint="Mortgage, utilities and upkeep.">
          <CategoryRows rows={view.housing} />
        </Section>
      )}

      <CopySummary view={view} owner={owner} />
    </div>
  )
}

function Headline({
  view,
  isCurrent,
  owner,
}: {
  view: MonthView
  isCurrent: boolean
  owner?: string
}) {
  const t = view.totals
  const left = t.target - t.spent
  const housing = view.housing.reduce((n, r) => n + r.spent + r.plannedPaid, 0)
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label={owner ? `${owner}’s everyday spending` : 'Everyday spending'}
        value={dollars(t.spent)}
        detail={
          t.target
            ? left >= 0
              ? `${dollars(left)} left of ${dollars(t.target)}`
              : `${dollars(-left)} over ${dollars(t.target)}`
            : 'No Targets set'
        }
        tone={t.target && left < 0 ? 'over' : undefined}
      >
        {t.target > 0 && (
          <Bar
            spent={t.spent}
            target={t.target}
            pace={isCurrent ? view.elapsed : undefined}
            className="mt-2"
          />
        )}
      </Stat>
      <Stat
        label="Wants (not needs)"
        value={dollars(t.flexibleSpent)}
        detail={
          t.flexibleTarget
            ? `Target ${dollars(t.flexibleTarget)} · ${signedDollars(t.flexibleSpent - t.flexibleTarget)}`
            : 'Nice-to-haves and fluff'
        }
        tone={
          t.flexibleTarget && t.flexibleSpent > t.flexibleTarget
            ? 'over'
            : undefined
        }
      />
      <Stat
        label="Planned bills"
        value={dollars(t.plannedPaid + t.plannedLeft)}
        detail={
          t.plannedLeft
            ? `${dollars(t.plannedLeft)} still to come`
            : t.plannedPaid
              ? 'All paid'
              : 'None due this month'
        }
        tone={t.plannedLeft ? 'planned' : undefined}
      />
      <Stat
        label="Housing"
        value={dollars(housing)}
        detail="Mortgage, utilities, upkeep"
      />
    </div>
  )
}

function Stat({
  label,
  value,
  detail,
  tone,
  children,
}: {
  label: string
  value: string
  detail: string
  tone?: 'over' | 'planned'
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">{value}</p>
      <p
        className={cn(
          'mt-0.5 text-sm text-muted',
          tone === 'over' && 'font-semibold text-over',
          tone === 'planned' && 'font-semibold text-planned',
        )}
      >
        {detail}
      </p>
      {children}
    </div>
  )
}

function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string
  hint?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          {hint && <p className="text-sm text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {children}
      </div>
    </section>
  )
}

function ComingUp({
  items,
  today,
}: {
  items: Array<Occurrence>
  today: string
}) {
  return (
    <Section
      title="Coming up"
      hint="Planned bills in the next 60 days that haven’t been paid yet."
    >
      <ul className="divide-y divide-border">
        {items.map((o) => (
          <li
            key={`${o.plan.id}-${o.due}`}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate font-semibold">{o.plan.name}</p>
              <p className="text-sm text-muted">
                {o.plan.category} · due {dayLabel(o.due)}
              </p>
            </div>
            <div className="text-right">
              <p className="font-bold">{dollars(o.plan.amount)}</p>
              <p
                className={cn(
                  'text-sm font-medium',
                  o.due < today ? 'text-over' : 'text-planned',
                )}
              >
                {o.due < today
                  ? `due ${relativeDays(today, o.due)}`
                  : relativeDays(today, o.due)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function CategoryRows({
  rows,
  pace,
}: {
  rows: Array<CategoryMonth>
  pace?: number
}) {
  const [open, setOpen] = useState<string | null>(null)
  if (!rows.length)
    return <p className="px-4 py-6 text-sm text-muted">Nothing spent.</p>
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => {
        const isOpen = open === r.name
        const over = r.target !== null && r.spent > r.target
        return (
          <li key={r.name}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : r.name)}
              className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 text-left hover:bg-sunken/50"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={cn('size-2 shrink-0 rounded-full', TAG_BG[r.tag])}
                  title={TAG_LABELS[r.tag]}
                />
                <span className="truncate font-semibold">{r.name}</span>
                {r.planned.length > 0 && (
                  <span className="shrink-0 rounded bg-planned-soft px-1.5 text-xs font-medium text-planned">
                    {r.plannedLeft
                      ? `${dollars(r.plannedLeft)} planned to come`
                      : `${dollars(r.plannedPaid)} planned, paid`}
                  </span>
                )}
                <ChevronDown
                  size={16}
                  className={cn(
                    'shrink-0 text-muted transition',
                    isOpen && 'rotate-180',
                  )}
                  aria-hidden
                />
              </span>
              <span className="text-right">
                <span className={cn('font-bold', over && 'text-over')}>
                  {dollars(r.spent)}
                </span>
                <span className="text-sm text-muted">
                  {r.target !== null ? ` of ${dollars(r.target)}` : ''}
                </span>
              </span>
              <Bar
                spent={r.spent}
                target={r.target}
                pace={pace}
                className="col-span-2"
              />
            </button>
            {isOpen && (
              <div className="border-t border-border bg-background/40">
                {r.planned.map((o) => (
                  <p
                    key={`${o.plan.id}-${o.due}`}
                    className="flex justify-between border-b border-border px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-semibold text-planned">
                        Planned:
                      </span>{' '}
                      {o.plan.name}, due {dayLabel(o.due)}
                    </span>
                    <span className="font-semibold">
                      {o.paidBy
                        ? `paid ${dollars(o.paidBy.amount)} ${dayLabel(o.paidBy.date)}`
                        : `${dollars(o.plan.amount)} to come`}
                    </span>
                  </p>
                ))}
                <TxnList txns={r.txns} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function Stores({
  stores,
  total,
  month,
}: {
  stores: Array<StoreMonth>
  total: number
  month: string
}) {
  const [open, setOpen] = useState<string | null>(null)
  if (!stores.length) return null
  const top = stores.slice(0, 3)
  const rest = stores.slice(3, 15)
  const opened = stores.find((s) => s.store === open)
  return (
    <section>
      <h2 className="text-lg font-bold tracking-tight">Where it went</h2>
      <p className="mb-2 text-sm text-muted">
        The biggest stores in {monthLabel(month)}, as hard numbers.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {top.map((s) => (
          <button
            key={s.store}
            type="button"
            aria-expanded={open === s.store}
            onClick={() => setOpen(open === s.store ? null : s.store)}
            className={cn(
              'rounded-2xl border border-border bg-surface p-4 text-left',
              open === s.store && 'ring-2 ring-accent',
            )}
          >
            <p className="truncate text-sm font-semibold text-muted">
              {s.store}
            </p>
            <p className="text-3xl font-extrabold tracking-tight">
              {dollars(s.amount)}
            </p>
            <p className="text-sm text-muted">
              {s.txns.length} purchase{s.txns.length === 1 ? '' : 's'} ·{' '}
              {total > 0 ? Math.round((s.amount / total) * 100) : 0}% of
              everyday
            </p>
          </button>
        ))}
      </div>
      {rest.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-surface">
          <ul className="divide-y divide-border">
            {rest.map((s) => (
              <li key={s.store}>
                <button
                  type="button"
                  aria-expanded={open === s.store}
                  onClick={() => setOpen(open === s.store ? null : s.store)}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-sunken/50"
                >
                  <span className="truncate font-medium">{s.store}</span>
                  <span>
                    <span className="text-muted">{s.txns.length}× </span>
                    <span className="font-semibold">{dollars(s.amount)}</span>
                  </span>
                </button>
                {open === s.store && (
                  <div className="border-t border-border bg-background/40">
                    <TxnList txns={s.txns} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {opened && top.includes(opened) && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-surface">
          <p className="border-b border-border px-4 py-2 text-sm font-semibold">
            {opened.store} in {monthLabel(month)}
          </p>
          <TxnList txns={opened.txns} />
        </div>
      )}
    </section>
  )
}

/** Plain text for a message or a note on the fridge. */
function CopySummary({ view, owner }: { view: MonthView; owner?: string }) {
  const [copied, setCopied] = useState(false)
  const text = () => {
    const t = view.totals
    const lines = [
      `${monthLabel(view.month, true)}${owner ? ` (${owner})` : ''}`,
      `Everyday: ${dollars(t.spent)}${t.target ? ` of ${dollars(t.target)} target` : ''}`,
      `Planned bills: ${dollars(t.plannedPaid)} paid${t.plannedLeft ? `, ${dollars(t.plannedLeft)} to come` : ''}`,
      '',
      'Over target:',
      ...view.everyday
        .filter((r) => r.target !== null && r.spent > r.target)
        .map(
          (r) => `- ${r.name}: ${dollars(r.spent)} vs ${dollars(r.target!)}`,
        ),
      '',
      'Biggest stores:',
      ...view.stores
        .slice(0, 5)
        .map((s) => `- ${s.store}: ${dollars(s.amount)} (${s.txns.length})`),
    ]
    return lines.join('\n')
  }
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={() =>
          void navigator.clipboard.writeText(text()).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          })
        }
        className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium"
      >
        <Copy size={15} aria-hidden /> {copied ? 'Copied' : 'Copy summary'}
      </button>
    </div>
  )
}
