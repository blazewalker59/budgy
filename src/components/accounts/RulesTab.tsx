/**
 * The Rules tab on Accounts: where each Store's purchases go, past and
 * future (every upload is filed by them). Rules the Moves suggest come
 * first, then every rule to change or remove, then a new one, then the
 * Import Rules. A Move on one purchase still wins over its Store's rule.
 */

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { StoreRule } from '@/lib/model/types'
import { useBook } from '@/lib/ledger/book'
import { useSetStoreRule } from '@/lib/ledger/useLedger'
import { ANY_SOURCE } from '@/lib/model/ledger'
import { ruleUses, suggestRules } from '@/lib/model/rules'
import { dayLabel } from '@/lib/model/dates'
import { TAG_LABELS } from '@/lib/model/types'
import { CategorySelect } from '@/components/shared/CategorySelect'
import { ImportRules } from '@/components/accounts/ImportRules'

export function RulesTab() {
  const { ix } = useBook()
  const suggestions = useMemo(() => suggestRules(ix), [ix])
  const uses = useMemo(() => ruleUses(ix), [ix])
  return (
    <div className="space-y-3">
      <p className="px-1 text-xs text-muted">
        Where each store’s purchases go, past ones and every upload to come.
        Moving one purchase still wins over its store’s rule.
      </p>
      {suggestions.length > 0 && <Suggestions list={suggestions} />}
      <RuleList uses={uses} />
      <AddRule />
      <ImportRules />
    </div>
  )
}

