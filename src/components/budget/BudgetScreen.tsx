/**
 * The Budget: a Target per Category, set from a month on, next to what a
 * typical month really costs (without Planned Expenses, which have their
 * own schedule). Stores can be re-filed here for good.
 */

import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
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
import { averages } from '@/lib/model/month'
import { monthlySetAside } from '@/lib/model/plans'
import { monthLabel, monthRange, shiftMonth } from '@/lib/model/dates'
import { dollars, parseDollars, signedDollars } from '@/lib/model/money'
import { TAGS, TAG_LABELS } from '@/lib/model/types'
import { TAG_BG } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CategorySelect } from '@/components/shared/CategorySelect'

export function BudgetScreen() {
  const book = useBook()
  const { ix } = book
  const thisMonth = book.today.slice(0, 7)
  const [from, setFrom] = useState(thisMonth)
  const [open, setOpen] = useState<string | null>(null)
  const window12 = useMemo(
    () => monthRange(shiftMonth(thisMonth, -1), 12),
    [thisMonth],
  )
  const avgs = useMemo(
    () => averages(ix, window12, book.plannedIds),
    [ix, window12, book.plannedIds],
  )

  const names = useMemo(() => {
    const set = new Set([...ix.categories.keys(), ...avgs.keys()])
    return [...set].sort(
      (a, b) =>
        (avgs.get(b)?.everyday ?? 0) - (avgs.get(a)?.everyday ?? 0) ||
        a.localeCompare(b),
    )
  }, [ix, avgs])
  const group = (n: string) => ix.categories.get(n)?.group ?? 'everyday'
  const everyday = names.filter((n) => group(n) === 'everyday')
  const housing = names.filter((n) => group(n) === 'housing')

  const totalTarget = everyday.reduce(
    (s, n) => s + (targetFor(ix, n, from) ?? 0),
    0,
  )
  const totalAvg = everyday.reduce(
    (s, n) => s + (avgs.get(n)?.everyday ?? 0),
    0,
  )
  const setAside = ix.ledger.plans
    .filter((p) => p.active)
    .reduce((s, p) => s + monthlySetAside(p), 0)

  const fromOptions = Array.from({ length: 13 }, (_, i) =>
    shiftMonth(thisMonth, i - 1),
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Budget</h1>
          <p className="text-sm text-muted">
            Typical month = average of {monthLabel(window12[0])} –{' '}
            {monthLabel(window12[11])}, leaving out Planned bills.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          Targets from
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="field font-semibold"
          >
            {fromOptions.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, true)} on
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Everyday Targets" value={dollars(totalTarget)} />
        <Stat
          label="Typical month"
          value={dollars(totalAvg)}
          detail={`${signedDollars(totalTarget - totalAvg)} vs Targets`}
        />
        <Stat
          label="Planned bills, per month"
          value={dollars(setAside)}
          detail="To set aside for them"
        />
      </div>

      <Table
        title="Everyday"
        names={everyday}
        from={from}
        avgs={avgs}
        open={open}
        setOpen={setOpen}
        window12={window12}
      />
      <Table
        title="Housing"
        names={housing}
        from={from}
        avgs={avgs}
        open={open}
        setOpen={setOpen}
        window12={window12}
      />
      <AddCategory />
    </div>
  )
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">{value}</p>
      {detail && <p className="text-sm text-muted">{detail}</p>}
    </div>
  )
}

