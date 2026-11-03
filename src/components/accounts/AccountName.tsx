/**
 * An Account as the Accounts screen names it: its label as a coloured chip,
 * then what it's shown as ("[Addie] 529"), or its full name when it has
 * neither. Screen readers hear the full name, its identifier everywhere
 * else (docs/adr/0016).
 */

import type { CSSProperties } from 'react'
import type { Account, AccountLabel } from '@/lib/model/types'
import { LABEL_COLORS, shownAs } from '@/lib/model/labels'
import { useBook } from '@/lib/ledger/book'
import { cn } from '@/lib/utils'

/** The chip's colours for both themes, as CSS variables. */
export function labelStyle(color: AccountLabel['color']): CSSProperties {
  const c = LABEL_COLORS[color]
  return {
    '--label-bg': c.light.bg,
    '--label-fg': c.light.fg,
    '--label-bg-dark': c.dark.bg,
    '--label-fg-dark': c.dark.fg,
  } as CSSProperties
}

/** The chip's classes; pair with `labelStyle`. */
export const LABEL_CHIP =
  'inline-flex shrink-0 items-center rounded-md bg-[var(--label-bg)] px-1.5 font-bold leading-[1.15rem] text-[var(--label-fg)] dark:bg-[var(--label-bg-dark)] dark:text-[var(--label-fg-dark)]'

/** A colour swatch: the chip's text colour, which reads on the surface. */
export const LABEL_SWATCH =
  'inline-block rounded-full bg-[var(--label-fg)] dark:bg-[var(--label-fg-dark)]'

export function LabelChip({
  label,
  className,
}: {
  label: AccountLabel
  className?: string
}) {
  return (
    <span
      className={cn(LABEL_CHIP, 'text-[11px]', className)}
      style={labelStyle(label.color)}
    >
      {label.name}
    </span>
  )
}

/** The Account's label, if it has one this Household still has. */
export function useLabelOf(
  account: Pick<Account, 'label'> | undefined,
): AccountLabel | undefined {
  const { ix } = useBook()
  return account?.label
    ? ix.ledger.labels.find((l) => l.name === account.label)
    : undefined
}

export function AccountName({
  account,
  className,
  chipClassName,
}: {
  account: Pick<Account, 'name' | 'label' | 'displayName'>
  className?: string
  chipClassName?: string
}) {
  const label = useLabelOf(account)
  const short = shownAs(account)
  if (!label && short === account.name)
    return <span className={cn('truncate', className)}>{account.name}</span>
  const spoken =
    label && !account.name.toLowerCase().includes(label.name.toLowerCase())
      ? `${account.name} (${label.name})`
      : account.name
  return (
    <span
      className={cn('inline-flex min-w-0 items-center gap-1.5', className)}
      title={account.name}
    >
      <span aria-hidden className="contents">
        {label && <LabelChip label={label} className={chipClassName} />}
        <span className="truncate">{short}</span>
      </span>
      <span className="sr-only">{spoken}</span>
    </span>
  )
}

/**
 * An Account named by a Transaction or Money in: the same, when the
 * Account is still here; otherwise just the name.
 */
export function AccountRef({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  const { ix } = useBook()
  const account = ix.ledger.accounts.find((a) => a.name === name)
  if (!account) return <span className={className}>{name}</span>
  return (
    <AccountName
      account={account}
      className={cn('max-w-full align-bottom', className)}
      chipClassName="text-[10px] leading-4"
    />
  )
}
