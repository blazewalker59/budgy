/**
 * Accounts: every card, bank, investment, retirement and 529 account the
 * Household has, each with its latest Balance, grouped by kind, and net
 * worth over time. Tapping one opens its sheet: details, today's balance,
 * its history (importable on first setup) and its purchases.
 */

import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Plus, Upload } from 'lucide-react'
import { AccountSheet } from './AccountSheet'
import type { Account, AccountKind } from '@/lib/model/types'
import { useBook } from '@/lib/ledger/book'
import { useSaveAccount } from '@/lib/ledger/useLedger'
import {
  activity,
  isDebt,
  latestBalances,
  netWorth,
  netWorthByMonth,
  ownerNames,
} from '@/lib/model/accounts'
import { ACCOUNT_KINDS, ACCOUNT_KIND_LABELS, OWNERS } from '@/lib/model/types'
import { dayLabel, daysBetween, monthRange } from '@/lib/model/dates'
import { dollars } from '@/lib/model/money'
import { ownerColor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Stat } from '@/components/shared/Layout'
import { WorthChart } from '@/components/charts/lazy'

const GROUPS: Array<{ title: string; kinds: Array<AccountKind> }> = [
  { title: 'Cash', kinds: ['checking', 'savings'] },
  { title: 'Credit cards', kinds: ['credit'] },
  { title: 'Investments', kinds: ['brokerage'] },
  { title: 'Retirement', kinds: ['retirement'] },
  { title: 'Education', kinds: ['education'] },
  { title: 'Loans', kinds: ['loan'] },
  { title: 'Other', kinds: ['other'] },
]

/** A Balance older than this is worth updating. */
const STALE_DAYS = 35

export function AccountsScreen() {
  const book = useBook()
  const ledger = book.ix.ledger
  const [sheet, setSheet] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const latest = useMemo(
    () => latestBalances(ledger.balances),
    [ledger.balances],
  )
  const reach = useMemo(() => activity(ledger), [ledger])
  const worth = useMemo(() => netWorth(ledger), [ledger])
  const history = useMemo(() => {
    const first = ledger.balances[0]?.date.slice(0, 7)
    if (!first) return []
    const now = book.today.slice(0, 7)
    const months = monthRange(now, 600).filter((m) => m >= first)
    return netWorthByMonth(ledger, months).map((m) => ({
      month: m.month,
      value: m.net,
    }))
  }, [ledger, book.today])

  const open = ledger.accounts.filter((a) => !a.closed)
  const closed = ledger.accounts.filter((a) => a.closed)
  const row = (a: Account) => (
    <AccountRow
      key={a.name}
      account={a}
      balance={latest.get(a.name)}
      lastPurchase={reach.get(a.name)?.last}
      today={book.today}
      onOpen={() => setSheet(a.name)}
    />
  )

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold tracking-tight">Accounts</h1>
        <Link
          to="/import"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold"
        >
          <Upload size={13} aria-hidden /> Import purchases
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Have" value={dollars(worth.assets)} />
        <Stat label="Owe" value={dollars(worth.debts)} />
        <Stat
          label="Net worth"
          value={dollars(worth.net)}
          tone={worth.net < 0 ? 'over' : undefined}
        />
      </div>
      {history.length > 1 && <WorthChart points={history} label="Net worth" />}

      {GROUPS.map((g) => {
        const list = open.filter((a) => g.kinds.includes(a.kind))
        if (!list.length) return null
        const total = list.reduce(
          (n, a) => n + (latest.get(a.name)?.amount ?? 0),
          0,
        )
        return (
          <section
            key={g.title}
            className="overflow-hidden rounded-xl border border-border bg-surface"
          >
            <div className="flex items-baseline justify-between border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <span>{g.title}</span>
              <span className="tabular-nums">
                {isDebt(list[0]) ? 'owed ' : ''}
                {dollars(total)}
              </span>
            </div>
            <ul className="divide-y divide-border">{list.map(row)}</ul>
          </section>
        )
      })}

      {closed.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <button
            type="button"
            onClick={() => setShowClosed(!showClosed)}
            className="w-full px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted"
          >
            {showClosed ? 'Hide' : 'Show'} {closed.length} closed
          </button>
          {showClosed && (
            <ul className="divide-y divide-border border-t border-border opacity-70">
              {closed.map(row)}
            </ul>
          )}
        </section>
      )}

      <AddAccount onAdded={setSheet} />
      {sheet && <AccountSheet name={sheet} onClose={() => setSheet(null)} />}
    </div>
  )
}

