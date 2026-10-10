/**
 * The Budget: a Target per Category, set from a month on, next to what
 * recent months really cost (without Planned Expenses, which have their own
 * schedule) and how that's trending, all weighed against take-home pay.
 * Each Category is a compact row; tapping it opens its sheet (history, tag
 * and group, Stores to re-file).
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronRight, Plus } from 'lucide-react'
import { BudgetMix } from './BudgetMix'
import { CategorySheet } from './CategorySheet'
import { IncomePlan } from './IncomePlan'
import { PaySheet } from './PaySheet'
import { TagSelect } from './TagSelect'
import type { CategoryHistory } from '@/lib/model/month'
import type { Category, Group, Tag } from '@/lib/model/types'
import { useBook } from '@/lib/ledger/book'
import { useSaveCategory, useSetTarget } from '@/lib/ledger/useLedger'
import { categoryTag, targetFor } from '@/lib/model/ledger'
import { categoryHistory } from '@/lib/model/month'
import { coverageGaps } from '@/lib/model/coverage'
import { budgetMix } from '@/lib/model/mix'
import { incomeSplit, takeHome } from '@/lib/model/pay'
import { monthlySetAside } from '@/lib/model/plans'
import { monthLabel, monthRange, shiftMonth } from '@/lib/model/dates'
import { dollars, parseDollars, signedDollars } from '@/lib/model/money'
import { TAG_BG } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Segmented, Stat } from '@/components/shared/Layout'
import { TrendSpark } from '@/components/charts/lazy'
import { Dropdown } from '@/components/shared/Dropdown'

type Span = '3' | '6' | '12'
const SPANS = [
  { value: '3' as const, label: '3 mo' },
  { value: '6' as const, label: '6 mo' },
  { value: '12' as const, label: '12 mo' },
]

/**
 * One grid for every row and the header: two lines on a phone (name and
 * ±, then trend, typical and Target), one line from `sm` up.
 */
const ROW_GRID =
  'grid items-center gap-x-2 gap-y-0.5 [grid-template-areas:"name_name_diff""spark_typ_target"] grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-y-0 sm:[grid-template-areas:"name_tag_spark_typ_target_diff"] sm:grid-cols-[minmax(0,1fr)_5rem_5.5rem_5rem_5rem_4.5rem]'

