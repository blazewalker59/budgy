import { and, eq, lt } from 'drizzle-orm'
import type { HouseholdDatabase } from '@/lib/households/scope'
import type { PostSummary } from '@/lib/ledger/accounts'
import { householdRow, inHousehold } from '@/lib/households/scope'
import { accountUpdateLocks, accountUpdates } from '@/lib/db/schema'
import { UserError } from '@/lib/errors'

export type UpdateSource = 'uploaded' | 'posted' | 'shortcut' | 'simplefin'
const LEASE_MS = 10 * 60_000

export async function acquireUpdate(db: HouseholdDatabase, account: string) {
  const now = new Date()
  const token = crypto.randomUUID()
  const expiresAt = new Date(now.getTime() + LEASE_MS)
  const locked = await db
    .insert(accountUpdateLocks)
    .values(householdRow(db, { account, token, expiresAt }))
    .onConflictDoUpdate({
      target: [accountUpdateLocks.householdId, accountUpdateLocks.account],
      set: { token, expiresAt },
      setWhere: lt(accountUpdateLocks.expiresAt, now),
    })
    .returning({ token: accountUpdateLocks.token })
  if (!locked.length)
    throw new UserError(
      'This Account is already updating. Wait a moment and try again.',
    )
  return token
}

export async function renewUpdate(
  db: HouseholdDatabase,
  account: string,
  token: string,
) {
  const renewed = await db
    .update(accountUpdateLocks)
    .set({ expiresAt: new Date(Date.now() + LEASE_MS) })
    .where(
      inHousehold(
        db,
        accountUpdateLocks,
        and(
          eq(accountUpdateLocks.account, account),
          eq(accountUpdateLocks.token, token),
        ),
      ),
    )
    .returning({ token: accountUpdateLocks.token })
  if (!renewed.length)
    throw new UserError('This update took too long. Try again.')
}

export async function releaseUpdate(
  db: HouseholdDatabase,
  account: string,
  token: string,
) {
  await db
    .delete(accountUpdateLocks)
    .where(
      inHousehold(
        db,
        accountUpdateLocks,
        and(
          eq(accountUpdateLocks.account, account),
          eq(accountUpdateLocks.token, token),
        ),
      ),
    )
}

export async function startReceipt(
  db: HouseholdDatabase,
  input: {
    id: string
    account: string
    source: UpdateSource
    updatedBy: string
    dates: Array<string>
  },
) {
  const dates = [...input.dates].sort()
  await db.insert(accountUpdates).values(
    householdRow(db, {
      id: input.id,
      account: input.account,
      source: input.source,
      updatedBy: input.updatedBy,
      status: 'running',
      startedAt: new Date(),
      fromDate: dates[0] ?? null,
      toDate: dates.at(-1) ?? null,
    }),
  )
}

/**
 * Close a receipt. A `notice` (the source said its data may be incomplete,
 * say) makes it need attention, with that message, even with nothing to
 * review.
 */
export async function finishReceipt(
  db: HouseholdDatabase,
  id: string,
  summary: PostSummary | null,
  notice?: string,
) {
  const attention = !!summary?.review.length || !!notice
  await db
    .update(accountUpdates)
    .set(
      summary
        ? {
            status: attention ? 'attention' : 'succeeded',
            finishedAt: new Date(),
            added: summary.added,
            updated: summary.updated,
            linked: summary.linked,
            skipped:
              summary.alreadyHad +
              summary.duplicates.length +
              summary.notSpending,
            review: summary.review.length,
            message:
              [notice, summary.review.length && 'Some purchases need review.']
                .filter(Boolean)
                .join(' ') || null,
            issues: summary.review,
          }
        : {
            status: 'failed',
            finishedAt: new Date(),
            message: 'This update didn’t finish. Try again.',
          },
    )
    .where(inHousehold(db, accountUpdates, eq(accountUpdates.id, id)))
}

/**
 * A check that read nothing for an Account (its source didn't send it), as
 * a failed receipt with a message for Members. Holds no lease: it changes
 * no purchases.
 */
export async function recordFailedCheck(
  db: HouseholdDatabase,
  input: {
    account: string
    source: UpdateSource
    updatedBy: string
    message: string
  },
) {
  const now = new Date()
  await db.insert(accountUpdates).values(
    householdRow(db, {
      id: crypto.randomUUID(),
      account: input.account,
      source: input.source,
      updatedBy: input.updatedBy,
      status: 'failed',
      startedAt: now,
      finishedAt: now,
      message: input.message,
    }),
  )
}
