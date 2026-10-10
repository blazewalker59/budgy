/**
 * The ⌘K palette (after t4-pulse-dashboard's): filter by anything, or jump
 * to anything. What's typed is read as filters ("kroger alex over 50 last
 * month" is four at once, offered as one Apply), and every person, account,
 * store, category, saved Lens, purchase, screen and action is searchable.
 * ⌘K / Ctrl+K opens it from anywhere, `/` when not typing, and + Filter.
 * Enter applies; Tab applies and keeps it open for the next filter;
 * Backspace on an empty search takes the last filter off.
 */

import { useNavigate } from '@tanstack/react-router'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Bot,
  CalendarClock,
  CircleDollarSign,
  CornerDownLeft,
  Filter,
  FilterX,
  Folder,
  LayoutList,
  ListChecks,
  Loader2,
  PieChart,
  Receipt,
  Search,
  Star,
  Store,
  SunMoon,
  User,
  Wallet,
} from 'lucide-react'
import { LensChip } from './LensBar'
import type { ReactNode } from 'react'
import type { Range } from '@/lib/fuzzy'
import type { Lens, LensFilter } from '@/lib/model/lens'
import type { LensPage } from '@/lib/ledger/useLens'
import { fuzzyMatch } from '@/lib/fuzzy'
import { useBook } from '@/lib/ledger/book'
import { useLens } from '@/lib/ledger/useLens'
import {
  describe,
  filterKey,
  filterLabel,
  filtersOf,
  isEmpty,
  matchLens,
  parseQuery,
  vocabulary,
  withFilter,
  withoutFilter,
} from '@/lib/model/lens'
import { dayLabel } from '@/lib/model/dates'
import { money } from '@/lib/model/money'
import { currentTheme, setTheme } from '@/lib/theme'
import { lockScroll } from '@/lib/scrollLock'
import { cn } from '@/lib/utils'

const I = 16

type Run = (keepOpen: boolean) => void

interface Cmd {
  id: string
  group: string
  label: string
  hint?: string
  keywords?: string
  icon: ReactNode
  run: Run
  /** Filters a compound Apply adds, shown as chips instead of a label. */
  chips?: Array<LensFilter>
  /** Whether it adds to the Lens (so Tab can keep the palette open). */
  filters?: boolean
}

interface Hit {
  cmd: Cmd
  ranges: Array<Range>
}

const GROUP_OF: Record<LensFilter['type'], string> = {
  person: 'People',
  account: 'Accounts',
  kind: 'Filters',
  store: 'Stores',
  category: 'Categories',
  tag: 'Filters',
  flag: 'Filters',
  amount: 'Filters',
  when: 'Filters',
  text: 'Filters',
}
const ICON_OF: Record<LensFilter['type'], ReactNode> = {
  person: <User size={I} />,
  account: <Wallet size={I} />,
  kind: <Wallet size={I} />,
  store: <Store size={I} />,
  category: <Folder size={I} />,
  tag: <Filter size={I} />,
  flag: <Filter size={I} />,
  amount: <CircleDollarSign size={I} />,
  when: <Filter size={I} />,
  text: <Search size={I} />,
}
const GROUP_CAP = 5
const MAX_HITS = 32

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]') !== null
  )
}

export function CommandPalette() {
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => (v === null ? '' : null))
      } else if (
        e.key === '/' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !isTyping(e.target)
      ) {
        e.preventDefault()
        setOpen('')
      }
    }
    const onOpen = (e: Event) =>
      setOpen(((e as CustomEvent<string>).detail as string | undefined) ?? '')
    window.addEventListener('keydown', onKey)
    window.addEventListener('budgy:palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('budgy:palette', onOpen)
    }
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen('')}
        className="hidden h-8 items-center gap-2 rounded-full border border-border bg-surface pl-3 pr-1.5 text-[13px] text-muted transition-colors hover:text-foreground sm:flex"
      >
        <Search size={14} aria-hidden />
        <span>Search or filter…</span>
        <Kbd>⌘K</Kbd>
      </button>
      {open !== null &&
        createPortal(
          <Palette initial={open} onClose={() => setOpen(null)} />,
          document.body,
        )}
    </>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-border bg-sunken px-1.5 py-px font-sans text-[11px] font-semibold text-muted">
      {children}
    </kbd>
  )
}

