/**
 * SimpleFIN Bridge connections (docs/adr/0010): connect with a setup token,
 * see the accounts it shares, and link each to a Budgy Account. Linking
 * imports nothing yet; syncing purchases is the next step.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Landmark, RefreshCw } from 'lucide-react'
import type { Account } from '@/lib/model/types'
import {
  connectBank,
  disconnectBank,
  linkBankAccount,
  refreshBankAccounts,
} from '@/lib/updates/server'
import {
  BANK_CONNECTIONS_KEY,
  useBankConnections,
} from '@/lib/updates/useUpdates'

type Connection = NonNullable<
  ReturnType<typeof useBankConnections>['data']
>[number]

export function BankConnections({ accounts }: { accounts: Array<Account> }) {
  const queryClient = useQueryClient()
  const connections = useBankConnections()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('SimpleFIN')
  const [setupToken, setSetupToken] = useState('')
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: BANK_CONNECTIONS_KEY })
  const connect = useMutation({
    mutationFn: () => connectBank({ data: { name, setupToken } }),
    onSuccess: async () => {
      setSetupToken('')
      setAdding(false)
      await refresh()
    },
  })
  const linkable = accounts.filter(
    (a) => !a.closed && ['credit', 'checking', 'savings'].includes(a.kind),
  )

  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold">
            <Landmark size={14} aria-hidden />
            Bank connections
          </h2>
          <p className="text-xs text-muted">
            Through SimpleFIN Bridge: read-only, and your bank login stays with
            Bridge. Link each account to a Budgy Account; automatic purchase
            syncing comes next.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-border px-3 text-xs font-semibold"
          >
            Connect
          </button>
        )}
      </div>

      {adding && (
        <form
          className="space-y-2 border-t border-border pt-3 text-xs"
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
            A setup token works once. Budgy stores the access it grants
            encrypted, and only lists accounts until you link them.
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
              onClick={() => {
                setAdding(false)
                connect.reset()
              }}
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
      )}

      {connections.isError && (
        <p role="alert" className="text-xs text-over">
          {connections.error.message}
        </p>
      )}
      {connections.data?.map((connection) => (
        <ConnectionRow
          key={connection.id}
          connection={connection}
          accounts={linkable}
          onChange={refresh}
        />
      ))}
    </section>
  )
}

function ConnectionRow({
  connection,
  accounts,
  onChange,
}: {
  connection: Connection
  accounts: Array<Account>
  onChange: () => Promise<void>
}) {
  const discover = useMutation({
    mutationFn: () => refreshBankAccounts({ data: { id: connection.id } }),
    onSettled: onChange,
  })
  const link = useMutation({
    mutationFn: (data: { providerId: string; account: string | null }) =>
      linkBankAccount({ data: { connectionId: connection.id, ...data } }),
    onSettled: onChange,
  })
  const disconnect = useMutation({
    mutationFn: () => disconnectBank({ data: { id: connection.id } }),
    onSettled: onChange,
  })
  const taken = new Set(
    connection.accounts.flatMap((a) => (a.account ? [a.account] : [])),
  )
  const problem =
    discover.error?.message ??
    link.error?.message ??
    disconnect.error?.message ??
    (connection.status === 'attention' ? connection.lastError : null)

  return (
    <div className="space-y-2 border-t border-border pt-3 text-xs">
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
      {!connection.accounts.length ? (
        <p className="text-muted">
          No accounts found yet. Connect banks in Bridge, then refresh.
        </p>
      ) : (
        <ul className="space-y-2">
          {connection.accounts.map((bank) => (
            <li
              key={bank.providerId}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold">
                  {bank.name}
                </span>
                <span className="block truncate text-muted">
                  {bank.institution}
                  {bank.currency.toUpperCase() !== 'USD'
                    ? ` · ${bank.currency} (not supported)`
                    : ''}
                  {!bank.present ? ' · no longer shared by Bridge' : ''}
                </span>
              </span>
              <select
                aria-label={`Budgy Account for ${bank.name}`}
                value={bank.account ?? ''}
                disabled={
                  link.isPending || bank.currency.toUpperCase() !== 'USD'
                }
                onChange={(event) =>
                  link.mutate({
                    providerId: bank.providerId,
                    account: event.target.value || null,
                  })
                }
                className="field min-h-11 w-full sm:w-56"
              >
                <option value="">Not linked</option>
                {accounts.map((a) => (
                  <option
                    key={a.name}
                    value={a.name}
                    disabled={taken.has(a.name) && a.name !== bank.account}
                  >
                    {a.name}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
