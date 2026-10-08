/**
 * The Budget: a Target per Category, set from a month on, next to what
 * recent months really cost (without Planned Expenses, which have their own
 * schedule) and how that's trending. Stores can be re-filed here for good.
 */

import { Fragment, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, Plus } from 'lucide-react'
import { BudgetMix } from './BudgetMix'
import type { CategoryHistory } from '@/lib/model/month'
import type { Category, Group, Tag } from '@/lib/model/types'
import { useBook } from '@/lib/ledger/book'
import {
  useSaveCategory,
  useSetStoreRule,
  useSetTarget,
} from '@/lib/ledger/useLedger'
import {
  categoryTag,
  ruleKey,
  storeCategory,
  targetFor,
} from '@/lib/model/ledger'
import { categoryHistory } from '@/lib/model/month'
import { budgetMix } from '@/lib/model/mix'
import { coverageGaps } from '@/lib/model/coverage'
import { monthlySetAside } from '@/lib/model/plans'
import { monthLabel, monthRange, shiftMonth } from '@/lib/model/dates'
import { dollars, parseDollars, signedDollars } from '@/lib/model/money'
import { TAGS } from '@/lib/model/types'
import { TAG_BG, TAG_SHORT } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CategorySelect } from '@/components/shared/CategorySelect'
import { Segmented, Stat } from '@/components/shared/Layout'
import { Spark } from '@/components/shared/Spark'

type Span = '3' | '6' | '12'
const SPANS = [
  { value: '3' as const, label: '3 mo' },
  { value: '6' as const, label: '6 mo' },
  { value: '12' as const, label: '12 mo' },
]

