/**
 * Spending, explored through the Lens: how that part of the Household's
 * spending sits inside each Category and against the plan, which Accounts
 * and Stores it comes from, and how it moves month to month, with the
 * purchases behind it below to Move or note. Every Category, Account,
 * Store and purchase is a filter to tap, so drilling down is tapping.
 */

import { useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import type { Period, SpendingSearch } from '@/lib/ledger/search'
import type { Lens } from '@/lib/model/lens'
import type { Selection } from '@/lib/model/breakdown'
import { useBook } from '@/lib/ledger/book'
import { useLens } from '@/lib/ledger/useLens'
import { breakdown } from '@/lib/model/breakdown'
import {
  describe,
  hasFilter,
  isEmpty,
  matchLens,
  toggleFilter,
} from '@/lib/model/lens'
import { monthLabel, monthRange, shiftMonth } from '@/lib/model/dates'
import { dollars } from '@/lib/model/money'
import { cn } from '@/lib/utils'
import { LensBar } from '@/components/lens/LensBar'
import { Segmented, Stat } from '@/components/shared/Layout'
import { TxnList } from '@/components/shared/TxnList'
import {
  PlanChart,
  SelectionMonths,
  SourceChart,
} from '@/components/charts/lazy'
import { Dropdown } from '@/components/shared/Dropdown'

const PERIODS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: 'month', label: 'Month' },
  { value: '3', label: '3 mo' },
  { value: '6', label: '6 mo' },
  { value: '12', label: '12 mo' },
]

