/**
 * One Category, as a sheet over the Budget: its months as a chart and as
 * numbers, its Tag, Group and Target history, and the Stores behind it,
 * each of which can be filed somewhere else for good.
 */

import { useMemo, useState } from 'react'
import { TagSelect } from './TagSelect'
import type { Category, Group } from '@/lib/model/types'
import type { TrendMonth } from '@/components/charts/CategoryTrend'
import { useBook } from '@/lib/ledger/book'
import {
  categoryTag,
  ruleFor,
  ruleKey,
  storeCategory,
  targetFor,
} from '@/lib/model/ledger'
import { useSaveCategory, useSetStoreRule } from '@/lib/ledger/useLedger'
import { CategorySelect } from '@/components/shared/CategorySelect'
import { categoryHistory } from '@/lib/model/month'
import { percentOf } from '@/lib/model/pay'
import { monthLabel, monthRange, shiftMonth } from '@/lib/model/dates'
import { dollars, signedDollars } from '@/lib/model/money'
import { cn } from '@/lib/utils'
import { Sheet } from '@/components/shared/Sheet'
import { CategoryTrend } from '@/components/charts/lazy'
import { Dropdown } from '@/components/shared/Dropdown'

/** At most this many months back, so the bars stay readable on a phone. */
const MAX_MONTHS = 24

export function CategorySheet({
  name,
  span,
  from,
  income,
  onClose,
}: {
  name: string
  /** Months the typical month averages, newest last. */
  span: number
  /** The month Targets are being set from on the Budget. */
  from: string
  /** Typical take-home pay per month. */
  income: number
  onClose: () => void
}) {
  const book = useBook()
  const { ix } = book
  const thisMonth = book.today.slice(0, 7)
  const months = useMemo(() => {
    const last = shiftMonth(thisMonth, -1)
    const first = book.months[0] ?? last
    return monthRange(last, MAX_MONTHS).filter((m) => m >= first)
  }, [thisMonth, book.months])

  const h = useMemo(
    () => categoryHistory(ix, months, book.plannedIds).get(name),
    [ix, months, book.plannedIds, name],
  )
  const typical = useMemo(
    () =>
      categoryHistory(ix, months.slice(-span), book.plannedIds).get(name)
        ?.typical ?? 0,
    [ix, months, span, book.plannedIds, name],
  )
  const target = targetFor(ix, name, from)
  const trend: Array<TrendMonth> = months.map((month, i) => ({
    month,
    everyday: h?.monthly[i] ?? 0,
    planned: (h?.allMonthly[i] ?? 0) - (h?.monthly[i] ?? 0),
  }))

  return (
    <Sheet title={name} onClose={onClose}>
      <CategoryTrend months={trend} target={target} typical={typical} />

      {income > 0 && (
        <p className="px-1 text-xs text-muted">
          Typical is{' '}
          <strong className="text-foreground">
            {percentOf(typical, income)}%
          </strong>{' '}
          of take-home pay
          {target !== null && (
            <>
              ; the Target,{' '}
              <strong className="text-foreground">
                {percentOf(target, income)}%
              </strong>
            </>
          )}
          .
        </p>
      )}
      <Settings name={name} />
      <Stores name={name} months={months} />
      <MonthTable name={name} trend={trend} />
    </Sheet>
  )
}

/** Tag, Group and the Target's history. */
function Settings({ name }: { name: string }) {
  const { ix } = useBook()
  const saveCategory = useSaveCategory()
  const category: Category = ix.categories.get(name) ?? {
    name,
    tag: categoryTag(ix, name),
    group: 'everyday',
  }
  const history = ix.targets.get(name) ?? []
  return (
    <section className="space-y-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Tag
          <TagSelect
            value={category.tag}
            label={`Tag for ${name}`}
            onChange={(tag) => tag && saveCategory.mutate({ ...category, tag })}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Group
          <Dropdown<Group>
            value={category.group}
            label={`Group for ${name}`}
            onChange={(group) => saveCategory.mutate({ ...category, group })}
            options={[
              { value: 'everyday', label: 'Everyday' },
              { value: 'housing', label: 'Housing' },
            ]}
          />
        </label>
      </div>
      <p className="text-xs text-muted">
        {history.length
          ? 'Targets: ' +
            [...history]
              .reverse()
              .map(
                (t) => `${dollars(t.amount)} from ${monthLabel(t.startsMonth)}`,
              )
              .join(' → ')
          : 'No Target yet: set one on the Budget.'}
      </p>
    </section>
  )
}

/**
 * The Stores filed here over the months shown, biggest first. Each can be
 * filed under another Category (a Store Rule: past and future purchases)
 * or given its own Tag.
 */
