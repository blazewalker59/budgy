/**
 * The Import Rules, edited as JSON at the foot of Accounts.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getImportRules, setImportRules } from '@/lib/ledger/server'
import { useSession } from '@/lib/ledger/useLedger'

const RULES_KEY = ['import-rules'] as const

/**
 * The Household's Import Rules as JSON: store aliases, local upkeep
 * vendors, rows that aren't spending. Kept in the database, not the code
 * (docs/adr/0003).
 */
export function ImportRules() {
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)
  const rules = useQuery({
    queryKey: [
      ...RULES_KEY,
      session?.status === 'member' ? session.household.id : null,
      session?.status === 'member' ? session.member.id : null,
    ],
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
      setStatus('Saved. New uploads will use these rules.')
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Couldn’t save. Try again.',
      )
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
      <div className="mb-1 space-y-0.5 text-xs text-muted">
        <p>How future uploads are named and categorized.</p>
        <ul className="list-disc pl-4">
          <li>Stores that go by another name</li>
          <li>Hardware stores and other home upkeep</li>
          <li>Descriptions that aren’t upkeep</li>
          <li>The category that splits into mortgage and utilities</li>
          <li>Rows that aren’t spending</li>
        </ul>
      </div>
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
