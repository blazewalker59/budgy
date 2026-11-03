/**
 * Setting many Targets at once, from one month on (accepting each Everyday
 * Category's Typical month during setup). Earlier months keep theirs.
 * Server-only.
 */

import type { HouseholdDatabase as Database } from '@/lib/households/scope'
import { householdRow } from '@/lib/households/scope'
import { budgetTargets, categories } from '@/lib/db/schema'
import { newCategory } from '@/lib/model/defaults'
import { TRANSFER } from '@/lib/model/ledger'

export async function saveTargets(
  db: Database,
  startsMonth: string,
  targets: ReadonlyArray<{ category: string; amount: number }>,
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(startsMonth)) throw new Error('Choose a month.')
  if (targets.some((t) => t.category === TRANSFER))
    throw new Error('Transfers have no Target.')
  const names = new Set(targets.map((t) => t.category))
  if (names.size !== targets.length)
    throw new Error('Each category once, please.')
  if (!targets.length) return
  const statements = [
    ...[...names].map((name) =>
      db
        .insert(categories)
        .values(householdRow(db, newCategory(name)))
        .onConflictDoNothing(),
    ),
    ...targets.map((t) =>
      db
        .insert(budgetTargets)
        .values(householdRow(db, { ...t, startsMonth }))
        .onConflictDoUpdate({
          target: [
            budgetTargets.householdId,
            budgetTargets.category,
            budgetTargets.startsMonth,
          ],
          set: { amount: t.amount },
        }),
    ),
  ]
  await db.batch(statements as [(typeof statements)[number]])
}
