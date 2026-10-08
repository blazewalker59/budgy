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
