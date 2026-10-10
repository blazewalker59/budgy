/** One update surface, independent of where an Account's data comes from. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Check, FileUp } from 'lucide-react'
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
import { UPDATES_KEY, useAccountUpdates } from '@/lib/updates/useUpdates'
import { useBook } from '@/lib/ledger/book'
import { LEDGER_KEY } from '@/lib/ledger/useLedger'
import { dollars } from '@/lib/model/money'

type UpdateState = NonNullable<
  ReturnType<typeof useAccountUpdates>['data']
>[number]
type Preview = Awaited<ReturnType<typeof updateAccountExport>>
const SOURCE_LABELS = {
  uploaded: 'Export upload',
  posted: 'Agent',
  shortcut: 'Shortcut',
  simplefin: 'SimpleFIN',
}

export function AccountUpdates() {
  const { ix } = useBook()
  const updates = useAccountUpdates()
  const [selected, setSelected] = useState<string | null>(null)
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
        Update card and bank purchases from exports, or open a balance-based
        Account to record its value. Purchase inputs share filing rules and
        update receipts. Bank connections and share-sheet uploads will plug into
        this flow next; they aren’t connected yet.
      </p>
      <p className="text-xs text-muted">
        “Last updated” is a successful check, even when there were no new
        purchases. It is not a guarantee that the source includes every
        transaction through today.
      </p>
      {!accounts.length && (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          Add an Account on the Accounts tab first, then bring in its export
          here.
        </p>
      )}
      {accounts.map((account) => {
        const state = updates.data.find((u) => u.account === account.name)
        const spending = ['credit', 'checking', 'savings'].includes(
          account.kind,
        )
        const lastBalance = !spending
          ? ix.ledger.balances.filter((b) => b.account === account.name).at(-1)
          : null
        return (
          <section
            key={account.name}
            className="space-y-3 rounded-xl border border-border bg-surface p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold">{account.name}</h2>
                <p className="text-xs text-muted">
                  {account.owner} ·{' '}
                  {spending ? 'Export-based purchases' : 'Recorded balances'}
                </p>
              </div>
              {spending ? (
                <button
                  type="button"
                  onClick={() =>
                    setSelected(selected === account.name ? null : account.name)
                  }
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold"
                >
                  <FileUp size={14} aria-hidden />
                  {selected === account.name
                    ? 'Close upload'
                    : 'Update Account'}
                </button>
              ) : (
                <Link
                  to="/accounts"
                  search={{ kinds: [account.kind], people: [account.owner] }}
                  className="inline-flex min-h-11 items-center rounded-full border border-border px-3 text-xs font-semibold"
                >
                  Record balance
                </Link>
              )}
            </div>
            {spending ? (
              <UpdateStatus state={state} />
            ) : (
              <p className="text-xs text-muted">
                {lastBalance
                  ? `Latest balance: ${dollars(lastBalance.amount)} on ${lastBalance.date}.`
                  : 'No balance recorded yet.'}{' '}
                Open this Account on the Accounts tab to record a balance or
                import its history. Balance connections aren’t available yet.
              </p>
            )}
            {spending && selected === account.name && (
              <ExportUpdate
                key={account.name}
                account={account}
                savedFormat={state?.format ?? null}
              />
            )}
          </section>
        )
      })}
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
