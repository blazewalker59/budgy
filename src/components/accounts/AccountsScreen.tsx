/**
 * Accounts: every card, bank, investment, retirement and 529 account the
 * Household has, each with its latest Balance, grouped by kind, and net
 * worth over time. Tapping one opens its sheet: details, today's balance,
 * its history and purchases (uploaded from its export). The Rules tab
 * says where each Store's purchases are filed.
 */

import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight, Plus } from 'lucide-react'
import { AccountSheet } from './AccountSheet'
import { AccountUpdates } from './AccountUpdates'
import { Baseline, WorthSheet, dayWithYear } from './WorthSheet'
import { RulesTab } from './RulesTab'
import type { WorthView } from './WorthSheet'
import type { Account, AccountKind } from '@/lib/model/types'
import type { Lens } from '@/lib/model/lens'
import type { Equity } from '@/lib/model/accounts'
import { Duplicates } from '@/components/accounts/Duplicates'
import { filtersOf } from '@/lib/model/lens'
import { LensBar } from '@/components/lens/LensBar'
import { useBook } from '@/lib/ledger/book'
import { useRemoveStarting, useSaveAccount } from '@/lib/ledger/useLedger'
import {
  ACCOUNT_GROUPS,
  activity,
  equity,
  isDebt,
  latestBalances,
  netWorth,
  ownerNames,
  worthHistory,
} from '@/lib/model/accounts'
import { ACCOUNT_KINDS, ACCOUNT_KIND_LABELS } from '@/lib/model/types'
import { useHousehold } from '@/lib/households/useHousehold'
import { dayLabel, daysBetween } from '@/lib/model/dates'
import { dollars, shortDollars, signedDollars } from '@/lib/model/money'
import { everyTxn } from '@/lib/model/ledger'
import { ownerColor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Segmented, Stat } from '@/components/shared/Layout'
import { WorthChart } from '@/components/charts/lazy'
import { Dropdown } from '@/components/shared/Dropdown'

/** A Balance older than this is worth updating. */
const STALE_DAYS = 35

type Tab = 'accounts' | 'rules' | 'updates'

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'accounts', label: 'Accounts' },
  { value: 'updates', label: 'Updates' },
  { value: 'rules', label: 'Rules' },
]

export function AccountsScreen({ lens, tab }: { lens: Lens; tab: Tab }) {
  const navigate = useNavigate({ from: '/accounts' })
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold tracking-tight">
          {tab === 'rules'
            ? 'Store Rules'
            : tab === 'updates'
              ? 'Update Accounts'
              : 'Accounts'}
        </h1>
        <Segmented
          label="Accounts section"
          value={tab}
          options={TABS}
          onChange={(t) =>
            void navigate({
              search: (s) => ({
                ...s,
                tab: t === 'accounts' ? undefined : t,
              }),
            })
          }
        />
      </div>
      {tab === 'rules' ? (
        <RulesTab />
      ) : tab === 'updates' ? (
        <>
          <Duplicates />
          <AccountUpdates />
        </>
      ) : (
        <AccountsList lens={lens} />
      )}
    </div>
  )
}