function Stores({ name, months }: { name: string; months: Array<string> }) {
  const { ix } = useBook()
  const setRule = useSetStoreRule()
  const [all, setAll] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const stores = useMemo(() => {
    const inRange = new Set(months)
    const map = new Map<
      string,
      {
        key: string
        store: string
        sourceCategory: string
        amount: number
        count: number
      }
    >()
    for (const t of ix.ledger.txns) {
      if (!inRange.has(t.month) || t.category) continue
      if (storeCategory(ix, t) !== name) continue
      const key = ruleKey(t.sourceCategory, t.store)
      const s = map.get(key) ?? {
        key,
        store: t.store,
        sourceCategory: t.sourceCategory,
        amount: 0,
        count: 0,
      }
      s.amount += t.amount
      s.count++
      map.set(key, s)
    }
    // Purchases Moved here one at a time count too, just not as Stores.
    const moved = ix.ledger.txns.filter(
      (t) => inRange.has(t.month) && t.category === name,
    ).length
    return {
      list: [...map.values()].sort((a, b) => b.amount - a.amount),
      moved,
    }
  }, [ix, months, name])
  const shown = all ? stores.list : stores.list.slice(0, 8)
  if (!stores.list.length) return null
  return (
    <section>
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        Stores · {monthLabel(months[0])} –{' '}
        {monthLabel(months[months.length - 1])}
        <span className="ml-1 font-normal normal-case tracking-normal">
          tap one to file it elsewhere
        </span>
      </h3>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-[13px]">
        {shown.map((s) => {
          const rule = ruleFor(ix, s)
          const open = editing === s.key
          return (
            <li key={s.key}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setEditing(open ? null : s.key)}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left"
              >
                <span className="min-w-0 truncate">
                  {s.store} <span className="text-muted">· {s.count}×</span>
                  {s.sourceCategory !== name && (
                    <span className="ml-1 rounded bg-planned-soft px-1 text-[10px] text-planned">
                      from {s.sourceCategory}
                    </span>
                  )}
                  {rule?.tag && (
                    <span className="ml-1 rounded bg-sunken px-1 text-[10px] text-muted">
                      {rule.tag}
                    </span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className="text-xs text-muted">
                    {dollars(s.amount / months.length)}/mo ·{' '}
                  </span>
                  <span className="font-semibold">{dollars(s.amount)}</span>
                </span>
              </button>
              {open && (
                <div className="flex items-center gap-2 bg-background/60 px-3 pb-2 pt-1">
                  <CategorySelect
                    label={`File ${s.store} under`}
                    value={name}
                    defaultValue={s.sourceCategory}
                    onChange={(c) => {
                      setRule.mutate({
                        sourceCategory: s.sourceCategory,
                        store: s.store,
                        category: c,
                      })
                      setEditing(null)
                    }}
                    className="min-w-0 flex-1"
                  />
                  <TagSelect
                    value={rule?.tag ?? ''}
                    allowInherit
                    label={`Tag for ${s.store}`}
                    onChange={(tag) =>
                      setRule.mutate({
                        sourceCategory: s.sourceCategory,
                        store: s.store,
                        tag,
                      })
                    }
                  />
                </div>
              )}
            </li>
          )
        })}
        {stores.list.length > shown.length && (
          <li>
            <button
              type="button"
              onClick={() => setAll(true)}
              className="w-full px-3 py-1.5 text-left text-xs font-semibold text-accent"
            >
              Show {stores.list.length - shown.length} more stores
            </button>
          </li>
        )}
      </ul>
      {stores.moved > 0 && (
        <p className="mt-1 text-[11px] text-muted">
          Plus {stores.moved} purchase{stores.moved === 1 ? '' : 's'} moved here
          one at a time.
        </p>
      )}
    </section>
  )
}

/** The months as numbers, newest first: the last six, or all of them. */
function MonthTable({
  name,
  trend,
}: {
  name: string
  trend: Array<TrendMonth>
}) {
  const { ix } = useBook()
  const [all, setAll] = useState(false)
  const newest = [...trend].reverse()
  const shown = all ? newest : newest.slice(0, 6)
  return (
    <div>
      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-[13px] tabular-nums">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="py-1.5 pl-3 font-semibold">Month</th>
              <th className="px-2 py-1.5 text-right font-semibold">Everyday</th>
              <th className="px-2 py-1.5 text-right font-semibold">Planned</th>
              <th className="py-1.5 pl-2 pr-3 text-right font-semibold">
                vs Target
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => {
              const t = targetFor(ix, name, m.month)
              return (
                <tr
                  key={m.month}
                  className="border-b border-border last:border-0"
                >
                  <td className="py-1 pl-3">{monthLabel(m.month)}</td>
                  <td className="px-2 py-1 text-right font-semibold">
                    {dollars(m.everyday)}
                  </td>
                  <td className="px-2 py-1 text-right text-planned">
                    {m.planned ? dollars(m.planned) : ''}
                  </td>
                  <td
                    className={cn(
                      'py-1 pl-2 pr-3 text-right',
                      t !== null && m.everyday > t ? 'text-over' : 'text-muted',
                    )}
                  >
                    {t === null ? '' : signedDollars(m.everyday - t)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
      {newest.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-1 text-xs font-semibold text-accent"
        >
          Show all {newest.length} months
        </button>
      )}
    </div>
  )
}