function Marked({ text, ranges }: { text: string; ranges: Array<Range> }) {
  if (ranges.length === 0) return <>{text}</>
  const parts: Array<ReactNode> = []
  let last = 0
  for (const [a, b] of ranges) {
    parts.push(text.slice(last, a))
    parts.push(
      <mark key={a} className="rounded-[3px] bg-accent/20 text-inherit">
        {text.slice(a, b + 1)}
      </mark>,
    )
    last = b + 1
  }
  parts.push(text.slice(last))
  return <>{parts}</>
}

function rank(cmds: Array<Cmd>, q: string, pinned: Array<Cmd>): Array<Hit> {
  const scored = cmds
    .map((cmd) => ({
      cmd,
      m: fuzzyMatch(q, cmd.label, `${cmd.keywords ?? ''} ${cmd.hint ?? ''}`),
    }))
    .filter((x): x is { cmd: Cmd; m: NonNullable<typeof x.m> } => x.m !== null)
    .sort((a, b) => b.m.score - a.m.score)
  // Groups appear in the order of their best hit, each capped so a busy
  // kind (stores, purchases) can't push the rest off.
  const order: Array<string> = []
  const byGroup = new Map<string, Array<Hit>>()
  for (const { cmd, m } of scored) {
    if (!byGroup.has(cmd.group)) {
      byGroup.set(cmd.group, [])
      order.push(cmd.group)
    }
    const list = byGroup.get(cmd.group)!
    if (list.length < GROUP_CAP) list.push({ cmd, ranges: m.ranges })
  }
  return [
    ...pinned.map((cmd) => ({
      cmd,
      ranges: fuzzyMatch(q, cmd.label)?.ranges ?? [],
    })),
    ...order
      .flatMap((g) => byGroup.get(g)!)
      .filter((h) => !pinned.includes(h.cmd)),
  ].slice(0, MAX_HITS)
}

