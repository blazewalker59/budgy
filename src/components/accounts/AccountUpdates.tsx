/** One update surface, independent of where an Account's data comes from. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Check, ChevronDown, FileUp, Landmark, Share } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { Account } from '@/lib/model/types'
import type { ExportFormat } from '@/lib/updates/exports'
import type { BankAccount } from '@/components/accounts/BankConnections'
import {
  EXPORT_FORMATS,
  EXPORT_LABELS,
  EXPORT_TOO_LARGE,
  MAX_EXPORT_BYTES,
  detectExport,
} from '@/lib/updates/exports'
import { retryBankAccount, updateAccountExport } from '@/lib/updates/server'
import {
  BANK_CONNECTIONS_KEY,
  UPDATES_KEY,
  useAccountUpdates,
  useBankConnections,
  useUploadTokens,
} from '@/lib/updates/useUpdates'
import { useBook } from '@/lib/ledger/book'
import { LEDGER_KEY } from '@/lib/ledger/useLedger'
import { MONEY_IN_KEY } from '@/lib/moneyIn/useMoneyIn'
import { dollars } from '@/lib/model/money'
import { dayLabel } from '@/lib/model/dates'
import { checkedAgo } from '@/lib/model/bankHealth'
import {
  BankConnections,
  BankLink,
  SIMPLEFIN_BRIDGE,
} from '@/components/accounts/BankConnections'
import { ShortcutUpload } from '@/components/accounts/ShortcutUpload'
import { Dropdown } from '@/components/shared/Dropdown'

type UpdateState = NonNullable<
  ReturnType<typeof useAccountUpdates>['data']
>[number]
type Preview = Awaited<ReturnType<typeof updateAccountExport>>
type ExportAttempt = {
  commit: boolean
  text: string
  format: ExportFormat
}
type Panel = 'choose' | 'link' | 'upload' | 'shortcut'
const SOURCE_LABELS = {
  uploaded: 'Export upload',
  posted: 'Agent',
  shortcut: 'Shortcut',
  simplefin: 'SimpleFIN',
}

export function AccountUpdates() {
  const { ix } = useBook()
  const updates = useAccountUpdates()
  const connections = useBankConnections()
  const tokens = useUploadTokens()
  const [selected, setSelected] = useState<{
    account: string
    /** Null: open, showing its details. */
    panel: Panel | null
    /** The group it was in when opened, so it doesn't move while open. */
    needsAction: boolean
  } | null>(null)
  const [banksOpen, setBanksOpen] = useState(false)
  if (updates.isPending)
    return (
      <p role="status" className="text-sm text-muted">
        Loading update status…
      </p>
    )
  if (updates.isError)
    return (
      <p role="alert" className="text-sm text-over">
        {updates.error.message}
      </p>
    )
  const banks = connections.data?.flatMap((c) => c.accounts) ?? []
  const health = new Map(
    (connections.data ?? []).map((c) => [c.id, c] as const),
  )
  const cards = ix.ledger.accounts
    .filter((a) => !a.closed)
    .map((account) => {
      const state = updates.data.find((u) => u.account === account.name)
      const situation = situate(
        account,
        state,
        banks,
        tokens.data ?? [],
        health,
      )
      const open = selected?.account === account.name ? selected : null
      const lastBalance = ix.ledger.balances
        .filter((b) => b.account === account.name)
        .at(-1)
      return {
        account,
        state,
        situation,
        line: brief(situation, state, lastBalance),
        panel: open?.panel ?? null,
        needsAction: open ? open.needsAction : situation.needsAction,
      }
    })
  const row = (c: (typeof cards)[number]) => (
    <AccountRow
      key={c.account.name}
      account={c.account}
      state={c.state}
      situation={c.situation}
      line={c.line}
      expanded={selected?.account === c.account.name}
      needsAction={c.needsAction}
      panel={c.panel}
      onToggle={() =>
        setSelected(
          selected?.account === c.account.name
            ? null
            : {
                account: c.account.name,
                panel: null,
                needsAction: c.needsAction,
              },
        )
      }
      onPanel={(panel) =>
        setSelected({
          account: c.account.name,
          panel,
          needsAction: c.needsAction,
        })
      }
      onConnectBank={() => {
        setBanksOpen(true)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }}
    />
  )
  const RANK = { over: 0, nice: 1, muted: 2 } as const
  const needing = cards
    .filter((c) => c.needsAction)
    .sort(
      (a, b) =>
        RANK[a.line.tone] - RANK[b.line.tone] ||
        a.line.text.localeCompare(b.line.text) ||
        a.account.name.localeCompare(b.account.name),
    )
  const settled = cards.filter((c) => !c.needsAction)
  return (
    <div className="space-y-4">
      <BankConnections open={banksOpen} onOpenChange={setBanksOpen} />
      {!cards.length && (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          No accounts yet. Add one on the Accounts tab.
        </p>
      )}
      {!!needing.length && (
        <section className="space-y-1.5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-nice">
            Needs action · {needing.length}
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {byBank(needing).map((item) =>
              'institution' in item ? (
                <SignInRow
                  key={`bank:${item.institution}`}
                  institution={item.institution}
                  accounts={item.cards.map((c) => c.account)}
                />
              ) : (
                row(item)
              ),
            )}
          </ul>
        </section>
      )}
      {!!settled.length && (
        <section className="space-y-1.5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted">
            {needing.length
              ? `Up to date · ${settled.length}`
              : 'All up to date'}
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {settled.map(row)}
          </ul>
          <p className="px-1 text-xs text-muted">
            “Through” is the last day a sync covered; the newest purchases can
            take a day or two to post.
          </p>
        </section>
      )}
    </div>
  )
}

