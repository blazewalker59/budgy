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
  reconnectBank,
  refreshBankAccounts,
  syncBank,
} from '@/lib/updates/server'
import {
  BANK_CONNECTIONS_KEY,
  UPDATES_KEY,
  useBankConnections,
} from '@/lib/updates/useUpdates'
import { LEDGER_KEY } from '@/lib/ledger/useLedger'
import { MONEY_IN_KEY } from '@/lib/moneyIn/useMoneyIn'
import { ConfirmPanel } from '@/components/shared/Confirm'
import { Dropdown } from '@/components/shared/Dropdown'
import {
  AddBankAccounts,
  unlinkedBankAccounts,
} from '@/components/accounts/AddBankAccounts'
import {
  checkedAgo,
  connectionHealth,
  syncingLabel,
  troubleLabel,
} from '@/lib/model/bankHealth'

type Connection = NonNullable<
  ReturnType<typeof useBankConnections>['data']
>[number]
export type BankAccount = Connection['accounts'][number]

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
  const health = connectionHealth(
    banks,
    all.flatMap((c) => c.issues ?? []),
  )
  // A connection Bridge stopped accepting is the whole connection's problem;
  // otherwise only the banks named have one.
  const stopped = all.some(
    (c) => c.status === 'revoked' || c.status === 'payment_required',
  )
  const note = stopped
    ? 'needs reconnecting'
    : (troubleLabel(health) ??
      // Saved before problems were kept per bank: until its next read.
      (all.some((c) => c.status === 'attention') ? 'needs attention' : null))
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
        queryClient.invalidateQueries({ queryKey: MONEY_IN_KEY }),
      ]),
  })
  const failed = sync.data?.filter((r) => r.error) ?? []
  const moneyIn = sync.data?.reduce((n, r) => n + (r.moneyIn ?? 0), 0) ?? 0

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
                : `SimpleFIN · ${linked} of ${banks.length} linked`}
            </span>
            {/* Its own line, so a narrow phone never cuts off what's wrong. */}
            {note && (
              <span
                className={`block truncate ${stopped ? 'text-over' : 'text-nice'}`}
              >
                {note}
              </span>
            )}
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
              {moneyIn > 0 && ` ${moneyIn} new money in to see under Money in.`}
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
          {!all.length && (
            <ul className="list-disc space-y-0.5 pl-4 text-muted">
              <li>
                SimpleFIN Bridge reads your banks. Your logins stay there.
              </li>
              <li>
                Add the accounts it finds here at once, or link each one from
                its Budgy account below.
              </li>
              <li>
                Cards and bank accounts bring in purchases and balances. Others
                bring in just the balance.
              </li>
            </ul>
          )}
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
          <AddFound banks={banks} />
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

export const SIMPLEFIN_SIGN_UP = 'https://bridge.simplefin.org/simplefin/create'
/** Where a Member signs in to Bridge: to renew, re-authorize a bank, or make a token. */
export const SIMPLEFIN_BRIDGE = 'https://bridge.simplefin.org/'

