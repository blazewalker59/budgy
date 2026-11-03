/**
 * The demo sandbox (docs/adr/0015): make Demo personas, act as one to see
 * exactly what a new family sees, and put them back to the start. Shown
 * only to admins; every action is checked again on the server.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { reloadAs } from './DemoBanner'
import { SampleDownloads } from './SampleDownloads'
import type { PersonaSummary } from '@/lib/demo/service'
import {
  actAsDemoPersona,
  deleteDemoPersona,
  getDemoPersonas,
  newDemoPersona,
  replayDemoInvite,
  resetDemoPersona,
} from '@/lib/demo/server'
import { MAX_LABEL, SIMPLEFIN_DEMO_TOKEN } from '@/lib/demo/personas'
import { STEP_COPY } from '@/components/setup/progress'
import { cn } from '@/lib/utils'

export const DEMO_PERSONAS_KEY = ['demo-personas'] as const

const button =
  'min-h-11 rounded-full border border-border px-3 text-xs font-semibold disabled:opacity-50'

export function AdminScreen() {
  const queryClient = useQueryClient()
  const personas = useQuery({
    queryKey: DEMO_PERSONAS_KEY,
    queryFn: () => getDemoPersonas(),
    retry: false,
  })
  const [label, setLabel] = useState('')
  const create = useMutation({
    mutationFn: () => newDemoPersona({ data: { label } }),
    onSuccess: () => {
      setLabel('')
      return queryClient.invalidateQueries({ queryKey: DEMO_PERSONAS_KEY })
    },
  })
  return (
    <main className="min-h-dvh bg-background px-3 py-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="space-y-1">
          <a href="/" className="text-xs font-semibold text-muted">
            ← Back to Budgy
          </a>
          <h1 className="text-lg font-extrabold tracking-tight">
            Demo sandbox
          </h1>
          <p className="text-sm text-muted">
            Demo personas are made-up people at <code>demo.invalid</code>. Act
            as one to go through exactly what a new family sees: starting a
            Household, setup, inviting a partner and joining. Their Households
            are marked demo, hold only their own made-up data, and can be reset
            at any time. No real Household is ever shown or touched here.
          </p>
        </header>

        <section className="space-y-2 rounded-xl border border-border bg-surface p-3">
          <h2 className="text-sm font-bold">New persona</h2>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              create.mutate()
            }}
          >
            <label htmlFor="persona-label" className="sr-only">
              Persona name
            </label>
            <input
              id="persona-label"
              className="field min-w-0 flex-1"
              value={label}
              maxLength={MAX_LABEL}
              placeholder="Sam"
              onChange={(e) => setLabel(e.target.value)}
            />
            <button
              type="submit"
              disabled={!label.trim() || create.isPending}
              className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50"
            >
              {create.isPending ? 'Making…' : 'New persona'}
            </button>
          </form>
          {create.isError && (
            <p role="alert" className="text-sm text-danger">
              {create.error.message}
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-bold">Personas</h2>
          {personas.isPending && (
            <p role="status" className="text-sm text-muted">
              Loading…
            </p>
          )}
          {personas.isError && (
            <p role="alert" className="text-sm text-danger">
              {personas.error.message}
            </p>
          )}
          {personas.data?.length === 0 && (
            <p className="text-sm text-muted">
              No personas yet. Make one above.
            </p>
          )}
          <ul className="space-y-2">
            {personas.data?.map((p) => (
              <PersonaCard key={p.id} persona={p} />
            ))}
          </ul>
        </section>

        <section
          id="samples"
          className="space-y-2 rounded-xl border border-border bg-surface p-3"
        >
          <h2 className="text-sm font-bold">Sample exports</h2>
          <p className="text-xs text-muted">
            Made-up purchases at common chains over the last five months, dated
            up to today. Bring them in the way a family would.
          </p>
          <SampleDownloads />
        </section>

        <section className="space-y-2 rounded-xl border border-border bg-surface p-3">
          <h2 className="text-sm font-bold">SimpleFIN demo</h2>
          <p className="text-xs text-muted">
            SimpleFIN’s own reusable demo setup token connects fake accounts (it
            claims{' '}
            <code>https://bridge.simplefin.org/simplefin/claim/demo</code>).
            Paste it on setup’s Connect step or Accounts → Updates → Bank
            connections.
          </p>
          <CopyField
            value={SIMPLEFIN_DEMO_TOKEN}
            label="SimpleFIN demo token"
          />
          <p className="text-xs text-muted">
            The same Bridge access can only be connected once anywhere, so only
            one demo Household can hold it at a time. Reset that persona (or
            disconnect it) before connecting it in another.
          </p>
        </section>

        <section className="space-y-1 rounded-xl border border-border bg-surface p-3 text-xs text-muted">
          <h2 className="text-sm font-bold text-foreground">Good to know</h2>
          <p>
            Acting as a persona lasts until you exit, sign out, or stop being an
            admin. “Use a different Google account” on the persona’s screens
            signs you out.
          </p>
          <p>
            A persona can make Agent and Shortcut tokens to see those screens,
            but they never work: Budgy never admits a demo persona outside your
            demo session. Reset deletes them with everything else.
          </p>
          <p>
            Reset on a Household’s owner deletes that Household (anyone who
            joined it starts over too); on a persona who joined, it only takes
            them out.
          </p>
        </section>
      </div>
    </main>
  )
}

function PersonaCard({ persona }: { persona: PersonaSummary }) {
  const queryClient = useQueryClient()
  const clear = () => queryClient.clear()
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: DEMO_PERSONAS_KEY })
  const [partner, setPartner] = useState('Partner')
  const [link, setLink] = useState<{
    path: string
    id: string
    name: string
  } | null>(null)
  const act = useMutation({
    mutationFn: (to: { id: string; path: string }) =>
      actAsDemoPersona({ data: { personaId: to.id } }).then(() => to.path),
    onSuccess: (path) => reloadAs(path, clear),
  })
  const reset = useMutation({
    mutationFn: () => resetDemoPersona({ data: { personaId: persona.id } }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: () => deleteDemoPersona({ data: { personaId: persona.id } }),
    onSuccess: refresh,
  })
  const replay = useMutation({
    mutationFn: () =>
      replayDemoInvite({
        data: { fromPersonaId: persona.id, label: partner },
      }),
    onSuccess: async (made) => {
      setLink({ path: made.path, id: made.persona.id, name: made.persona.name })
      await refresh()
    },
  })
  const household = persona.household
  const settled =
    household?.steps.filter((s) => s.done || s.skipped).length ?? 0
  const busy =
    act.isPending || reset.isPending || remove.isPending || replay.isPending
  const error = act.error ?? reset.error ?? remove.error ?? replay.error
  return (
    <li className="space-y-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {persona.name}
            {persona.acting && (
              <span className="ml-2 rounded-full bg-amber-300 px-2 py-0.5 text-[11px] text-black">
                Acting as
              </span>
            )}
          </p>
          <p className="text-xs text-muted">{persona.email}</p>
          <p className="text-xs text-muted">
            {household
              ? `${household.role === 'owner' ? 'Owner of' : 'Member of'} ${household.name} · ${household.members} member${household.members === 1 ? '' : 's'}${household.invites ? ` · ${household.invites} invite${household.invites === 1 ? '' : 's'} waiting` : ''} · ${household.accounts} accounts · ${household.purchases} purchases${household.bankConnections ? ` · ${household.bankConnections} bank connection` : ''}`
              : 'No Household yet: starts at “Start your Household”'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            className={cn(button, 'bg-foreground text-background')}
            onClick={() => act.mutate({ id: persona.id, path: '/' })}
          >
            Act as
          </button>
          <button
            type="button"
            disabled={busy || !household}
            className={button}
            onClick={() => {
              if (
                window.confirm(
                  household?.role === 'owner'
                    ? `Delete ${household.name} and everything in it?`
                    : `Take ${persona.name} out of their Household?`,
                )
              )
                reset.mutate()
            }}
          >
            Reset to start
          </button>
          <button
            type="button"
            disabled={busy}
            className={cn(button, 'text-danger')}
            onClick={() => {
              if (window.confirm(`Delete ${persona.name}?`)) remove.mutate()
            }}
          >
            Delete persona
          </button>
        </div>
      </div>
      {household && (
        <div className="space-y-1">
          <p className="text-xs font-semibold">
            Setup: {settled} of {household.steps.length} done
          </p>
          <ol className="flex flex-wrap gap-1">
            {household.steps.map((s) => (
              <li
                key={s.id}
                className={cn(
                  'rounded-full border border-border px-2 py-0.5 text-[11px]',
                  s.done
                    ? 'border-accent text-accent'
                    : s.skipped
                      ? 'text-muted line-through'
                      : 'text-muted',
                )}
              >
                {STEP_COPY[s.id].title}
              </li>
            ))}
          </ol>
        </div>
      )}
      {household?.role === 'owner' && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            replay.mutate()
          }}
        >
          <label
            htmlFor={`partner-${persona.id}`}
            className="text-xs font-semibold"
          >
            Replay invite: new persona
          </label>
          <input
            id={`partner-${persona.id}`}
            className="field w-32"
            value={partner}
            maxLength={MAX_LABEL}
            onChange={(e) => setPartner(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy || !partner.trim()}
            className={button}
          >
            {replay.isPending ? 'Inviting…' : 'Invite them'}
          </button>
        </form>
      )}
      {link && (
        <div className="space-y-2 rounded-lg border border-border bg-background p-2">
          <p className="text-xs">
            {persona.name}’s Household invited {link.name}. The link is shown
            only now:
          </p>
          <CopyField
            value={`${window.location.origin}${link.path}`}
            label="Invitation link"
          />
          <button
            type="button"
            disabled={busy}
            className={cn(button, 'bg-foreground text-background')}
            onClick={() => act.mutate({ id: link.id, path: link.path })}
          >
            Act as {link.name} and open the link
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error.message}
        </p>
      )}
    </li>
  )
}

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <input
        aria-label={label}
        readOnly
        value={value}
        className="field min-w-0 flex-1 font-mono text-xs"
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button"
        className={button}
        onClick={() =>
          void navigator.clipboard.writeText(value).then(() => setCopied(true))
        }
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