/**
 * Accounts needing the same bank sign-in, together: one login at the bank
 * fixes them all. An Account that's open stays on its own row.
 */
function byBank<
  TCard extends { situation: Situation; panel: Panel | null; account: Account },
>(
  cards: Array<TCard>,
): Array<TCard | { institution: string; cards: Array<TCard> }> {
  const signIn = (c: TCard) =>
    c.situation.bank?.problemKind === 'reauth' &&
    !c.situation.paused &&
    c.panel === null
      ? c.situation.bank.institution
      : null
  const counts = new Map<string, number>()
  for (const c of cards) {
    const bank = signIn(c)
    if (bank) counts.set(bank, (counts.get(bank) ?? 0) + 1)
  }
  const out: Array<TCard | { institution: string; cards: Array<TCard> }> = []
  const groups = new Map<string, { institution: string; cards: Array<TCard> }>()
  for (const c of cards) {
    const bank = signIn(c)
    if (!bank || (counts.get(bank) ?? 0) < 2) {
      out.push(c)
      continue
    }
    let group = groups.get(bank)
    if (!group) {
      group = { institution: bank, cards: [] }
      groups.set(bank, group)
      out.push(group)
    }
    group.cards.push(c)
  }
  return out
}

/** Several Accounts waiting on one bank sign-in, in Bridge. */
function SignInRow({
  institution,
  accounts,
}: {
  institution: string
  accounts: Array<Account>
}) {
  return (
    <li className="flex items-center gap-2 px-3 py-1">
      <div className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5">
        <span
          aria-hidden
          className={`size-2 shrink-0 rounded-full ${TONE_DOT.nice}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {accounts.map((a) => a.name).join(', ')}
          </span>
          <span className="block truncate text-xs text-nice">
            Sign in to {institution} in Bridge
          </span>
        </span>
      </div>
      <a
        href={SIMPLEFIN_BRIDGE}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-9 shrink-0 items-center rounded-full bg-foreground px-3 text-xs font-semibold text-background"
      >
        Open Bridge
      </a>
    </li>
  )
}

/** One Account in a line; tap for its details and every way to update. */
function AccountRow({
  account,
  state,
  situation,
  line,
  expanded,
  needsAction,
  panel,
  onToggle,
  onPanel,
  onConnectBank,
}: {
  account: Account
  state?: UpdateState
  situation: Situation
  line: { tone: Tone; text: string }
  expanded: boolean
  needsAction: boolean
  panel: Panel | null
  onToggle: () => void
  onPanel: (panel: Panel | null) => void
  onConnectBank: () => void
}) {
  const { primary } = describe(situation, state)
  // Needing action, the fix sits on the row itself; otherwise it's inside.
  const inline = needsAction && primary !== null && panel !== primary.panel
  return (
    <li>
      <div className="flex items-center gap-2 px-3 py-1">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <span
            aria-hidden
            className={`size-2 shrink-0 rounded-full ${TONE_DOT[line.tone]}`}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {account.name}
              <span className="font-normal text-muted"> · {account.owner}</span>
            </span>
            <span className={`block truncate text-xs ${TONE_TEXT[line.tone]}`}>
              {line.text}
            </span>
          </span>
          <ChevronDown
            size={16}
            aria-hidden
            className={`shrink-0 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
        {inline && (
          <PrimaryAction
            account={account}
            bank={situation.bank}
            primary={primary}
            onPanel={onPanel}
            compact
          />
        )}
      </div>
      {expanded && (
        <div className="border-t border-border bg-background/40 px-3 py-3">
          <AccountCard
            account={account}
            state={state}
            situation={situation}
            panel={panel}
            onPanel={onPanel}
            onConnectBank={onConnectBank}
            showsAction={inline}
          />
        </div>
      )}
    </li>
  )
}

type Method = 'bank' | 'shortcut' | 'manual'
type Situation = ReturnType<typeof situate>

/**
 * How an Account updates today, and whether it needs the Member: not set
 * up, a better way available, or its last update failed or needs review.
 */
function situate(
  account: Account,
  state: UpdateState | undefined,
  banks: Array<BankAccount>,
  tokens: Array<{ account: string }>,
  health: ReadonlyMap<string, { status: string; lastError: string | null }>,
) {
  const spending = ['credit', 'checking', 'savings'].includes(account.kind)
  const bank = banks.find((b) => b.account === account.name) ?? null
  // The whole connection stopped (a lapsed plan, revoked access): say so
  // on every Account it feeds, with what to do.
  const connection = bank ? health.get(bank.connectionId) : undefined
  const paused =
    connection &&
    (connection.status === 'payment_required' ||
      connection.status === 'revoked')
      ? connection.lastError
      : null
  const unlinkedBanks = banks.filter(
    (b) => !b.account && b.present && b.currency.toUpperCase() === 'USD',
  ).length
  const method: Method = bank
    ? 'bank'
    : tokens.some((t) => t.account === account.name)
      ? 'shortcut'
      : 'manual'
  const latest = state?.latest?.status
  const needsAction =
    // Linking a balance-only Account to its bank is a suggestion, shown
    // inside it, not something broken.
    (spending && method === 'manual') ||
    (bank !== null && !bank.present) ||
    (bank !== null && (!!bank.problem || !!paused)) ||
    latest === 'failed' ||
    latest === 'attention'
  return { spending, bank, paused, unlinkedBanks, method, needsAction }
}

type Primary = {
  label: string
  /** On a row, where space is short. */
  short?: string
  panel?: Panel
  record?: boolean
  href?: string
  retry?: boolean
}

/** What an Account's details say, and the one thing it asks for (if any). */
function describe(
  situation: Situation,
  state: UpdateState | undefined,
): { summary: string; primary: Primary | null } {
  const { spending, bank, paused, unlinkedBanks, method } = situation
  if (bank && paused)
    return {
      summary: `Bank sync is paused. ${paused}`,
      primary: {
        label: 'Open SimpleFIN Bridge',
        short: 'Open Bridge',
        href: SIMPLEFIN_BRIDGE,
      },
    }
  if (bank && bank.problem)
    return {
      summary: bank.problem,
      primary:
        bank.problemKind === 'reauth'
          ? {
              label: 'Open SimpleFIN Bridge',
              short: 'Open Bridge',
              href: SIMPLEFIN_BRIDGE,
            }
          : { label: 'Retry', retry: true },
    }
  if (bank && !bank.present)
    return {
      summary: `SimpleFIN stopped sharing ${bank.name}. Check SimpleFIN Bridge or link another account.`,
      primary: { label: 'Fix link', short: 'Fix', panel: 'link' },
    }
  if (bank)
    return {
      summary: `Updates automatically from ${bank.name} (${bank.institution}).`,
      primary: null,
    }
  if (method === 'shortcut')
    return { summary: 'Updates from its iPhone Shortcut.', primary: null }
  if (spending)
    return {
      summary: state?.success
        ? 'Updated by uploading exports. Set up an easier way.'
        : 'Not set up yet. Choose how purchases come in.',
      primary: { label: 'Set up updates', short: 'Set up', panel: 'choose' },
    }
  if (unlinkedBanks)
    return {
      summary:
        'Its balance is entered by hand. Link its bank to update it automatically.',
      primary: { label: 'Link bank', panel: 'link' },
    }
  return {
    summary: 'Its balance is entered by hand.',
    primary: { label: 'Record balance', record: true },
  }
}

type Tone = 'over' | 'nice' | 'muted'
const TONE_TEXT: Record<Tone, string> = {
  over: 'text-over',
  nice: 'text-nice',
  muted: 'text-muted',
}
const TONE_DOT: Record<Tone, string> = {
  over: 'bg-over',
  nice: 'bg-nice',
  muted: 'bg-border',
}

/**
 * One short line for an Account's row: why it needs action, or how and when
 * it last updated. Same-bank problems read alike, so they sort together.
 */
function brief(
  situation: Situation,
  state: UpdateState | undefined,
  lastBalance: { amount: number; date: string } | undefined,
): { tone: Tone; text: string } {
  const { spending, bank, paused, method } = situation
  const latest = state?.latest?.status
  if (bank && paused) return { tone: 'over', text: 'Bank sync paused' }
  if (bank?.problemKind === 'reauth')
    return { tone: 'nice', text: `Sign in to ${bank.institution} in Bridge` }
  if (bank?.problem) return { tone: 'nice', text: 'Couldn’t sync this time' }
  if (bank && !bank.present)
    return { tone: 'over', text: 'The bank stopped sharing it' }
  if (latest === 'failed') return { tone: 'over', text: 'Last update failed' }
  if (latest === 'attention')
    return { tone: 'nice', text: 'Purchases to review' }
  if (spending && method === 'manual')
    return {
      tone: 'nice',
      text: state?.success?.finishedAt
        ? `Uploaded by hand · ${checkedAgo(state.success.finishedAt)}`
        : 'Not set up yet',
    }
  const via = bank
    ? `Bank sync · ${bank.syncedThrough ? `through ${dayLabel(bank.syncedThrough)}` : 'first sync soon'}`
    : method === 'shortcut'
      ? `Shortcut · ${state?.success?.finishedAt ? checkedAgo(state.success.finishedAt) : 'not used yet'}`
      : null
  const balance = lastBalance
    ? `${dollars(lastBalance.amount)} on ${dayLabel(lastBalance.date)}`
    : 'No balance yet'
  return {
    tone: 'muted',
    text: via ? (spending ? via : `${via} · ${balance}`) : balance,
  }
}

/** Which way of updating suits an Account best, given what's set up. */
function recommend(account: Account, bankAvailable: boolean): Panel {
  if (bankAvailable) return 'link'
  return account.kind === 'credit' ? 'shortcut' : 'upload'
}

function AccountCard({
  account,
  state,
  situation,
  panel,
  onPanel,
  onConnectBank,
  showsAction,
}: {
  account: Account
  state?: UpdateState
  situation: Situation
  panel: Panel | null
  onPanel: (panel: Panel | null) => void
  onConnectBank: () => void
  /** The row above already shows the action. */
  showsAction: boolean
}) {
  const { ix } = useBook()
  const connections = useBankConnections()
  const { spending, bank, paused, unlinkedBanks, method } = situation
  const lastBalance = ix.ledger.balances
    .filter((b) => b.account === account.name)
    .at(-1)
  const best = recommend(account, unlinkedBanks > 0)

  const { summary, primary } = describe(situation, state)

  return (
    <div className="space-y-2.5 text-xs">
      <p className="text-muted">
        {account.owner} ·{' '}
        {bank
          ? 'Bank sync'
          : method === 'shortcut'
            ? 'iPhone Shortcut'
            : spending
              ? 'Manual'
              : 'Recorded balances'}
      </p>
      {bank && (paused || bank.problem) ? (
        <p role="alert" className="text-over">
          {summary}
        </p>
      ) : (
        <p className="text-muted">{summary}</p>
      )}
      {spending && <UpdateStatus state={state} />}
      {(!spending || bank) && (
        <p className="text-muted">
          {lastBalance
            ? `Balance ${dollars(lastBalance.amount)} on ${lastBalance.date}`
            : 'No balance recorded yet'}
          {bank
            ? bank.syncedThrough
              ? `. Synced through ${bank.syncedThrough}.${spending && !bank.historyComplete ? ' Older history is still coming in.' : ''}`
              : '. Its first sync starts shortly and brings in up to 6 months of history, where the bank allows.'
            : '.'}
        </p>
      )}

      {panel === 'choose' && (
        <UpdateOptions
          account={account}
          spending={spending}
          method={method}
          best={best}
          hasConnection={!!connections.data?.length}
          onPick={onPanel}
          onConnectBank={onConnectBank}
        />
      )}
      {panel && panel !== 'choose' && (
        <div className="space-y-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => onPanel('choose')}
            className="min-h-11 font-semibold text-accent"
          >
            ‹ All ways to update
          </button>
          {panel === 'link' && <BankLink account={account} />}
          {panel === 'upload' && (
            <ExportUpdate
              account={account}
              savedFormat={state?.format ?? null}
            />
          )}
          {panel === 'shortcut' && (
            <ShortcutUpload
              account={account}
              savedFormat={state?.format ?? null}
            />
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => onPanel(panel ? null : 'choose')}
        className="min-h-11 font-semibold text-muted hover:text-foreground"
      >
        {panel
          ? 'Close'
          : method === 'manual' && spending
            ? 'What are my options?'
            : 'Other ways to update'}
      </button>
      {primary && !showsAction && panel !== primary.panel && (
        <PrimaryAction
          account={account}
          bank={bank}
          primary={primary}
          onPanel={onPanel}
        />
      )}
    </div>
  )
}

/** The one thing an Account asks for, as a button or link. */
function PrimaryAction({
  account,
  bank,
  primary,
  onPanel,
  compact = false,
}: {
  account: Account
  bank: BankAccount | null
  primary: Primary
  onPanel: (panel: Panel | null) => void
  /** On a row: the short label, a smaller button. */
  compact?: boolean
}) {
  const style = `inline-flex shrink-0 items-center rounded-full bg-foreground font-semibold text-background ${compact ? 'min-h-9 px-3 text-xs' : 'min-h-11 px-4 text-xs'}`
  const label = compact ? (primary.short ?? primary.label) : primary.label
  if (primary.retry && bank) return <RetryBank bank={bank} />
  if (primary.href)
    return (
      <a href={primary.href} target="_blank" rel="noreferrer" className={style}>
        {label}
      </a>
    )
  if (primary.record)
    return (
      <Link
        to="/accounts"
        search={{ kinds: [account.kind], people: [account.owner] }}
        className={style}
      >
        {label}
      </Link>
    )
  return (
    <button
      type="button"
      onClick={() => onPanel(primary.panel!)}
      className={style}
    >
      {label}
    </button>
  )
}

/** Try a failed bank account again now, on its own. */
function RetryBank({ bank }: { bank: BankAccount }) {
  const queryClient = useQueryClient()
  const retry = useMutation({
    mutationFn: () =>
      retryBankAccount({
        data: { connectionId: bank.connectionId, providerId: bank.providerId },
      }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: BANK_CONNECTIONS_KEY }),
        queryClient.invalidateQueries({ queryKey: UPDATES_KEY }),
        queryClient.invalidateQueries({ queryKey: LEDGER_KEY }),
        queryClient.invalidateQueries({ queryKey: MONEY_IN_KEY }),
      ]),
  })
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={retry.isPending}
        onClick={() => retry.mutate()}
        className="min-h-11 rounded-full bg-foreground px-4 font-semibold text-background disabled:opacity-50"
      >
        {retry.isPending ? 'Retrying…' : 'Retry'}
      </button>
      {retry.isError && (
        <p role="alert" className="max-w-56 text-right text-over">
          {retry.error.message}
        </p>
      )}
    </div>
  )
}

