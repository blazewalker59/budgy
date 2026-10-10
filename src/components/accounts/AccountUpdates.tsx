/** One update surface, independent of where an Account's data comes from. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Check, FileUp, Landmark, Share } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { Account } from '@/lib/model/types'
import type { ExportFormat } from '@/lib/updates/exports'
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
} from '@/lib/updates/useUpdates'
import { useBook } from '@/lib/ledger/book'
import { LEDGER_KEY } from '@/lib/ledger/useLedger'
import { dollars } from '@/lib/model/money'
import {
  BankConnections,
  BankLink,
  useBankLink,
} from '@/components/accounts/BankConnections'
import { ShortcutUpload } from '@/components/accounts/ShortcutUpload'

type UpdateState = NonNullable<
  ReturnType<typeof useAccountUpdates>['data']
>[number]
type Preview = Awaited<ReturnType<typeof updateAccountExport>>
type Panel = 'link' | 'upload' | 'shortcut'
const SOURCE_LABELS = {
  uploaded: 'Export upload',
  posted: 'Agent',
  shortcut: 'Shortcut',
  simplefin: 'SimpleFIN',
}

export function AccountUpdates() {
  const { ix } = useBook()
  const updates = useAccountUpdates()
  const [selected, setSelected] = useState<{
    account: string
    panel: Panel
  } | null>(null)
  const accounts = ix.ledger.accounts.filter((a) => !a.closed)
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
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        How each Account stays current: a linked bank syncs on its own; cards
        without one take an export, here or from your iPhone’s share sheet.
        “Last updated” is a successful check, even with nothing new; it isn’t a
        guarantee the source has every transaction through today.
      </p>
      <BankConnections />
      {!accounts.length && (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          Add an Account on the Accounts tab first, then choose how it updates
          here.
        </p>
      )}
      {accounts.map((account) => (
        <AccountCard
          key={account.name}
          account={account}
          state={updates.data.find((u) => u.account === account.name)}
          panel={selected?.account === account.name ? selected.panel : null}
          onPanel={(panel) =>
            setSelected(panel ? { account: account.name, panel } : null)
          }
        />
      ))}
    </div>
  )
}

function AccountCard({
  account,
  state,
  panel,
  onPanel,
}: {
  account: Account
  state?: UpdateState
  panel: Panel | null
  onPanel: (panel: Panel | null) => void
}) {
  const { ix } = useBook()
  const connections = useBankConnections()
  const bank = useBankLink(account.name)
  const spending = ['credit', 'checking', 'savings'].includes(account.kind)
  const lastBalance = ix.ledger.balances
    .filter((b) => b.account === account.name)
    .at(-1)
  const toggle = (which: Panel) => (open: boolean) =>
    onPanel(open ? null : which)
  const method = bank
    ? `SimpleFIN · ${bank.institution}`
    : spending
      ? 'Export or Shortcut'
      : 'Recorded balances'

  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-bold">{account.name}</h2>
          <p className="text-xs text-muted">
            {account.owner} · {method}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {!!connections.data?.length && (
            <PanelButton
              open={panel === 'link'}
              onClick={toggle('link')}
              icon={<Landmark size={14} aria-hidden />}
              label={bank ? 'SimpleFIN' : 'Link bank'}
            />
          )}
          {spending && !bank && (
            <PanelButton
              open={panel === 'shortcut'}
              onClick={toggle('shortcut')}
              icon={<Share size={14} aria-hidden />}
              label="Shortcut"
            />
          )}
          {spending ? (
            <PanelButton
              open={panel === 'upload'}
              onClick={toggle('upload')}
              icon={<FileUp size={14} aria-hidden />}
              label="Upload CSV"
            />
          ) : (
            !bank && (
              <Link
                to="/accounts"
                search={{ kinds: [account.kind], people: [account.owner] }}
                className="inline-flex min-h-11 items-center rounded-full border border-border px-3 text-xs font-semibold"
              >
                Record balance
              </Link>
            )
          )}
        </div>
      </div>
      {spending && <UpdateStatus state={state} />}
      {(!spending || bank) && (
        <p className="text-xs text-muted">
          {lastBalance
            ? `Balance ${dollars(lastBalance.amount)} on ${lastBalance.date}`
            : 'No balance recorded yet'}
          {bank
            ? bank.syncedThrough
              ? ` · from ${bank.name}, synced through ${bank.syncedThrough}.`
              : ` · from ${bank.name}; not synced yet.`
            : '. Record a balance or import its history on the Accounts tab.'}
        </p>
      )}
      {panel === 'link' && <BankLink account={account} />}
      {panel === 'upload' && (
        <ExportUpdate account={account} savedFormat={state?.format ?? null} />
      )}
      {panel === 'shortcut' && (
        <ShortcutUpload account={account} savedFormat={state?.format ?? null} />
      )}
    </section>
  )
}

function PanelButton({
  open,
  onClick,
  icon,
  label,
}: {
  open: boolean
  onClick: (open: boolean) => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => onClick(open)}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${open ? 'border-foreground' : 'border-border'}`}
    >
      {icon}
      {label}
    </button>
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
