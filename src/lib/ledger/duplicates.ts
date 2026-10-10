/**
 * Settling a possible duplicate (src/lib/model/duplicates.ts) in D1: merge
 * the two into one, or keep both and remember that. Server-only.
 */

import { and, eq, inArray, sql } from 'drizzle-orm'
import { KEPT_KEY, loadKept } from './queries'
import type { HouseholdDatabase as Database } from '@/lib/households/scope'
import { householdRow, inHousehold } from '@/lib/households/scope'
import { imports, settings, transactions } from '@/lib/db/schema'
import { filedFirst, pairKey, staysFirst } from '@/lib/model/duplicates'

/**
 * One copy goes; the one the next update will know stays (`staysFirst`),
 * and takes the bank's ID if it had none, so a sync never adds it again.
 * It keeps a starting purchase's Store and filing, else its own, taking
 * the other's Move and note where it had none.
 */
export async function mergeDuplicate(
  db: Database,
  pair: { goes: string; stays: string },
): Promise<void> {
  const rows = await db
    .select({
      id: transactions.id,
      account: transactions.account,
      amount: transactions.amount,
      store: transactions.store,
      sourceCategory: transactions.sourceCategory,
      category: transactions.category,
      note: transactions.note,
      sourceKey: transactions.sourceKey,
      starting: sql<number>`${imports.account} is null`,
    })
    .from(transactions)
    .leftJoin(
      imports,
      and(
        eq(imports.id, transactions.importId),
        eq(imports.householdId, transactions.householdId),
      ),
    )
    .where(
      inHousehold(
        db,
        transactions,
        inArray(transactions.id, [pair.goes, pair.stays]),
      ),
    )
  const [x, y] = [pair.goes, pair.stays].map((id) => {
    const t = rows.find((r) => r.id === id)
    return t && { ...t, starting: !!t.starting, synced: !!t.sourceKey }
  })
  if (!x || !y) throw new Error('One of these purchases is gone')
  if (
    x.id === y.id ||
    (x.synced && y.synced) ||
    x.account !== y.account ||
    x.amount !== y.amount
  )
    throw new Error('These purchases can’t be merged')
  const [stays, goes] = staysFirst(y, x) ? [y, x] : [x, y]
  const [filed, other] = filedFirst(stays, goes) ? [stays, goes] : [goes, stays]
  await db.batch([
    // Out first: the bank's ID is unique within an Account.
    db
      .delete(transactions)
      .where(inHousehold(db, transactions, eq(transactions.id, goes.id))),
    db
      .update(transactions)
      .set({
        sourceKey: stays.sourceKey ?? goes.sourceKey,
        store: filed.store,
        sourceCategory: filed.sourceCategory,
        category: filed.category ?? other.category,
        note: filed.note ?? other.note,
      })
      .where(
        inHousehold(
          db,
          transactions,
          and(
            eq(transactions.id, stays.id),
            eq(transactions.account, stays.account),
          ),
        ),
      ),
  ])
}

/** Two purchases that only look alike: never offer to merge them again. */
export async function keepBoth(
  db: Database,
  pair: { goes: string; stays: string },
): Promise<void> {
  const key = pairKey(pair.goes, pair.stays)
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
