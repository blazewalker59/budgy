/**
 * Account labels: a Household's coloured chips ("Addie") that, with an
 * Account's "Shown as" ("529"), name it briefly on the Accounts screen.
 * Separate from the Owner (whose spending it is); an Account's `name` stays
 * its identifier everywhere. Pure (docs/adr/0016).
 */

import { z } from 'zod'
import type { Account, AccountLabel, Ledger } from './types'

/**
 * The colours a label can have: chip background and text for each theme,
 * each pair at least 4.5:1 (a test checks), plus a swatch for pickers.
 */
export const LABEL_COLORS = {
  slate: {
    name: 'Slate',
    light: { bg: '#e2e8f0', fg: '#334155' },
    dark: { bg: '#2a3441', fg: '#cbd5e1' },
  },
  red: {
    name: 'Red',
    light: { bg: '#fee2e2', fg: '#991b1b' },
    dark: { bg: '#45201f', fg: '#fca5a5' },
  },
  orange: {
    name: 'Orange',
    light: { bg: '#ffedd5', fg: '#9a3412' },
    dark: { bg: '#432914', fg: '#fdba74' },
  },
  amber: {
    name: 'Amber',
    light: { bg: '#fef3c7', fg: '#92400e' },
    dark: { bg: '#3f3212', fg: '#fcd34d' },
  },
  green: {
    name: 'Green',
    light: { bg: '#dcfce7', fg: '#166534' },
    dark: { bg: '#173723', fg: '#86efac' },
  },
  teal: {
    name: 'Teal',
    light: { bg: '#ccfbf1', fg: '#115e59' },
    dark: { bg: '#123a37', fg: '#5eead4' },
  },
  sky: {
    name: 'Sky',
    light: { bg: '#e0f2fe', fg: '#075985' },
    dark: { bg: '#112f43', fg: '#7dd3fc' },
  },
  blue: {
    name: 'Blue',
    light: { bg: '#dbeafe', fg: '#1e40af' },
    dark: { bg: '#1b2a4d', fg: '#93c5fd' },
  },
  violet: {
    name: 'Violet',
    light: { bg: '#ede9fe', fg: '#5b21b6' },
    dark: { bg: '#2c2150', fg: '#c4b5fd' },
  },
  pink: {
    name: 'Pink',
    light: { bg: '#fce7f3', fg: '#9d174d' },
    dark: { bg: '#441b30', fg: '#f9a8d4' },
  },
} as const

export type LabelColor = keyof typeof LABEL_COLORS
export const LABEL_COLOR_KEYS = Object.keys(LABEL_COLORS) as Array<LabelColor>

export const labelName = z.string().trim().min(1).max(30)
export const labelColor = z.enum(
  LABEL_COLOR_KEYS as [LabelColor, ...Array<LabelColor>],
)
export const labelInput = z.object({ name: labelName, color: labelColor })

/** "Shown as": empty means none. */
export const displayNameInput = z
  .string()
  .trim()
  .max(60)
  .nullish()
  .transform((s) => (s === undefined ? undefined : s || null))

/** A colour for a new label: the first no label has yet. */
export function nextColor(labels: ReadonlyArray<AccountLabel>): LabelColor {
  const used = new Set(labels.map((l) => l.color))
  return (
    LABEL_COLOR_KEYS.find((c) => !used.has(c) && c !== 'slate') ??
    LABEL_COLOR_KEYS[labels.length % LABEL_COLOR_KEYS.length]
  )
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * What to show an Account as once it has a label its name starts with:
 * "Addie 529" with Addie is "529", "Addie's Trump Account" "Trump Account".
 * Null when its name doesn't start with the label.
 */
export function suggestShownAs(name: string, label: string): string | null {
  const l = label.trim()
  if (!l) return null
  const match = new RegExp(`^${escape(l)}(?:['’]s)?\\s+(.+)$`, 'i').exec(
    name.trim(),
  )
  const rest = match?.[1].trim().slice(0, 60)
  return rest || null
}

/**
 * Other Accounts whose names start with the label and don't have it yet,
 * each with what it'd be shown as (its own "Shown as" if it has one).
 */
export function othersStartingWith(
  accounts: ReadonlyArray<Account>,
  label: string,
  except: string,
): Array<{ name: string; displayName: string }> {
  return accounts.flatMap((a) => {
    if (a.name === except || a.label?.toLowerCase() === label.toLowerCase())
      return []
    const shown = suggestShownAs(a.name, label)
    return shown ? [{ name: a.name, displayName: a.displayName ?? shown }] : []
  })
}

/** How an Account reads on the Accounts screen: its short name, or name. */
export function shownAs(account: Pick<Account, 'name' | 'displayName'>) {
  return account.displayName || account.name
}

/** A label with another name or colour; its Accounts follow the rename. */
export function relabeledLedger(
  ledger: Ledger,
  from: string,
  next: AccountLabel,
): Ledger {
  return {
    ...ledger,
    labels: ledger.labels
      .map((l) => (l.name === from ? next : l))
      .sort((a, b) => a.name.localeCompare(b.name)),
    accounts:
      from === next.name
        ? ledger.accounts
        : ledger.accounts.map((a) =>
            a.label === from ? { ...a, label: next.name } : a,
          ),
  }
}

/** A label gone: its Accounts keep their "Shown as". */
export function unlabeledLedger(ledger: Ledger, name: string): Ledger {
  return {
    ...ledger,
    labels: ledger.labels.filter((l) => l.name !== name),
    accounts: ledger.accounts.map((a) =>
      a.label === name ? { ...a, label: null } : a,
    ),
  }
}

/** Several Accounts given a label (and a "Shown as") at once. */
export function labeledLedger(
  ledger: Ledger,
  label: string,
  accounts: ReadonlyArray<{ name: string; displayName: string | null }>,
): Ledger {
  const shown = new Map(accounts.map((a) => [a.name, a.displayName]))
  return {
    ...ledger,
    accounts: ledger.accounts.map((a) =>
      shown.has(a.name)
        ? { ...a, label, displayName: shown.get(a.name) ?? null }
        : a,
    ),
  }
}
