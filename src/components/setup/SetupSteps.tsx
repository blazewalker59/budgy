/**
 * Each setup step's own view: done here where it's quick (the Household,
 * Categories, sorting, Targets), or explained with a link to where it's
 * done (uploads, bills). Nothing here keeps its own idea of progress.
 */
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import type { SetupStep } from '@/lib/model/setup'
import type { Category } from '@/lib/model/types'
import { useBook } from '@/lib/ledger/book'
import { useHousehold } from '@/lib/households/useHousehold'
import {
  useHideCategory,
  useRenameCategory,
  useSetTargets,
} from '@/lib/ledger/useLedger'
import { categoryHistory } from '@/lib/model/month'
import { targetFor } from '@/lib/model/ledger'
import { unsortedShare } from '@/lib/model/sorting'
import { takeHome } from '@/lib/model/pay'
import { suggestPlans } from '@/lib/model/detect'
import { monthLabel, monthRange, shiftMonth } from '@/lib/model/dates'
import { dollars, parseDollars } from '@/lib/model/money'
import { CADENCE_LABELS, PAY_CADENCE_LABELS } from '@/lib/model/types'
import { TAG_BG } from '@/lib/format'
import { cn } from '@/lib/utils'
import { HouseholdSettings } from '@/components/households/HouseholdSettings'
import { InviteForm } from '@/components/households/HouseholdScreen'
import {
  BankConnections,
  SimplefinNote,
} from '@/components/accounts/BankConnections'
import { BankCategories } from '@/components/accounts/BankCategories'
import { PaySheet } from '@/components/budget/PaySheet'
import { UnsortedStores } from '@/components/setup/UnsortedStores'

export function SetupStepView({ step }: { step: SetupStep }) {
  switch (step) {
    case 'household':
      return <HouseholdStep />
    case 'partner':
      return <PartnerStep />
    case 'categories':
      return <CategoriesStep />
    case 'connect':
      return <ConnectStep />
    case 'history':
      return <HistoryStep />
    case 'sort':
      return <SortStep />
    case 'pay':
      return <PayStep />
    case 'targets':
      return <TargetsStep />
    case 'bills':
      return <BillsStep />
  }
}

const linkClass =
  'inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold'

function HouseholdStep() {
  const details = useHousehold()
  if (!details.data)
    return (
      <p role="status" className="text-sm text-muted">
        Loading…
      </p>
    )
  return (
    <HouseholdSettings
      key={details.data.household.id}
      household={details.data.household}
    />
  )
}

function PartnerStep() {
  const details = useHousehold()
  if (!details.data)
    return (
      <p role="status" className="text-sm text-muted">
        Loading…
      </p>
    )
  const { household, members, invites } = details.data
  const others = members.length - 1
  return (
    <div className="space-y-3">
      {others > 0 && (
        <p className="text-sm text-accent">
          {others === 1
            ? '1 other person is in your Household.'
            : `${others} other people are in your Household.`}
        </p>
      )}
      {invites.length > 0 && (
        <p className="text-sm text-muted">
          Waiting on: {invites.map((i) => i.email).join(', ')}
        </p>
      )}
      {household.role === 'owner' ? (
        <>
          <p className="text-sm text-muted">
            Enter their Google account’s email, then send them the link
            yourself. It works once and expires in 7 days.
          </p>
          <InviteForm onInvited={() => details.refetch().then(() => {})} />
        </>
      ) : (
        <p className="text-sm text-muted">Only the owner can invite people.</p>
      )}
      <Link to="/household" className={linkClass}>
        Manage the Household
      </Link>
    </div>
  )
}

function CategoriesStep() {
  const { ix } = useBook()
  const all = [...ix.categories.values()]
  const group = (g: Category['group']) =>
    all
      .filter((c) => c.group === g && c.name !== 'Uncategorized')
      .sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Turn off what doesn’t apply. Hidden ones leave the Budget and pickers,
        and anything already filed there still counts. Change a tag or add one
        later on Plan.
      </p>
      {(['everyday', 'housing'] as const).map(
        (g) =>
          group(g).length > 0 && (
            <section key={g} className="space-y-1">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {g === 'everyday' ? 'Everyday' : 'Housing'}
              </h3>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {group(g).map((c) => (
                  <CategoryChoice key={c.name} category={c} />
                ))}
              </ul>
            </section>
          ),
      )}
      {!all.length && (
        <p className="text-sm text-muted">
          No categories yet. Add them on Plan, or let your first upload bring
          its own.
        </p>
      )}
    </div>
  )
}

