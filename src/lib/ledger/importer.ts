/**
 * What every way of adding purchases shares: D1's statement limits and the
 * Household's Import Rules. Server-only.
 */

import { eq, getTableColumns } from 'drizzle-orm'
import type { Table } from 'drizzle-orm'
import type { HouseholdDatabase as Database } from '@/lib/households/scope'
import type { ImportRules } from '@/lib/import/rules'
import { inHousehold } from '@/lib/households/scope'
import { settings } from '@/lib/db/schema'
import { parseImportRules } from '@/lib/import/rules'
import {
  BANK_CATEGORIES_KEY,
  parseBankCategories,
} from '@/lib/import/bankCategories'

/** Each statement may bind at most 100 values in D1. */
export const D1_MAX_VARIABLES = 100
export const STATEMENTS_PER_BATCH = 40

/**
 * How many rows of `table` one insert can carry: every column counted,
 * so a column added later can't push an insert past D1's limit.
 */
export function rowsPerInsert(table: Table): number {
  const columns = Object.keys(getTableColumns(table)).length
  return Math.max(1, Math.floor(D1_MAX_VARIABLES / columns))
}

export const RULES_KEY = 'import_rules'

export async function loadImportRules(db: Database): Promise<ImportRules> {
  const row = await db
    .select({ value: settings.value })
    .from(settings)
    .where(inHousehold(db, settings, eq(settings.key, RULES_KEY)))
    .get()
  return parseImportRules(row?.value)
}

/** What each Bank category means to this Household. */
export async function loadBankCategories(
  db: Database,
): Promise<Map<string, string>> {
  const row = await db
    .select({ value: settings.value })
    .from(settings)
    .where(inHousehold(db, settings, eq(settings.key, BANK_CATEGORIES_KEY)))
    .get()
  return parseBankCategories(row?.value)
}
