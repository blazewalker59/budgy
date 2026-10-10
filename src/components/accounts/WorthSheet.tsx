/**
 * What a net worth figure is made of, from a tap on Have, Owe or Net worth
 * on Accounts: each group of Accounts as a bar on one scale, its share,
 * and (tapped) its Accounts, each of which opens its own sheet. Net worth
 * shows both sides together, with the baseline it's counted from.
 */

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Ledger } from '@/lib/model/types'
import type { WorthHistory, WorthPart } from '@/lib/model/accounts'
import { netWorth, worthParts } from '@/lib/model/accounts'
import { dollars, signedDollars } from '@/lib/model/money'
import { Segmented } from '@/components/shared/Layout'
import { Sheet } from '@/components/shared/Sheet'
import { useWorthBaseline } from '@/lib/ledger/useLedger'
import { cn } from '@/lib/utils'

export type WorthView = 'assets' | 'debts' | 'net'

const VIEWS: ReadonlyArray<{ value: WorthView; label: string }> = [
  { value: 'assets', label: 'Have' },
  { value: 'debts', label: 'Owe' },
  { value: 'net', label: 'Net worth' },
]

const pct = (part: number, whole: number | null) =>
  whole && whole > 0 ? `${Math.round((part / whole) * 100)}%` : ''

export function WorthSheet({
  ledger,
  history,
  today,
  initial,
  onOpenAccount,
  onClose,
}: {
  ledger: Ledger
  history: WorthHistory | null
  today: string
  initial: WorthView
  onOpenAccount: (name: string) => void
  onClose: () => void
}) {
  const [view, setView] = useState<WorthView>(initial)
  const worth = useMemo(() => netWorth(ledger), [ledger])
  const assets = useMemo(() => worthParts(ledger, 'assets'), [ledger])
  const debts = useMemo(() => worthParts(ledger, 'debts'), [ledger])
  return (
    <Sheet title="What makes up net worth" onClose={onClose}>
      <Segmented
        label="Which figure"
        value={view}
        options={VIEWS}
        onChange={setView}
      />
      {view === 'net' ? (
        <>
          <Equation have={worth.assets} owe={worth.debts} net={worth.net} />
          <Parts
            title="By group"
            parts={[
              ...assets.map((p) => ({ ...p, sign: 1 as const })),
              ...debts.map((p) => ({ ...p, sign: -1 as const })),
            ].sort((a, b) => b.total - a.total)}
            whole={null}
            onOpenAccount={onOpenAccount}
          />
          {history && <Baseline history={history} today={today} />}
        </>
      ) : (
        <>
          <p className="text-3xl font-extrabold tracking-tight tabular-nums">
            {dollars(view === 'assets' ? worth.assets : worth.debts)}
          </p>
          <Parts
            title={view === 'assets' ? 'What you have' : 'What you owe'}
            parts={(view === 'assets' ? assets : debts).map((p) => ({
              ...p,
              sign: view === 'assets' ? (1 as const) : (-1 as const),
            }))}
            whole={view === 'assets' ? worth.assets : worth.debts}
            onOpenAccount={onOpenAccount}
          />
        </>
      )}
    </Sheet>
  )
}

/** Have − Owe = Net worth, as two bars on one scale. */
function Equation({
  have,
  owe,
  net,
}: {
  have: number
  owe: number
  net: number
}) {
  const scale = Math.max(have, owe, 1)
  const rows = [
    { label: 'Have', value: have, color: 'bg-accent', text: dollars(have) },
    { label: 'Owe', value: owe, color: 'bg-over', text: `−${dollars(owe)}` },
  ]
  return (
    <section className="space-y-2 rounded-xl border border-border bg-surface p-3">
      {rows.map((r) => (
        <div key={r.label} className="space-y-1">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-muted">{r.label}</span>
            <span className="font-semibold tabular-nums">{r.text}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-sunken">
            <div
              className={cn('h-2 rounded-full', r.color)}
              style={{ width: `${(Math.max(r.value, 0) / scale) * 100}%` }}
            />
          </div>
        </div>
      ))}
      <div className="flex items-baseline justify-between border-t border-border pt-2">
        <span className="text-[13px] font-semibold">Net worth</span>
        <span
          className={cn(
            'text-xl font-extrabold tracking-tight tabular-nums',
            net < 0 && 'text-over',
          )}
        >
          {dollars(net)}
        </span>
      </div>
    </section>
  )
}

/**
 * Groups as bars on one scale (the largest fills the row), each with its
 * share of `whole`; tap one for its Accounts.
 */
