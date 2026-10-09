/**
 * What a purchase becomes in the Ledger, and how its id is made. A
 * Transaction's id hashes its date, Account, description, amount and how
 * many identical rows came before it, so posting an overlapping upload
 * again adds nothing twice.
 */

export interface ParsedTxn {
  id: string
  date: string
  month: string
  account: string
  accountSource: string
  description: string
  store: string
  sourceCategory: string
  amount: number
}

export async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(text),
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Python's `f"{x:.2f}"` for amounts with at most two decimals. */
export function twoDecimals(dollars: number): string {
  return (Object.is(dollars, -0) ? 0 : dollars).toFixed(2)
}
