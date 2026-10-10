/**
 * Overview: the month against the Budget, what Planned Expenses are due,
 * and where the money went, plainly enough to talk through together. The
 * Lens narrows it (Alex's, the cards, a store) against the household's
 * Targets; its dates are Spending's, since this is one month.
 */

import { Link, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Copy, X } from 'lucide-react'
import type { CategoryMonth, MonthView, StoreMonth } from '@/lib/model/month'
import type { Occurrence } from '@/lib/model/plans'
import type { Lens, LensFilter } from '@/lib/model/lens'
import type { OverviewSearch } from '@/lib/ledger/search'
import type { Gap } from '@/lib/model/coverage'
import type { MonthBills, MonthPay } from '@/lib/model/bills'
import { useBook } from '@/lib/ledger/book'
import { useLens } from '@/lib/ledger/useLens'
import { indexLedger } from '@/lib/model/ledger'
import { describe, filtersOf, isEmpty, matchLens } from '@/lib/model/lens'
import { monthView, upcoming } from '@/lib/model/month'
import { coverageGaps } from '@/lib/model/coverage'
import { monthBills, monthPay } from '@/lib/model/bills'
import { addDays, dayLabel, monthLabel, relativeDays } from '@/lib/model/dates'
import { dollars } from '@/lib/model/money'
import { TAG_LABELS } from '@/lib/model/types'
import { TAG_BG } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Bar } from '@/components/shared/Bar'
import { MonthPicker } from '@/components/shared/Pickers'
import { LensBar } from '@/components/lens/LensBar'
import { Section, Stat } from '@/components/shared/Layout'
import { TxnList } from '@/components/shared/TxnList'

export function MonthScreen({
  month: monthParam,
  lens,
}: {
  month?: string
  lens: Lens
}) {
  const book = useBook()
  const { add } = useLens()
  const scope = useMemo(() => {
    const l: Lens = { ...lens, from: undefined, to: undefined }
    if (isEmpty(l)) return { ix: book.ix, occurrences: book.occurrences }
    const txns = book.ix.ledger.txns.filter((t) =>
      matchLens(book.ix, t, l, book.plannedIds),
    )
    const ids = new Set(txns.map((t) => t.id))
    return {
      ix: indexLedger({ ...book.ix.ledger, txns }),
      // Under a Lens, only the planned bills it caught.
      occurrences: book.occurrences.filter(
        (o) => o.paidBy && ids.has(o.paidBy.id),
      ),
    }
  }, [book, lens])
  const filtered = scope.ix !== book.ix
  const person =
    lens.people?.length === 1 && filtersOf(lens).length === 1
      ? lens.people[0]
      : undefined
  const navigate = useNavigate({ from: '/' })
  const thisMonth = book.today.slice(0, 7)
  const month = monthParam ?? thisMonth
  const months = useMemo(
    () => [...new Set([...book.months, thisMonth, month])].sort(),
    [book.months, thisMonth, month],
  )
  const view = useMemo(
    () => monthView(scope.ix, month, book.today, null, scope.occurrences),
    [scope, month, book.today],
  )
  const gaps = useMemo(
    () => coverageGaps(book.ix, month, book.today),
    [book, month],
  )
  const soon = useMemo(
    () => upcoming(book.occurrences, book.today, addDays(book.today, 60)),
    [book],
  )
  const isCurrent = month === thisMonth
  const bills = useMemo(
    () => monthBills(scope.ix, view, book.today, book.plannedIds, !filtered),
    [scope, view, book.today, book.plannedIds, filtered],
  )
  // Take-home is the household's, so it shows only without a Lens.
  const pay = useMemo(
    () =>
      filtered || !book.ix.ledger.pay.length
        ? null
        : monthPay(book.ix.ledger.pay, month, book.today),
    [filtered, book, month],
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonthPicker
          month={month}
          months={months}
          onChange={(m) =>
            void navigate({
              search: (s: OverviewSearch) => ({
                ...s,
                month: m === thisMonth ? undefined : m,
              }),
            })
          }
        />
        <GapChip gaps={gaps} month={month} />
      </div>
      <LensBar
        page="/"
        note={
          lens.from ? 'Dates apply on Spending; this is one month.' : undefined
        }
      />

      <Headline
        view={view}
        isCurrent={isCurrent}
        bills={bills}
        pay={pay}
        label={
          person
            ? `${person}’s everyday`
            : filtered
              ? 'Everyday, in the lens'
              : 'Everyday'
        }
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-3">
          <Section title="Everyday" hint="planned bills counted separately">
            <CategoryRows
              rows={filtered ? spentIn(view.everyday) : view.everyday}
              lens={lens}
              month={month}
              onPick={add}
            />
          </Section>
          {(filtered ? spentIn(view.housing) : view.housing).length > 0 && (
            <Section title="Housing">
              <CategoryRows
                rows={filtered ? spentIn(view.housing) : view.housing}
                lens={lens}
                month={month}
                onPick={add}
              />
            </Section>
          )}
        </div>
        <div className="space-y-3">
          {isCurrent && !filtered && soon.length > 0 && (
            <ComingUp items={soon} today={book.today} />
          )}
          <Stores
            stores={view.stores}
            total={view.totals.spent}
            month={month}
            onPick={add}
          />
          <CopySummary
            view={view}
            owner={filtered ? describe(lens) : undefined}
          />
        </div>
      </div>
    </div>
  )
}

