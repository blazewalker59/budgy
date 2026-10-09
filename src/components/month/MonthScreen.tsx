/**
 * Overview: the month against the Budget, what Planned Expenses are due,
 * and where the money went, plainly enough to talk through together. The
 * Lens narrows it (Alex's, the cards, a store) against the household's
 * Targets; its dates are Spending's, since this is one month.
 */

import { Link, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, Copy } from 'lucide-react'
import type { CategoryMonth, MonthView, StoreMonth } from '@/lib/model/month'
import type { Occurrence } from '@/lib/model/plans'
import type { Lens, LensFilter } from '@/lib/model/lens'
import type { OverviewSearch } from '@/lib/ledger/search'
import { useBook } from '@/lib/ledger/book'
import { useLens } from '@/lib/ledger/useLens'
import { indexLedger } from '@/lib/model/ledger'
import { describe, filtersOf, isEmpty, matchLens } from '@/lib/model/lens'
import { monthView, upcoming } from '@/lib/model/month'
import { coverageGaps } from '@/lib/model/coverage'
import { addDays, dayLabel, monthLabel, relativeDays } from '@/lib/model/dates'
import { dollars, signedDollars } from '@/lib/model/money'
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
    () => coverageGaps(book.ix.ledger, month, book.today),
    [book, month],
  )
  const soon = useMemo(
    () => upcoming(book.occurrences, book.today, addDays(book.today, 60)),
    [book],
  )
  const isCurrent = month === thisMonth

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
      </div>
      <LensBar
        page="/"
        note={
          lens.from ? 'Dates apply on Spending; this is one month.' : undefined
        }
      />

      {gaps.length > 0 && (
        <p className="flex gap-1.5 rounded-lg border border-nice/40 bg-surface px-2.5 py-1.5 text-xs">
          <AlertTriangle size={14} className="shrink-0 text-nice" aria-hidden />
          <span>
            Probably missing:{' '}
            {gaps.map((g, i) => (
              <span key={g.account}>
                {i > 0 && '; '}
                <strong>{g.account}</strong> after{' '}
                {g.last ? dayLabel(g.last) : 'this month'}
              </span>
            ))}
            . Import a newer export.
          </span>
        </p>
      )}

      <Headline
        view={view}
        isCurrent={isCurrent}
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
}: {
  view: MonthView
  isCurrent: boolean
  label: string
}) {
  const t = view.totals
  const left = t.target - t.spent
  const housing = view.housing.reduce((n, r) => n + r.spent + r.plannedPaid, 0)
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
          <Bar
            spent={t.spent}
            target={t.target}
            pace={isCurrent ? view.elapsed : undefined}
            className="mt-1"
          />
        )}
        {isCurrent && t.target > 0 && (
          <p className="mt-0.5 text-[11px] text-muted">
            {(() => {
              const onPace = Math.round(t.target * view.elapsed)
              const diff = t.spent - onPace
              return `│ on pace: ${dollars(onPace)} by today, ${
                diff > 0 ? `${dollars(diff)} over` : `${dollars(-diff)} under`
              }`
            })()}
          </p>
        )}
      </Stat>
      <Stat
        label="Wants"
        value={dollars(t.flexibleSpent)}
        detail={
          t.flexibleTarget
            ? `${signedDollars(t.flexibleSpent - t.flexibleTarget)} vs ${dollars(t.flexibleTarget)}`
            : 'Nice + fluff'
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
              : 'None due'
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
