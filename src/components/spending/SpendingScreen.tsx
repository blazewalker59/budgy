/**
 * Spending, explored: pick a person, cards or a search and see how that
 * part of the Household's spending sits inside each Category and against
 * the plan, where it comes from, and how it moves month to month; the
 * purchases behind it are listed below, to Move or note.
 */

import { useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import { Search, X } from 'lucide-react'
import type { Period, SpendingSearch } from '@/lib/ledger/search'
import type { Selection } from '@/lib/model/breakdown'
import { useBook } from '@/lib/ledger/book'
import { breakdown, inSelection, isSelecting } from '@/lib/model/breakdown'
import { categoryOf, ownerOf } from '@/lib/model/ledger'
import { monthLabel, monthRange, shiftMonth } from '@/lib/model/dates'
import { dollars } from '@/lib/model/money'
import { ownerColor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { OwnerPicker } from '@/components/shared/Pickers'
import { Segmented, Stat } from '@/components/shared/Layout'
import { TxnList } from '@/components/shared/TxnList'
import {
  PlanChart,
  SelectionMonths,
  SourceChart,
} from '@/components/charts/lazy'

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
  const set = (patch: Partial<SpendingSearch>) =>
    void navigate({ search: (s) => ({ ...s, ...patch }), replace: true })

  const thisMonth = book.today.slice(0, 7)
  const period: Period = search.period ?? '3'
  const month = search.month ?? thisMonth
  const accounts = useMemo(
    () => (search.acct ? search.acct.split(',').filter(Boolean) : []),
    [search.acct],
  )
  const months = useMemo(
    () =>
      period === 'month'
        ? [month]
        : monthRange(shiftMonth(thisMonth, -1), Number(period)),
    [period, month, thisMonth],
  )
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
  const sel: Selection = { owner: search.owner, accounts, q: search.q }
  const selecting = isSelecting(sel)
  const label =
    accounts.length === 1
      ? accounts[0]
      : accounts.length > 1
        ? `${accounts.length} sources`
        : search.owner
          ? search.owner
          : search.q
            ? `“${search.q}”`
            : 'Everyone'

  const b = useMemo(
    () => breakdown(ix, months, sel, book.plannedIds),
    // sel is rebuilt each render from these:
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ix, months, search.owner, accounts, search.q, book.plannedIds],
  )
  const trend = useMemo(
    () =>
      trendMonths === months
        ? b.months
        : breakdown(ix, trendMonths, sel, book.plannedIds).months,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [b, ix, trendMonths, months, book.plannedIds],
  )

  const txns = useMemo(() => {
    const inPeriod = new Set(months)
    return ix.ledger.txns
      .filter(
        (t) =>
          inPeriod.has(t.month) &&
          inSelection(ix, t, sel) &&
          (!search.cat || categoryOf(ix, t) === search.cat),
      )
      .sort((x, y) => y.date.localeCompare(x.date) || y.amount - x.amount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ix, months, search.owner, accounts, search.q, search.cat])
  const listTotal = txns.reduce((n, t) => n + t.amount, 0)

  // Sources to pick from: the person's, or everyone's.
  const sourceChoices = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of ix.ledger.txns)
      if (
        months.includes(t.month) &&
        (!search.owner || ownerOf(ix, t) === search.owner)
      )
        counts.set(t.account, (counts.get(t.account) ?? 0) + 1)
    return ix.ledger.accounts
      .filter((a) => counts.has(a.name) || accounts.includes(a.name))
      .sort((x, y) => (counts.get(y.name) ?? 0) - (counts.get(x.name) ?? 0))
  }, [ix, months, search.owner, accounts])

  const toggleAccount = (name: string) => {
    const next = accounts.includes(name)
      ? accounts.filter((a) => a !== name)
      : [...accounts, name]
    set({ acct: next.length ? next.join(',') : undefined })
  }

  const perMonth = months.length > 1
  const per = perMonth ? '/mo' : ''
  const t = b.totals
  const top = b.categories.find((c) => c.selected > 0)
  const share = t.total ? Math.round((t.selected / t.total) * 100) : 0
  const planUse = t.target ? Math.round((t.selected / t.target) * 100) : 0
  const periodLabel = perMonth
    ? `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}, per month`
    : monthLabel(months[0], true)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold tracking-tight">Spending</h1>
        <div className="flex items-center gap-2">
          <Segmented
            label="Period"
            value={period}
            options={PERIODS}
            onChange={(p) => set({ period: p === '3' ? undefined : p })}
          />
          {period === 'month' && (
            <select
              value={month}
              onChange={(e) =>
                set({
                  month:
                    e.target.value === thisMonth ? undefined : e.target.value,
                })
              }
              aria-label="Month"
              className="field font-semibold"
            >
              {[...new Set([...book.months, thisMonth])]
                .sort()
                .reverse()
                .map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
            </select>
          )}
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-surface p-2">
        <div className="flex flex-wrap items-center gap-2">
          <OwnerPicker
            owner={search.owner}
            onChange={(o) => set({ owner: o, acct: undefined })}
          />
          <label className="relative min-w-40 flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              type="search"
              defaultValue={search.q ?? ''}
              key={search.q ?? ''}
              placeholder="Store, description or note"
              aria-label="Search purchases"
              className="field w-full pl-7"
              onKeyDown={(e) => {
                if (e.key === 'Enter')
                  set({ q: e.currentTarget.value.trim() || undefined })
              }}
              onBlur={(e) => {
                const q = e.target.value.trim() || undefined
                if (q !== search.q) set({ q })
              }}
            />
          </label>
          {(selecting || search.cat) && (
            <button
              type="button"
              onClick={() =>
                set({
                  owner: undefined,
                  acct: undefined,
                  q: undefined,
                  cat: undefined,
                })
              }
              className="rounded-full px-2 py-0.5 text-xs font-semibold text-accent"
            >
              Clear all
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Sources">
          {sourceChoices.map((a) => {
            const on = accounts.includes(a.name)
            return (
              <button
                key={a.name}
                type="button"
                aria-pressed={on}
                onClick={() => toggleAccount(a.name)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
                  on
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-muted hover:text-foreground',
                )}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ background: ownerColor(a.owner) }}
                />
                {a.name}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label={selecting ? label : 'Everyone'}
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
          value={String(b.totals.count)}
          detail={
            perMonth ? `everyday, over ${months.length} months` : 'everyday'
          }
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start">
        <PlanChart
          categories={b.categories}
          selecting={selecting}
          label={label}
          active={search.cat ?? null}
          onSelect={(c) => set({ cat: c === search.cat ? undefined : c })}
        />
        <div className="space-y-3">
          <SourceChart
            sources={b.sources}
            perMonth={perMonth}
            onSelect={toggleAccount}
          />
          <SelectionMonths
            months={trend}
            target={t.target}
            selecting={selecting}
            label={label}
          />
        </div>
      </div>

      <section>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted">
            Purchases
            <span className="ml-2 font-normal normal-case tracking-normal">
              {txns.length} · {dollars(listTotal)}
              {perMonth ? ` over ${months.length} months` : ''}
            </span>
          </h2>
          {search.cat && (
            <button
              type="button"
              onClick={() => set({ cat: undefined })}
              className="flex items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-xs font-semibold text-background"
            >
              {search.cat} <X size={12} aria-hidden />
            </button>
          )}
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <TxnList txns={txns} limit={100} />
        </div>
      </section>
    </div>
  )
}