/** Under a Lens, only the Categories it touched. */
function spentIn(rows: Array<CategoryMonth>): Array<CategoryMonth> {
  return rows.filter((r) => r.spent !== 0 || r.plannedPaid !== 0)
}

function Headline({
  view,
  isCurrent,
  label,
  bills,
  pay,
}: {
  view: MonthView
  isCurrent: boolean
  label: string
  bills: MonthBills
  pay: MonthPay | null
}) {
  const t = view.totals
  const left = t.target - t.spent
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2 sm:items-start">
        <Stat
          label={label}
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
            <Bar spent={t.spent} target={t.target} className="mt-1" />
          )}
          {isCurrent && t.target > 0 && (
            <p className="mt-0.5 text-[11px] text-muted">
              {(() => {
                const onPace = Math.round(t.target * view.elapsed)
                const diff = t.spent - onPace
                return `On pace: ${dollars(onPace)} by today, ${
                  diff > 0 ? `${dollars(diff)} over` : `${dollars(-diff)} under`
                }`
              })()}
            </p>
          )}
        </Stat>
        <Bills bills={bills} />
      </div>
      {pay && pay.amount > 0 && (
        <TakeHomeLine
          pay={pay}
          spent={t.spent + bills.paid}
          coming={bills.expected - bills.paid}
          isCurrent={isCurrent}
        />
      )}
    </div>
  )
}

/**
 * Housing and Planned Expenses for the month: what's paid, and what's
 * still coming (a bill due, or Housing that usually posts by about then).
 */
function Bills({ bills }: { bills: MonthBills }) {
  const [all, setAll] = useState(false)
  const coming = bills.expected - bills.paid
  const shown = all ? bills.lines : bills.lines.slice(0, 6)
  return (
    <div className="min-w-0 space-y-1 rounded-xl border border-border bg-surface px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted">
          Bills this month
        </p>
        <p className="shrink-0 text-xs text-muted tabular-nums">
          {coming > 0
            ? `${dollars(bills.paid)} of ~${dollars(bills.expected)}`
            : bills.paid
              ? `${dollars(bills.paid)}, all in`
              : 'None yet'}
        </p>
      </div>
      {bills.expected > 0 && (
        <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
          <div
            className="h-full rounded-full bg-planned"
            style={{ width: `${(bills.paid / bills.expected) * 100}%` }}
          />
        </div>
      )}
      <ul className="space-y-0.5 text-[13px] tabular-nums">
        {shown.map((b) => (
          <li
            key={`${b.status}|${b.name}|${b.date}`}
            className={cn(
              'flex items-center justify-between gap-2',
              b.status === 'due' && 'font-semibold text-planned',
              b.status === 'usual' && 'text-muted',
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {b.status === 'paid' ? (
                <Check
                  size={13}
                  className="shrink-0 text-accent"
                  aria-label="Paid"
                />
              ) : (
                <span className="size-[13px] shrink-0 rounded-full border border-current opacity-60" />
              )}
              <span className="truncate">
                {b.name}
                {b.status === 'due' && b.date && ` · ${dayLabel(b.date)}`}
                {b.status === 'usual' &&
                  b.date &&
                  `, usually ~${dayLabel(b.date)}`}
              </span>
            </span>
            <span className="shrink-0">
              {b.more && (
                <span className="text-xs text-muted">
                  ~{dollars(b.more.amount)} more by {dayLabel(b.more.date)}{' '}
                  ·{' '}
                </span>
              )}
              {b.status === 'usual' ? '~' : ''}
              {dollars(b.amount)}
            </span>
          </li>
        ))}
      </ul>
      {bills.lines.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="text-xs font-semibold text-accent"
        >
          {bills.lines.length - shown.length} more
        </button>
      )}
    </div>
  )
}

/** Take-home this month, less what's gone and what's still coming. */
function TakeHomeLine({
  pay,
  spent,
  coming,
  isCurrent,
}: {
  pay: MonthPay
  spent: number
  coming: number
  isCurrent: boolean
}) {
  const left = pay.amount - spent - (isCurrent ? coming : 0)
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs text-muted tabular-nums">
      <span className="font-semibold uppercase tracking-wide text-[11px]">
        Take-home
      </span>
      <span>
        {dollars(pay.amount)} ({pay.paychecks} paycheck
        {pay.paychecks === 1 ? '' : 's'})
      </span>
      <span>·</span>
      <span
        className={cn('font-semibold', left < 0 ? 'text-over' : 'text-accent')}
      >
        {left < 0 ? `${dollars(-left)} short` : `${dollars(left)} left`}
      </span>
      {isCurrent && coming > 0 && <span>after bills still due</span>}
      {isCurrent && pay.next && (
        <>
          <span>·</span>
          <span>next payday {dayLabel(pay.next)}</span>
        </>
      )}
    </p>
  )
}

