/**
 * Money in (docs/adr/0011) in D1: recording what came into a bank Account
 * from its updates, and filing it. An offset is a refund Transaction on the
 * same Account and day, in the chosen Category, that this row owns: filing
 * it again changes that Transaction, and filing it as anything else removes
 * it. Server-only.
 */
import { eq } from 'drizzle-orm'
import type { HouseholdDatabase as Database } from '@/lib/households/scope'
import type { IncomingRow, MoneyIn, MoneyInUse } from '@/lib/model/moneyIn'
import { householdRow, inHousehold } from '@/lib/households/scope'
import { categories, imports, moneyIn, transactions } from '@/lib/db/schema'
import { loadImportRules, rowsPerInsert } from '@/lib/ledger/importer'
import { guessUse } from '@/lib/model/moneyIn'
import { newCategory } from '@/lib/model/defaults'
import { TRANSFER } from '@/lib/model/ledger'
import { sha1Hex } from '@/lib/import/rows'
import { storeName } from '@/lib/import/stores'

/** Where an offset's refund Transaction says it came from. */
const OFFSET_KEY = 'money-in:'

/**
 * Save an update's incoming rows for one Account; ones already here are
 * left as they are (a Member's filing always wins). Returns how many were
 * new. With a namespace, rows are known by their connector id; without,
 * by a hash of the row and how many identical ones came before it.
 */
export async function recordMoneyIn(
  db: Database,
  account: string,
  rows: ReadonlyArray<IncomingRow>,
  namespace?: string,
): Promise<number> {
  if (!rows.length) return 0
  const rules = await loadImportRules(db)
  const seen = new Map<string, number>()
  const keyed = []
  for (const r of rows) {
    let sourceKey: string
    if (r.sourceId && namespace)
      sourceKey = await sha1Hex(JSON.stringify([namespace, r.sourceId]))
    else {
      const base = `${r.date}|${r.description}|${r.amount}`
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      sourceKey = await sha1Hex(`${base}|${n}`)
    }
    keyed.push({ ...r, sourceKey })
  }
  const have = new Set(
    (
      await db
        .select({ sourceKey: moneyIn.sourceKey })
        .from(moneyIn)
        .where(inHousehold(db, moneyIn, eq(moneyIn.account, account)))
    ).map((m) => m.sourceKey),
  )
  const fresh = []
  for (const r of keyed) {
    if (have.has(r.sourceKey)) continue
    have.add(r.sourceKey)
    fresh.push(
      householdRow(db, {
        id: (await sha1Hex(JSON.stringify([account, r.sourceKey]))).slice(
          0,
          16,
        ),
        account,
        date: r.date,
        month: r.date.slice(0, 7),
        description: r.description.slice(0, 200),
        store: storeName(r.description, rules) || 'Unknown',
        amount: r.amount,
        use: guessUse(r.description),
        sourceKey: r.sourceKey,
      }),
    )
  }
  const perInsert = rowsPerInsert(moneyIn)
  for (let i = 0; i < fresh.length; i += perInsert)
    await db
      .insert(moneyIn)
      .values(fresh.slice(i, i + perInsert))
      .onConflictDoNothing()
  return fresh.length
}

export async function listMoneyIn(db: Database): Promise<Array<MoneyIn>> {
  const rows = await db
    .select({
      id: moneyIn.id,
      account: moneyIn.account,
      date: moneyIn.date,
      month: moneyIn.month,
      description: moneyIn.description,
      store: moneyIn.store,
      amount: moneyIn.amount,
      use: moneyIn.use,
      category: moneyIn.category,
      offset: moneyIn.offset,
      note: moneyIn.note,
    })
    .from(moneyIn)
    .where(inHousehold(db, moneyIn))
  return rows.sort(
    (a, b) => b.date.localeCompare(a.date) || b.amount - a.amount,
  )
}

export interface MoneyInFiling {
  id: string
  use: MoneyInUse
  /** For an offset: the Category it comes off. */
  category?: string | null
  /** For an offset: cents to take off; the whole amount if left out. */
  offset?: number | null
  /** Left out keeps the note; null clears it. */
  note?: string | null
}

/** Say what one Money in is; an offset adds (or changes) its refund. */
export async function fileMoneyIn(
  db: Database,
  filing: MoneyInFiling,
  filedBy: string,
): Promise<MoneyIn> {
  const row = await db
    .select()
    .from(moneyIn)
    .where(inHousehold(db, moneyIn, eq(moneyIn.id, filing.id)))
    .get()
  if (!row) throw new Error('That money in is no longer here.')
  const note =
    filing.note === undefined ? row.note : filing.note?.trim() || null
  const statements = []
  let txnId: string | null = null
  let category: string | null = null
  let offset: number | null = null
  if (filing.use === 'offset') {
    category = filing.category?.trim() || null
    if (!category || category === TRANSFER)
      throw new Error('Choose the category this money comes off.')
    offset = filing.offset ?? row.amount
    if (!Number.isInteger(offset) || offset < 1 || offset > row.amount)
      throw new Error(
        'An offset can be at most the money that came in, and more than $0.',
      )
    txnId =
      row.txnId ??
      (await sha1Hex(JSON.stringify([row.account, OFFSET_KEY, row.id]))).slice(
        0,
        16,
      )
    statements.push(
      db
        .insert(categories)
        .values(householdRow(db, newCategory(category)))
        .onConflictDoNothing(),
    )
    const existing = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(inHousehold(db, transactions, eq(transactions.id, txnId)))
      .get()
    if (existing)
      statements.push(
        db
          .update(transactions)
          .set({
            amount: -offset,
            sourceCategory: category,
            category,
            note,
          })
          .where(inHousehold(db, transactions, eq(transactions.id, txnId))),
      )
    else {
      const importId = `im_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
      statements.push(
        db.insert(imports).values(
          householdRow(db, {
            id: importId,
            fileName: `money in to ${row.account}`,
            account: row.account,
            importedBy: filedBy,
            added: 1,
            skipped: 0,
          }),
        ),
        db.insert(transactions).values(
          householdRow(db, {
            id: txnId,
            date: row.date,
            month: row.month,
            account: row.account,
            description: row.description,
            store: row.store,
            sourceCategory: category,
            // A Move, so a Store Rule for, say, Venmo never refiles it.
            category,
            amount: -offset,
            note,
            importId,
            sourceKey: `${OFFSET_KEY}${row.id}`,
          }),
        ),
      )
    }
  } else if (row.txnId)
    statements.push(
      db
        .delete(transactions)
        .where(inHousehold(db, transactions, eq(transactions.id, row.txnId))),
    )
  statements.push(
    db
      .update(moneyIn)
      .set({ use: filing.use, category, offset, txnId, note })
      .where(inHousehold(db, moneyIn, eq(moneyIn.id, row.id))),
  )
  await db.batch(
    statements as [(typeof statements)[number], ...typeof statements],
  )
  return {
    id: row.id,
    account: row.account,
    date: row.date,
    month: row.month,
    description: row.description,
    store: row.store,
    amount: row.amount,
    use: filing.use,
    category,
    offset,
    note,
  }
}

/**
 * Forget one Account's Money in, for when the Account itself goes. Offsets
 * are purchases, which already keep an Account from being deleted.
 */
export function deleteMoneyInFor(db: Database, account: string) {
  return db
    .delete(moneyIn)
    .where(inHousehold(db, moneyIn, eq(moneyIn.account, account)))
}