export function BudgetScreen() {
  const book = useBook()
  const { ix } = book
  const thisMonth = book.today.slice(0, 7)
  const [from, setFrom] = useState(thisMonth)
  const [span, setSpan] = useState<Span>('3')
  const [open, setOpen] = useState<string | null>(null)
  const window = useMemo(
    () => monthRange(shiftMonth(thisMonth, -1), Number(span)),
    [thisMonth, span],
  )
  const history = useMemo(
    () => categoryHistory(ix, window, book.plannedIds),
    [ix, window, book.plannedIds],
  )
  // The trend always shows a year, with the averaged months drawn strong.
  const year = useMemo(
    () =>
      categoryHistory(
        ix,
        monthRange(shiftMonth(thisMonth, -1), 12),
        book.plannedIds,
      ),
    [ix, thisMonth, book.plannedIds],
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

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold tracking-tight">Budget</h1>
        <div className="flex items-center gap-2">
          <Segmented
            label="Typical month over"
            value={span}
            options={SPANS}
            onChange={setSpan}
          />
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Targets apply from"
            className="field font-semibold"
          >
            {Array.from({ length: 13 }, (_, i) =>
              shiftMonth(thisMonth, i - 1),
            ).map((m) => (
              <option key={m} value={m}>
                From {monthLabel(m)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Targets" value={dollars(totalTarget)} detail="per month" />
        <Stat
          label="Typical"
          value={dollars(totalTypical)}
          detail={
            totalTypical > totalTarget
              ? `${dollars(totalTypical - totalTarget)} over`
              : `${dollars(totalTarget - totalTypical)} under`
          }
          tone={totalTypical > totalTarget ? 'over' : 'good'}
        />
        <Stat
          label="Planned"
          value={dollars(setAside)}
          detail="set aside / mo"
        />
      </div>

      <BudgetMix slices={mix} />

      <p className="text-xs text-muted">
        {`Typical = ${monthLabel(window[0])}${
          window.length > 1 ? ` – ${monthLabel(window[window.length - 1])}` : ''
        } average without planned bills (a newer category counts from its first month). ± is Target minus typical; amber means a cut.`}
      </p>
      {gaps.length > 0 && (
        <p className="flex gap-1.5 text-xs text-muted">
          <AlertTriangle size={14} className="shrink-0 text-nice" aria-hidden />
          <span>
            Low because of missing imports:{' '}
            {gaps
              .map(
                (g) =>
                  `${monthLabel(g.month)} (${g.gaps.map((x) => x.account).join(', ')})`,
              )
              .join('; ')}
            .
          </span>
        </p>
      )}

      <Table
        title="Everyday"
        names={everyday}
        from={from}
        history={history}
        year={year}
        span={window.length}
        open={open}
        setOpen={setOpen}
      />
      <Table
        title="Housing"
        names={housing}
        from={from}
        history={history}
        year={year}
        span={window.length}
        open={open}
        setOpen={setOpen}
      />
      <AddCategory />
    </div>
  )
}

function Table({
  title,
  names,
  from,
  history,
  year,
  span,
  open,
  setOpen,
}: {
  title: string
  names: Array<string>
  from: string
  history: Map<string, CategoryHistory>
  year: Map<string, CategoryHistory>
  span: number
  open: string | null
  setOpen: (name: string | null) => void
}) {
  if (!names.length) return null
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <table className="w-full table-fixed text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
            <th className="py-1.5 pl-3 font-semibold">{title}</th>
            <th className="hidden w-20 px-1 py-1.5 font-semibold sm:table-cell">
              Tag
            </th>
            <th className="hidden w-24 px-1 py-1.5 text-right font-semibold sm:table-cell">
              Trend
            </th>
            <th className="w-[4.5rem] px-1 py-1.5 text-right font-semibold">
              Typical
            </th>
            <th className="w-[4.25rem] px-1 py-1.5 text-right font-semibold sm:w-20">
              Target
            </th>
            <th className="w-[3.75rem] py-1.5 pl-1 pr-3 text-right font-semibold sm:w-20">
              ±
            </th>
          </tr>
        </thead>
        <tbody>
          {names.map((name) => (
            <Row
              key={name}
              name={name}
              from={from}
              h={history.get(name)}
              trend={year.get(name)}
              span={span}
              open={open === name}
              toggle={() => setOpen(open === name ? null : name)}
            />
          ))}
        </tbody>
      </table>
    </section>
  )
}

function TagSelect({
  value,
  onChange,
  label,
  allowInherit,
}: {
  value: Tag | ''
  onChange: (tag: Tag | null) => void
  label: string
  allowInherit?: boolean
}) {
  return (
    <select
      value={value}
      aria-label={label}
      className="field"
      onChange={(e) => onChange((e.target.value || null) as Tag | null)}
    >
      {allowInherit && <option value="">As category</option>}
      {TAGS.map((t) => (
        <option key={t} value={t}>
          {TAG_SHORT[t]}
        </option>
      ))}
    </select>
  )
}

function Row({
  name,
  from,
  h,
  trend,
  span,
  open,
  toggle,
}: {
  name: string
  from: string
  h?: CategoryHistory
  trend?: CategoryHistory
  span: number
  open: boolean
  toggle: () => void
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
    <Fragment>
      <tr className="border-b border-border last:border-0">
        <td className="max-w-0 py-1 pl-3">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className="flex w-full min-w-0 items-center gap-1.5 text-left font-semibold"
          >
            <span
              className={cn(
                'size-2 shrink-0 rounded-full',
                TAG_BG[category.tag],
              )}
            />
            <span className="truncate">{name}</span>
            <ChevronDown
              size={13}
              className={cn(
                'shrink-0 text-muted transition',
                open && 'rotate-180',
              )}
              aria-hidden
            />
          </button>
          {trend && (
            <Spark
              values={trend.monthly}
              target={target}
              highlight={span}
              className="mt-0.5 sm:hidden"
            />
          )}
        </td>
        <td className="hidden px-1 py-1 sm:table-cell">
          <TagSelect
            value={category.tag}
            label={`Tag for ${name}`}
            onChange={(tag) => tag && saveCategory.mutate({ ...category, tag })}
          />
        </td>
        <td className="hidden px-1 py-1 text-right sm:table-cell">
          {trend && (
            <Spark
              values={trend.monthly}
              target={target}
              highlight={span}
              className="ml-auto"
            />
          )}
        </td>
        <td className="px-1 py-1 text-right tabular-nums">
          {dollars(typical)}
          {h && h.withPlanned - typical > 500 && (
            <span className="block text-[10px] leading-none text-planned">
              {dollars(h.withPlanned)} w/ planned
            </span>
          )}
          {h && h.months < h.monthly.length && (
            <span className="block text-[10px] leading-none text-muted">
              {h.months} mo
            </span>
          )}
        </td>
        <td className="px-1 py-1 text-right">
          <input
            key={`${from}-${target}`}
            inputMode="decimal"
            defaultValue={target === null ? '' : String(target / 100)}
            placeholder="—"
            aria-label={`Target for ${name} from ${monthLabel(from)}`}
            className="field w-14 text-right sm:w-16"
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
        </td>
        <td
          className={cn(
            'py-1 pl-1 pr-3 text-right tabular-nums',
            target === null
              ? 'text-muted'
              : target < typical
                ? 'font-semibold text-nice'
                : 'text-muted',
          )}
        >
          {target === null ? '' : signedDollars(target - typical)}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border bg-background/50">
          <td colSpan={6} className="px-3 py-2">
            <Details category={category} h={trend} />
          </td>
        </tr>
      )}
    </Fragment>
  )
}

/** Monthly numbers, Tag, Group, Target history, and Stores to re-file. */
function Details({ category, h }: { category: Category; h?: CategoryHistory }) {
  const book = useBook()
  const { ix } = book
  const saveCategory = useSaveCategory()
  const setRule = useSetStoreRule()
  const thisMonth = book.today.slice(0, 7)
  const window = useMemo(
    () => monthRange(shiftMonth(thisMonth, -1), 12),
    [thisMonth],
  )
  const stores = useMemo(() => {
    const months = new Set(window)
    const map = new Map<
      string,
      { store: string; sourceCategory: string; amount: number; count: number }
    >()
    for (const t of ix.ledger.txns) {
      if (!months.has(t.month) || t.category) continue
      if (storeCategory(ix, t) !== category.name) continue
      const key = ruleKey(t.sourceCategory, t.store)
      const s = map.get(key) ?? {
        store: t.store,
        sourceCategory: t.sourceCategory,
        amount: 0,
        count: 0,
      }
      s.amount += t.amount
      s.count++
      map.set(key, s)
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount)
  }, [ix, category.name, window])
  const [all, setAll] = useState(false)
  const shown = all ? stores : stores.slice(0, 8)
  const history = ix.targets.get(category.name) ?? []
  const recent = h ? h.monthly.slice(-6) : []
  const recentMonths = monthRange(
    shiftMonth(thisMonth, -1),
    h?.monthly.length ?? 0,
  ).slice(-6)

  return (
    <div className="space-y-2 text-[13px]">
      {recent.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
          {recentMonths.map((m, i) => (
            <span key={m}>
              <span className="text-muted">{monthLabel(m).slice(0, 3)}</span>{' '}
              <span className="font-semibold">{dollars(recent[i])}</span>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <TagSelect
          value={category.tag}
          label={`Tag for ${category.name}`}
          onChange={(tag) => tag && saveCategory.mutate({ ...category, tag })}
        />
        <select
          value={category.group}
          aria-label={`Group for ${category.name}`}
          className="field"
          onChange={(e) =>
            saveCategory.mutate({ ...category, group: e.target.value as Group })
          }
        >
          <option value="everyday">Everyday</option>
          <option value="housing">Housing</option>
        </select>
        <span className="text-xs text-muted">
          {history.length
            ? 'Targets: ' +
              [...history]
                .reverse()
                .map(
                  (t) =>
                    `${dollars(t.amount)} from ${monthLabel(t.startsMonth)}`,
                )
                .join(' → ')
            : 'No Target yet'}
        </span>
      </div>
      {stores.length > 0 && (
        <div className="divide-y divide-border rounded-lg border border-border bg-surface">
          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Stores, last 12 months · always file under · tag
          </p>
          {shown.map((s) => {
            const rule = ix.rules.get(ruleKey(s.sourceCategory, s.store))
            return (
              <div
                key={`${s.sourceCategory}-${s.store}`}
                className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 px-2 py-1 sm:grid-cols-[1fr_5rem_11rem_7rem]"
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">{s.store}</span>
                  <span className="text-muted"> · {s.count}×</span>
                  {s.sourceCategory !== category.name && (
                    <span className="ml-1 rounded bg-planned-soft px-1 text-[10px] text-planned">
                      from {s.sourceCategory}
                    </span>
                  )}
                </span>
                <span className="text-right tabular-nums">
                  {dollars(s.amount / window.length)}/mo
                </span>
                <CategorySelect
                  label={`Category for ${s.store}`}
                  value={category.name}
                  defaultValue={s.sourceCategory}
                  onChange={(c) =>
                    setRule.mutate({
                      sourceCategory: s.sourceCategory,
                      store: s.store,
                      category: c,
                    })
                  }
                  className="w-full"
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
            )
          })}
          {stores.length > shown.length && (
            <button
              type="button"
              onClick={() => setAll(true)}
              className="w-full px-2 py-1 text-left text-xs font-semibold text-accent"
            >
              Show {stores.length - shown.length} smaller stores
            </button>
          )}
        </div>
      )}
    </div>
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
      <select
        value={group}
        onChange={(e) => setGroup(e.target.value as Group)}
        aria-label="Group"
        className="field"
      >
        <option value="everyday">Everyday</option>
        <option value="housing">Housing</option>
      </select>
      <button
        type="submit"
        className="inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background"
      >
        <Plus size={13} aria-hidden /> Add
      </button>
    </form>
  )
}