export function SpendingScreen({ search }: { search: SpendingSearch }) {
  const book = useBook()
  const { ix } = book
  const navigate = useNavigate({ from: '/spending' })
  const { show, add } = useLens()
  const set = (patch: Partial<SpendingSearch>) =>
    void navigate({ search: (s) => ({ ...s, ...patch }), replace: true })

  const periodParam = search.period
  const monthParam = search.month
  // Lens fields only, so a period or month change keeps this reference.
  const lens = useMemo((): Lens => {
    const next: Lens = {}
    if (search.people?.length) next.people = search.people
    if (search.accounts?.length) next.accounts = search.accounts
    if (search.kinds?.length) next.kinds = search.kinds
    if (search.stores?.length) next.stores = search.stores
    if (search.categories?.length) next.categories = search.categories
    if (search.tags?.length) next.tags = search.tags
    if (search.flags?.length) next.flags = search.flags
    if (search.min !== undefined) next.min = search.min
    if (search.max !== undefined) next.max = search.max
    if (search.from) next.from = search.from
    if (search.to) next.to = search.to
    if (search.q) next.q = search.q
    return next
  }, [
    search.people,
    search.accounts,
    search.kinds,
    search.stores,
    search.categories,
    search.tags,
    search.flags,
    search.min,
    search.max,
    search.from,
    search.to,
    search.q,
  ])
  const thisMonth = book.today.slice(0, 7)
  const period: Period = periodParam ?? '3'
  const month = monthParam ?? thisMonth
  // The Lens's dates, when it has them, decide the months.
  const months = useMemo(() => {
    if (lens.from && lens.to) {
      const first = lens.from.slice(0, 7)
      return monthRange(lens.to.slice(0, 7), 600).filter((m) => m >= first)
    }
    return period === 'month'
      ? [month]
      : monthRange(shiftMonth(thisMonth, -1), Number(period))
  }, [lens, period, month, thisMonth])
  // The trend shows at least six months, ending with the period.
  const trendMonths = useMemo(
    () =>
      months.length >= 6
        ? months
        : monthRange(months[months.length - 1], 6).filter(
            (m) => m >= (book.months[0] ?? m),
          ),
    [months, book.months],
  )

  const selecting = !isEmpty(lens)
  const label = selecting ? describe(lens) : 'Everyone'
  const sel: Selection = useMemo(
    () => ({
      owner: lens.people?.length === 1 ? lens.people[0] : undefined,
      match: selecting
        ? (t) => matchLens(ix, t, lens, book.plannedIds)
        : undefined,
    }),
    [ix, lens, selecting, book.plannedIds],
  )
  const b = useMemo(
    () => breakdown(ix, months, sel, book.plannedIds),
    [ix, months, sel, book.plannedIds],
  )
  // The trend leaves out the Lens's dates, so the shape around them shows.
  const trend = useMemo(() => {
    if (trendMonths === months && !lens.from) return b.months
    const undated: Lens = { ...lens, from: undefined, to: undefined }
    return breakdown(
      ix,
      trendMonths,
      {
        ...sel,
        match: selecting
          ? (t) => matchLens(ix, t, undated, book.plannedIds)
          : undefined,
      },
      book.plannedIds,
    ).months
  }, [b, ix, trendMonths, months, sel, selecting, lens, book.plannedIds])

  const txns = useMemo(() => {
    const inPeriod = new Set(months)
    return ix.ledger.txns
      .filter(
        (t) => inPeriod.has(t.month) && matchLens(ix, t, lens, book.plannedIds),
      )
      .sort((x, y) => y.date.localeCompare(x.date) || y.amount - x.amount)
  }, [ix, months, lens, book.plannedIds])
  const listTotal = txns.reduce((n, t) => n + t.amount, 0)
  // Nothing in the period, but the Lens finds purchases at other times.
  const elsewhere = useMemo(
    () =>
      txns.length || lens.from || isEmpty(lens)
        ? 0
        : ix.ledger.txns.filter((t) => matchLens(ix, t, lens, book.plannedIds))
            .length,
    [txns.length, ix, lens, book.plannedIds],
  )

  const stores = useMemo(() => {
    const by = new Map<string, { amount: number; count: number }>()
    for (const t of txns) {
      const s = by.get(t.store) ?? { amount: 0, count: 0 }
      s.amount += t.amount
      s.count++
      by.set(t.store, s)
    }
    return [...by]
      .map(([store, s]) => ({ store, ...s }))
      .sort((x, y) => y.amount - x.amount)
      .slice(0, 8)
  }, [txns])

  const perMonth = months.length > 1
  const per = perMonth ? '/mo' : ''
  const t = b.totals
  const top = b.categories.find((c) => c.selected > 0)
  const share = t.total ? Math.round((t.selected / t.total) * 100) : 0
  const planUse = t.target ? Math.round((t.selected / t.target) * 100) : 0
  const periodLabel = perMonth
    ? `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}, per month`
    : monthLabel(months[0], true)
  const onlyCategory = lens.categories?.length === 1 ? lens.categories[0] : null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold tracking-tight">Spending</h1>
        {lens.from ? (
          <span className="text-xs text-muted">
            The lens’s dates set the period
          </span>
        ) : (
          <div className="flex items-center gap-2">
            <Segmented
              label="Period"
              value={period}
              options={PERIODS}
              onChange={(p) => set({ period: p === '3' ? undefined : p })}
            />
            {period === 'month' && (
              <Dropdown
                value={month}
                onChange={(m) =>
                  set({ month: m === thisMonth ? undefined : m })
                }
                label="Month"
                className="font-semibold"
                options={[...new Set([...book.months, thisMonth])]
                  .sort()
                  .reverse()
                  .map((m) => ({ value: m, label: monthLabel(m) }))}
              />
            )}
          </div>
        )}
      </div>

      <LensBar page="/spending" />

      {elsewhere > 0 && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-nice/40 bg-surface px-3 py-2 text-xs">
          Nothing in this period. The lens finds {elsewhere} purchase
          {elsewhere === 1 ? '' : 's'} at other times.
          {period !== '12' && (
            <button
              type="button"
              onClick={() => set({ period: '12', month: undefined })}
              className="font-semibold text-accent"
            >
              Show 12 months
            </button>
          )}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label={selecting ? 'In the lens' : 'Everyone'}
          value={`${dollars(t.selected)}${per}`}
          detail={selecting ? `${share}% of everyday spending` : periodLabel}
        />
        <Stat
          label="Of the plan"
          value={`${planUse}%`}
          detail={`${dollars(t.selected)} of ${dollars(t.target)} Targets`}
          tone={!selecting && t.selected > t.target ? 'over' : undefined}
        />
        <Stat
          label="Biggest category"
          value={top ? dollars(top.selected) : '—'}
          detail={
            top
              ? `${top.name}${top.target ? ` · ${Math.round((top.selected / top.target) * 100)}% of Target` : ''}`
              : 'Nothing spent'
          }
        />
        <Stat
          label="Purchases"
          value={String(txns.length)}
          detail={`${dollars(listTotal)}${perMonth ? ` over ${months.length} months` : ''}`}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start">
        <PlanChart
          categories={b.categories}
          selecting={selecting}
          label={label}
          active={onlyCategory}
          onSelect={(c) =>
            show(toggleFilter(lens, { type: 'category', value: c }))
          }
        />
        <div className="space-y-3">
          <SourceChart
            sources={b.sources}
            perMonth={perMonth}
            onSelect={(a) =>
              show(toggleFilter(lens, { type: 'account', value: a }))
            }
          />
          {stores.length > 0 && (
            <Stores
              stores={stores}
              isOn={(s) => hasFilter(lens, { type: 'store', value: s })}
              onToggle={(s) =>
                show(toggleFilter(lens, { type: 'store', value: s }))
              }
            />
          )}
          <SelectionMonths
            months={trend}
            target={t.target}
            selecting={selecting}
            label={label}
          />
        </div>
      </div>

      <section>
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted">
          Purchases
          <span className="ml-2 font-normal normal-case tracking-normal">
            {txns.length} · {dollars(listTotal)} · tap a store or account to
            filter
          </span>
        </h2>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <TxnList txns={txns} limit={100} onPick={add} />
        </div>
      </section>
    </div>
  )
}

/** The Stores in the Lens, biggest first; each is a filter to tap. */
function Stores({
  stores,
  isOn,
  onToggle,
}: {
  stores: Array<{ store: string; amount: number; count: number }>
  isOn: (store: string) => boolean
  onToggle: (store: string) => void
}) {
  const most = Math.max(1, stores[0].amount)
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <h2 className="border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        Stores
        <span className="ml-1.5 font-normal normal-case tracking-normal">
          tap one to filter
        </span>
      </h2>
      <ul className="divide-y divide-border text-[13px]">
        {stores.map((s) => {
          const on = isOn(s.store)
          return (
            <li key={s.store}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(s.store)}
                className={cn(
                  'grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 px-3 py-1 text-left hover:bg-sunken/50',
                  on && 'bg-accent-soft',
                )}
              >
                <span className="truncate font-semibold">{s.store}</span>
                <span className="tabular-nums">
                  <span className="text-xs text-muted">{s.count}× </span>
                  <span className="font-semibold">{dollars(s.amount)}</span>
                </span>
                <span className="col-span-2 mt-0.5 h-1 overflow-hidden rounded-full bg-sunken">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{
                      width: `${Math.max(2, (Math.max(0, s.amount) / most) * 100)}%`,
                    }}
                  />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