function Palette({
  initial,
  onClose,
}: {
  initial: string
  onClose: () => void
}) {
  const book = useBook()
  const { ix, today, plannedIds } = book
  const navigate = useNavigate()
  const { lens, show, page } = useLens()
  const [q, setQ] = useState(initial)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const terms = useMemo(() => vocabulary(ix), [ix])

  /** Show the Lens on this screen if it uses lenses, else on Spending. */
  const apply = useCallback(
    (next: Lens, to?: LensPage) =>
      show(
        next,
        to ?? (page === '/' || page === '/spending' ? page : '/spending'),
      ),
    [show, page],
  )

  const cmds = useMemo((): Array<Cmd> => {
    const go = (
      id: string,
      label: string,
      to: LensPage | '/agents',
      icon: ReactNode,
      keywords: string,
      patch?: Record<string, unknown>,
    ): Cmd => ({
      id: `go:${id}`,
      group: 'Go to',
      label,
      keywords,
      icon,
      run: () => {
        if (to === '/agents') void navigate({ to })
        else show(lens, to, patch)
      },
    })
    const out: Array<Cmd> = [
      go(
        'overview',
        'Overview',
        '/',
        <PieChart size={I} />,
        'home month pace this month coming up',
      ),
      go(
        'spending',
        'Spending',
        '/spending',
        <Receipt size={I} />,
        'explore purchases transactions',
      ),
      go(
        'plan',
        'Plan',
        '/plan',
        <LayoutList size={I} />,
        'budget targets take-home pay',
      ),
      go(
        'bills',
        'Planned bills',
        '/plan',
        <CalendarClock size={I} />,
        'plan bills upcoming forecast subscriptions due',
        { tab: 'bills' },
      ),
      go(
        'accounts',
        'Accounts',
        '/accounts',
        <Wallet size={I} />,
        'net worth balances equity home loans upload export csv import',
      ),
      go(
        'rules',
        'Store Rules',
        '/accounts',
        <ListChecks size={I} />,
        'filing rules categorize recategorize always file move categories',
        { tab: 'rules' },
      ),
      go('agents', 'Agents', '/agents', <Bot size={I} />, 'mcp api token'),
      {
        id: 'action:theme',
        group: 'Actions',
        label: 'Toggle light / dark',
        keywords: 'theme dark mode light mode appearance',
        icon: <SunMoon size={I} />,
        run: () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'),
      },
    ]
    if (!isEmpty(lens))
      out.push({
        id: 'action:clear',
        group: 'Actions',
        label: 'Clear filters',
        hint: describe(lens),
        keywords: 'reset all everything unfilter',
        icon: <FilterX size={I} />,
        run: () => show({}),
      })
    for (const l of ix.ledger.lenses)
      out.push({
        id: `lens:${l.id}`,
        group: 'Saved lenses',
        label: l.name,
        hint: describe(l.lens),
        keywords: 'saved lens view',
        icon: <Star size={I} />,
        run: () => apply(l.lens),
      })
    for (const t of terms)
      out.push({
        id: `term:${filterKey(t.filter)}`,
        group: GROUP_OF[t.filter.type],
        label: t.label,
        hint: t.hint,
        keywords: t.aliases.join(' '),
        icon: ICON_OF[t.filter.type],
        filters: true,
        run: () => apply(withFilter(lens, t.filter)),
      })
    return out
  }, [ix, terms, lens, show, apply, navigate])

  const hits = useMemo((): Array<Hit> => {
    const query = q.trim()
    if (!query) {
      // Saved lenses first, then where to go.
      const ids = [
        ...ix.ledger.lenses.slice(0, 5).map((l) => `lens:${l.id}`),
        'action:clear',
        'go:overview',
        'go:spending',
        'go:plan',
        'go:accounts',
        'action:theme',
      ]
      return ids.flatMap((id) =>
        cmds.filter((c) => c.id === id).map((cmd) => ({ cmd, ranges: [] })),
      )
    }
    // A saved Lens named like the query beats reading it as filters.
    const pinned: Array<Cmd> = cmds.filter(
      (c) => c.id.startsWith('lens:') && fuzzyMatch(query, c.label) !== null,
    )
    const { filters, rest } = parseQuery(query, terms, today)
    const exact = filters.find(
      (f): f is Extract<LensFilter, { type: 'amount' }> =>
        f.type === 'amount' && f.min !== undefined && f.min === f.max,
    )
    // Several filters at once (or an amount or dates alone): one Apply.
    if (
      filters.length >= 2 ||
      (filters.length === 1 &&
        !rest.length &&
        (filters[0].type === 'amount' || filters[0].type === 'when'))
    ) {
      const all: Array<LensFilter> = rest.length
        ? [...filters, { type: 'text', value: rest.join(' ') }]
        : filters
      const next = all.reduce(withFilter, lens)
      const n = ix.ledger.txns.filter((t) =>
        matchLens(ix, t, next, plannedIds),
      ).length
      pinned.push({
        id: 'apply',
        group: 'Apply',
        label: all.map((f) => filterLabel(f)[1]).join(' '),
        hint: `${n} purchase${n === 1 ? '' : 's'}${next.from ? '' : ', all time'}`,
        icon: <CornerDownLeft size={I} />,
        chips: all,
        filters: true,
        run: () => apply(next),
      })
    }
    // Purchases: the exact charge, or a description or note that says it.
    const needle = query.toLowerCase()
    const purchases = ix.ledger.txns
      .filter((t) =>
        exact
          ? Math.abs(t.amount) === exact.min
          : needle.length >= 3 &&
            (t.description.toLowerCase().includes(needle) ||
              (t.note ?? '').toLowerCase().includes(needle)),
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5)
    const found: Array<Cmd> = purchases.map((t) => ({
      id: `txn:${t.id}`,
      group: 'Purchases',
      label: `${t.store} · ${money(t.amount)}`,
      hint: `${dayLabel(t.date)} ’${t.date.slice(2, 4)} · ${t.account}`,
      keywords: `${t.description} ${t.note ?? ''} ${query}`,
      icon: <Receipt size={I} />,
      run: () =>
        apply(
          {
            stores: [t.store],
            min: Math.abs(t.amount),
            max: Math.abs(t.amount),
            from: t.date,
            to: t.date,
          },
          '/spending',
        ),
    }))
    return rank([...cmds, ...found], query, pinned)
  }, [cmds, q, terms, today, ix, lens, plannedIds, apply])

  const activeHit = hits[Math.min(active, hits.length - 1)] as Hit | undefined

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    const unlock = lockScroll()
    return () => {
      unlock()
      previous?.focus()
    }
  }, [])

  const run = useCallback(
    (cmd: Cmd, keepOpen: boolean) => {
      cmd.run(keepOpen)
      if (keepOpen && cmd.filters) {
        setQ('')
        inputRef.current?.focus()
      } else onClose()
    },
    [onClose],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(hits.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeHit) run(activeHit.cmd, false)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (activeHit && q.trim()) run(activeHit.cmd, true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Backspace' && !q) {
      const fs = filtersOf(lens)
      const last = fs[fs.length - 1] as LensFilter | undefined
      if (last) {
        e.preventDefault()
        show(withoutFilter(lens, last))
      }
    }
  }

  // The highlight is one element that glides to the active row. It snaps on
  // the first paint and after the results change, and eases only on moves.
  const [glow, setGlow] = useState<{
    top: number
    height: number
    animate: boolean
  } | null>(null)
  const moved = useRef(false)
  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-i="${active}"]`,
    )
    if (!el) {
      setGlow(null)
      return
    }
    setGlow({
      top: el.offsetTop,
      height: el.offsetHeight,
      animate: moved.current,
    })
    el.scrollIntoView({ block: 'nearest' })
  }, [active, hits])
  useEffect(() => {
    moved.current = false
    setActive(0)
  }, [q])

  const lensFilters = filtersOf(lens)
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-3 pt-3 sm:pt-[12vh]">
      <div
        className="palette-scrim absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search or filter"
        className="palette-pop relative flex max-h-[85vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_24px_64px_rgb(0_0_0/0.22)] sm:max-h-[70vh]"
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          {book.ix.ledger.txns.length === 0 ? (
            <Loader2
              size={18}
              className="shrink-0 animate-spin text-muted"
              aria-hidden
            />
          ) : (
            <Search size={18} className="shrink-0 text-muted" aria-hidden />
          )}
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={
              activeHit ? `palette-opt-${active}` : undefined
            }
            aria-label="Search or filter"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Store, person, over 50, last month, or a page"
            className="min-w-0 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:text-muted/70"
          />
          <Kbd>esc</Kbd>
        </div>
        {lensFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-muted">
              Active filters
            </span>
            {lensFilters.map((f) => (
              <LensChip
                key={filterKey(f)}
                filter={f}
                onRemove={() => show(withoutFilter(lens, f))}
              />
            ))}
          </div>
        )}

        <div
          ref={listRef}
          id="palette-list"
          role="listbox"
          aria-label="Results"
          className="relative overflow-y-auto p-2"
        >
          {glow && (
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-x-2 rounded-xl bg-accent/10 ring-1 ring-accent/20',
                glow.animate &&
                  'transition-[transform,height] duration-150 ease-[cubic-bezier(0.2,0.9,0.3,1.15)]',
              )}
              style={{
                transform: `translateY(${glow.top}px)`,
                height: glow.height,
                top: 0,
              }}
            />
          )}
          {hits.map((h, i) => {
            const header = q.trim()
              ? i === 0 || hits[i - 1].cmd.group !== h.cmd.group
                ? h.cmd.group
                : null
              : i === 0
                ? 'Suggested'
                : null
            const on = i === active
            return (
              <div key={h.cmd.id}>
                {header && (
                  <div className="px-3 pb-1 pt-2.5 text-[11px] font-bold text-muted">
                    {header}
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  id={`palette-opt-${i}`}
                  aria-selected={on}
                  tabIndex={-1}
                  data-i={i}
                  onMouseMove={() => {
                    if (i !== active) {
                      moved.current = true
                      setActive(i)
                    }
                  }}
                  onClick={() => run(h.cmd, false)}
                  className="palette-item relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm"
                  style={{ animationDelay: `${Math.min(i, 12) * 12}ms` }}
                >
                  <span
                    className={cn(
                      'shrink-0 transition-colors',
                      on ? 'text-accent' : 'text-muted',
                    )}
                  >
                    {h.cmd.icon}
                  </span>
                  {h.cmd.chips ? (
                    <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                      {h.cmd.chips.map((f) => (
                        <LensChip key={filterKey(f)} filter={f} />
                      ))}
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      <Marked text={h.cmd.label} ranges={h.ranges} />
                    </span>
                  )}
                  {h.cmd.hint && (
                    <span className="max-w-[45%] shrink-0 truncate text-xs text-muted">
                      {h.cmd.hint}
                    </span>
                  )}
                  <span
                    className={cn(
                      'w-4 shrink-0 text-muted transition-opacity duration-100',
                      on ? 'opacity-100' : 'opacity-0',
                    )}
                  >
                    <CornerDownLeft size={14} />
                  </span>
                </button>
              </div>
            )
          })}
          {hits.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted">
              Nothing matches “{q.trim()}”.
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-sunken/60 px-4 py-2 text-[11px] text-muted">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> apply
          </span>
          <span className="hidden items-center gap-1 sm:flex">
            <Kbd>⇥</Kbd> add &amp; keep typing
          </span>
          <span className="hidden items-center gap-1 sm:flex">
            <Kbd>⌫</Kbd> remove last filter
          </span>
        </div>
      </div>
    </div>
  )
}
