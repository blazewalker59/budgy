/**
 * SimpleFIN Bridge connections (docs/adr/0010), kept out of the way: a
 * collapsed section for connecting, refreshing and syncing, and a per-Account
 * select (BankLink) for choosing which bank account feeds each Budgy Account.
 * Linked accounts sync four times a day, or now.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ChevronDown, Landmark, RefreshCw } from 'lucide-react'
import type { Account } from '@/lib/model/types'
import type { SyncedAccount } from '@/lib/updates/sync'
import {
  connectBank,
  disconnectBank,
  linkBankAccount,
  refreshBankAccounts,
  syncBank,
} from '@/lib/updates/server'
import {
  BANK_CONNECTIONS_KEY,
  UPDATES_KEY,
  useBankConnections,
} from '@/lib/updates/useUpdates'
import { LEDGER_KEY } from '@/lib/ledger/useLedger'

type Connection = NonNullable<
  ReturnType<typeof useBankConnections>['data']
>[number]
export type BankAccount = Connection['accounts'][number]

/** The bank account feeding a Budgy Account, if one is linked. */
export function useBankLink(account: string): BankAccount | null {
  const connections = useBankConnections()
  return (
    connections.data
      ?.flatMap((c) => c.accounts)
      .find((a) => a.account === account) ?? null
  )
}