export function BudgetScreen({ owner }: { owner?: string }) {
  const book = useBook()
  const { ix } = book
  const thisMonth = book.today.slice(0, 7)
  const [from, setFrom] = useState(thisMonth)
  const [span, setSpan] = useState<Span>('3')
  const [sheet, setSheet] = useState<string | null>(null)
  const [paySheet, setPaySheet] = useState(false)
  const window = useMemo(
    () => monthRange(shiftMonth(thisMonth, -1), Number(span)),
    [thisMonth, span],
  )
  const history = useMemo(
    () => categoryHistory(ix, window, book.plannedIds, owner ?? null),
    [ix, window, book.plannedIds, owner],
  )
  // The trend always shows a year, with the averaged months drawn strong.
  const year = useMemo(
    () =>
      categoryHistory(
        ix,
        monthRange(shiftMonth(thisMonth, -1), 12),
        book.plannedIds,
        owner ?? null,
      ),
    [ix, thisMonth, book.plannedIds, owner],
  )
  const gaps = useMemo(
    () =>
      window
        .map((m) => ({
          month: m,
          gaps: coverageGaps(ix.ledger, m, book.today),
        }))
        .filter((g) => g.gaps.length),
    [ix, window, book.today],
  )

  const names = useMemo(() => {
    const set = new Set([...ix.categories.keys(), ...history.keys()])
    return [...set].sort(
      (a, b) =>
        (history.get(b)?.typical ?? 0) - (history.get(a)?.typical ?? 0) ||
        a.localeCompare(b),
    )
  }, [ix, history])
  const group = (n: string) => ix.categories.get(n)?.group ?? 'everyday'
  const everyday = names.filter((n) => group(n) === 'everyday')
  const housing = names.filter((n) => group(n) === 'housing')

  const sum = (list: Array<string>, f: (n: string) => number) =>
    list.reduce((s, n) => s + f(n), 0)
  const totalTarget = sum(everyday, (n) => targetFor(ix, n, from) ?? 0)
  const totalTypical = sum(everyday, (n) => history.get(n)?.typical ?? 0)
  const mix = budgetMix(
    everyday.map((n) => ({
      name: n,
      typical: history.get(n)?.typical ?? 0,
      target: targetFor(ix, n, from) ?? 0,
    })),
  )
  const setAside = ix.ledger.plans
    .filter((p) => p.active)
    .reduce((s, p) => s + monthlySetAside(p), 0)
  const pay = useMemo(
    () => takeHome(ix.ledger.pay, book.today),
    [ix, book.today],
  )
  // Against take-home, a Category without a Target counts at its typical.
  const planned = (n: string) =>
    targetFor(ix, n, from) ?? history.get(n)?.typical ?? 0
  const typicalSplit = incomeSplit(pay.monthly, {
    everyday: totalTypical,
    housing: sum(housing, (n) => history.get(n)?.typical ?? 0),
    planned: setAside,
  })
  const budgetSplit = incomeSplit(pay.monthly, {
    everyday: sum(everyday, planned),
    housing: sum(housing, planned),
    planned: setAside,
  })
  const windowLabel =
    window.length > 1
      ? `${monthLabel(window[0]).slice(0, 3)}–${monthLabel(window[window.length - 1])}`
      : monthLabel(window[0])

  const list = (title: string, rows: Array<string>) =>
    rows.length > 0 && (
      <CategoryList
        title={title}
        names={rows}
        from={from}
        history={history}
        year={year}
        span={window.length}
        compare={!owner}
        onOpen={setSheet}
      />
    )

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-extrabold tracking-tight">
          {owner ? `Budget, ${owner}’s spending` : 'Budget'}
        </h2>
        <Dropdown
          value={from}
          onChange={setFrom}
          label="Targets apply from"
          className="text-xs font-semibold"
          options={Array.from({ length: 13 }, (_, i) =>
            shiftMonth(thisMonth, i - 1),
          ).map((m) => ({ value: m, label: `Targets from ${monthLabel(m)}` }))}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Targets" value={dollars(totalTarget)} detail="per month" />
        <Stat
          label={owner ? `${owner}’s typical` : 'Typical'}
          value={dollars(totalTypical)}
          detail={
            owner
              ? `${totalTarget ? Math.round((totalTypical / totalTarget) * 100) : 0}% of household Targets`
              : totalTypical > totalTarget
                ? `${dollars(totalTypical - totalTarget)} over`
                : `${dollars(totalTarget - totalTypical)} under`
          }
          tone={
            owner ? undefined : totalTypical > totalTarget ? 'over' : 'good'
          }
        />
        <Stat
          label="Planned"
          value={dollars(setAside)}
          detail="set aside / mo"
        />
      </div>

      {owner ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted">
          Typical months are {owner}’s spending; Targets and take-home are the
          household’s. Clear the person filter to see the share of take-home
          pay.
        </p>
      ) : (
        <IncomePlan
          pay={pay}
          typical={typicalSplit}
          budget={budgetSplit}
          onOpen={() => setPaySheet(true)}
        />
      )}
      <BudgetMix slices={mix} />

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-[11px] text-muted">
          Typical = {windowLabel} average, without planned bills
          {gaps.length > 0 && (
            <span
              className="ml-1 inline-flex items-center gap-0.5 text-nice"
              title={gaps
                .map(
                  (g) =>
                    `${monthLabel(g.month)}: ${g.gaps.map((x) => x.account).join(', ')}`,
                )
                .join('; ')}
            >
              <AlertTriangle size={11} aria-hidden />
              low: {gaps
                .map((g) => monthLabel(g.month).slice(0, 3))
                .join(', ')}{' '}
              missing imports
            </span>
          )}
        </p>
        <Segmented
          label="Typical month over"
          value={span}
          options={SPANS}
          onChange={setSpan}
        />
      </div>

      {list('Everyday', everyday)}
      {list('Housing', housing)}
      <AddCategory />
      {sheet && (
        <CategorySheet
          name={sheet}
          span={window.length}
          from={from}
          income={pay.monthly}
          onClose={() => setSheet(null)}
        />
      )}
      {paySheet && (
        <PaySheet
          pay={pay}
          spentTypical={typicalSplit.spent}
          onClose={() => setPaySheet(false)}
        />
      )}
    </div>
  )
}

function CategoryList({
  title,
  names,
  from,
  history,
  year,
  span,
  compare,
  onOpen,
}: {
  title: string
  names: Array<string>
  from: string
  history: Map<string, CategoryHistory>
  year: Map<string, CategoryHistory>
  span: number
  /** Show Target minus typical (not for one person's spending). */
  compare: boolean
  onOpen: (name: string) => void
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div
        className={cn(
          ROW_GRID,
          'border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted',
        )}
      >
        <span className="[grid-area:name]">{title}</span>
        <span className="hidden [grid-area:tag] sm:block">Tag</span>
        <span className="hidden text-right [grid-area:spark] sm:block">
          Trend
        </span>
        <span className="hidden text-right [grid-area:typ] sm:block">
          Typical
        </span>
        <span className="hidden text-right [grid-area:target] sm:block">
          Target
        </span>
        <span
          className="text-right [grid-area:diff]"
          title="Target minus typical; amber means a cut"
        >
          ±
        </span>
      </div>
      <ul className="divide-y divide-border">
        {names.map((name) => (
          <CategoryRow
            key={name}
            name={name}
            from={from}
            h={history.get(name)}
            trend={year.get(name)}
            span={span}
            compare={compare}
            onOpen={() => onOpen(name)}
          />
        ))}
      </ul>
    </section>
  )
}