function Table({
  title,
  names,
  from,
  avgs,
  open,
  setOpen,
  window12,
}: {
  title: string
  names: Array<string>
  from: string
  avgs: Map<string, { everyday: number; all: number }>
  open: string | null
  setOpen: (name: string | null) => void
  window12: Array<string>
}) {
  if (!names.length) return null
  return (
    <section>
      <h2 className="mb-2 text-lg font-bold tracking-tight">{title}</h2>
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-2 py-2 font-medium">Tag</th>
              <th className="px-2 py-2 text-right font-medium">
                Typical month
              </th>
              <th className="px-2 py-2 text-right font-medium">Target</th>
              <th className="px-4 py-2 text-right font-medium">vs typical</th>
            </tr>
          </thead>
          <tbody>
            {names.map((name) => (
              <Row
                key={name}
                name={name}
                from={from}
                avg={avgs.get(name)}
                open={open === name}
                toggle={() => setOpen(open === name ? null : name)}
                window12={window12}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Row({
  name,
  from,
  avg,
  open,
  toggle,
  window12,
}: {
  name: string
  from: string
  avg?: { everyday: number; all: number }
  open: boolean
  toggle: () => void
  window12: Array<string>
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
  const history = ix.targets.get(name) ?? []
  const typical = avg?.everyday ?? 0
  return (
    <Fragment>
      <tr className="border-b border-border last:border-0">
        <td className="px-4 py-2">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className="flex items-center gap-2 text-left font-semibold"
          >
            <span className={cn('size-2 rounded-full', TAG_BG[category.tag])} />
            {name}
            <ChevronDown
              size={15}
              className={cn('text-muted transition', open && 'rotate-180')}
              aria-hidden
            />
          </button>
        </td>
        <td className="px-2 py-2">
          <select
            value={category.tag}
            aria-label={`Tag for ${name}`}
            className="field"
            onChange={(e) =>
              saveCategory.mutate({ ...category, tag: e.target.value as Tag })
            }
          >
            {TAGS.map((t) => (
              <option key={t} value={t}>
                {TAG_LABELS[t]}
              </option>
            ))}
          </select>
        </td>
        <td className="px-2 py-2 text-right">
          {dollars(typical)}
          {avg && avg.all - avg.everyday > 500 && (
            <span className="block text-xs text-planned">
              {dollars(avg.all)} with planned
            </span>
          )}
        </td>
        <td className="px-2 py-2 text-right">
          <input
            key={`${from}-${target}`}
            inputMode="decimal"
            defaultValue={target === null ? '' : String(target / 100)}
            placeholder="—"
            aria-label={`Target for ${name} from ${monthLabel(from)}`}
            className="field w-24 text-right"
            onBlur={(e) => {
              const raw = e.target.value.trim()
              const startsHere = history.some((h) => h.startsMonth === from)
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
            'px-4 py-2 text-right font-medium',
            target !== null && target < typical ? 'text-accent' : 'text-muted',
          )}
        >
          {target === null ? '' : signedDollars(target - typical)}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border bg-background/40">
          <td colSpan={5} className="px-4 py-3">
            <Details
              category={category}
              history={history}
              window12={window12}
            />
          </td>
        </tr>
      )}
    </Fragment>
  )
}

/** Target history, the Category's Group, and its Stores to re-file. */
function Details({
  category,
  history,
  window12,
}: {
  category: Category
  history: Array<{ startsMonth: string; amount: number }>
  window12: Array<string>
}) {
  const { ix } = useBook()
  const saveCategory = useSaveCategory()
  const setRule = useSetStoreRule()
  const stores = useMemo(() => {
    const months = new Set(window12)
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
  }, [ix, category.name, window12])
  const [all, setAll] = useState(false)
  const shown = all ? stores : stores.slice(0, 10)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          Group
          <select
            value={category.group}
            className="field"
            onChange={(e) =>
              saveCategory.mutate({
                ...category,
                group: e.target.value as Group,
              })
            }
          >
            <option value="everyday">Everyday</option>
            <option value="housing">Housing</option>
          </select>
        </label>
        <span className="text-muted">
          {history.length
            ? 'Target history: ' +
              [...history]
                .reverse()
                .map(
                  (h) =>
                    `${dollars(h.amount)} from ${monthLabel(h.startsMonth)}`,
                )
                .join(', ')
            : 'No Target yet'}
        </span>
      </div>
      {stores.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-1 font-medium">Store (last 12 months)</th>
              <th className="py-1 text-right font-medium">Per month</th>
              <th className="py-1 pl-3 font-medium">Always file under</th>
              <th className="py-1 pl-2 font-medium">Tag</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const rule = ix.rules.get(ruleKey(s.sourceCategory, s.store))
              return (
                <tr key={`${s.sourceCategory}-${s.store}`}>
                  <td className="py-1">
                    <span className="font-medium">{s.store}</span>
                    <span className="text-muted"> · {s.count}×</span>
                    {s.sourceCategory !== category.name && (
                      <span className="ml-1.5 rounded bg-planned-soft px-1 text-[11px] text-planned">
                        moved from {s.sourceCategory}
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-right">
                    {dollars(s.amount / window12.length)}
                  </td>
                  <td className="py-1 pl-3">
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
                    />
                  </td>
                  <td className="py-1 pl-2">
                    <select
                      value={rule?.tag ?? ''}
                      aria-label={`Tag for ${s.store}`}
                      className="field"
                      onChange={(e) =>
                        setRule.mutate({
                          sourceCategory: s.sourceCategory,
                          store: s.store,
                          tag: (e.target.value || null) as Tag | null,
                        })
                      }
                    >
                      <option value="">Same as category</option>
                      {TAGS.map((t) => (
                        <option key={t} value={t}>
                          {TAG_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {stores.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="text-sm font-medium text-accent"
        >
          Show {stores.length - shown.length} smaller stores
        </button>
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
      className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-border p-3"
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
        className="field min-w-48 flex-1"
      />
      <select
        value={tag}
        onChange={(e) => setTag(e.target.value as Tag)}
        aria-label="Tag"
        className="field"
      >
        {TAGS.map((t) => (
          <option key={t} value={t}>
            {TAG_LABELS[t]}
          </option>
        ))}
      </select>
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
        className="inline-flex items-center gap-1 rounded-full bg-foreground px-4 py-1.5 text-sm font-semibold text-background"
      >
        <Plus size={15} aria-hidden /> Add
      </button>
    </form>
  )
}
