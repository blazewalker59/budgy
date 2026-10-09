/**
 * The Import Rules, edited as JSON at the foot of Accounts.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getImportRules, setImportRules } from '@/lib/ledger/server'

const RULES_KEY = ['import-rules'] as const

/**
 * The Household's Import Rules as JSON: store aliases, local upkeep
 * vendors, rows that aren't spending. Kept in the database, not the code
 * (docs/adr/0003).
 */
export function ImportRules() {
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
        How uploaded purchases are named and filed: stores that go by another
        name, local vendors that count as home upkeep, and rows that aren’t
        spending. Changes apply to future uploads.
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
