/** One update surface, independent of where an Account's data comes from. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Check, FileUp, Landmark, Share } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { Account } from '@/lib/model/types'
import type { ExportFormat } from '@/lib/updates/exports'
import type { BankAccount } from '@/components/accounts/BankConnections'
import {
  EXPORT_FORMATS,
  EXPORT_LABELS,
  MAX_EXPORT_BYTES,
  detectExport,
} from '@/lib/updates/exports'
import { updateAccountExport } from '@/lib/updates/server'
import {
  UPDATES_KEY,
  useAccountUpdates,
  useBankConnections,
  useUploadTokens,
} from '@/lib/updates/useUpdates'
import { useBook } from '@/lib/ledger/book'
import { LEDGER_KEY } from '@/lib/ledger/useLedger'
import { dollars } from '@/lib/model/money'
import {
  BankConnections,
  BankLink,
} from '@/components/accounts/BankConnections'
import { ShortcutUpload } from '@/components/accounts/ShortcutUpload'

type UpdateState = NonNullable<
  ReturnType<typeof useAccountUpdates>['data']
>[number]
type Preview = Awaited<ReturnType<typeof updateAccountExport>>
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
    panel: Panel
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
  const cards = ix.ledger.accounts
    .filter((a) => !a.closed)
    .map((account) => {
      const state = updates.data.find((u) => u.account === account.name)
      const situation = situate(account, state, banks, tokens.data ?? [])
      const open = selected?.account === account.name ? selected : null
      return {
        account,
        state,
        situation,
        panel: open?.panel ?? null,
        needsAction: open ? open.needsAction : situation.needsAction,
      }
    })
  const card = (c: (typeof cards)[number]) => (
    <AccountCard
      key={c.account.name}
      account={c.account}
      state={c.state}
      situation={c.situation}
      panel={c.panel}
      onPanel={(panel) =>
        setSelected(
          panel
            ? {
                account: c.account.name,
                panel,
                needsAction: c.needsAction,
              }
            : null,
        )
      }
      onConnectBank={() => {
        setBanksOpen(true)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }}
    />
  )
  const needing = cards.filter((c) => c.needsAction)
  const settled = cards.filter((c) => !c.needsAction)
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        How each Account stays current: a linked bank syncs on its own; cards
        without one take an export, here or from your iPhone’s share sheet.
        “Last updated” is a successful check, even with nothing new; it isn’t a
        guarantee the source has every transaction through today.
      </p>
      <BankConnections open={banksOpen} onOpenChange={setBanksOpen} />
      {!cards.length && (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          Add an Account on the Accounts tab first, then choose how it updates
          here.
        </p>
      )}
      {!!needing.length && (
        <section className="space-y-2">
          <h2 className="pt-1 text-sm font-bold uppercase tracking-wide text-muted">
            Needs action · {needing.length}
          </h2>
          {needing.map(card)}
        </section>
      )}
      {!!settled.length && (
        <section className="space-y-2">
          <h2 className="pt-1 text-sm font-bold uppercase tracking-wide text-muted">
            {needing.length ? `Set up · ${settled.length}` : 'All set up'}
          </h2>
          {settled.map(card)}
        </section>
      )}
    </div>
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
) {
  const spending = ['credit', 'checking', 'savings'].includes(account.kind)
  const bank = banks.find((b) => b.account === account.name) ?? null
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
    (spending && method === 'manual') ||
    (!spending && !bank && unlinkedBanks > 0) ||
    (bank !== null && !bank.present) ||
    latest === 'failed' ||
    latest === 'attention'
  return { spending, bank, unlinkedBanks, method, needsAction }
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
}: {
  account: Account
  state?: UpdateState
  situation: Situation
  panel: Panel | null
  onPanel: (panel: Panel | null) => void
  onConnectBank: () => void
}) {
  const { ix } = useBook()
  const connections = useBankConnections()
  const { spending, bank, unlinkedBanks, method } = situation
  const lastBalance = ix.ledger.balances
    .filter((b) => b.account === account.name)
    .at(-1)
  const best = recommend(account, unlinkedBanks > 0)

  // What the card says, and the one thing it asks for (if anything).
  let summary: string
  let primary: { label: string; panel?: Panel; record?: boolean } | null = null
  if (bank && !bank.present) {
    summary = `SimpleFIN no longer shares ${bank.name}. Check it in Bridge, or link another account.`
    primary = { label: 'Fix link', panel: 'link' }
  } else if (bank) {
    summary = `Updates automatically from ${bank.name} (${bank.institution}).`
  } else if (method === 'shortcut') {
    summary =
      'Updates when you share an export to its iPhone Shortcut: export from Wallet or your bank, then Share → your Shortcut.'
  } else if (spending) {
    summary = state?.success
      ? 'Updated by uploading exports. Set up an easier way so it stays current.'
      : 'Not set up yet. Choose how its purchases come into Budgy.'
    primary = { label: 'Set up updates', panel: 'choose' }
  } else if (unlinkedBanks) {
    summary =
      'Its balance is entered by hand. Link its bank to keep it current.'
    primary = { label: 'Link bank', panel: 'link' }
  } else {
    summary = 'Its balance is entered by hand.'
    primary = { label: 'Record balance', record: true }
  }

  return (
    <section className="space-y-2.5 rounded-xl border border-border bg-surface p-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">{account.name}</h2>
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
        </div>
        {primary &&
          (primary.record ? (
            <Link
              to="/accounts"
              search={{ kinds: [account.kind], people: [account.owner] }}
              className="inline-flex min-h-11 items-center rounded-full bg-foreground px-4 font-semibold text-background"
            >
              {primary.label}
            </Link>
          ) : (
            panel !== primary.panel && (
              <button
                type="button"
                onClick={() => onPanel(primary.panel!)}
                className="min-h-11 rounded-full bg-foreground px-4 font-semibold text-background"
              >
                {primary.label}
              </button>
            )
          ))}
      </div>
      <p className="text-muted">{summary}</p>
      {spending && <UpdateStatus state={state} />}
      {(!spending || bank) && (
        <p className="text-muted">
          {lastBalance
            ? `Balance ${dollars(lastBalance.amount)} on ${lastBalance.date}`
            : 'No balance recorded yet'}
          {bank
            ? bank.syncedThrough
              ? `; synced through ${bank.syncedThrough}.`
              : '; waiting for the first sync.'
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
    </section>
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
        ? 'Best when your bank is in SimpleFIN Bridge: purchases and the balance arrive on their own, several times a day.'
        : 'Best when it’s in SimpleFIN Bridge: the balance stays current on its own.',
      current: method === 'bank',
    },
  ]
  if (spending)
    options.push(
      {
        panel: 'shortcut',
        icon: <Share size={16} aria-hidden />,
        title: 'From your iPhone’s share sheet',
        body: 'For cards SimpleFIN can’t reach, like Apple Card. Set up a Shortcut once; then export from Wallet or your bank and share it to Budgy in a couple of taps.',
        current: method === 'shortcut',
      },
      {
        panel: 'upload',
        icon: <FileUp size={16} aria-hidden />,
        title: 'Upload a file now',
        body: 'A one-off: choose a CSV export, review what’s new, and confirm. Good for catching up.',
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
                    ? ' Connect SimpleFIN first, in Bank connections above.'
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
    return (
      <p className="text-xs text-muted">
        No update receipt yet. Existing purchases and balances are unchanged.
      </p>
    )
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
          {state.success ? ' The last successful update is shown above.' : ''}
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
            Review this Account’s purchases
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
          Source rows dated {latest.fromDate} through {latest.toDate}
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
    mutationFn: (commit: boolean) => {
      if (!format)
        throw new Error('Choose the export format and amount convention')
      return updateAccountExport({
        data: { account: account.name, text, format, commit },
      })
    },
    onSuccess: async (result, commit) => {
      if (!commit) {
        setPreview(result)
        return
      }
      setDone(
        `Updated ${account.name}: ${result.summary.added} added, ${result.summary.alreadyHad + result.summary.duplicates.length} already present, ${result.summary.notSpending} excluded.`,
      )
      setPreview(null)
      setText('')
      setFileName('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: LEDGER_KEY }),
        queryClient.invalidateQueries({ queryKey: UPDATES_KEY }),
      ])
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey: UPDATES_KEY })
    },
  })
  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="text-xs text-muted">
        No known balance is needed to update purchases. This upload won’t
        replace your balance history or delete purchases missing from the file.
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
              setProblem('Choose a CSV export smaller than 2 MB')
              return
            }
            setReading(true)
            try {
              const contents = await file.text()
              setText(contents)
              setFileName(file.name)
              setFormat(detectExport(contents) ?? savedFormat ?? '')
            } catch {
              setProblem('Could not read this file. Try selecting it again.')
            } finally {
              setReading(false)
            }
          }}
        />
      </label>
      {fileName && <p className="text-xs text-muted">{fileName}</p>}
      <label className="block space-y-1 text-xs font-semibold">
        Export format
        <select
          value={format}
          disabled={update.isPending || reading}
          className="field min-h-11 w-full"
          onChange={(event) => {
            setFormat(event.target.value as ExportFormat)
            setPreview(null)
            setDone(null)
            update.reset()
          }}
        >
          <option value="">Choose the amount convention…</option>
          {EXPORT_FORMATS.map((value) => (
            <option key={value} value={value}>
              {EXPORT_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      {format === 'apple-card' && (
        <p className="text-xs text-muted">
          In Wallet: Apple Card → Card Balance → Export Transactions → choose
          dates → CSV. Apple’s export is still a manual step; availability of
          current-cycle dates should be checked on your iPhone.
        </p>
      )}
      {text && !preview && (
        <button
          type="button"
          disabled={!format || update.isPending}
          className="min-h-11 rounded-full bg-foreground px-4 text-xs font-semibold text-background disabled:opacity-50"
          onClick={() => update.mutate(false)}
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
            {preview.fromDate} through {preview.toDate}. Payments, transfers and
            non-spending are left out.
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
            Unrecognized stores go to Uncategorized until you file them.
            Existing Moves and notes stay as they are.
          </p>
          <button
            type="button"
            disabled={update.isPending}
            onClick={() => update.mutate(true)}
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