function AccountsList({ lens }: { lens: Lens }) {
  const book = useBook()
  // Of the Lens, Accounts uses the people and the account types.
  const ledger = useMemo(() => {
    const all = book.ix.ledger
    if (!lens.people?.length && !lens.kinds?.length) return all
    return {
      ...all,
      accounts: all.accounts.filter(
        (a) =>
          (!lens.people?.length || lens.people.includes(a.owner)) &&
          (!lens.kinds?.length || lens.kinds.includes(a.kind)),
      ),
    }
  }, [book.ix.ledger, lens.people, lens.kinds])
  const others = filtersOf(lens).filter(
    (f) => f.type !== 'person' && f.type !== 'kind',
  ).length
  const [sheet, setSheet] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const latest = useMemo(
    () => latestBalances(ledger.balances),
    [ledger.balances],
  )
  const reach = useMemo(() => activity(ledger), [ledger])
  const worth = useMemo(() => netWorth(ledger), [ledger])
  const equities = useMemo(
    () => new Map(equity(ledger).map((e) => [e.property, e])),
    [ledger],
  )
  const history = useMemo(
    () => worthHistory(ledger, book.ix.ledger.baseline, book.today),
    [ledger, book.ix.ledger.baseline, book.today],
  )
  const [breakdown, setBreakdown] = useState<WorthView | null>(null)

  const open = ledger.accounts.filter((a) => !a.closed)
  const closed = ledger.accounts.filter((a) => a.closed)
  const row = (a: Account) => (
    <AccountRow
      key={a.name}
      account={a}
      balance={latest.get(a.name)}
      lastPurchase={reach.get(a.name)?.last}
      equity={equities.get(a.name)}
      today={book.today}
      onOpen={() => setSheet(a.name)}
    />
  )

  return (
    <>
      <LensBar
        page="/accounts"
        note={
          others ? 'Accounts uses only people and account types.' : undefined
        }
      />

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            { view: 'assets', label: 'Have', value: worth.assets },
            { view: 'debts', label: 'Owe', value: worth.debts },
            { view: 'net', label: 'Net worth', value: worth.net },
          ] as const
        ).map((s) => (
          <button
            key={s.view}
            type="button"
            onClick={() => setBreakdown(s.view)}
            aria-label={`${s.label} ${dollars(s.value)}: see what makes it up`}
            className="min-w-0 rounded-xl text-left active:scale-[0.98] transition-transform"
          >
            <Stat
              label={s.label}
              value={shortDollars(s.value)}
              tappable
              tone={s.view === 'net' && s.value < 0 ? 'over' : undefined}
            />
          </button>
        ))}
      </div>
      {history && history.points.length > 1 && (
        <WorthChart
          points={history.points}
          label="Net worth"
          headline={`${signedDollars(history.now - history.start)} since ${dayWithYear(history.baseline, book.today)}`}
        />
      )}
      {history && <Baseline history={history} today={book.today} />}

      {ACCOUNT_GROUPS.map((g) => {
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
                {g.kinds.includes('property')
                  ? `equity ${dollars(list.reduce((n, a) => n + (equities.get(a.name)?.equity ?? 0), 0))}`
                  : `${isDebt(list[0]) ? 'owed ' : ''}${dollars(total)}`}
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
      <StartingPurchases onOpen={setSheet} />
      {breakdown && (
        <WorthSheet
          ledger={ledger}
          history={history}
          today={book.today}
          initial={breakdown}
          onOpenAccount={setSheet}
          onClose={() => setBreakdown(null)}
        />
      )}
      {sheet && <AccountSheet name={sheet} onClose={() => setSheet(null)} />}
    </>
  )
}

/**
 * The starting purchases still here (from the whole-household export Budgy
 * started from), by Account: each Account's own upload replaces them over
 * its dates, and whatever's left can go.
 */
function StartingPurchases({ onOpen }: { onOpen: (name: string) => void }) {
  const { ix } = useBook()
  const removeStarting = useRemoveStarting()
  const [confirm, setConfirm] = useState(false)
  const byAccount = useMemo(() => {
    const by = new Map<string, number>()
    for (const t of everyTxn(ix))
      if (t.starting) by.set(t.account, (by.get(t.account) ?? 0) + 1)
    return [...by].sort((a, b) => b[1] - a[1])
  }, [ix])
  if (!byAccount.length) return null
  const total = byAccount.reduce((n, [, c]) => n + c, 0)
  return (
    <section className="space-y-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        Starting purchases
      </h2>
      <p className="text-muted">
        {total} purchases are still from the first bulk import.
      </p>
      <ol className="list-decimal space-y-0.5 pl-4 text-muted">
        <li>
          Open each account and upload its export. Categories and notes carry
          over.
        </li>
        <li>Remove whatever’s left.</li>
      </ol>
      <ul className="flex flex-wrap gap-1.5">
        {byAccount.map(([name, n]) => (
          <li key={name}>
            <button
              type="button"
              onClick={() => onOpen(name)}
              className="rounded-full border border-border bg-sunken px-2 py-0.5 font-semibold hover:border-accent"
            >
              {name} <span className="font-normal text-muted">{n}</span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          if (!confirm) return setConfirm(true)
          removeStarting.mutate({})
          setConfirm(false)
        }}
        onBlur={() => setConfirm(false)}
        className={cn(
          'rounded-full px-2 py-0.5 font-semibold',
          confirm ? 'bg-over text-background' : 'text-over',
        )}
      >
        {confirm
          ? `Remove all ${total}? Tap again`
          : `Remove all ${total} starting purchases`}
      </button>
    </section>
  )
}

function AccountRow({
  account: a,
  balance,
  lastPurchase,
  equity: e,
  today,
  onOpen,
}: {
  account: Account
  balance?: { date: string; amount: number }
  lastPurchase?: string
  equity?: Equity
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
            e && e.loans.length
              ? `owe ${dollars(e.owed)} · equity ${dollars(e.equity)}`
              : a.owner,
            a.institution,
            a.securedBy && `against ${a.securedBy}`,
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
          securedBy: null,
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
        <Dropdown<AccountKind>
          value={kind}
          onChange={setKind}
          label="Kind"
          options={ACCOUNT_KINDS.map((k) => ({
            value: k,
            label: ACCOUNT_KIND_LABELS[k],
          }))}
        />
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
  const household = useHousehold()
  const names = ownerNames(ix.ledger.accounts, [
    'Joint',
    ...(household.data?.members
      .map((m) => m.name?.split(' ')[0])
      .filter((name): name is string => Boolean(name)) ?? []),
  ])
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
