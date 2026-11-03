/**
 * Account labels in D1: adding, renaming (its Accounts follow), recolouring
 * and deleting them, and labelling Accounts (docs/adr/0016). Every read and
 * write is scoped to the Household; a label is only ever set on an Account
 * when that label exists in the same Household. Server-only.
 */

import { and, eq, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { HouseholdDatabase as Database } from '@/lib/households/scope'
import type { AccountLabel } from '@/lib/model/types'
import { householdRow, inHousehold } from '@/lib/households/scope'
import { accountLabels, accounts } from '@/lib/db/schema'
import { UserError } from '@/lib/errors'

/** At most this many Accounts labelled at once (one D1 batch). */
export const MAX_LABELLED = 40

async function labelsNamed(db: Database, name: string) {
  return db
    .select({ name: accountLabels.name, color: accountLabels.color })
    .from(accountLabels)
    .where(
      inHousehold(
        db,
        accountLabels,
        sql`lower(${accountLabels.name}) = ${name.trim().toLowerCase()}`,
      ),
    )
}

/** This Household's label by name, any case; its real name. */
export async function findLabel(
  db: Database,
  name: string,
): Promise<AccountLabel> {
  const [found] = await labelsNamed(db, name)
  if (!found) throw new UserError(`There’s no label called ${name.trim()}.`)
  return found
}

/**
 * The label's name, only if this Household has it: what an Account's
 * `label` is set to, so a write can never point at another Household's (or
 * a just-deleted) label.
 */
export function labelIfOurs(db: Database, name: string): SQL {
  return sql`(select name from account_labels where household_id = ${db.householdId} and name = ${name})`
}

export async function createLabel(
  db: Database,
  label: AccountLabel,
): Promise<void> {
  const name = label.name.trim()
  if ((await labelsNamed(db, name)).length)
    throw new UserError(`There’s already a label called ${name}.`)
  await db
    .insert(accountLabels)
    .values(householdRow(db, { name, color: label.color }))
}

/** Rename or recolour a label; every Account using it follows the rename. */
export async function updateLabel(
  db: Database,
  from: string,
  next: AccountLabel,
): Promise<void> {
  const current = await findLabel(db, from)
  if (current.name !== from)
    throw new UserError(`There’s no label called ${from}.`)
  const name = next.name.trim()
  if ((await labelsNamed(db, name)).some((l) => l.name !== from))
    throw new UserError(`There’s already a label called ${name}.`)
  await db.batch([
    db
      .update(accountLabels)
      .set({ name, color: next.color })
      .where(inHousehold(db, accountLabels, eq(accountLabels.name, from))),
    db
      .update(accounts)
      .set({ label: name })
      .where(inHousehold(db, accounts, eq(accounts.label, from))),
  ])
}

/** Delete a label; its Accounts keep their "Shown as". */
export async function deleteLabel(db: Database, name: string): Promise<void> {
  await db.batch([
    db
      .update(accounts)
      .set({ label: null })
      .where(inHousehold(db, accounts, eq(accounts.label, name))),
    db
      .delete(accountLabels)
      .where(inHousehold(db, accountLabels, eq(accountLabels.name, name))),
  ])
}

/**
 * Give several Accounts a label, each with what it's shown as, all or none.
 * Returns how many Accounts were labelled.
 */
export async function labelAccounts(
  db: Database,
  label: string,
  rows: ReadonlyArray<{ name: string; displayName: string | null }>,
): Promise<number> {
  if (!rows.length) return 0
  if (rows.length > MAX_LABELLED)
    throw new UserError(`Label up to ${MAX_LABELLED} accounts at once.`)
  const { name } = await findLabel(db, label)
  const known = await db
    .select({ name: accounts.name })
    .from(accounts)
    .where(
      inHousehold(
        db,
        accounts,
        inArray(
          accounts.name,
          rows.map((r) => r.name),
        ),
      ),
    )
  const missing = rows.filter((r) => !known.some((k) => k.name === r.name))
  if (missing.length)
    throw new UserError(`No account named ${missing[0].name}.`)
  const [first, ...rest] = rows.map((r) =>
    db
      .update(accounts)
      .set({ label: labelIfOurs(db, name), displayName: r.displayName })
      .where(
        inHousehold(
          db,
          accounts,
          and(
            eq(accounts.name, r.name),
            sql`exists (select 1 from account_labels where household_id = ${db.householdId} and name = ${name})`,
          ),
        ),
      ),
  )
  await db.batch([first, ...rest])
  return rows.length
}