function AccountRow({
  account: a,
  balance,
  lastPurchase,
  today,
  onOpen,
}: {
  account: Account
  balance?: { date: string; amount: number }
  lastPurchase?: string
  today: string
  onOpen: () => void
}) {
  const stale = balance && daysBetween(balance.date, today) > STALE_DAYS
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-3 py-1.5 text-left text-[13px] hover:bg-sunken"
      >
        <span className="flex min-w-0 items-center gap-1.5 font-semibold">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: ownerColor(a.owner) }}
          />
          <span className="truncate">{a.name}</span>
          <ChevronRight size={13} className="shrink-0 text-muted" aria-hidden />
        </span>
        <span className="text-right font-semibold tabular-nums">
          {balance ? dollars(balance.amount) : ''}
        </span>
        <span className="truncate text-[11px] text-muted">
          {[
            a.owner,
            a.institution,
            lastPurchase && `last purchase ${dayLabel(lastPurchase)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span
          className={cn(
            'text-right text-[11px]',
            !balance
              ? 'font-semibold text-accent'
              : stale
                ? 'text-nice'
                : 'text-muted',
          )}
        >
          {balance ? `as of ${dayLabel(balance.date)}` : 'Add balance'}
        </span>
      </button>
    </li>
  )
}

function AddAccount({ onAdded }: { onAdded: (name: string) => void }) {
  const { ix } = useBook()
  const saveAccount = useSaveAccount()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountKind>('checking')
  const [owner, setOwner] = useState('Joint')
  const [institution, setInstitution] = useState('')
  const taken = ix.ledger.accounts.some(
    (a) => a.name.toLowerCase() === name.trim().toLowerCase(),
  )
  return (
    <form
      className="space-y-1.5 rounded-xl border border-dashed border-border p-2"
      onSubmit={(e) => {
        e.preventDefault()
        const n = name.trim()
        if (!n || taken) return
        saveAccount.mutate({
          name: n,
          kind,
          owner: owner.trim() || 'Joint',
          institution: institution.trim() || null,
          closed: false,
          isNew: true,
        })
        setName('')
        setInstitution('')
        onAdded(n)
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New account, e.g. 401(k)"
          maxLength={60}
          aria-label="New account name"
          className="field min-w-40 flex-1"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as AccountKind)}
          aria-label="Kind"
          className="field"
        >
          {ACCOUNT_KINDS.map((k) => (
            <option key={k} value={k}>
              {ACCOUNT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <OwnerInput value={owner} onChange={setOwner} className="w-28" />
        <input
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
          placeholder="Institution"
          maxLength={60}
          aria-label="Institution"
          className="field min-w-28 flex-1"
        />
        <button
          type="submit"
          disabled={!name.trim() || taken}
          className="inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background disabled:opacity-40"
        >
          <Plus size={13} aria-hidden /> Add
        </button>
      </div>
      {taken && (
        <p className="text-[11px] text-over">
          There’s already an account with that name.
        </p>
      )}
    </form>
  )
}

/** Whose an Account is: the Household's names, or any other (a child's). */
export function OwnerInput({
  value,
  onChange,
  onBlur,
  className,
}: {
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  className?: string
}) {
  const { ix } = useBook()
  const names = ownerNames(ix.ledger.accounts, OWNERS)
  return (
    <>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        list="account-owners"
        maxLength={40}
        aria-label="Owner"
        placeholder="Owner"
        className={cn('field', className)}
      />
      <datalist id="account-owners">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </>
  )
}
