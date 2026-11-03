/**
 * Setup marks in D1: the few things about setup the Ledger can't show (a
 * step skipped, Categories reviewed, the checklist put away), one settings
 * row per Household (docs/adr/0013). Server-only.
 */

import { eq } from 'drizzle-orm'
import type { HouseholdDatabase as Database } from '@/lib/households/scope'
import type { SetupMarks, SetupStep } from '@/lib/model/setup'
import { householdRow, inHousehold } from '@/lib/households/scope'
import { settings } from '@/lib/db/schema'
import { markStep, parseSetupMarks } from '@/lib/model/setup'

export const SETUP_KEY = 'setup'

export async function loadSetup(db: Database): Promise<SetupMarks> {
  const row = await db
    .select({ value: settings.value })
    .from(settings)
    .where(inHousehold(db, settings, eq(settings.key, SETUP_KEY)))
    .get()
  return parseSetupMarks(row?.value)
}

export type SetupChange =
  { step: SetupStep; mark: 'skipped' | 'done' | null } | { dismissed: boolean }

/** Apply one change to this Household's marks; returns them all. */
export async function saveSetup(
  db: Database,
  change: SetupChange,
): Promise<SetupMarks> {
  const marks = await loadSetup(db)
  const next =
    'step' in change
      ? markStep(marks, change.step, change.mark)
      : { ...marks, dismissed: change.dismissed }
  const value = JSON.stringify(next)
  await db
    .insert(settings)
    .values(householdRow(db, { key: SETUP_KEY, value }))
    .onConflictDoUpdate({
      target: [settings.householdId, settings.key],
      set: { value },
    })
  return next
}
