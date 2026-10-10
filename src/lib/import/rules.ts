/**
 * The Household's own import rules: which Stores go by another name, which
 * local vendors are home upkeep, and which rows aren't spending (investment
 * contributions). Kept in the database,
 * never in the repository, since they name real accounts and places
 * (docs/adr/0003).
 */

import { z } from 'zod'

export interface ImportRules {
  /** [needle, Store]: a description containing needle (any case) is Store. */
  stores: Array<[string, string]>
  /** Regular expression (case-insensitive) for home upkeep vendors. */
  upkeep: string
  /**
   * Description substrings (any case) that count as home upkeep, such as
   * this Household's hardware stores.
   */
  hardware: Array<string>
  /**
   * Regular expression (case-insensitive). A match is not home upkeep even
   * when the description also matches a hardware store or `upkeep`.
   */
  upkeepExclude: string
  /** Regular expression for the mortgage servicer, within `mortgageCategory`. */
  mortgage: string
  /**
   * The finance app's category that splits into Mortgage vs Utilities.
   * Empty means that split is not this Household's.
   */
  mortgageCategory: string
  /** Regular expression for rows that aren't spending (investments). */
  notSpending: string
}

export const EMPTY_RULES: ImportRules = {
  stores: [],
  upkeep: '',
  hardware: [],
  upkeepExclude: '',
  mortgage: '',
  mortgageCategory: '',
  notSpending: '',
}

/** Fill anything a partial record left out. */
export function completeRules(rules: Partial<ImportRules>): ImportRules {
  return {
    stores: rules.stores ?? EMPTY_RULES.stores,
    upkeep: rules.upkeep ?? EMPTY_RULES.upkeep,
    hardware: rules.hardware ?? EMPTY_RULES.hardware,
    upkeepExclude: rules.upkeepExclude ?? EMPTY_RULES.upkeepExclude,
    mortgage: rules.mortgage ?? EMPTY_RULES.mortgage,
    mortgageCategory: rules.mortgageCategory ?? EMPTY_RULES.mortgageCategory,
    notSpending: rules.notSpending ?? EMPTY_RULES.notSpending,
  }
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
  stores: z
    .array(z.tuple([z.string().min(1).max(80), z.string().min(1).max(80)]))
    .max(500),
  upkeep: pattern,
  hardware: z.array(z.string().min(1).max(80)).max(100).optional(),
  upkeepExclude: pattern.optional(),
  mortgage: pattern,
  mortgageCategory: z.string().max(80).optional(),
  notSpending: pattern,
})

/** Read stored rules, falling back to none for anything missing or broken. */
export function parseImportRules(json: string | null | undefined): ImportRules {
  if (!json) return EMPTY_RULES
  try {
    const parsed = importRulesSchema.partial().safeParse(JSON.parse(json))
    return parsed.success ? completeRules(parsed.data) : EMPTY_RULES
  } catch {
    return EMPTY_RULES
  }
}

/** A compiled pattern, or null when empty. */
export function compile(source: string, flags = ''): RegExp | null {
  return source ? new RegExp(source, flags) : null
}