function CategoryChoice({ category }: { category: Category }) {
  const { ix } = useBook()
  const hide = useHideCategory()
  const rename = useRenameCategory()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const on = !category.hidden
  return (
    <li className="flex min-h-11 items-center gap-2 px-2 py-1 text-sm">
      <input
        type="checkbox"
        checked={on}
        aria-label={`Use ${category.name}`}
        onChange={() => hide.mutate({ name: category.name, hidden: on })}
        className="size-5 shrink-0 accent-current"
      />
      <span
        aria-hidden
        className={cn('size-2 shrink-0 rounded-full', TAG_BG[category.tag])}
      />
      {editing ? (
        <form
          className="flex flex-1 items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            const to = (
              e.currentTarget.elements.namedItem('name') as HTMLInputElement
            ).value.trim()
            if (!to || to === category.name) return setEditing(false)
            const taken = [...ix.categories.keys()].some(
              (n) =>
                n !== category.name && n.toLowerCase() === to.toLowerCase(),
            )
            if (taken)
              return setError(`There’s already a category called ${to}.`)
            rename.mutate({ from: category.name, to })
            setError(null)
            setEditing(false)
          }}
        >
          <input
            name="name"
            autoFocus
            defaultValue={category.name}
            maxLength={60}
            aria-label={`New name for ${category.name}`}
            className="field min-h-9 flex-1"
          />
          <button
            type="submit"
            className="min-h-9 rounded-full bg-foreground px-3 text-xs font-semibold text-background"
          >
            Save
          </button>
        </form>
      ) : (
        <>
          <span className={cn('flex-1 truncate', !on && 'text-muted')}>
            {category.name}
          </span>
          <button
            type="button"
            aria-label={`Rename ${category.name}`}
            onClick={() => setEditing(true)}
            className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-foreground"
          >
            <Pencil size={14} aria-hidden />
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="basis-full text-xs text-over">
          {error}
        </p>
      )}
    </li>
  )
}

function ConnectStep() {
  const { ix } = useBook()
  const [banksOpen, setBanksOpen] = useState(true)
  const open = ix.ledger.accounts.filter((a) => !a.closed)
  return (
    <div className="space-y-3 text-sm">
      {open.length > 0 && (
        <p className="text-accent">
          {open.length === 1 ? '1 account' : `${open.length} accounts`} so far:{' '}
          {open.map((a) => a.name).join(', ')}.
        </p>
      )}
      <Option title="Sync from your bank">
        <p className="text-muted">
          SimpleFIN Bridge reads your banks and cards, and Budgy checks it a few
          times a day. Your bank logins stay with Bridge. Each account you link
          brings in up to 6 months of history, where the bank allows.
        </p>
        <div className="text-xs">
          <SimplefinNote />
        </div>
        <BankConnections open={banksOpen} onOpenChange={setBanksOpen} />
      </Option>
      <Option title="Upload an export">
        <p className="text-muted">
          Download a CSV of purchases from your card or bank’s website. Add the
          account on Accounts, open it, and choose{' '}
          <strong>Upload an export</strong>. Works for any card, Apple Card too.
        </p>
        <Link to="/accounts" className={linkClass}>
          Go to Accounts
        </Link>
      </Option>
      <Option title="iPhone Shortcut">
        <p className="text-muted">
          Send an Apple Card export to Budgy from your phone’s share sheet. Set
          it up under Accounts, Updates.
        </p>
        <Link to="/accounts" search={{ tab: 'updates' }} className={linkClass}>
          Set up a Shortcut
        </Link>
      </Option>
      <Option title="Just the balance">
        <p className="text-muted">
          For investments, loans and your home: add the account and type its
          balance now and then. It counts toward net worth, not spending.
        </p>
        <Link to="/accounts" className={linkClass}>
          Add an account
        </Link>
      </Option>
    </div>
  )
}

function Option({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2 rounded-lg border border-border bg-background p-3">
      <h3 className="font-bold">{title}</h3>
      {children}
    </section>
  )
}

