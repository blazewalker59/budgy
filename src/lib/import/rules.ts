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

/** Longest pattern a Member may save. Stored ones up to 4000 still load. */
export const MAX_PATTERN_LENGTH = 500

function compiles(source: string) {
  try {
    new RegExp(source)
    return true
  } catch {
    return false
  }
}

const REPEAT = /^(?:[*+]|\{\d+(?:,\d*)?\})/
/** Adjacent repeats (`\s*\s*\s*…`) slow down polynomially; few are needed. */
const MAX_REPEATS = 6

/**
 * Why a pattern could take exponential time on a crafted description, or
 * null. Rules run on the server for every imported row, so a Member's
 * pattern must not be able to stall it. Deliberately conservative: it
 * refuses backreferences and any repeated group that itself repeats or
 * has alternatives (`(a+)+`, `(a|ab)*`), which ordinary Store patterns
 * (`Green Lawn|^Bug Guys$`) never need.
 */
export function unsafePattern(source: string): string | null {
  if (/\\(?:[1-9]|k<)/.test(source))
    return 'Backreferences (\\1) aren’t allowed in rules.'
  const groups: Array<{ repeats: boolean }> = []
  let inClass = false
  let repeats = 0
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '\\') {
      i++
      continue
    }
    if (inClass) {
      if (c === ']') inClass = false
      continue
    }
    if (c === '[') inClass = true
    else if (c === '(') {
      groups.push({ repeats: false })
      if (source[i + 1] === '?') i++
    } else if (c === '|') {
      if (groups.length) groups[groups.length - 1].repeats = true
    } else if (c === ')') {
      const group = groups.pop()
      const repeated = REPEAT.test(source.slice(i + 1))
      if (repeated) repeats++
      if (group?.repeats && repeated)
        return 'A repeated group can’t itself repeat or have alternatives, as in (a+)+ or (a|b)*.'
      if ((group?.repeats || repeated) && groups.length)
        groups[groups.length - 1].repeats = true
    } else if (REPEAT.test(source.slice(i))) {
      // A group's own repeat was counted at its `)`.
      if (source[i - 1] !== ')' || source[i - 2] === '\\') repeats++
      if (groups.length) groups[groups.length - 1].repeats = true
    }
  }
  if (repeats > MAX_REPEATS)
    return `Use at most ${MAX_REPEATS} repeats (*, + or {n,}) in a pattern.`
  return null
}

/** A pattern as stored: lenient, so rules saved earlier still load. */
const storedPattern = z.string().max(4000).refine(compiles)

/** A pattern a Member saves now: short, valid and safe to run. */
const pattern = z
  .string()
  .max(
    MAX_PATTERN_LENGTH,
    `Keep each pattern under ${MAX_PATTERN_LENGTH} characters.`,
  )
  .refine(compiles, 'Not a valid regular expression')
  .superRefine((source, ctx) => {
    const unsafe = unsafePattern(source)
    if (unsafe) ctx.addIssue({ code: 'custom', message: unsafe })
  })

function rulesSchema(p: z.ZodType<string>) {
  return z.object({
    stores: z
      .array(z.tuple([z.string().min(1).max(80), z.string().min(1).max(80)]))
      .max(500),
    upkeep: p,
    hardware: z.array(z.string().min(1).max(80)).max(100).optional(),
    upkeepExclude: p.optional(),
    mortgage: p,
    mortgageCategory: z.string().max(80).optional(),
    notSpending: p,
  })
}

/** What a Member may save. */
export const importRulesSchema = rulesSchema(pattern)

/** Read stored rules, falling back to none for anything missing or broken. */
export function parseImportRules(json: string | null | undefined): ImportRules {
  if (!json) return EMPTY_RULES
  try {
    const parsed = rulesSchema(storedPattern)
      .partial()
      .safeParse(JSON.parse(json))
    return parsed.success ? completeRules(parsed.data) : EMPTY_RULES
  } catch {
    return EMPTY_RULES
  }
}

/**
 * A compiled pattern, or null when empty. A pattern saved before the
 * safety check that fails it is left out rather than run.
 */
export function compile(source: string, flags = ''): RegExp | null {
  return source && !unsafePattern(source) ? new RegExp(source, flags) : null
}