function Suggestions({ list }: { list: ReturnType<typeof suggestRules> }) {
  const setRule = useSetStoreRule()
  const make = (s: { store: string; category: string }) =>
    setRule.mutate({
      sourceCategory: ANY_SOURCE,
      store: s.store,
      category: s.category,
    })
  return (
    <section className="overflow-hidden rounded-xl border border-nice/40 bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          From your Moves
          <span className="ml-1.5 font-normal normal-case tracking-normal">
            stores you keep moving to the same place
          </span>
        </h2>
        {list.length > 1 && (
          <button
            type="button"
            onClick={() => list.forEach(make)}
            className="shrink-0 text-xs font-semibold text-accent"
          >
            Make all {list.length}
          </button>
        )}
      </div>
      <ul className="divide-y divide-border text-[13px]">
        {list.map((s) => (
          <li
            key={s.store}
            className="flex items-center justify-between gap-2 px-3 py-1.5"
          >
            <span className="min-w-0">
              <span className="font-semibold">{s.store}</span>
              <span className="text-muted"> → </span>
              <span className="font-semibold">{s.category}</span>
              <span className="block text-[11px] text-muted">
                Moved {s.moved} of {s.purchases}
                {s.changes > 0 && `; ${s.changes} more would move too`}
              </span>
            </span>
            <button
              type="button"
              onClick={() => make(s)}
              className="shrink-0 rounded-full bg-foreground px-2.5 py-0.5 text-xs font-semibold text-background"
            >
              Make rule
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RuleList({ uses }: { uses: ReturnType<typeof ruleUses> }) {
  const setRule = useSetStoreRule()
  const [q, setQ] = useState('')
  const shown = uses.filter(
    (u) =>
      !q ||
      `${u.rule.store} ${u.rule.category ?? ''}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  )
  const change = (r: StoreRule, patch: Partial<StoreRule>) =>
    setRule.mutate({
      sourceCategory: r.sourceCategory,
      store: r.store,
      ...patch,
    })
  // A rule for one import Category, made for the first bulk import, can
  // cover the Store's every purchase instead (unless one already does).
  const wide = new Set(
    uses
      .filter((u) => u.rule.sourceCategory === ANY_SOURCE)
      .map((u) => u.rule.store.toLowerCase()),
  )
  const narrow = uses.filter(
    (u) =>
      u.rule.sourceCategory !== ANY_SOURCE &&
      u.rule.category &&
      !wide.has(u.rule.store.toLowerCase()),
  )
  const widen = (r: StoreRule) => {
    setRule.mutate({
      sourceCategory: ANY_SOURCE,
      store: r.store,
      category: r.category,
      tag: r.tag,
    })
    change(r, { category: null, tag: null })
  }
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-border px-3 py-1.5">
        <h2 className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-muted">
          Rules · {uses.length}
        </h2>
        {narrow.length > 1 && (
          <button
            type="button"
            onClick={() => {
              // One per Store: the busiest of its rules.
              const seen = new Set<string>()
              for (const u of [...narrow].sort(
                (a, b) => b.purchases - a.purchases,
              )) {
                const k = u.rule.store.toLowerCase()
                if (seen.has(k)) continue
                seen.add(k)
                widen(u.rule)
              }
            }}
            className="ml-auto shrink-0 text-xs font-semibold text-accent"
            title="Rules made for the first bulk import only apply to purchases that came in under one category"
          >
            Apply all to every purchase
          </button>
        )}
        {uses.length > 8 && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a store"
            aria-label="Find a rule"
            className="field w-full py-0.5 text-xs sm:w-40"
          />
        )}
      </div>
      {!uses.length && (
        <p className="px-3 py-2 text-xs text-muted">
          No rules yet. Move a purchase and choose Always, or add one below.
        </p>
      )}
      <ul className="divide-y divide-border text-[13px]">
        {shown.map(({ rule: r, purchases, last }) => (
          <li
            key={`${r.sourceCategory}|${r.store}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 px-3 py-1.5 sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold">{r.store}</span>
              <span className="block truncate text-[11px] text-muted">
                {r.sourceCategory === ANY_SOURCE ? (
                  'every purchase'
                ) : (
                  <>
                    when it came in as {r.sourceCategory}
                    {r.category && !wide.has(r.store.toLowerCase()) && (
                      <>
                        {' ('}
                        <button
                          type="button"
                          onClick={() => widen(r)}
                          className="font-semibold text-accent"
                        >
                          every purchase
                        </button>
                        {')'}
                      </>
                    )}
                  </>
                )}
                {' · '}
                {purchases} filed
                {last && `, last ${dayLabel(last)} ’${last.slice(2, 4)}`}
                {r.tag && ` · ${TAG_LABELS[r.tag]}`}
              </span>
            </span>
            <button
              type="button"
              onClick={() => change(r, { category: null, tag: null })}
              aria-label={`Remove the rule for ${r.store}`}
              title="Remove this rule"
              className="row-span-2 rounded-full p-1 text-muted hover:bg-sunken hover:text-over sm:order-last sm:row-span-1"
            >
              <X size={14} aria-hidden />
            </button>
            {r.category ? (
              <CategorySelect
                label={`File ${r.store} under`}
                value={r.category}
                onChange={(c) => change(r, { category: c })}
                className="w-full min-w-0"
              />
            ) : (
              <span className="text-xs text-muted">Tag only</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function AddRule() {
  const { ix } = useBook()
  const setRule = useSetStoreRule()
  const [store, setStore] = useState('')
  const [category, setCategory] = useState('')
  // Every Store, busiest first, under the name the Ledger uses.
  const stores = useMemo(() => {
    const by = new Map<string, { name: string; n: number }>()
    for (const t of ix.ledger.txns) {
      const k = t.store.toLowerCase()
      const s = by.get(k) ?? { name: t.store, n: 0 }
      s.n++
      by.set(k, s)
    }
    return [...by.values()].sort((a, b) => b.n - a.n).map((s) => s.name)
  }, [ix])
  const name =
    stores.find((s) => s.toLowerCase() === store.trim().toLowerCase()) ??
    store.trim()
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name || !category) return
        setRule.mutate({ sourceCategory: ANY_SOURCE, store: name, category })
        setStore('')
        setCategory('')
      }}
    >
      <span className="font-semibold">Always file</span>
      <input
        value={store}
        onChange={(e) => setStore(e.target.value)}
        list="rule-stores"
        maxLength={80}
        placeholder="a store"
        aria-label="Store"
        className="field w-40"
      />
      <datalist id="rule-stores">
        {stores.slice(0, 400).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <span className="font-semibold">under</span>
      <CategorySelect
        label="Category for the rule"
        value={category}
        onChange={setCategory}
        className="w-44"
      />
      <button
        type="submit"
        disabled={!name || !category}
        className="ml-auto rounded-full bg-foreground px-3 py-1 font-semibold text-background disabled:opacity-40"
      >
        Add rule
      </button>
    </form>
  )
}
