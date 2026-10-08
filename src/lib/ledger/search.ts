/** The month and Owner a screen shows, kept in the URL so links share it. */

export interface ViewSearch {
  month?: string
  owner?: string
}

export function validateViewSearch(s: Record<string, unknown>): ViewSearch {
  const out: ViewSearch = {}
  if (typeof s.month === 'string' && /^\d{4}-\d{2}$/.test(s.month))
    out.month = s.month
  if (typeof s.owner === 'string' && s.owner.length <= 30) out.owner = s.owner
  return out
}

export type Period = 'month' | '3' | '6' | '12'

/** Spending's filters, in the URL so a filtered view can be shared. */
export interface SpendingSearch {
  period?: Period
  month?: string
  owner?: string
  /** Accounts, comma-separated. */
  acct?: string
  cat?: string
  q?: string
}

export function validateSpendingSearch(
  s: Record<string, unknown>,
): SpendingSearch {
  const out: SpendingSearch = {}
  if (
    s.period === 'month' ||
    s.period === '3' ||
    s.period === '6' ||
    s.period === '12'
  )
    out.period = s.period
  else if (typeof s.period === 'number' && [3, 6, 12].includes(s.period))
    out.period = String(s.period) as Period
  if (typeof s.month === 'string' && /^\d{4}-\d{2}$/.test(s.month))
    out.month = s.month
  for (const key of ['owner', 'acct', 'cat', 'q'] as const) {
    const v = s[key]
    if (typeof v === 'string' && v.length > 0 && v.length <= 400) out[key] = v
  }
  return out
}
