/**
 * Agents (docs/adr/0004): API tokens that let an AI agent use Budgy as
 * you through the MCP server at /mcp, and how to point one at it, including
 * a daily digest on a schedule. A new token is shown once.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  createApiToken,
  getApiTokens,
  revokeApiToken,
} from '@/lib/agents/server'
import { useSession } from '@/lib/ledger/useLedger'
import { CopyLine } from '@/components/shared/CopyLine'

const TOKENS_KEY = ['api-tokens']

const DAILY_PROMPT = `Every morning: if you have an account’s new posted purchases, add them to Budgy with add_transactions (commit true), leaving out payments and transfers. Then call get_daily_digest for yesterday and send me a short summary: what we spent by person and account, anything unusual, and every Budget Alert, most urgent first. Do not invent or assume bank access; mention any account whose source data looks out of date.`

export function AgentsScreen() {
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const tokens = useQuery({
    queryKey: [
      ...TOKENS_KEY,
      session?.status === 'member' ? session.member.id : null,
      session?.status === 'member' ? session.household.id : null,
    ],
    queryFn: () => getApiTokens(),
  })
  const [name, setName] = useState('')
  const [write, setWrite] = useState(true)
  const [created, setCreated] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: (v: { name: string; write: boolean }) =>
      createApiToken({ data: v }),
    onSuccess: (r) => {
      setCreated(r.token)
      setName('')
      void queryClient.invalidateQueries({ queryKey: TOKENS_KEY })
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiToken({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TOKENS_KEY }),
  })
  const endpoint =
    typeof window === 'undefined' ? '/mcp' : `${window.location.origin}/mcp`
  const token = created ?? 'bg_…'

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-extrabold tracking-tight">Agents</h1>
        <p className="text-xs text-muted">
          Let an AI agent, like Claude or your own bot, use Budgy as you. It
          can:
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted">
          <li>Answer questions about your spending</li>
          <li>Send Budget Alerts and a daily digest</li>
          <li>
            Import purchases, change categories and add notes, if you allow it
          </li>
        </ul>
      </div>

      {created ? (
        <section
          role="status"
          className="space-y-2 rounded-xl border border-accent/50 bg-accent-soft px-3 py-2.5 text-[13px]"
        >
          <p className="font-semibold">Your new token</p>
          <p className="text-xs text-muted">
            Copy it now. It won’t be shown again. Keep it secret, since anyone
            with it can read your budget.
          </p>
          <CopyLine text={created} label="token" />
          <button
            type="button"
            onClick={() => setCreated(null)}
            className="rounded-full px-2 py-0.5 text-xs font-semibold text-muted"
          >
            Done
          </button>
        </section>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) create.mutate({ name: name.trim(), write })
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoComplete="off"
            placeholder="Token name, e.g. Claude daily digest"
            aria-label="Token name"
            className="field min-w-48 flex-1"
          />
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={write}
              onChange={(e) => setWrite(e.target.checked)}
            />
            Can import and edit
          </label>
          <button
            type="submit"
            disabled={!name.trim() || create.isPending}
            className="rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background disabled:opacity-40"
          >
            {create.isPending ? 'Creating…' : 'Create token'}
          </button>
          {create.error && (
            <p role="alert" className="w-full text-xs text-over">
              {create.error.message}
            </p>
          )}
        </form>
      )}

      <section className="space-y-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-[13px]">
        <p className="font-semibold">Connect an agent</p>
        <p className="text-xs text-muted">
          Add an MCP server with this URL and header.
        </p>
        <CopyLine text={endpoint} label="URL" />
        <CopyLine text={`Authorization: Bearer ${token}`} label="header" />
        <p className="pt-1 text-xs text-muted">Or run this in Claude Code.</p>
        <CopyLine
          text={`claude mcp add --transport http budgy ${endpoint} --header "Authorization: Bearer ${token}"`}
          label="Claude Code command"
        />
      </section>

      <section className="space-y-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-[13px]">
        <p className="font-semibold">A daily digest</p>
        <p className="text-xs text-muted">
          Have your agent run this each morning, for example as a Claude
          scheduled task or a cron job. The digest only covers what’s been
          imported. With a token that can import, the agent adds new purchases
          first.
        </p>
        <CopyLine text={DAILY_PROMPT} label="daily prompt" />
      </section>

      <section>
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted">
          Your tokens
        </h2>
        {tokens.isPending ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : !tokens.data?.length ? (
          <p className="text-xs text-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {tokens.data.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 px-3 py-1.5 text-[13px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{t.name}</span>
                  <span className="block truncate text-[11px] text-muted">
                    <span className="font-mono">{t.prefix}…</span> ·{' '}
                    {t.scopes.includes('write')
                      ? 'read, import, edit'
                      : 'read only'}{' '}
                    ·{' '}
                    {t.lastUsedAt
                      ? `used ${new Date(t.lastUsedAt).toLocaleString()}`
                      : 'never used'}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={revoke.isPending}
                  onClick={() => {
                    if (confirm(`Revoke “${t.name}”? Its agent stops working.`))
                      revoke.mutate(t.id)
                  }}
                  className="rounded-full px-2 py-0.5 text-xs font-semibold text-muted hover:text-over disabled:opacity-50"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
