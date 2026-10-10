/**
 * Set up the iPhone share-sheet Shortcut for one Account (docs/adr/0010):
 * a write-only token, shown once, and the steps to build the Shortcut.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Account } from '@/lib/model/types'
import type { ExportFormat } from '@/lib/updates/exports'
import {
  EXPORT_FORMATS,
  EXPORT_LABELS,
  UPLOAD_PATH,
} from '@/lib/updates/exports'
import {
  createAccountUploadToken,
  revokeAccountUploadToken,
} from '@/lib/updates/server'
import { UPLOAD_TOKENS_KEY, useUploadTokens } from '@/lib/updates/useUpdates'
import { CopyLine } from '@/components/shared/CopyLine'

export function ShortcutUpload({
  account,
  savedFormat,
}: {
  account: Account
  savedFormat: ExportFormat | null
}) {
  const queryClient = useQueryClient()
  const tokens = useUploadTokens()
  const [format, setFormat] = useState<ExportFormat | ''>(
    savedFormat ?? (account.kind === 'credit' ? 'apple-card' : ''),
  )
  const [created, setCreated] = useState<string | null>(null)
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: UPLOAD_TOKENS_KEY })
  const create = useMutation({
    mutationFn: () => {
      if (!format)
        throw new Error('Choose the export format and amount convention')
      return createAccountUploadToken({
        data: { account: account.name, format },
      })
    },
    onSuccess: async (result) => {
      setCreated(result.token)
      await refresh()
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => revokeAccountUploadToken({ data: { id } }),
    onSuccess: refresh,
  })
  const endpoint =
    typeof window === 'undefined'
      ? UPLOAD_PATH
      : `${window.location.origin}${UPLOAD_PATH}`
  const mine = tokens.data?.filter((t) => t.account === account.name) ?? []

  return (
    <div className="space-y-3 border-t border-border pt-3 text-xs">
      <p className="text-muted">
        Send an export straight from your iPhone’s share sheet. The Shortcut’s
        token can only add purchases to {account.name}; it can’t read anything.
        Each upload is checked and filed like any other, without a preview.
      </p>

      {created ? (
        <div
          role="status"
          className="space-y-2 rounded-xl border border-accent/50 bg-accent-soft p-3"
        >
          <p className="font-semibold">Build the Shortcut</p>
          <p className="text-muted">
            Copy the token now: it won’t be shown again.
          </p>
          <ol className="list-decimal space-y-1.5 pl-4">
            <li>
              In Shortcuts, make a new Shortcut named “Send to Budgy (
              {account.name})”. In its details, turn on Show in Share Sheet and
              have it receive Files.
            </li>
            <li>
              Add <b>Get Contents of URL</b>, with this URL:
              <CopyLine text={endpoint} label="upload URL" />
            </li>
            <li>
              Set Method to POST and add a header named Authorization with this
              value:
              <CopyLine text={`Bearer ${created}`} label="header value" />
            </li>
            <li>Set Request Body to File, and choose Shortcut Input.</li>
            <li>
              Add <b>Show Notification</b> with the Contents of URL, to see what
              was added.
            </li>
          </ol>
          <p className="text-muted">
            {format === 'apple-card'
              ? 'Then in Wallet: Apple Card → Card Balance → Export Transactions → choose dates → CSV → Share → your Shortcut.'
              : 'Then export a CSV from your bank and share it to your Shortcut.'}{' '}
            Overlapping date ranges are fine; nothing is added twice.
          </p>
          <button
            type="button"
            onClick={() => setCreated(null)}
            className="min-h-11 rounded-full border border-border px-3 font-semibold"
          >
            Done
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1 space-y-1 font-semibold">
            The export it will send
            <select
              value={format}
              disabled={create.isPending}
              className="field min-h-11 w-full"
              onChange={(event) =>
                setFormat(event.target.value as ExportFormat)
              }
            >
              <option value="">Choose the amount convention…</option>
              {EXPORT_FORMATS.filter(
                (value) => value !== 'apple-card' || account.kind === 'credit',
              ).map((value) => (
                <option key={value} value={value}>
                  {EXPORT_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!format || create.isPending}
            onClick={() => create.mutate()}
            className="min-h-11 rounded-full bg-foreground px-4 font-semibold text-background disabled:opacity-50"
          >
            {create.isPending ? 'Creating…' : 'Create Shortcut token'}
          </button>
        </div>
      )}

      {!!mine.length && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {mine.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-muted">
                <span className="font-mono">{t.prefix}…</span> ·{' '}
                {EXPORT_LABELS[t.format]} · {t.memberEmail} ·{' '}
                {t.lastUsedAt
                  ? `used ${new Date(t.lastUsedAt).toLocaleString()}`
                  : 'never used'}
              </span>
              <button
                type="button"
                disabled={revoke.isPending}
                onClick={() => {
                  if (confirm('Revoke this token? Its Shortcut stops working.'))
                    revoke.mutate(t.id)
                }}
                className="min-h-11 rounded-full px-2 font-semibold text-muted hover:text-over disabled:opacity-50"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      {(create.isError || revoke.isError) && (
        <p role="alert" className="text-over">
          {(create.error ?? revoke.error)?.message}
        </p>
      )}
    </div>
  )
}