export function BankConnections({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const connections = useBankConnections()
  const [adding, setAdding] = useState(false)
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: BANK_CONNECTIONS_KEY })
  const all = connections.data ?? []
  const banks = all.flatMap((c) => c.accounts)
  const linked = banks.filter((b) => b.account).length
  const attention = all.some((c) => c.status === 'attention')
  const sync = useMutation({
    mutationFn: async () => {
      const results: Array<SyncedAccount> = []
      for (const c of all.filter((x) => x.accounts.some((a) => a.account)))
        results.push(...(await syncBank({ data: { id: c.id } })))
      return results
    },
    onSettled: () =>
      Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: LEDGER_KEY }),
        queryClient.invalidateQueries({ queryKey: UPDATES_KEY }),
      ]),
  })
  const failed = sync.data?.filter((r) => r.error) ?? []

  return (
    <section className="rounded-xl border border-border bg-surface text-xs">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Landmark size={14} aria-hidden className="shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm font-bold">Bank connections</span>
            <span className="block truncate text-muted">
              {!all.length
                ? 'Connect SimpleFIN Bridge to sync banks automatically'
                : `SimpleFIN · ${linked} of ${banks.length} accounts linked`}
              {attention && (
                <span className="text-over"> · needs attention</span>
              )}
            </span>
          </span>
          <ChevronDown
            size={16}
            aria-hidden
            className={`ml-auto shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {linked > 0 && (
          <button
            type="button"
            disabled={sync.isPending}
            onClick={() => sync.mutate()}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 font-semibold disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              aria-hidden
              className={sync.isPending ? 'animate-spin' : ''}
            />
            {sync.isPending ? 'Syncing…' : 'Sync now'}
          </button>
        )}
      </div>

      {(sync.data || sync.isError) && (
        <div role="status" className="space-y-0.5 px-3 pb-3">
          {sync.isError ? (
            <p className="text-over">{sync.error.message}</p>
          ) : (
            <p className="text-accent">
              Synced {sync.data!.length - failed.length} of {sync.data!.length}{' '}
              linked accounts.
            </p>
          )}
          {failed.map((r) => (
            <p key={r.account} className="text-over">
              {r.account}: {r.error}
            </p>
          ))}
        </div>
      )}

      {open && (
        <div className="space-y-3 border-t border-border p-3">
          <p className="text-muted">
            SimpleFIN Bridge reads your banks; your bank logins stay with
            Bridge. Choose which Budgy Account each bank account feeds on that
            Account below: cards and bank accounts bring in posted purchases and
            balances, others just their balance.
          </p>
          {connections.isError && (
            <p role="alert" className="text-over">
              {connections.error.message}
            </p>
          )}
          {all.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              onChange={refresh}
            />
          ))}
          {adding ? (
            <ConnectForm
              onDone={async () => {
                setAdding(false)
                await refresh()
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="min-h-11 rounded-full border border-border px-3 font-semibold"
            >
              {all.length ? 'Add another connection' : 'Connect SimpleFIN'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function ConnectForm({
  onDone,
  onCancel,
}: {
  onDone: () => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState('SimpleFIN')
  const [setupToken, setSetupToken] = useState('')
  const connect = useMutation({
    mutationFn: () => connectBank({ data: { name, setupToken } }),
    onSuccess: onDone,
  })
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        connect.mutate()
      }}
    >
      <ol className="list-decimal space-y-1 pl-4 text-muted">
        <li>
          At{' '}
          <a
            href="https://bridge.simplefin.org"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-accent"
          >
            bridge.simplefin.org
          </a>
          , connect your banks.
        </li>
        <li>Create a new setup token there and paste it below.</li>
      </ol>
      <label className="block space-y-1 font-semibold">
        Name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          className="field min-h-11 w-full"
        />
      </label>
      <label className="block space-y-1 font-semibold">
        Setup token
        <textarea
          value={setupToken}
          onChange={(event) => setSetupToken(event.target.value)}
          rows={3}
          autoComplete="off"
          spellCheck={false}
          className="field w-full font-mono"
        />
      </label>
      <p className="text-muted">
        A setup token works once. Budgy stores the access it grants encrypted,
        and only lists accounts until you link them.
      </p>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!setupToken.trim() || !name.trim() || connect.isPending}
          className="min-h-11 rounded-full bg-foreground px-4 font-semibold text-background disabled:opacity-50"
        >
          {connect.isPending ? 'Connecting…' : 'Connect'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-full border border-border px-4 font-semibold"
        >
          Cancel
        </button>
      </div>
      {connect.isError && (
        <p role="alert" className="text-over">
          {connect.error.message}
        </p>
      )}
    </form>
  )
}

function ConnectionRow({
  connection,
  onChange,
}: {
  connection: Connection
  onChange: () => Promise<void>
}) {
  const discover = useMutation({
    mutationFn: () => refreshBankAccounts({ data: { id: connection.id } }),
    onSettled: onChange,
  })
  const disconnect = useMutation({
    mutationFn: () => disconnectBank({ data: { id: connection.id } }),
    onSettled: onChange,
  })
  const unlinked = connection.accounts.filter((a) => !a.account && a.present)
  const problem =
    discover.error?.message ??
    disconnect.error?.message ??
    (connection.status === 'attention' ? connection.lastError : null)

  return (
    <div className="space-y-1.5 rounded-lg bg-background p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{connection.name}</p>
          <p className="truncate text-muted">
            Connected by {connection.createdBy}
            {connection.lastFetchedAt
              ? ` · checked ${new Date(connection.lastFetchedAt).toLocaleString()}`
              : ''}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            aria-label={`Refresh accounts for ${connection.name}`}
            disabled={discover.isPending}
            onClick={() => discover.mutate()}
            className="flex size-11 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              className={discover.isPending ? 'animate-spin' : ''}
            />
          </button>
          <button
            type="button"
            disabled={disconnect.isPending}
            onClick={() => {
              if (
                confirm(
                  `Disconnect ${connection.name}? Budgy forgets its access; revoke it in SimpleFIN Bridge too. Purchases already in Budgy stay.`,
                )
              )
                disconnect.mutate()
            }}
            className="min-h-11 rounded-full px-2 font-semibold text-muted hover:text-over disabled:opacity-50"
          >
            Disconnect
          </button>
        </div>
      </div>
      {problem && (
        <p role="alert" className="text-over">
          {problem}
        </p>
      )}
      <p className="text-muted">
        {!connection.accounts.length
          ? 'No accounts found yet. Connect banks in Bridge, then refresh.'
          : unlinked.length
            ? `Not linked yet: ${unlinked.map((a) => `${a.name} (${a.institution})`).join(', ')}.`
            : `All ${connection.accounts.length} accounts are linked.`}
      </p>
    </div>
  )
}

/** Choose the bank account that feeds this Budgy Account, or none. */
export function BankLink({ account }: { account: Account }) {
  const queryClient = useQueryClient()
  const connections = useBankConnections()
  const link = useMutation({
    mutationFn: async (value: string) => {
      const current = connections.data
        ?.flatMap((c) => c.accounts)
        .find((a) => a.account === account.name)
      if (!value) {
        if (current)
          await linkBankAccount({
            data: {
              connectionId: current.connectionId,
              providerId: current.providerId,
              account: null,
            },
          })
        return
      }
      const [connectionId, providerId] = JSON.parse(value) as [string, string]
      if (current)
        await linkBankAccount({
          data: {
            connectionId: current.connectionId,
            providerId: current.providerId,
            account: null,
          },
        })
      await linkBankAccount({
        data: { connectionId, providerId, account: account.name },
      })
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: BANK_CONNECTIONS_KEY }),
  })
  const all = connections.data ?? []
  const current = all
    .flatMap((c) => c.accounts)
    .find((a) => a.account === account.name)
  const key = (b: BankAccount) => JSON.stringify([b.connectionId, b.providerId])

  return (
    <div className="space-y-1.5 border-t border-border pt-3 text-xs">
      <label className="block space-y-1 font-semibold">
        SimpleFIN account
        <select
          aria-label={`SimpleFIN account for ${account.name}`}
          value={current ? key(current) : ''}
          disabled={link.isPending}
          onChange={(event) => link.mutate(event.target.value)}
          className="field min-h-11 w-full"
        >
          <option value="">Not linked</option>
          {all.map((c) => (
            <optgroup key={c.id} label={c.name}>
              {c.accounts.map((b) => {
                const elsewhere = b.account && b.account !== account.name
                const usable = b.currency.toUpperCase() === 'USD' && b.present
                return (
                  <option
                    key={key(b)}
                    value={key(b)}
                    disabled={!!elsewhere || !usable}
                  >
                    {b.name} · {b.institution}
                    {elsewhere ? ` (feeds ${b.account})` : ''}
                    {!usable ? ' (unavailable)' : ''}
                  </option>
                )
              })}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="text-muted">
        {['credit', 'checking', 'savings'].includes(account.kind)
          ? 'Posted purchases and the balance come in on each sync; nothing is added twice.'
          : 'Its balance is recorded on each sync.'}
      </p>
      {link.isError && (
        <p role="alert" className="text-over">
          {link.error.message}
        </p>
      )}
    </div>
  )
}