/**
 * Accounts that look behind (no purchases lately where there usually are),
 * as a small chip by the month. Dismissed, it stays away until the list
 * changes.
 */
function GapChip({ gaps, month }: { gaps: Array<Gap>; month: string }) {
  const key = `${month}|${gaps.map((g) => `${g.account}@${g.last}`).join(',')}`
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(GAPS_DISMISSED) === key
    } catch {
      return false
    }
  })
  const [open, setOpen] = useState(false)
  if (!gaps.length || dismissed) return null
  return (
    <div className="relative">
      <span className="inline-flex items-center rounded-full border border-nice/40 bg-surface text-xs font-semibold text-nice">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 py-0.5 pl-2 pr-1"
        >
          <AlertTriangle size={12} aria-hidden />
          {gaps.length === 1
            ? '1 account behind'
            : `${gaps.length} accounts behind`}
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(GAPS_DISMISSED, key)
            } catch {
              // Private browsing: it hides for this visit.
            }
            setDismissed(true)
          }}
          aria-label="Dismiss"
          className="rounded-full p-1 opacity-70 hover:opacity-100"
        >
          <X size={12} aria-hidden />
        </button>
      </span>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] sm:left-auto sm:right-0 space-y-1 rounded-xl border border-border bg-surface p-2.5 text-xs shadow-lg">
          <p className="text-muted">
            No purchases lately where there usually are, so this month may look
            cheaper than it was:
          </p>
          <ul className="space-y-0.5">
            {gaps.map((g) => (
              <li key={g.account}>
                <strong>{g.account}</strong>{' '}
                <span className="text-muted">
                  last {g.last ? dayLabel(g.last) : 'never'}
                </span>
              </li>
            ))}
          </ul>
          <Link
            to="/accounts"
            className="inline-block font-semibold text-accent"
          >
            Upload on Accounts
          </Link>
        </div>
      )}
    </div>
  )
}

const GAPS_DISMISSED = 'budgy:gaps-dismissed'

