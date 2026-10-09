/**
 * What every way of adding purchases shares: D1's statement limits and the
 * Household's Import Rules. Server-only.
 */

import { eq } from 'drizzle-orm'
import type { Database } from '@/lib/db'
import type { ImportRules } from '@/lib/import/rules'
import { settings } from '@/lib/db/schema'
import { parseImportRules } from '@/lib/import/rules'

/** Each statement may bind at most 100 values in D1. */
export const ROWS_PER_INSERT = 10
export const STATEMENTS_PER_BATCH = 40

export const RULES_KEY = 'import_rules'

export async function loadImportRules(db: Database): Promise<ImportRules> {
  const row = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, RULES_KEY))
    .get()
  return parseImportRules(row?.value)
}
