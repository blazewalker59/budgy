/**
 * What a purchase becomes in the Ledger, and how its id is made. A
 * Transaction's id hashes its date, Account, description, amount and how
 * many identical rows came before it, so posting an overlapping upload
 * again adds nothing twice.
 */

import { digestHex } from '@/lib/secret'

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

export function sha1Hex(text: string): Promise<string> {
  return digestHex('SHA-1', text)
}

/** Python's `f"{x:.2f}"` for amounts with at most two decimals. */
export function twoDecimals(dollars: number): string {
  return (Object.is(dollars, -0) ? 0 : dollars).toFixed(2)
}