function ComingUp({
  items,
  today,
}: {
  items: Array<Occurrence>
  today: string
}) {
  return (
    <Section title="Coming up" hint="next 60 days, unpaid">
      <ul className="divide-y divide-border text-[13px]">
        {items.map((o) => (
          <li
            key={`${o.plan.id}-${o.due}`}
            className="flex items-center justify-between gap-2 px-3 py-1.5"
          >
            <span className="min-w-0 truncate">
              <span className="font-semibold">{o.plan.name}</span>
              <span className="text-muted"> · {dayLabel(o.due)}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              <span
                className={cn(
                  'mr-2 text-xs font-semibold',
                  o.due < today ? 'text-over' : 'text-planned',
                )}
              >
                {o.due < today
                  ? `due ${relativeDays(today, o.due)}`
                  : relativeDays(today, o.due)}
              </span>
              <span className="font-bold">{dollars(o.plan.amount)}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function CategoryRows({
  rows,
  lens,
  month,
  onPick,
}: {
  rows: Array<CategoryMonth>
  lens: Lens
  month: string
  onPick: (f: LensFilter) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  if (!rows.length)
    return (
      <p className="px-3 py-3 text-sm text-muted">
        {isEmpty(lens)
          ? 'Nothing spent.'
          : 'Nothing this month in the lens. Spending shows it over more months.'}
      </p>
    )
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
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-1.5 text-left text-[13px] hover:bg-sunken/50 sm:grid-cols-[10.5rem_minmax(0,1fr)_8rem]"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className={cn('size-2 shrink-0 rounded-full', TAG_BG[r.tag])}
                  title={TAG_LABELS[r.tag]}
                />
                <span className="truncate font-semibold">{r.name}</span>
                {r.planned.length > 0 && (
                  <span
                    className="shrink-0 rounded bg-planned-soft px-1 text-[10px] font-semibold text-planned"
                    title={
                      r.plannedLeft
                        ? `${dollars(r.plannedLeft)} planned, still to come`
                        : `${dollars(r.plannedPaid)} planned, paid`
                    }
                  >
                    {r.plannedLeft
                      ? `+${dollars(r.plannedLeft)} due`
                      : `${dollars(r.plannedPaid)} ✓`}
                  </span>
                )}
                <ChevronDown
                  size={13}
                  className={cn(
                    'shrink-0 text-muted transition',
                    isOpen && 'rotate-180',
                  )}
                  aria-hidden
                />
              </span>
              <Bar
                spent={r.spent}
                target={r.target}
                className="order-last col-span-2 sm:order-none sm:col-span-1"
              />
              <span className="text-right tabular-nums">
                <span className={cn('font-bold', over && 'text-over')}>
                  {dollars(r.spent)}
                </span>
                <span className="text-muted">
                  {r.target !== null ? ` / ${dollars(r.target)}` : ''}
                </span>
              </span>
            </button>
            {isOpen && (
              <div className="border-t border-border bg-background/50">
                {r.planned.map((o) => (
                  <p
                    key={`${o.plan.id}-${o.due}`}
                    className="flex justify-between gap-2 border-b border-border px-3 py-1 text-xs"
                  >
                    <span className="truncate">
                      <span className="font-semibold text-planned">
                        Planned
                      </span>{' '}
                      {o.plan.name}, due {dayLabel(o.due)}
                    </span>
                    <span className="shrink-0 font-semibold">
                      {o.paidBy
                        ? `paid ${dollars(o.paidBy.amount)} ${dayLabel(o.paidBy.date)}`
                        : `${dollars(o.plan.amount)} to come`}
                    </span>
                  </p>
                ))}
                <TxnList txns={r.txns} onPick={onPick} />
                <Link
                  to="/spending"
                  search={{
                    ...lens,
                    from: undefined,
                    to: undefined,
                    categories: [r.name],
                    period: 'month',
                    month,
                  }}
                  className="block border-t border-border px-3 py-1.5 text-xs font-semibold text-accent"
                >
                  {r.name} in Spending →
                </Link>
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
  onPick,
}: {
  stores: Array<StoreMonth>
  total: number
  month: string
  onPick: (f: LensFilter) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  if (!stores.length) return null
  const top = stores.slice(0, 3)
  const rest = stores.slice(3, 15)
  const opened = top.find((s) => s.store === open)
  const share = (s: StoreMonth) =>
    total > 0 ? Math.round((s.amount / total) * 100) : 0
  return (
    <Section title="Where it went" hint={monthLabel(month)} bare>
      <div className="grid grid-cols-3 gap-2">
        {top.map((s) => (
          <button
            key={s.store}
            type="button"
            aria-expanded={open === s.store}
            onClick={() => setOpen(open === s.store ? null : s.store)}
            className={cn(
              'min-w-0 rounded-xl border border-border bg-surface px-2.5 py-2 text-left',
              open === s.store && 'ring-2 ring-accent',
            )}
          >
            <p className="truncate text-xs font-semibold text-muted">
              {s.store}
            </p>
            <p className="text-lg font-extrabold leading-tight tracking-tight">
              {dollars(s.amount)}
            </p>
            <p className="truncate text-[11px] text-muted">
              {s.txns.length}× · {share(s)}%
            </p>
          </button>
        ))}
      </div>
      {opened && (
        <div className="mt-2 overflow-hidden rounded-xl border border-border bg-surface">
          <TxnList txns={opened.txns} onPick={onPick} />
        </div>
      )}
      {rest.length > 0 && (
        <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-[13px]">
          {rest.map((s) => (
            <li key={s.store}>
              <button
                type="button"
                aria-expanded={open === s.store}
                onClick={() => setOpen(open === s.store ? null : s.store)}
                className="flex w-full items-center justify-between gap-2 px-3 py-1 text-left hover:bg-sunken/50"
              >
                <span className="truncate">{s.store}</span>
                <span className="shrink-0 tabular-nums">
                  <span className="text-xs text-muted">{s.txns.length}× </span>
                  <span className="font-semibold">{dollars(s.amount)}</span>
                </span>
              </button>
              {open === s.store && (
                <div className="border-t border-border bg-background/50">
                  <TxnList txns={s.txns} onPick={onPick} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
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
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium"
      >
        <Copy size={13} aria-hidden /> {copied ? 'Copied' : 'Copy summary'}
      </button>
    </div>
  )
}