function HistoryStep() {
  const { ix, today } = useBook()
  const spending = ix.ledger.accounts.filter(
    (a) => !a.closed && ['credit', 'checking', 'savings'].includes(a.kind),
  )
  const first = new Map<string, string>()
  for (const t of ix.ledger.txns)
    if ((first.get(t.account) ?? '9999') > t.date) first.set(t.account, t.date)
  const since = monthLabel(shiftMonth(today.slice(0, 7), -3))
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        Typical months, the starting point for Targets, come from the last 3
        full months. A linked bank brings in up to 6 months where the bank
        allows, but some only share a few weeks. Upload older purchases for any
        card or bank that doesn’t reach back to {since}.
      </p>
      <p className="text-muted">
        On Accounts, open the account and choose{' '}
        <strong>Upload an export</strong>. Budgy works out the columns and skips
        anything it already has.
      </p>
      {spending.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {spending.map((a) => (
            <li
              key={a.name}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0 truncate font-semibold">{a.name}</span>
              <span className="shrink-0 text-xs text-muted">
                {first.has(a.name)
                  ? `from ${monthLabel(first.get(a.name)!.slice(0, 7), true)}`
                  : 'nothing yet'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">Add a card or bank account first.</p>
      )}
      <Link to="/accounts" className={linkClass}>
        Go to Accounts
      </Link>
    </div>
  )
}

function SortStep() {
  const { ix } = useBook()
  const { unsorted, purchases } = unsortedShare(ix)
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        {purchases === 0
          ? 'Nothing to sort until purchases come in.'
          : `${unsorted} of ${purchases} purchases are Uncategorized.`}{' '}
        Pick a category for a store and every purchase there goes to it, now and
        later. You can change it on Accounts, Rules.
      </p>
      {purchases > 0 && <UnsortedStores />}
      <BankCategories limit={20} />
    </div>
  )
}

function PayStep() {
  const book = useBook()
  const [open, setOpen] = useState(false)
  const pay = useMemo(() => takeHome(book.ix.ledger.pay, book.today), [book])
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        Enter what lands in the bank each payday, and how often. Budgy never
        guesses it from deposits.
      </p>
      {pay.schedules.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {pay.schedules.map(({ schedule }) => (
            <li
              key={schedule.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <span className="font-semibold">{schedule.name}</span>
              <span className="text-xs text-muted">
                {dollars(schedule.amount)} ·{' '}
                {PAY_CADENCE_LABELS[schedule.cadence].toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 rounded-full bg-foreground px-4 font-semibold text-background"
      >
        {pay.schedules.length ? 'Change pay' : 'Add pay'}
      </button>
      {open && (
        <PaySheet pay={pay} spentTypical={0} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}

/** A suggested Target: the typical month, up to the next $10. */
function suggested(typical: number): number {
  return typical > 0 ? Math.ceil(typical / 1000) * 1000 : 0
}

function TargetsStep() {
  const book = useBook()
  const { ix } = book
  const setTargets = useSetTargets()
  const thisMonth = book.today.slice(0, 7)
  const history = useMemo(
    () =>
      categoryHistory(
        ix,
        monthRange(shiftMonth(thisMonth, -1), 3),
        book.plannedIds,
      ),
    [ix, thisMonth, book.plannedIds],
  )
  const names = [...ix.categories.values()]
    .filter(
      (c) => c.group === 'everyday' && !c.hidden && c.name !== 'Uncategorized',
    )
    .map((c) => c.name)
    .sort(
      (a, b) =>
        (history.get(b)?.typical ?? 0) - (history.get(a)?.typical ?? 0) ||
        a.localeCompare(b),
    )
  const known = names.some((n) => (history.get(n)?.typical ?? 0) > 0)
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      names.map((n) => {
        const now = targetFor(ix, n, thisMonth)
        const start = now ?? suggested(history.get(n)?.typical ?? 0)
        return [n, start ? String(start / 100) : '']
      }),
    ),
  )
  const changes = names.flatMap((n) => {
    const cents = parseDollars(amounts[n] ?? '')
    return cents !== null && cents > 0 && cents !== targetFor(ix, n, thisMonth)
      ? [{ category: n, amount: cents }]
      : []
  })
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        {known
          ? `Each starts at its typical month (the last 3 full months), rounded up. Adjust any, then save. They apply from ${monthLabel(thisMonth)}.`
          : 'There’s no spending history yet, so there’s nothing to start from. Type the ones you know, or skip this and set them on Plan once a few months are in.'}
      </p>
      {names.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {names.map((n) => (
            <li
              key={n}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-1.5"
            >
              <span className="truncate font-semibold">{n}</span>
              <span className="text-xs text-muted">
                {known && `typical ${dollars(history.get(n)?.typical ?? 0)}`}
              </span>
              <input
                inputMode="decimal"
                aria-label={`Target for ${n}`}
                placeholder="—"
                value={amounts[n] ?? ''}
                onChange={(e) =>
                  setAmounts((a) => ({ ...a, [n]: e.target.value }))
                }
                className="field w-24 text-right"
              />
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        disabled={!changes.length || setTargets.isPending}
        onClick={() =>
          setTargets.mutate({ startsMonth: thisMonth, targets: changes })
        }
        className="min-h-11 rounded-full bg-foreground px-4 font-semibold text-background disabled:opacity-50"
      >
        {changes.length
          ? `Save ${changes.length} ${changes.length === 1 ? 'Target' : 'Targets'}`
          : setTargets.isSuccess
            ? 'Saved'
            : 'Save Targets'}
      </button>
    </div>
  )
}

function BillsStep() {
  const book = useBook()
  const suggestions = useMemo(() => suggestPlans(book.ix, book.today), [book])
  const plans = book.ix.ledger.plans
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        Add bills you know are coming, like car insurance twice a year or an
        annual renewal. Ones less often than monthly are set aside for, not
        counted in Targets.
      </p>
      {plans.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {plans.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <span className="font-semibold">{p.name}</span>
              <span className="text-xs text-muted">
                {dollars(p.amount)} · {CADENCE_LABELS[p.cadence].toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted">
        {suggestions.length
          ? `Budgy found ${suggestions.length} that look regular. Add them from Plan, Bills.`
          : 'Budgy suggests bills once it sees a year or so of history.'}
      </p>
      <Link to="/plan" search={{ tab: 'bills' }} className={linkClass}>
        Go to Bills
      </Link>
    </div>
  )
}