function Parts({
  title,
  parts,
  whole,
  onOpenAccount,
}: {
  title: string
  parts: Array<WorthPart & { sign: 1 | -1 }>
  /** What shares are of; null for no shares (net worth's two sides). */
  whole: number | null
  onOpenAccount: (name: string) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const scale = Math.max(...parts.map((p) => p.total), 1)
  if (!parts.length)
    return <p className="text-sm text-muted">No balances here yet.</p>
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <h2 className="border-b border-border px-3 py-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
        {title}
      </h2>
      <ul className="divide-y divide-border">
        {parts.map((p) => {
          const key = `${p.sign}${p.title}`
          const expanded = open === key
          const color = p.sign > 0 ? 'bg-accent' : 'bg-over'
          return (
            <li key={key}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : key)}
                className="flex min-h-11 w-full flex-col gap-1 px-3 py-2 text-left hover:bg-sunken"
              >
                <span className="flex w-full items-baseline gap-2 text-[13px]">
                  {expanded ? (
                    <ChevronDown size={13} className="shrink-0 text-muted" />
                  ) : (
                    <ChevronRight size={13} className="shrink-0 text-muted" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {p.title}
                  </span>
                  <span className="text-[11px] text-muted tabular-nums">
                    {pct(p.total, whole)}
                  </span>
                  <span className="w-24 text-right font-semibold tabular-nums">
                    {p.sign < 0 ? '−' : ''}
                    {dollars(p.total)}
                  </span>
                </span>
                <span className="block h-1.5 w-full rounded-full bg-sunken">
                  <span
                    className={cn('block h-1.5 rounded-full', color)}
                    style={{
                      width: `${(Math.max(p.total, 0) / scale) * 100}%`,
                    }}
                  />
                </span>
              </button>
              {expanded && (
                <ul className="bg-background/60 pb-1">
                  {p.accounts.map(({ account, amount }) => (
                    <li key={account.name}>
                      <button
                        type="button"
                        onClick={() => onOpenAccount(account.name)}
                        className="flex min-h-11 w-full flex-col gap-1 py-1.5 pr-3 pl-8 text-left hover:bg-sunken"
                      >
                        <span className="flex w-full items-baseline gap-2 text-[13px]">
                          <span className="min-w-0 flex-1 truncate">
                            {account.name}
                          </span>
                          <span className="text-[11px] text-muted tabular-nums">
                            {pct(amount, whole)}
                          </span>
                          <span className="w-24 text-right tabular-nums">
                            {p.sign < 0 ? '−' : ''}
                            {dollars(amount)}
                          </span>
                        </span>
                        <span className="block h-1 w-full rounded-full bg-sunken">
                          <span
                            className={cn('block h-1 rounded-full', color)}
                            style={{
                              width: `${(Math.max(amount, 0) / scale) * 100}%`,
                              opacity: 0.7,
                            }}
                          />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** "Oct 8", with the year when it isn't this one. */
export function dayWithYear(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  return date.slice(0, 4) === today.slice(0, 4) ? label : `${label}, ${y}`
}

/**
 * The day net worth history counts from, its change since, and a way to
 * set it: a day of your choosing, or automatic (the first day every open
 * Account had a balance).
 */
export function Baseline({
  history,
  today,
}: {
  history: WorthHistory
  today: string
}) {
  const save = useWorthBaseline()
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(history.baseline)
  const change = history.now - history.start
  return (
    <section className="space-y-2 rounded-xl border border-border bg-surface p-3 text-[13px]">
      <div className="flex items-baseline justify-between gap-2">
        <span>
          <span className="text-muted">
            Since {dayWithYear(history.baseline, today)}
            {history.auto ? ' (automatic)' : ''}
          </span>{' '}
          <span
            className={cn(
              'font-semibold tabular-nums',
              change < 0 && 'text-over',
            )}
          >
            {signedDollars(change)}
          </span>
        </span>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setDate(history.baseline)
              setEditing(true)
            }}
            className="shrink-0 font-semibold text-accent"
          >
            Change
          </button>
        )}
      </div>
      {history.late.length > 0 && (
        <p className="text-xs text-muted">
          {history.late.length === 1
            ? `${history.late[0]} has no balance before this date, so adding it counts as growth.`
            : `${history.late.length} accounts have no balance before this date, so adding them counts as growth.`}
        </p>
      )}
      {editing && (
        <div className="space-y-2 border-t border-border pt-2">
          <p className="text-xs text-muted">
            Net worth history starts here. Pick the day your accounts were all
            set up.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Baseline date"
              className="field min-h-11"
            />
            <button
              type="button"
              disabled={!date || save.isPending}
              onClick={() => {
                save.mutate({ date })
                setEditing(false)
              }}
              className="min-h-11 rounded-full bg-accent px-4 font-semibold text-surface disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => {
                save.mutate({ date: today })
                setEditing(false)
              }}
              className="min-h-11 rounded-full bg-sunken px-4 font-semibold disabled:opacity-50"
            >
              Today
            </button>
            {!history.auto && (
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => {
                  save.mutate({ date: null })
                  setEditing(false)
                }}
                className="min-h-11 rounded-full bg-sunken px-4 font-semibold disabled:opacity-50"
              >
                Automatic
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="min-h-11 px-2 text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {save.error && (
        <p className="text-xs text-over">Couldn’t save. Try again.</p>
      )}
    </section>
  )
}
