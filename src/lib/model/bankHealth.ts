/**
 * A bank connection's health as a Member reads it (docs/adr/0014): how many
 * linked accounts are syncing, and each bank with a problem once, with what
 * to do and which Budgy Accounts it affects. Bridge reports problems per
 * institution login (`connId`) or per account; one login usually covers
 * several accounts, so they're grouped by bank, not listed per message.
 * Pure.
 */

export type BankTrouble = 'sign-in' | 'failed' | 'other'

export interface HealthIssue {
  kind: string
  message: string
  connId?: string
  accountId?: string
}

export interface HealthAccount {
  providerId: string
  name: string
  institution: string
  /** The Budgy Account it feeds, if linked. */
  account: string | null
  present: boolean
  connId?: string | null
  problem?: string | null
  problemKind?: 'reauth' | 'failed' | 'missing' | null
}

export interface BankWithTrouble {
  institution: string
  trouble: BankTrouble
  /** Bridge's own words, each once; the protocol asks apps to show them. */
  said: Array<string>
  /** Budgy Accounts this bank feeds that are affected. */
  affects: Array<string>
}

export interface ConnectionHealth {
  linked: number
  /** Linked accounts with no problem. */
  syncing: number
  banks: Array<BankWithTrouble>
}

const RANK: Record<BankTrouble, number> = { 'sign-in': 0, failed: 1, other: 2 }

function trouble(kind: string): BankTrouble {
  if (kind === 'con.auth' || kind === 'gen.auth') return 'sign-in'
  if (kind.startsWith('act')) return 'failed'
  return 'other'
}

/**
 * "Connection to NewRez may need attention. Auth required" names its bank;
 * used only when no discovered account shares the issue's login.
 */
function namedBank(message: string): string | null {
  const match = /^Connection to (.+?) may need attention/i.exec(message)
  return match ? match[1].trim() : null
}

export function connectionHealth(
  accounts: ReadonlyArray<HealthAccount>,
  issues: ReadonlyArray<HealthIssue> | null | undefined,
): ConnectionHealth {
  const banks = new Map<string, BankWithTrouble>()
  const troubled = new Set<string>()

  const note = (
    institution: string,
    kind: BankTrouble,
    said: string | null,
    affected: ReadonlyArray<HealthAccount>,
  ) => {
    const key = institution.toLowerCase()
    const bank = banks.get(key) ?? {
      institution,
      trouble: kind,
      said: [],
      affects: [],
    }
    if (RANK[kind] < RANK[bank.trouble]) bank.trouble = kind
    if (said && !bank.said.includes(said)) bank.said.push(said)
    for (const a of affected) {
      if (!a.account) continue
      troubled.add(a.providerId)
      if (!bank.affects.includes(a.account)) bank.affects.push(a.account)
    }
    banks.set(key, bank)
  }

  for (const issue of issues ?? []) {
    const affected = accounts.filter((a) =>
      issue.accountId
        ? a.providerId === issue.accountId
        : issue.connId
          ? a.connId === issue.connId
          : false,
    )
    const institution =
      affected[0]?.institution ?? namedBank(issue.message) ?? 'SimpleFIN'
    note(institution, trouble(issue.kind), issue.message, affected)
  }
  // What the last sync of each linked account found, if the connection's
  // own read didn't already say it.
  for (const a of accounts) {
    if (!a.account || !a.problemKind) continue
    note(
      a.institution,
      a.problemKind === 'reauth' ? 'sign-in' : 'failed',
      null,
      [a],
    )
  }

  const linked = accounts.filter((a) => a.account).length
  return {
    linked,
    syncing: linked - troubled.size,
    banks: [...banks.values()].sort(
      (x, y) =>
        RANK[x.trouble] - RANK[y.trouble] ||
        x.institution.localeCompare(y.institution),
    ),
  }
}

/** "5 of 8 linked accounts syncing", or "All 8 linked accounts syncing". */
export function syncingLabel({ linked, syncing }: ConnectionHealth): string {
  if (!linked) return 'Nothing linked yet'
  if (syncing === linked)
    return linked === 1
      ? 'Your linked account is syncing'
      : `All ${linked} linked accounts syncing`
  return `${syncing} of ${linked} linked accounts syncing`
}

/** Short header note: "3 banks need a sign-in", or null when all is well. */
export function troubleLabel(health: ConnectionHealth): string | null {
  const signIn = health.banks.filter((b) => b.trouble === 'sign-in').length
  const other = health.banks.length - signIn
  const parts: Array<string> = []
  if (signIn)
    parts.push(
      signIn === 1
        ? '1 bank needs a sign-in'
        : `${signIn} banks need a sign-in`,
    )
  if (other)
    parts.push(
      other === 1 ? '1 bank had trouble' : `${other} banks had trouble`,
    )
  return parts.length ? parts.join(' · ') : null
}

/** "12 min ago", "3 hours ago", "yesterday": when a connection was last read. */
export function checkedAgo(at: Date | string | number, now = new Date()) {
  const minutes = Math.round((now.getTime() - new Date(at).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}