/** Every way an Account can update, explained, with the best one first. */
function UpdateOptions({
  account,
  spending,
  method,
  best,
  hasConnection,
  onPick,
  onConnectBank,
}: {
  account: Account
  spending: boolean
  method: Method
  best: Panel
  hasConnection: boolean
  onPick: (panel: Panel) => void
  onConnectBank: () => void
}) {
  const options: Array<{
    panel: Panel
    icon: React.ReactNode
    title: string
    body: string
    current: boolean
  }> = [
    {
      panel: 'link',
      icon: <Landmark size={16} aria-hidden />,
      title: 'Automatically from your bank',
      body: spending
        ? 'For banks in SimpleFIN Bridge. Purchases and the balance sync several times a day.'
        : 'For banks in SimpleFIN Bridge. The balance syncs on its own.',
      current: method === 'bank',
    },
  ]
  if (spending)
    options.push(
      {
        panel: 'shortcut',
        icon: <Share size={16} aria-hidden />,
        title: 'From your iPhone’s share sheet',
        body: 'For cards SimpleFIN can’t reach, like Apple Card. Set up a Shortcut once, then share exports to it from Wallet or your bank.',
        current: method === 'shortcut',
      },
      {
        panel: 'upload',
        icon: <FileUp size={16} aria-hidden />,
        title: 'Upload a file now',
        body: 'Choose a CSV export, review what’s new, then confirm.',
        current: false,
      },
    )
  options.sort((a, b) => Number(b.panel === best) - Number(a.panel === best))
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="font-semibold">How should {account.name} update?</p>
      <ul className="space-y-2">
        {options.map((o) => (
          <li key={o.panel}>
            <button
              type="button"
              onClick={() =>
                o.panel === 'link' && !hasConnection
                  ? onConnectBank()
                  : onPick(o.panel)
              }
              className="flex w-full items-start gap-2.5 rounded-lg border border-border bg-background p-2.5 text-left hover:border-foreground"
            >
              <span className="mt-0.5 shrink-0">{o.icon}</span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                  {o.title}
                  {o.current ? (
                    <span className="rounded-full bg-sunken px-1.5 py-0.5 text-[10px] text-muted">
                      Current
                    </span>
                  ) : (
                    o.panel === best && (
                      <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">
                        Recommended
                      </span>
                    )
                  )}
                </span>
                <span className="block text-muted">
                  {o.body}
                  {o.panel === 'link' && !hasConnection
                    ? ' Connect SimpleFIN in Bank connections above first.'
                    : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!spending && (
        <p className="text-muted">
          Or{' '}
          <Link
            to="/accounts"
            search={{ kinds: [account.kind], people: [account.owner] }}
            className="font-semibold text-accent"
          >
            record a balance by hand
          </Link>{' '}
          on the Accounts tab.
        </p>
      )}
    </div>
  )
}

function UpdateStatus({ state }: { state?: UpdateState }) {
  if (!state?.latest)
    return <p className="text-xs text-muted">No updates yet.</p>
  const latest = state.latest
  const timestamp = (date: Date | null) =>
    date ? new Date(date).toLocaleString() : '—'
  const active =
    state.lockExpiresAt && new Date(state.lockExpiresAt).getTime() > Date.now()
  return (
    <div className="space-y-1 text-xs">
      {state.success && (
        <p className="flex items-center gap-1.5 text-accent">
          <Check size={13} aria-hidden />
          Last updated {timestamp(state.success.finishedAt)} ·{' '}
          {state.success.source
            ? SOURCE_LABELS[state.success.source]
            : 'Update'}
        </p>
      )}
      {latest.status === 'running' && (
        <p role="status" className="text-muted">
          {active
            ? 'Updating…'
            : 'An update was interrupted. Retry the same export.'}
        </p>
      )}
      {(latest.status === 'failed' || latest.status === 'attention') && (
        <p role="alert" className="text-over">
          {latest.message}
          {state.success ? ' The last successful update is above.' : ''}
        </p>
      )}
      {!!latest.issues?.length && (
        <div className="space-y-2">
          <ul className="space-y-1 text-muted">
            {latest.issues.slice(0, 5).map((issue, index) => (
              <li key={index}>
                {issue.date} · {issue.description} ·{' '}
                {dollars(Math.round(issue.amount * 100))}: {issue.reason}
              </li>
            ))}
          </ul>
          <Link
            to="/spending"
            search={{ accounts: [state.account] }}
            className="font-semibold text-accent"
          >
            Review these purchases
          </Link>
        </div>
      )}
      {latest.status === 'succeeded' && (
        <p className="text-muted">
          {latest.added} added · {latest.updated} updated · {latest.linked}{' '}
          matched to existing · {latest.skipped} skipped
        </p>
      )}
      {latest.fromDate && latest.toDate && (
        <p className="text-muted">
          Covers {latest.fromDate} through {latest.toDate}
        </p>
      )}
    </div>
  )
}

function ExportUpdate({
  account,
  savedFormat,
}: {
  account: Account
  savedFormat: ExportFormat | null
}) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [format, setFormat] = useState<ExportFormat | ''>(savedFormat ?? '')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const update = useMutation({
    // The file and format travel with the call. Query installs a new
    // mutation function in an effect, so a click in that gap would otherwise
    // review with the previous render's empty format.
    mutationFn: ({ commit, text: csv, format: chosen }: ExportAttempt) => {
      if (!chosen) throw new Error('Choose an export format.')
      return updateAccountExport({
        data: { account: account.name, text: csv, format: chosen, commit },
      })
    },
    onSuccess: async (result, { commit }) => {
      if (!commit) {
        setPreview(result)
        return
      }
      setDone(
        `Updated ${account.name}: ${result.summary.added} added, ${result.summary.alreadyHad + result.summary.duplicates.length} already present, ${result.summary.notSpending} excluded.${result.moneyInAdded ? ` ${result.moneyInAdded} new money in to see under Money in.` : ''}`,
      )
      setPreview(null)
      setText('')
      setFileName('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: LEDGER_KEY }),
        queryClient.invalidateQueries({ queryKey: UPDATES_KEY }),
        queryClient.invalidateQueries({ queryKey: MONEY_IN_KEY }),
      ])
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey: UPDATES_KEY })
    },
  })
  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="text-xs text-muted">
        Adds new purchases only. Balances and existing purchases stay as they
        are.
      </p>
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border px-3 text-xs font-semibold">
        <FileUp size={14} aria-hidden />
        Choose transactions CSV
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          disabled={update.isPending || reading}
          onChange={async (event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            setPreview(null)
            setProblem(null)
            setDone(null)
            update.reset()
            setText('')
            setFileName('')
            if (file.size > MAX_EXPORT_BYTES) {
              setProblem(EXPORT_TOO_LARGE)
              return
            }
            setReading(true)
            try {
              const contents = await file.text()
              setText(contents)
              setFileName(file.name)
              setFormat(detectExport(contents) ?? savedFormat ?? '')
            } catch {
              setProblem('Couldn’t read that file. Try choosing it again.')
            } finally {
              setReading(false)
            }
          }}
        />
      </label>
      {fileName && <p className="text-xs text-muted">{fileName}</p>}
      <label className="block space-y-1 text-xs font-semibold">
        Export format
        <Dropdown<ExportFormat>
          value={format}
          disabled={update.isPending || reading}
          label="Export format"
          placeholder="Choose a format…"
          className="min-h-11 w-full"
          onChange={(value) => {
            setFormat(value)
            setPreview(null)
            setDone(null)
            update.reset()
          }}
          options={EXPORT_FORMATS.map((value) => ({
            value,
            label: EXPORT_LABELS[value],
          }))}
        />
      </label>
      {format === 'apple-card' && (
        <ol className="list-decimal space-y-0.5 pl-4 text-xs text-muted">
          <li>
            In Wallet, tap <strong>Apple Card</strong> →{' '}
            <strong>Card Balance</strong> → <strong>Export Transactions</strong>
            .
          </li>
          <li>Choose dates and CSV.</li>
          <li>Upload the file here.</li>
        </ol>
      )}
      {text && !preview && (
        <button
          type="button"
          disabled={!format || update.isPending}
          className="min-h-11 rounded-full bg-foreground px-4 text-xs font-semibold text-background disabled:opacity-50"
          onClick={() => {
            if (format) update.mutate({ commit: false, text, format })
          }}
        >
          {update.isPending ? 'Reading…' : 'Review export'}
        </button>
      )}
      {preview && (
        <div className="space-y-2 rounded-xl bg-background p-3 text-xs">
          <p className="font-semibold">
            {preview.summary.added} new purchases ·{' '}
            {preview.summary.alreadyHad + preview.summary.duplicates.length}{' '}
            already present · {preview.summary.notSpending} excluded
          </p>
          <p className="text-muted">
            {preview.fromDate} through {preview.toDate}. Payments and transfers
            are left out of spending.
            {preview.incoming > 0 &&
              ` ${preview.incoming} incoming will be kept under Money in.`}
          </p>
          <ul className="space-y-1">
            {preview.summary.filed.slice(0, 5).map((row, index) => (
              <li key={index} className="flex justify-between gap-3">
                <span>
                  {row.description} · {row.category}
                </span>
                <span className="shrink-0 tabular-nums">
                  {dollars(Math.round(row.amount * 100))}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted">
            New stores go to Uncategorized. Existing categories and notes stay
            as they are.
          </p>
          <button
            type="button"
            disabled={update.isPending}
            onClick={() => {
              if (format) update.mutate({ commit: true, text, format })
            }}
            className="min-h-11 rounded-full bg-foreground px-4 text-xs font-semibold text-background disabled:opacity-50"
          >
            {update.isPending ? 'Updating…' : 'Confirm update'}
          </button>
        </div>
      )}
      {done && (
        <p role="status" className="text-xs text-accent">
          {done}
        </p>
      )}
      {(problem || update.isError) && (
        <p role="alert" className="text-xs text-over">
          {problem ?? update.error?.message}
        </p>
      )}
    </div>
  )
}
