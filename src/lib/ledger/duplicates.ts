/**
 * Settling a possible duplicate (src/lib/model/duplicates.ts) in D1: merge
 * the synced purchase into the one already here, or keep both and
 * remember that. Server-only.
 */

import { and, eq, inArray } from 'drizzle-orm'
import { KEPT_KEY, loadKept } from './queries'
import type { HouseholdDatabase as Database } from '@/lib/households/scope'
import { householdRow, inHousehold } from '@/lib/households/scope'
import { settings, transactions } from '@/lib/db/schema'
import { pairKey } from '@/lib/model/duplicates'

/**
 * The synced one goes; the one already here keeps its Category, Move and
 * note (taking the synced one's where it had none) and takes the bank's
 * ID, so the next sync knows it and never adds it again.
 */
export async function mergeDuplicate(
  db: Database,
  pair: { synced: string; other: string },
): Promise<void> {
  const rows = await db
    .select({
      id: transactions.id,
      account: transactions.account,
      amount: transactions.amount,
      category: transactions.category,
      note: transactions.note,
      sourceKey: transactions.sourceKey,
    })
    .from(transactions)
    .where(
      inHousehold(
        db,
        transactions,
        inArray(transactions.id, [pair.synced, pair.other]),
      ),
    )
  const synced = rows.find((t) => t.id === pair.synced)
  const other = rows.find((t) => t.id === pair.other)
  if (!synced || !other) throw new Error('One of these purchases is gone')
  if (
    !synced.sourceKey ||
    other.sourceKey ||
    synced.account !== other.account ||
    synced.amount !== other.amount
  )
    throw new Error('These purchases can’t be merged')
  await db.batch([
    // Out first: the bank's ID is unique within an Account.
    db
      .delete(transactions)
      .where(inHousehold(db, transactions, eq(transactions.id, synced.id))),
    db
      .update(transactions)
      .set({
        sourceKey: synced.sourceKey,
        category: other.category ?? synced.category,
        note: other.note ?? synced.note,
      })
      .where(
        inHousehold(
          db,
          transactions,
          and(
            eq(transactions.id, other.id),
            eq(transactions.account, other.account),
          ),
        ),
      ),
  ])
}

/** Two purchases that only look alike: never offer to merge them again. */
export async function keepBoth(
  db: Database,
  pair: { synced: string; other: string },
): Promise<void> {
  const key = pairKey(pair.synced, pair.other)
  const kept = await loadKept(db)
  if (kept.includes(key)) return
  const value = JSON.stringify([...kept, key])
  await db
    .insert(settings)
    .values(householdRow(db, { key: KEPT_KEY, value }))
    .onConflictDoUpdate({
      target: [settings.householdId, settings.key],
      set: { value },
    })
}
