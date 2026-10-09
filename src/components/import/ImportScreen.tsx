/**
 * Bringing in a new export, and saying whose each Account is. An import
 * only adds Transactions the Ledger doesn't have, so overlapping exports
 * are safe.
 */

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUp } from 'lucide-react'
import type { ImportSummary } from '@/lib/ledger/server'
import {
  getImportRules,
  importCsv,
  listImports,
  setImportRules,
} from '@/lib/ledger/server'
import { useBook } from '@/lib/ledger/book'
import { LEDGER_KEY, useSetOwner } from '@/lib/ledger/useLedger'
import { OWNERS } from '@/lib/model/types'
import { dayLabel } from '@/lib/model/dates'
import { ownerColor } from '@/lib/format'

interface Pending {
  file: File
  text: string
  summary?: ImportSummary
  error?: string
  done?: boolean
  busy?: boolean
}

const IMPORTS_KEY = ['imports'] as const

export function ImportScreen() {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<Array<Pending>>([])
  const history = useQuery({
    queryKey: IMPORTS_KEY,
    queryFn: () => listImports(),
  })

  const update = (file: File, patch: Partial<Pending>) =>
    setPending((list) =>
      list.map((p) => (p.file === file ? { ...p, ...patch } : p)),
    )

  const choose = async (files: FileList | null) => {
    if (!files) return
    const added = await Promise.all(
      [...files].map(async (file) => ({
        file,
        text: await file.text(),
        busy: true,
      })),
    )
    setPending((list) => [...added, ...list])
    for (const p of added) {
      try {
        const summary = await importCsv({
          data: { fileName: p.file.name, text: p.text, commit: false },
        })
        update(p.file, { summary, busy: false })
      } catch (error) {
        update(p.file, {
          error: error instanceof Error ? error.message : 'Could not read it.',
          busy: false,
        })
      }
    }
  }

  const commit = async (p: Pending) => {
    update(p.file, { busy: true })
    try {
      const summary = await importCsv({
        data: { fileName: p.file.name, text: p.text, commit: true },
      })
      update(p.file, { summary, done: true, busy: false })
      await queryClient.invalidateQueries({ queryKey: LEDGER_KEY })
      await queryClient.invalidateQueries({ queryKey: IMPORTS_KEY })
    } catch (error) {
      update(p.file, {
        error: error instanceof Error ? error.message : 'Import failed.',
        busy: false,
      })
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-extrabold tracking-tight">Import</h1>
        <p className="text-xs text-muted">
          Export transactions from the finance app as CSV and drop them here.
          Spending and income (for take-home pay) are kept; transfers are
          skipped, and anything already imported is never added twice.
        </p>
      </div>

      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-surface px-4 py-5 text-center hover:border-accent">
        <FileUp size={28} className="text-accent" aria-hidden />
        <span className="font-semibold">Choose CSV files</span>
        <span className="text-xs text-muted">
          You’ll see what’s new before anything is added.
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          multiple
          className="sr-only"
          onChange={(e) => {
            void choose(e.target.files)
            e.target.value = ''
          }}
        />
      </label>

      {pending.map((p) => (
        <div
          key={`${p.file.name}-${p.file.lastModified}`}
          className="rounded-xl border border-border bg-surface p-3"
        >
          <p className="font-semibold">{p.file.name}</p>
          {p.busy && <p className="text-xs text-muted">Reading…</p>}
          {p.error && (
            <p className="text-sm font-medium text-over">{p.error}</p>
          )}
          {p.summary && (
            <div className="mt-1 space-y-2 text-sm">
              <p>
                {p.done ? (
                  <strong className="text-accent">
                    Added {p.summary.added} purchases
                    {p.summary.income.added
                      ? ` and ${p.summary.income.added} deposits`
                      : ''}
                    .
                  </strong>
                ) : (
                  <>
                    <strong>{p.summary.added} new</strong> of {p.summary.rows}{' '}
                    purchases
                    {p.summary.alreadyHad
                      ? ` (${p.summary.alreadyHad} already here)`
                      : ''}
                    {p.summary.income.rows > 0 &&
                      `, ${p.summary.income.added} new of ${p.summary.income.rows} deposits`}
                    .
                  </>
                )}{' '}
                <span className="text-muted">
                  Skipped {p.summary.skipped.otherTypes} transfers
                  {p.summary.skipped.notSpending
                    ? `, ${p.summary.skipped.notSpending} escrow and investment rows`
                    : ''}
                  .
                </span>
              </p>
              {p.summary.byAccount.length > 0 && (
                <ul className="text-muted">
                  {p.summary.byAccount.map((a) => (
                    <li key={a.account}>
                      {a.account}: {a.added} new, {dayLabel(a.first)} –{' '}
                      {dayLabel(a.last)}
                      {p.summary!.newAccounts.includes(a.account) && (
                        <span className="ml-1 rounded bg-accent-soft px-1 text-xs text-accent">
                          new account
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!p.done && p.summary.added + p.summary.income.added > 0 && (
                <button
                  type="button"
                  disabled={p.busy}
                  onClick={() => void commit(p)}
                  className="rounded-full bg-foreground px-4 py-1.5 font-semibold text-background disabled:opacity-40"
                >
                  Add {p.summary.added} purchases
                  {p.summary.income.added > 0 &&
                    ` and ${p.summary.income.added} deposits`}
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      <Accounts />

      <RulesEditor />

      {history.data && history.data.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted">
            Recent imports
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-sm">
            {history.data.map((h) => (
              <li key={h.id} className="flex justify-between gap-3 px-3 py-1.5">
                <span className="truncate">
                  {h.fileName}{' '}
                  <span className="text-muted">by {h.importedBy}</span>
                </span>
                <span className="shrink-0 text-muted">
                  +{h.added} · {new Date(h.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** Whose spending each Account is, and how far its data reaches. */
function Accounts() {
  const { ix } = useBook()
  const setOwner = useSetOwner()
  const stats = useMemo(() => {
    const m = new Map<string, { n: number; first: string; last: string }>()
    for (const t of ix.ledger.txns) {
      const s = m.get(t.account) ?? { n: 0, first: t.date, last: t.date }
      s.n++
      if (t.date < s.first) s.first = t.date
      if (t.date > s.last) s.last = t.date
      m.set(t.account, s)
    }
    return m
  }, [ix])
  if (!ix.ledger.accounts.length) return null
  return (
    <section>
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted">
        Accounts
      </h2>
      <p className="mb-1 text-xs text-muted">
        Whose spending each card or account is. Data that stops early means that
        account is missing from the latest export.
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {ix.ledger.accounts.map((a) => {
          const s = stats.get(a.name)
          return (
            <li
              key={a.name}
              className="flex flex-wrap items-center justify-between gap-3 px-3 py-1.5"
            >
              <div className="min-w-0">
                <p className="font-semibold">
                  <span
                    className="mr-2 inline-block size-2.5 rounded-full"
                    style={{ background: ownerColor(a.owner) }}
                  />
                  {a.name}
                </p>
                <p className="text-xs text-muted">
                  {s
                    ? `${s.n} purchases, ${s.first} to ${s.last}`
                    : 'No purchases'}
                </p>
              </div>
              <select
                value={a.owner}
                aria-label={`Owner of ${a.name}`}
                className="field"
                onChange={(e) =>
                  setOwner.mutate({ account: a.name, owner: e.target.value })
                }
              >
                {OWNERS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const RULES_KEY = ['import-rules'] as const

/**
 * The Household's Import Rules as JSON: account names, store aliases, local
 * upkeep vendors. Kept in the database, not the code (docs/adr/0003).
 */
function RulesEditor() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const rules = useQuery({
    queryKey: RULES_KEY,
    queryFn: () => getImportRules(),
    enabled: open,
  })
  const [draft, setDraft] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const text = draft ?? (rules.data ? JSON.stringify(rules.data, null, 2) : '')

  const save = async () => {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      setStatus('That isn’t valid JSON.')
      return
    }
    try {
      await setImportRules({ data: parsed })
      await queryClient.invalidateQueries({ queryKey: RULES_KEY })
      setDraft(null)
      setStatus('Saved. New imports will use these rules.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save.')
    }
  }

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-sm font-bold uppercase tracking-wide text-muted"
      >
        Import rules {open ? '▾' : '▸'}
      </button>
      <p className="mb-1 text-xs text-muted">
        How exports become names: what each account is called, stores that go by
        another name, local vendors that count as home upkeep, and rows that
        aren’t spending. Changes apply to future imports.
      </p>
      {open && (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => {
              setDraft(e.target.value)
              setStatus(null)
            }}
            spellCheck={false}
            rows={18}
            aria-label="Import rules (JSON)"
            className="field w-full font-mono text-xs"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={draft === null}
              onClick={() => void save()}
              className="rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background disabled:opacity-40"
            >
              Save rules
            </button>
            {status && <span className="text-xs text-muted">{status}</span>}
          </div>
        </div>
      )}
    </section>
  )
}