function CategoryRow({
  name,
  from,
  h,
  trend,
  span,
  compare,
  onOpen,
}: {
  name: string
  from: string
  h?: CategoryHistory
  trend?: CategoryHistory
  span: number
  compare: boolean
  onOpen: () => void
}) {
  const { ix } = useBook()
  const setTarget = useSetTarget()
  const saveCategory = useSaveCategory()
  const category: Category = ix.categories.get(name) ?? {
    name,
    tag: categoryTag(ix, name),
    group: 'everyday',
  }
  const target = targetFor(ix, name, from)
  const typical = h?.typical ?? 0
  return (
    <li className={cn(ROW_GRID, 'px-3 py-1.5 text-[13px]')}>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 items-center gap-1.5 text-left font-semibold [grid-area:name]"
      >
        <span
          className={cn('size-2 shrink-0 rounded-full', TAG_BG[category.tag])}
        />
        <span className="truncate">{name}</span>
        <ChevronRight size={13} className="shrink-0 text-muted" aria-hidden />
      </button>
      <span className="hidden [grid-area:tag] sm:block">
        <TagSelect
          value={category.tag}
          label={`Tag for ${name}`}
          onChange={(tag) => tag && saveCategory.mutate({ ...category, tag })}
          className="w-full"
        />
      </span>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${name} by month`}
        title="See by month"
        className="w-20 rounded hover:bg-sunken [grid-area:spark] sm:ml-auto"
      >
        {trend && (
          <TrendSpark values={trend.monthly} target={target} highlight={span} />
        )}
      </button>
      <span className="tabular-nums [grid-area:typ] sm:text-right">
        <span className="text-[11px] text-muted sm:hidden">Typical </span>
        {dollars(typical)}
        {h && h.months < h.monthly.length && (
          <span className="ml-1 text-[10px] text-muted">{h.months} mo</span>
        )}
      </span>
      <label className="flex items-center justify-end gap-1 [grid-area:target]">
        <span className="text-[11px] text-muted sm:hidden">Target</span>
        <input
          key={`${from}-${target}`}
          inputMode="decimal"
          defaultValue={target === null ? '' : String(target / 100)}
          placeholder="—"
          aria-label={`Target for ${name} from ${monthLabel(from)}`}
          className="field w-[4.5rem] text-right"
          onBlur={(e) => {
            const raw = e.target.value.trim()
            const startsHere = (ix.targets.get(name) ?? []).some(
              (t) => t.startsMonth === from,
            )
            if (raw === '') {
              if (startsHere)
                setTarget.mutate({
                  category: name,
                  startsMonth: from,
                  amount: null,
                })
              return
            }
            const cents = parseDollars(raw)
            if (cents === null || cents === target) return
            setTarget.mutate({
              category: name,
              startsMonth: from,
              amount: cents,
            })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
      </label>
      <span
        className={cn(
          'text-right tabular-nums [grid-area:diff]',
          target === null
            ? 'text-muted'
            : target < typical
              ? 'font-semibold text-nice'
              : 'text-muted',
        )}
      >
        {target === null || !compare ? '' : signedDollars(target - typical)}
      </span>
    </li>
  )
}

function AddCategory() {
  const saveCategory = useSaveCategory()
  const [name, setName] = useState('')
  const [tag, setTag] = useState<Tag>('nice')
  const [group, setGroup] = useState<Group>('everyday')
  return (
    <form
      className="flex flex-wrap items-center gap-1.5 rounded-xl border border-dashed border-border p-2"
      onSubmit={(e) => {
        e.preventDefault()
        const n = name.trim()
        if (!n) return
        saveCategory.mutate({ name: n, tag, group })
        setName('')
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New category"
        maxLength={60}
        aria-label="New category name"
        className="field min-w-32 flex-1"
      />
      <TagSelect value={tag} label="Tag" onChange={(t) => t && setTag(t)} />
      <Dropdown<Group>
        value={group}
        onChange={setGroup}
        label="Group"
        options={[
          { value: 'everyday', label: 'Everyday' },
          { value: 'housing', label: 'Housing' },
        ]}
      />
      <button
        type="submit"
        className="inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background"
      >
        <Plus size={13} aria-hidden /> Add
      </button>
    </form>
  )
}
