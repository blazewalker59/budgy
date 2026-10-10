/**
 * One Account, as a sheet over Accounts: whose it is and what kind, today's
 * balance, its balance by month, a history to import on first setup (so
 * growth shows from day one), every recorded balance, and its purchases.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, Trash2 } from 'lucide-react'
import { OwnerInput } from './AccountsScreen'
import type { Account, AccountKind } from '@/lib/model/types'
import type { ParsedHistory } from '@/lib/import/history'
import type { PostSummary } from '@/lib/ledger/server'
import { uploadPurchases } from '@/lib/ledger/server'
import { useBook } from '@/lib/ledger/book'
import {
  LEDGER_KEY,
  useDeleteAccount,
  useDeleteBalance,
  useRecordBalances,
  useRemoveStarting,
  useSaveAccount,
} from '@/lib/ledger/useLedger'
import { activity, balanceByMonth, equity, isDebt } from '@/lib/model/accounts'
import {
  guessDirection,
  parseBalanceHistory,
  purchasesFrom,
  rebuildBalances,
} from '@/lib/import/history'
import { ACCOUNT_KINDS, ACCOUNT_KIND_LABELS } from '@/lib/model/types'
import { dayLabel, monthLabel, monthRange } from '@/lib/model/dates'
import { dollars, parseDollars, signedDollars } from '@/lib/model/money'
import { everyTxn } from '@/lib/model/ledger'
import { cn } from '@/lib/utils'
import { Sheet } from '@/components/shared/Sheet'
import { WorthChart } from '@/components/charts/lazy'
import { UPDATES_KEY } from '@/lib/updates/useUpdates'

export function AccountSheet({
  name,
  onClose,
}: {
  name: string
  onClose: () => void
}) {
  const book = useBook()
  const ledger = book.ix.ledger
  const account = ledger.accounts.find((a) => a.name === name)
  const own = useMemo(
    () => ledger.balances.filter((b) => b.account === name),
    [ledger.balances, name],
  )
  const points = useMemo(() => {
    if (!own.length) return []
    const months = monthRange(book.today.slice(0, 7), 600).filter(
      (m) => m >= own[0].date.slice(0, 7),
    )
    return balanceByMonth(own, name, months).flatMap((v, i) =>
      v === null ? [] : [{ month: months[i], value: v }],
    )
  }, [own, name, book.today])
  const reach = useMemo(() => activity(ledger).get(name), [ledger, name])
  const deleteAccount = useDeleteAccount()

  if (!account) return null
  const debt = isDebt(account)
  return (
    <Sheet title={name} onClose={onClose}>
      <Details
        account={account}
        onDelete={
          reach
            ? undefined
            : () => {
                deleteAccount.mutate({ name })
                onClose()
              }
        }
      />
      {account.kind === 'property' && <EquityLine name={name} />}
      <UpdateBalance account={account} today={book.today} />
      {['credit', 'checking', 'savings'].includes(account.kind) && (
        <p className="px-1 text-xs text-muted">
          For routine purchase updates, use{' '}
          <Link
            to="/accounts"
            search={{ tab: 'updates' }}
            onClick={onClose}
            className="font-semibold text-accent"
          >
            Account Updates
          </Link>
          . No balance is needed. The history importer below remains available
          for balance backfills.
        </p>
      )}
      {points.length > 1 && (
        <WorthChart
          points={points}
          label={debt ? 'Owed' : 'Balance'}
          color={debt ? 'var(--color-over)' : undefined}
        />
      )}
      <ImportHistory
        account={account}
        hasHistory={own.length > 0}
        today={book.today}
      />
      {own.length > 0 && <BalanceList account={account} rows={own} />}
      {reach && (
        <p className="px-1 text-xs text-muted">
          {reach.purchases} purchases, {dayLabel(reach.first)} ’
          {reach.first.slice(2, 4)} to {dayLabel(reach.last)}.{' '}
          <Link
            to="/spending"
            search={{ accounts: [name] }}
            className="font-semibold text-accent"
          >
            See them in Spending
          </Link>
        </p>
      )}
      <StartingHere name={name} />
    </Sheet>
  )
}

/** Owner, kind, institution, and closing (which records a final zero). */
function Details({
  account,
  onDelete,
}: {
  account: Account
  /** Only for an Account without purchases. */
  onDelete?: () => void
}) {
  const { today } = useBook()
  const { ix } = useBook()
  const saveAccount = useSaveAccount()
  const recordBalances = useRecordBalances()
  const properties = ix.ledger.accounts.filter(
    (a) => a.kind === 'property' && !a.closed,
  )
  const [owner, setOwner] = useState(account.owner)
  const [institution, setInstitution] = useState(account.institution ?? '')
  const save = (patch: Partial<Account>) => {
    const { sourceName: _s, ...rest } = account
    saveAccount.mutate({ ...rest, ...patch, isNew: false })
  }
  return (
    <section className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs">
      <select
        value={account.kind}
        onChange={(e) => save({ kind: e.target.value as AccountKind })}
        aria-label="Kind"
        className="field"
      >
        {ACCOUNT_KINDS.map((k) => (
          <option key={k} value={k}>
            {ACCOUNT_KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <OwnerInput
        value={owner}
        onChange={setOwner}
        onBlur={() =>
          owner.trim() && owner.trim() !== account.owner
            ? save({ owner: owner.trim() })
            : setOwner(account.owner)
        }
        className="w-24"
      />
      <input
        value={institution}
        onChange={(e) => setInstitution(e.target.value)}
        onBlur={() =>
          institution.trim() !== (account.institution ?? '') &&
          save({ institution: institution.trim() || null })
        }
        placeholder="Institution"
        maxLength={60}
        aria-label="Institution"
        className="field min-w-24 flex-1"
      />
      {account.kind === 'loan' && properties.length > 0 && (
        <label className="flex items-center gap-1 text-muted">
          Against
          <select
            value={account.securedBy ?? ''}
            onChange={(e) => save({ securedBy: e.target.value || null })}
            aria-label="The property this loan is against"
            className="field text-foreground"
          >
            <option value="">Nothing</option>
            {properties.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex items-center gap-1 text-muted">
        <input
          type="checkbox"
          checked={account.closed}
          onChange={(e) => {
            save({ closed: e.target.checked })
            if (e.target.checked)
              recordBalances.mutate({
                balances: [{ account: account.name, date: today, amount: 0 }],
              })
          }}
        />
        Closed
      </label>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1 rounded px-1 text-muted hover:text-over"
        >
          <Trash2 size={13} aria-hidden /> Delete
        </button>
      )}
    </section>
  )
}

function balanceLabel(account: Account): string {
  if (account.kind === 'property') return 'Estimated value'
  return isDebt(account) ? 'Balance owed' : 'Balance'
}

/** A property's value, the loans against it, and the equity left. */
function EquityLine({ name }: { name: string }) {
  const { ix } = useBook()
  const e = equity(ix.ledger).find((x) => x.property === name)
  if (!e) return null
  return (
    <p className="px-1 text-xs text-muted">
      {e.loans.length ? (
        <>
          Value {dollars(e.value)} − owed {dollars(e.owed)} (
          {e.loans.join(', ')}) ={' '}
          <strong className="text-foreground">
            equity {dollars(e.equity)}
          </strong>
        </>
      ) : (
        'Add the loan against it as a Loan account, then pick this property as what it’s against.'
      )}
    </p>
  )
}

function UpdateBalance({
  account,
  today,
}: {
  account: Account
  today: string
}) {
  const recordBalances = useRecordBalances()
  const [date, setDate] = useState(today)
  const [amount, setAmount] = useState('')
  const cents = parseDollars(amount)
  return (
    <form
      className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault()
        if (cents === null) return
        recordBalances.mutate({
          balances: [{ account: account.name, date, amount: cents }],
        })
        setAmount('')
      }}
    >
      <span className="font-semibold">{balanceLabel(account)}</span>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        placeholder="$0.00"
        aria-label="Balance"
        className="field w-28 text-right tabular-nums"
      />
      <label className="flex items-center gap-1 text-muted">
        on
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          aria-label="As of"
          className="field text-foreground"
        />
      </label>
      <button
        type="submit"
        disabled={cents === null}
        className="ml-auto rounded-full bg-foreground px-3 py-1 font-semibold text-background disabled:opacity-40"
      >
        Save
      </button>
    </form>
  )
}

/**
 * The Account's export: its balance history (a CSV, or two columns pasted
 * from a spreadsheet), or its transactions export, whose balances are
 * worked back from one balance the Member knows and whose spending becomes
 * the Account's purchases. Shown before it's saved; it can replace the
 * Account's earlier balances, and the starting purchases over its dates.
 */
function ImportHistory({
  account,
  hasHistory,
  today,
}: {
  account: Account
  hasHistory: boolean
  today: string
}) {
  const { ix } = useBook()
  const queryClient = useQueryClient()
  const recordBalances = useRecordBalances()
  const [open, setOpen] = useState(!hasHistory)
  const [text, setText] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const [replace, setReplace] = useState(true)
  const [knownDate, setKnownDate] = useState(today)
  const [known, setKnown] = useState('')
  const [flip, setFlip] = useState(false)
  const [addPurchases, setAddPurchases] = useState(true)
  const [replaceStarting, setReplaceStarting] = useState(true)
  const [preview, setPreview] = useState<PostSummary | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const parsed: ParsedHistory | null = useMemo(
    () => (text.trim() ? parseBalanceHistory(text) : null),
    [text],
  )
  const debt = isDebt(account)
  const knownCents = parseDollars(known)
  // The transactions in it: the whole export, or alongside its balances.
  const txnPart =
    parsed?.kind === 'transactions' ? parsed : (parsed?.changes ?? null)
  const direction = txnPart
    ? ((guessDirection(txnPart, debt) * (flip ? -1 : 1)) as 1 | -1)
    : 1
  const rows = useMemo(() => {
    if (!parsed) return []
    if (parsed.kind === 'balances') return parsed.rows
    if (knownCents === null) return []
    return rebuildBalances(parsed.changes, direction, {
      date: knownDate,
      amount: knownCents,
    })
  }, [parsed, knownCents, knownDate, direction])
  const purchases = useMemo(
    () => (txnPart ? purchasesFrom(txnPart, direction, debt) : null),
    [txnPart, direction, debt],
  )
  const bought = useMemo(() => purchases?.rows ?? [], [purchases])
  // Starting purchases over the export's dates, which it can replace.
  const startingHere = useMemo(() => {
    if (!bought.length) return 0
    const dates = bought.map((r) => r.date).sort()
    return everyTxn(ix).filter(
      (t) =>
        t.starting &&
        t.account === account.name &&
        t.date >= dates[0] &&
        t.date <= dates[dates.length - 1],
    ).length
  }, [bought, ix, account.name])
  const replacing = startingHere > 0 && replaceStarting
  const uncategorized =
    preview?.filed.filter((f) => f.how === 'uncategorized').length ?? 0

  // What adding them would do, asked of the server as the export changes.
  useEffect(() => {
    setPreview(null)
    setProblem(null)
    if (!bought.length) return
    let current = true
    uploadPurchases({
      data: {
        account: account.name,
        rows: bought,
        commit: false,
        replaceStarting: replacing,
      },
    }).then(
      (summary) => current && setPreview(summary),
      (error: unknown) =>
        current &&
        setProblem(
          error instanceof Error ? error.message : 'Could not read it.',
        ),
    )
    return () => {
      current = false
    }
  }, [bought, replacing, account.name])

  const posting = addPurchases && preview !== null && bought.length > 0
  const save = async () => {
    setSaving(true)
    const said: Array<string> = []
    try {
      if (rows.length) {
        await recordBalances.mutateAsync({
          balances: rows.map((r) => ({ account: account.name, ...r })),
          replace: hasHistory && replace ? account.name : undefined,
        })
        said.push(`${rows.length} balances`)
      }
      if (posting) {
        const summary = await uploadPurchases({
          data: {
            account: account.name,
            rows: bought,
            commit: true,
            replaceStarting: replacing,
          },
        })
        await queryClient.invalidateQueries({ queryKey: LEDGER_KEY })
        await queryClient.invalidateQueries({ queryKey: UPDATES_KEY })
        said.push(
          `${summary.added} purchases${summary.replaced ? ` (in place of ${summary.replaced} starting ones)` : ''}`,
        )
      }
      setDone(`Saved ${said.join(' and ')}.`)
      setText('')
      setKnown('')
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not save it.')
    } finally {
      setSaving(false)
    }
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 px-1 text-xs font-semibold text-accent"
      >
        <FileUp size={13} aria-hidden /> Upload an export
      </button>
    )
  const span = (r: Array<{ date: string }>) =>
    `${monthLabel(r[0].date.slice(0, 7))} to ${monthLabel(r[r.length - 1].date.slice(0, 7))}`
  return (
    <section className="space-y-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Upload an export</h2>
        <label className="inline-flex cursor-pointer items-center gap-1 font-semibold text-accent">
          <FileUp size={13} aria-hidden /> Choose CSV
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) {
                setText(await f.text())
                setDone(null)
              }
              e.target.value = ''
            }}
          />
        </label>
      </div>
      <p className="text-muted">
        The institution’s transactions export: its spending becomes this
        account’s purchases, and its balances are worked out from one you know.
        Or a balance history: a date and a balance on each line.
      </p>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDone(null)
        }}
        rows={3}
        placeholder={'2024-01-31, 41,250.00\n2024-02-29, 42,010.55\n…'}
        aria-label="Balance history"
        className="field w-full font-mono text-[11px]"
      />

      {parsed?.kind === 'balances' && (
        <p className={cn(rows.length ? 'text-foreground' : 'text-over')}>
          {rows.length
            ? `${rows.length} balances, ${span(rows)}: ${dollars(rows[0].amount)} → ${dollars(rows[rows.length - 1].amount)}`
            : 'No dates and balances found.'}
          {parsed.column && (
            <span className="text-muted"> (from “{parsed.column}”)</span>
          )}
          {parsed.skipped > 0 && (
            <span className="text-muted">
              {' '}
              · {parsed.skipped} lines skipped
            </span>
          )}
        </p>
      )}

      {parsed?.kind === 'transactions' && (
        <div className="space-y-1.5 rounded-lg bg-sunken px-2 py-1.5">
          <p>
            <strong>
              {parsed.changes.length} transactions, {span(parsed.changes)}
            </strong>{' '}
            <span className="text-muted">(from “{parsed.column}”)</span>. A
            transactions export, not balances: enter one balance you know and
            the rest are worked back from it.
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold">{balanceLabel(account)}</span>
            <input
              value={known}
              onChange={(e) => setKnown(e.target.value)}
              inputMode="decimal"
              placeholder="$0.00"
              aria-label="A balance you know"
              className="field w-28 text-right tabular-nums"
            />
            <label className="flex items-center gap-1 text-muted">
              on
              <input
                type="date"
                value={knownDate}
                max={today}
                onChange={(e) => e.target.value && setKnownDate(e.target.value)}
                aria-label="Known balance date"
                className="field text-foreground"
              />
            </label>
          </div>
          <p className="text-muted">
            Reading{' '}
            {parsed.split
              ? 'credits as money in'
              : `${direction === 1 ? 'positive' : 'negative'} amounts as ${debt ? 'adding to what’s owed' : 'money in'}`}
            .{' '}
            {!parsed.split && (
              <button
                type="button"
                onClick={() => setFlip(!flip)}
                className="font-semibold text-accent"
              >
                Backwards? Flip it
              </button>
            )}
          </p>
          {rows.length > 1 && (
            <ul className="grid grid-cols-2 gap-x-3 tabular-nums sm:grid-cols-3">
              {rows
                .slice(-6)
                .reverse()
                .map((r) => (
                  <li key={r.date} className="flex justify-between gap-2">
                    <span className="text-muted">
                      {dayLabel(r.date)} ’{r.date.slice(2, 4)}
                    </span>
                    <span>{dollars(r.amount)}</span>
                  </li>
                ))}
            </ul>
          )}
          {rows.length > 1 && (
            <p className="text-muted">
              Check one against a statement: if it’s off, the export may be
              missing transactions or the direction is backwards.
            </p>
          )}
        </div>
      )}

      {purchases && (
        <div className="space-y-1 rounded-lg bg-sunken px-2 py-1.5">
          <label className="flex items-center gap-1.5 font-semibold">
            <input
              type="checkbox"
              checked={addPurchases}
              onChange={(e) => setAddPurchases(e.target.checked)}
            />
            Add its purchases
          </label>
          <p className="text-muted">
            {bought.length} spending rows
            {[
              purchases.moving && `${purchases.moving} payments and transfers`,
              purchases.moneyIn && `${purchases.moneyIn} deposits`,
              purchases.unnamed && `${purchases.unnamed} without a description`,
            ]
              .filter(Boolean)
              .map((x) => `, ${x} left out`)
              .join('')}
            .
          </p>
          {parsed?.kind === 'balances' && txnPart && !txnPart.split && (
            <p className="text-muted">
              Reading {debt === (direction === 1) ? 'positive' : 'negative'}{' '}
              amounts as spending.{' '}
              <button
                type="button"
                onClick={() => setFlip(!flip)}
                className="font-semibold text-accent"
              >
                Backwards? Flip it
              </button>
            </p>
          )}
          {addPurchases && preview && (
            <p>
              <strong>{preview.added} new</strong>
              {[
                preview.alreadyHad && `${preview.alreadyHad} already here`,
                preview.duplicates.length &&
                  `${preview.duplicates.length} match one already here that day`,
                preview.notSpending && `${preview.notSpending} not spending`,
              ]
                .filter(Boolean)
                .map((x) => `, ${x}`)
                .join('')}
              .{' '}
              {uncategorized > 0 && (
                <span className="text-muted">
                  {uncategorized === 1 ? '1 goes' : `${uncategorized} go`} to
                  Uncategorized, to Move later.
                </span>
              )}
            </p>
          )}
          {addPurchases && startingHere > 0 && (
            <label className="flex items-start gap-1.5 text-muted">
              <input
                type="checkbox"
                checked={replaceStarting}
                onChange={(e) => setReplaceStarting(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Replace the {startingHere} starting purchases over these dates
                (from the first bulk import). Their stores, categories, Moves
                and notes carry over
                {preview?.carried ? ` (${preview.carried})` : ''}.
              </span>
            </label>
          )}
        </div>
      )}
      {problem && <p className="font-medium text-over">{problem}</p>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {hasHistory && rows.length > 0 && (
          <label className="mr-auto flex items-center gap-1 text-muted">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
            />
            Replace the balances already here
          </label>
        )}
        {done !== null && (
          <span className="font-semibold text-accent">{done}</span>
        )}
        <button
          type="button"
          disabled={saving || (!rows.length && !posting)}
          onClick={() => void save()}
          className="rounded-full bg-foreground px-3 py-1 font-semibold text-background disabled:opacity-40"
        >
          {saving
            ? 'Saving…'
            : `Save ${[
                rows.length && `${rows.length} balances`,
                posting && `${preview.added} purchases`,
              ]
                .filter(Boolean)
                .join(' and ')}`}
        </button>
      </div>
    </section>
  )
}

/** This Account's starting purchases still here, and taking them out. */
function StartingHere({ name }: { name: string }) {
  const { ix } = useBook()
  const removeStarting = useRemoveStarting()
  const [confirm, setConfirm] = useState(false)
  const n = useMemo(
    () => everyTxn(ix).filter((t) => t.starting && t.account === name).length,
    [ix, name],
  )
  if (!n) return null
  return (
    <p className="px-1 text-xs text-muted">
      {n} of them are still from the first bulk import; uploading this account’s
      export replaces those over its dates.{' '}
      <button
        type="button"
        onClick={() => {
          if (!confirm) return setConfirm(true)
          removeStarting.mutate({ account: name })
          setConfirm(false)
        }}
        onBlur={() => setConfirm(false)}
        className="font-semibold text-over"
      >
        {confirm ? `Remove ${n}? Tap again` : `Remove them`}
      </button>
    </p>
  )
}

function BalanceList({
  account,
  rows,
}: {
  account: Account
  rows: Array<{ date: string; amount: number }>
}) {
  const deleteBalance = useDeleteBalance()
  const recordBalances = useRecordBalances()
  const [all, setAll] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const newest = [...rows].reverse()
  const shown = all ? newest : newest.slice(0, 6)
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface text-[13px]">
      <ul className="divide-y divide-border tabular-nums">
        {shown.map((b, i) => {
          const before = newest[newest.indexOf(b) + 1]
          return (
            <li
              key={b.date}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-3 px-3 py-1"
            >
              <span>
                {dayLabel(b.date)} ’{b.date.slice(2, 4)}
              </span>
              <span className="text-right font-semibold">
                {dollars(b.amount)}
              </span>
              <span className="w-20 text-right text-[11px] text-muted">
                {before ? signedDollars(b.amount - before.amount) : ''}
              </span>
              <button
                type="button"
                onClick={() =>
                  deleteBalance.mutate({ account: account.name, date: b.date })
                }
                aria-label={`Remove the ${dayLabel(b.date)} balance`}
                className={cn(
                  'rounded p-0.5 text-muted hover:text-over',
                  i > 0 && 'opacity-60',
                )}
              >
                <Trash2 size={13} aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
      <div className="flex border-t border-border text-xs font-semibold">
        {newest.length > 6 && (
          <button
            type="button"
            onClick={() => setAll(!all)}
            className="flex-1 py-1.5 text-accent"
          >
            {all ? 'Show fewer' : `Show all ${newest.length}`}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (!confirm) return setConfirm(true)
            recordBalances.mutate({ balances: [], replace: account.name })
            setConfirm(false)
          }}
          onBlur={() => setConfirm(false)}
          className={cn(
            'flex-1 py-1.5',
            confirm ? 'text-over' : 'text-muted hover:text-over',
          )}
        >
          {confirm
            ? `Tap again to clear all ${newest.length}`
            : 'Clear history'}
        </button>
      </div>
    </section>
  )
}