/** What SimpleFIN Bridge is and costs, before anyone signs up. */
export function SimplefinNote() {
  return (
    <p className="text-muted">
      SimpleFIN Bridge is a separate service, about $1.50 a month or $15 a year,
      for up to 25 banks. It can’t reach every card (Apple Card, for one). For
      those, upload an export instead.
    </p>
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
      <SimplefinNote />
      <ol className="list-decimal space-y-1 pl-4 text-muted">
        <li>
          <a
            href={SIMPLEFIN_SIGN_UP}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-accent"
          >
            Sign up for SimpleFIN Bridge
          </a>{' '}
          and connect your banks there.
        </li>
        <li>
          Create a <strong>setup token</strong> there and paste it below.
        </li>
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
        Each setup token works once. Accounts aren’t synced until you link them.
        Linking one brings in up to 6 months of its history, where the bank
        allows.
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
  const [confirming, setConfirming] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const unlinked = connection.accounts.filter((a) => !a.account && a.present)
  const health = connectionHealth(connection.accounts, connection.issues)
  const stopped =
    connection.status === 'revoked' || connection.status === 'payment_required'
  // Bridge's problems are shown per bank below; this is for what happened
  // here (a refresh or disconnect failing) or the whole connection stopping.
  const problem =
    discover.error?.message ??
    disconnect.error?.message ??
    (stopped || (connection.status === 'attention' && !connection.issues)
      ? connection.lastError
      : null)

  return (
    <div className="space-y-1.5 rounded-lg bg-background p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{connection.name}</p>
          <p className="truncate text-muted">
            {stopped ? 'Paused' : syncingLabel(health)}
            {connection.lastFetchedAt && (
              <span title={new Date(connection.lastFetchedAt).toLocaleString()}>
                {' '}
                · checked {checkedAgo(connection.lastFetchedAt)}
              </span>
            )}
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
            onClick={() => setConfirming(true)}
            className="min-h-11 rounded-full px-2 font-semibold text-muted hover:text-over disabled:opacity-50"
          >
            Disconnect
          </button>
        </div>
      </div>
      {confirming && (
        <ConfirmPanel
          question={`Disconnect ${connection.name}?`}
          detail="Purchases already in Budgy stay. Also revoke access in SimpleFIN Bridge."
          action="Disconnect"
          onConfirm={() => {
            setConfirming(false)
            disconnect.mutate()
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
      {problem && (
        <p role="alert" className="text-over">
          {problem}
        </p>
      )}
      {connection.status === 'revoked' &&
        (reconnecting ? (
          <ReconnectForm
            id={connection.id}
            onDone={async () => {
              setReconnecting(false)
              await onChange()
            }}
            onCancel={() => setReconnecting(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setReconnecting(true)}
            className="min-h-11 rounded-full bg-foreground px-4 font-semibold text-background"
          >
            Reconnect
          </button>
        ))}
      {connection.status === 'payment_required' && (
        <a
          href={SIMPLEFIN_BRIDGE}
          target="_blank"
          rel="noreferrer"
          className="inline-block font-semibold text-accent"
        >
          Renew in SimpleFIN Bridge
        </a>
      )}
      {!stopped && health.banks.length > 0 && (
        <BankTroubles banks={health.banks} />
      )}
      {!connection.accounts.length ? (
        <p className="text-muted">
          No accounts yet. Connect banks in SimpleFIN Bridge, then refresh.
        </p>
      ) : unlinked.length ? (
        <div className="space-y-0.5">
          <p className="text-muted">
            {unlinked.length === 1
              ? '1 account isn’t linked yet:'
              : `${unlinked.length} accounts aren’t linked yet:`}
          </p>
          <ul className="list-disc pl-4 text-muted">
            {unlinked.map((a) => (
              <li key={a.providerId}>
                {a.name} <span className="opacity-70">· {a.institution}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-muted">Connected by {connection.createdBy}</p>
    </div>
  )
}

const TROUBLE_TEXT = {
  'sign-in': 'Sign in to this bank again in SimpleFIN Bridge.',
  failed: 'SimpleFIN couldn’t read it this time. Budgy will try again.',
  other: 'SimpleFIN reported a problem.',
} as const

/** Each bank with a problem once: what to do, and which Accounts wait on it. */
function BankTroubles({
  banks,
}: {
  banks: ReturnType<typeof connectionHealth>['banks']
}) {
  const signIn = banks.some((b) => b.trouble === 'sign-in')
  return (
    <div className="space-y-1.5">
      <ul className="space-y-1.5">
        {banks.map((bank) => (
          <li
            key={bank.institution}
            className="rounded-md border-l-2 border-nice bg-surface px-2.5 py-1.5"
          >
            <p className="font-semibold">{bank.institution}</p>
            <p>{TROUBLE_TEXT[bank.trouble]}</p>
            <p className="text-muted">
              {bank.affects.length
                ? `Waiting: ${bank.affects.join(', ')}`
                : 'None of your Budgy accounts use it yet.'}
            </p>
            {bank.said.length > 0 && (
              <p className="text-muted opacity-80">
                SimpleFIN says: {bank.said.map(sentence).join(' ')}
              </p>
            )}
          </li>
        ))}
      </ul>
      {signIn && (
        <a
          href={SIMPLEFIN_BRIDGE}
          target="_blank"
          rel="noreferrer"
          className="inline-block font-semibold text-accent"
        >
          Open SimpleFIN Bridge
        </a>
      )}
    </div>
  )
}

/** Bridge's messages often run two phrases together without a stop. */
function sentence(text: string): string {
  const joined = text.replace(/([a-z])\. ?([A-Z][a-z]+ required)$/, '$1. $2')
  return /[.!?…]$/.test(joined) ? joined : `${joined}.`
}

/** A new setup token for a connection Bridge stopped accepting. */
function ReconnectForm({
  id,
  onDone,
  onCancel,
}: {
  id: string
  onDone: () => Promise<void>
  onCancel: () => void
}) {
  const [setupToken, setSetupToken] = useState('')
  const reconnect = useMutation({
    mutationFn: () => reconnectBank({ data: { id, setupToken } }),
    onSuccess: onDone,
  })
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        reconnect.mutate()
      }}
    >
      <p className="text-muted">
        In{' '}
        <a
          href={SIMPLEFIN_BRIDGE}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-accent"
        >
          SimpleFIN Bridge
        </a>
        , create a new setup token and paste it here. Linked accounts stay
        linked.
      </p>
      <label className="block space-y-1 font-semibold">
        New setup token
        <textarea
          value={setupToken}
          onChange={(event) => setSetupToken(event.target.value)}
          rows={3}
          autoComplete="off"
          spellCheck={false}
          className="field w-full font-mono"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!setupToken.trim() || reconnect.isPending}
          className="min-h-11 rounded-full bg-foreground px-4 font-semibold text-background disabled:opacity-50"
        >
          {reconnect.isPending ? 'Reconnecting…' : 'Reconnect'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-full border border-border px-4 font-semibold"
        >
          Cancel
        </button>
      </div>
      {reconnect.isError && (
        <p role="alert" className="text-over">
          {reconnect.error.message}
        </p>
      )}
    </form>
  )
}

/** Bank accounts found and not linked: offer to add them all at once. */
export function AddFound({ banks }: { banks: Array<BankAccount> }) {
  const [open, setOpen] = useState(false)
  const unlinked = unlinkedBankAccounts(banks)
  const feeding = banks.flatMap((b) => (b.account ? [b.account] : []))
  if (!unlinked.length) return null
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 rounded-full bg-foreground px-4 font-semibold text-background"
      >
        Add these accounts ({unlinked.length})
      </button>
    )
  return (
    <div className="space-y-2 rounded-lg bg-background p-2.5">
      <p className="font-semibold">Add these accounts</p>
      <AddBankAccounts
        // A fresh list each time it opens, from what's unlinked now.
        key={unlinked.map((b) => b.providerId).join()}
        banks={unlinked}
        feeding={feeding}
        onDone={() => setOpen(false)}
      />
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
        <Dropdown
          label={`SimpleFIN account for ${account.name}`}
          value={current ? key(current) : ''}
          disabled={link.isPending}
          onChange={(value) => link.mutate(value)}
          className="min-h-11 w-full"
          options={[
            { value: '', label: 'Not linked' },
            ...all.map((c) => ({
              group: c.name,
              options: c.accounts.map((b) => {
                const elsewhere = b.account && b.account !== account.name
                const usable = b.currency.toUpperCase() === 'USD' && b.present
                return {
                  value: key(b),
                  label: `${b.name} · ${b.institution}`,
                  hint: elsewhere
                    ? `feeds ${b.account}`
                    : !usable
                      ? 'unavailable'
                      : undefined,
                  disabled: !!elsewhere || !usable,
                }
              }),
            })),
          ]}
        />
      </label>
      <p className="text-muted">
        {['credit', 'checking', 'savings'].includes(account.kind)
          ? 'Purchases and the balance come in on each sync.'
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
