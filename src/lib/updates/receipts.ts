import { and, eq, lt } from 'drizzle-orm'
import type { HouseholdDatabase } from '@/lib/households/scope'
import type { PostSummary } from '@/lib/ledger/accounts'
import { householdRow, inHousehold } from '@/lib/households/scope'
import { accountUpdateLocks, accountUpdates } from '@/lib/db/schema'

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
    throw new Error(
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
    throw new Error('Account update lease was lost. Retry this update.')
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

export async function finishReceipt(
  db: HouseholdDatabase,
  id: string,
  summary: PostSummary | null,
) {
  await db
    .update(accountUpdates)
    .set(
      summary
        ? {
            status: summary.review.length ? 'attention' : 'succeeded',
            finishedAt: new Date(),
            added: summary.added,
            updated: summary.updated,
            linked: summary.linked,
            skipped:
              summary.alreadyHad +
              summary.duplicates.length +
              summary.notSpending,
            review: summary.review.length,
            message: summary.review.length
              ? 'Some source purchases need review. Ambiguous matches were not merged.'
              : null,
            issues: summary.review,
          }
        : {
            status: 'failed',
            finishedAt: new Date(),
            message:
              'This update did not finish. Retry the same source; purchases already saved will not be added again.',
          },
    )
    .where(inHousehold(db, accountUpdates, eq(accountUpdates.id, id)))
}
