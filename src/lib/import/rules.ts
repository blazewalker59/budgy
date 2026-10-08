/**
 * The Household's own import rules: what its Accounts are called, which
 * Stores go by another name, which local vendors are home upkeep, and which
 * rows aren't spending (investment contributions). Kept in the database,
 * never in the repository, since they name real accounts and places
 * (docs/adr/0003).
 */

import { z } from 'zod'

export interface ImportRules {
  /** Exported account name → short Account name. */
  accounts: Record<string, string>
  /** [needle, Store]: a description containing needle (any case) is Store. */
  stores: Array<[string, string]>
  /** Regular expression (case-insensitive) for home upkeep vendors. */
  upkeep: string
  /** Regular expression for the mortgage servicer, within "Mortgage and Utilities". */
  mortgage: string
  /** Regular expression for rows that aren't spending (investments). */
  notSpending: string
}

export const EMPTY_RULES: ImportRules = {
  accounts: {},
  stores: [],
  upkeep: '',
  mortgage: '',
  notSpending: '',
}

const pattern = z
  .string()
  .max(4000)
  .refine((s) => {
    try {
      new RegExp(s)
      return true
    } catch {
      return false
    }
  }, 'Not a valid regular expression')

export const importRulesSchema = z.object({
  accounts: z.record(z.string().max(200), z.string().min(1).max(60)),
  stores: z
    .array(z.tuple([z.string().min(1).max(80), z.string().min(1).max(80)]))
    .max(500),
  upkeep: pattern,
  mortgage: pattern,
  notSpending: pattern,
})

/** Read stored rules, falling back to none for anything missing or broken. */
export function parseImportRules(json: string | null | undefined): ImportRules {
  if (!json) return EMPTY_RULES
  try {
    const parsed = importRulesSchema.partial().safeParse(JSON.parse(json))
    return parsed.success ? { ...EMPTY_RULES, ...parsed.data } : EMPTY_RULES
  } catch {
    return EMPTY_RULES
  }
}

/** A compiled pattern, or null when empty. */
export function compile(source: string, flags = ''): RegExp | null {
  return source ? new RegExp(source, flags) : null
}
