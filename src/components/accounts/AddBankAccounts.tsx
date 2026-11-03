/**
 * "Add these accounts": every bank account SimpleFIN found that feeds
 * nothing yet, each made a new Budgy Account (name, kind, owner and bank
 * filled in, all editable), linked to one already here, or skipped. One
 * save adds and links them all (docs/adr/0013).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { BankAccount } from './BankConnections'
import type { AccountKind } from '@/lib/model/types'
import type { BankAccountChoice } from '@/lib/updates/connections'
import { ACCOUNT_KINDS, ACCOUNT_KIND_LABELS } from '@/lib/model/types'
import { guessAccountKind } from '@/lib/model/accounts'
import { useBook } from '@/lib/ledger/book'
import { LEDGER_KEY } from '@/lib/ledger/useLedger'
import { addFromBank } from '@/lib/updates/server'
import { BANK_CONNECTIONS_KEY } from '@/lib/updates/useUpdates'
import { Dropdown } from '@/components/shared/Dropdown'
import { Segmented } from '@/components/shared/Layout'
import { OwnerInput } from '@/components/accounts/AccountsScreen'

type Action = 'new' | 'link' | 'skip'

interface Row {
  action: Action
  name: string
  kind: AccountKind
  owner: string
  institution: string
  link: string
}

const ACTIONS: ReadonlyArray<{ value: Action; label: string }> = [
  { value: 'new', label: 'Add' },
  { value: 'link', label: 'Link' },
  { value: 'skip', label: 'Skip' },
]

const keyOf = (b: BankAccount) => JSON.stringify([b.connectionId, b.providerId])

/** Bank accounts that could feed a Budgy Account and don't yet. */
export function unlinkedBankAccounts(
  banks: ReadonlyArray<BankAccount>,
): Array<BankAccount> {
  return banks.filter(
    (b) => !b.account && b.present && b.currency.toUpperCase() === 'USD',
  )
}

export function AddBankAccounts({
  banks,
  feeding = [],
  onDone,
}: {
  /** The bank accounts to offer (unlinked ones). */
  banks: ReadonlyArray<BankAccount>
  /** Budgy Accounts a bank account already feeds. */
  feeding?: ReadonlyArray<string>
  onDone?: (result: { added: number; linked: number }) => void
}) {
  const { ix } = useBook()
  const queryClient = useQueryClient()
  const accounts = ix.ledger.accounts
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      banks.map((b) => [
        keyOf(b),
        {
          action: 'new' as Action,
          name: b.name.slice(0, 60),
          kind: guessAccountKind(b.name),
          owner: 'Joint',
          institution: b.institution.slice(0, 60),
          link: '',
        },
      ]),
    ),
  )
  const save = useMutation({
    mutationFn: (choices: Array<BankAccountChoice>) =>
      addFromBank({ data: { choices } }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: LEDGER_KEY }),
        queryClient.invalidateQueries({ queryKey: BANK_CONNECTIONS_KEY }),
      ])
      onDone?.(result)
    },
  })
  const set = (key: string, patch: Partial<Row>) =>
    setRows((r) => ({ ...r, [key]: { ...r[key], ...patch } }))

  const choices = banks.flatMap((b): Array<BankAccountChoice> => {
    const r = rows[keyOf(b)] as Row | undefined
    if (!r || r.action === 'skip') return []
    const where = { connectionId: b.connectionId, providerId: b.providerId }
    if (r.action === 'link') return r.link ? [{ ...where, link: r.link }] : []
    return [
      {
        ...where,
        create: {
          name: r.name.trim(),
          kind: r.kind,
          owner: r.owner.trim() || 'Joint',
          institution: r.institution.trim() || null,
        },
      },
    ]
  })
  const names = choices.map((c) =>
    ('create' in c ? c.create.name : c.link).toLowerCase(),
  )
  const clash = (name: string) =>
    accounts.some((a) => a.name.toLowerCase() === name.trim().toLowerCase())
  const problem = names.some((n, i) => names.indexOf(n) !== i)
    ? 'Two bank accounts are going to the same account.'
    : choices.some(
          (c) => 'create' in c && (!c.create.name || clash(c.create.name)),
        )
      ? 'Each new account needs a name not already used.'
      : null
  // Open Accounts no bank account feeds yet, to link to.
  const linkable = accounts.filter(
    (a) => !a.closed && !feeding.includes(a.name),
  )

  if (!banks.length)
    return (
      <p className="text-xs text-muted">
        Every bank account SimpleFIN found is linked.
      </p>
    )

  return (
    <form
      className="space-y-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault()
        if (choices.length && !problem) save.mutate(choices)
      }}
    >
      <p className="text-muted">
        Check each one. <strong>Add</strong> makes a new account here,{' '}
        <strong>Link</strong> feeds one you already have.
      </p>
      <ul className="space-y-2">
        {banks.map((b) => {
          const key = keyOf(b)
          const r = rows[key] as Row | undefined
          if (!r) return null
          return (
            <li
              key={key}
              className="space-y-1.5 rounded-lg border border-border bg-background p-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 font-semibold">
                  {b.name}{' '}
                  <span className="font-normal text-muted">
                    · {b.institution}
                  </span>
                </p>
                <Segmented
                  label={`What to do with ${b.name}`}
                  value={r.action}
                  options={ACTIONS}
                  onChange={(action) => set(key, { action })}
                />
              </div>
              {r.action === 'new' && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    value={r.name}
                    onChange={(e) => set(key, { name: e.target.value })}
                    maxLength={60}
                    aria-label={`Name for ${b.name}`}
                    className="field min-h-11 min-w-36 flex-1"
                  />
                  <Dropdown<AccountKind>
                    value={r.kind}
                    onChange={(kind) => set(key, { kind })}
                    label={`Kind for ${b.name}`}
                    className="min-h-11"
                    options={ACCOUNT_KINDS.map((k) => ({
                      value: k,
                      label: ACCOUNT_KIND_LABELS[k],
                    }))}
                  />
                  <OwnerInput
                    value={r.owner}
                    onChange={(owner) => set(key, { owner })}
                    className="min-h-11 w-28"
                  />
                </div>
              )}
              {r.action === 'link' && (
                <Dropdown
                  value={r.link}
                  onChange={(link) => set(key, { link })}
                  label={`Account for ${b.name}`}
                  placeholder="Choose an account"
                  className="min-h-11 w-full"
                  options={linkable.map((a) => ({
                    value: a.name,
                    label: a.name,
                  }))}
                />
              )}
            </li>
          )
        })}
      </ul>
      {problem && (
        <p role="alert" className="text-over">
          {problem}
        </p>
      )}
      {save.isError && (
        <p role="alert" className="text-over">
          {save.error.message}
        </p>
      )}
      <button
        type="submit"
        disabled={!choices.length || !!problem || save.isPending}
        className="min-h-11 rounded-full bg-foreground px-4 font-semibold text-background disabled:opacity-50"
      >
        {save.isPending
          ? 'Adding…'
          : `Add ${choices.length} ${choices.length === 1 ? 'account' : 'accounts'}`}
      </button>
      {save.isSuccess && (
        <p role="status" className="text-accent">
          Done. They’ll sync from now on.
        </p>
      )}
    </form>
  )
}
