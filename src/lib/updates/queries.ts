import { and, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { HouseholdDatabase } from '@/lib/households/scope'
import { inHousehold } from '@/lib/households/scope'
import {
  accountInputs,
  accountUpdateLocks,
  accountUpdates,
  accounts,
} from '@/lib/db/schema'

/** Indexed latest/success lookups keep failure history from hiding an older success. */
export async function listAccountUpdates(db: HouseholdDatabase) {
  const latest = alias(accountUpdates, 'latest_update')
  const success = alias(accountUpdates, 'successful_update')
  const fields = (table: typeof latest | typeof success) => ({
    id: table.id,
    source: table.source,
    status: table.status,
    startedAt: table.startedAt,
    finishedAt: table.finishedAt,
    fromDate: table.fromDate,
    toDate: table.toDate,
    added: table.added,
    updated: table.updated,
    linked: table.linked,
    skipped: table.skipped,
    review: table.review,
    message: table.message,
    issues: table.issues,
  })
  return db
    .select({
      account: accounts.name,
      format: accountInputs.format,
      lockExpiresAt: accountUpdateLocks.expiresAt,
      latest: fields(latest),
      success: fields(success),
    })
    .from(accounts)
    .leftJoin(
      accountInputs,
      and(
        eq(accountInputs.householdId, accounts.householdId),
        eq(accountInputs.account, accounts.name),
      ),
    )
    .leftJoin(
      accountUpdateLocks,
      and(
        eq(accountUpdateLocks.householdId, accounts.householdId),
        eq(accountUpdateLocks.account, accounts.name),
      ),
    )
    .leftJoin(
      latest,
      and(
        eq(latest.householdId, accounts.householdId),
        eq(
          latest.id,
          sql`(select id from account_updates where household_id = ${accounts.householdId} and account = ${accounts.name} order by started_at desc, rowid desc limit 1)`,
        ),
      ),
    )
    .leftJoin(
      success,
      and(
        eq(success.householdId, accounts.householdId),
        eq(
          success.id,
          sql`(select id from account_updates where household_id = ${accounts.householdId} and account = ${accounts.name} and status = 'succeeded' order by started_at desc, rowid desc limit 1)`,
        ),
      ),
    )
    .where(inHousehold(db, accounts))
    .orderBy(accounts.name)
}
