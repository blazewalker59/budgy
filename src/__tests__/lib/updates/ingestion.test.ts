import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import { householdDatabase } from '@/lib/households/scope'
import {
  accountUpdateLocks,
  accountUpdates,
  households,
  transactions,
} from '@/lib/db/schema'
import {
  deleteAccount,
  postTransactions,
  removeStarting,
  saveAccount,
} from '@/lib/ledger/accounts'
import {
  loadLedger,
  moveTransaction,
  noteTransaction,
} from '@/lib/ledger/queries'
import { listAccountUpdates } from '@/lib/updates/queries'
import { acquireUpdate, releaseUpdate } from '@/lib/updates/receipts'
import { ingestAccountExport } from '@/lib/updates/ingest'

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})
async function fixture() {
  const { db, sqlite, newClient, d1 } = testDatabase()
  open.push(sqlite)
  await db.insert(households).values([
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ])
  const a = householdDatabase(newClient(), 'a')
  const b = householdDatabase(newClient(), 'b')
  for (const scope of [a, b])
    await saveAccount(
      scope,
      {
        name: 'Card',
        owner: 'Joint',
        kind: 'credit',
        institution: null,
        closed: false,
        securedBy: null,
      },
      true,
    )
  return { db, a, b, sqlite, d1 }
}
const row = { date: '2026-10-01', description: 'Coffee Shop', amount: 5 }
const identified = { ...row, sourceId: 'source-1' }
const post = (account = 'Card') => ({
  account,
  commit: true,
  importedBy: 'Member',
  via: 'uploaded' as const,
})

describe('Unified account ingestion', () => {
  it('routes a CSV through shared filing and saves its format only within the current Household', async () => {
    const { a, b } = await fixture()
    const data = {
      account: 'Card',
      text: 'Date,Description,Amount\n2026-10-01,Coffee Shop,5',
      format: 'spending-positive' as const,
      commit: false,
    }
    await ingestAccountExport(a, data, 'Member')
    expect((await listAccountUpdates(a))[0].format).toBeNull()
    expect((await listAccountUpdates(a))[0].latest).toBeNull()
    const imported = await ingestAccountExport(
      a,
      { ...data, commit: true },
      'Member',
    )
    expect(imported.summary.added).toBe(1)
    expect((await listAccountUpdates(a))[0].format).toBe('spending-positive')
    expect((await listAccountUpdates(b))[0].format).toBeNull()
    expect((await loadLedger(b)).txns).toHaveLength(0)
  })

  it('records a failed committed CSV without storing its raw contents or counting preview errors as attempts', async () => {
    const { a, db } = await fixture()
    const data = {
      account: 'Card',
      text: 'Date,Description,Amount\n2026-10-01,PRIVATE RAW CSV,not a number',
      format: 'spending-positive' as const,
      commit: false,
    }
    await expect(ingestAccountExport(a, data, 'Member')).rejects.toThrow(
      'Nothing was imported',
    )
    expect(await db.select().from(accountUpdates)).toHaveLength(0)
    await expect(
      ingestAccountExport(a, { ...data, commit: true }, 'Member'),
    ).rejects.toThrow('Nothing was imported')
    const status = (await listAccountUpdates(a))[0]
    expect(status.latest?.status).toBe('failed')
    expect(status.latest?.message).not.toContain('PRIVATE RAW CSV')
    expect((await loadLedger(a)).txns).toHaveLength(0)
  })
  it('orders receipts deterministically when attempts share the same millisecond', async () => {
    const { a } = await fixture()
    const common = {
      householdId: 'a',
      account: 'Card',
      source: 'uploaded' as const,
      startedAt: new Date('2026-10-01'),
      finishedAt: new Date('2026-10-01'),
      updatedBy: 'Member',
    }
    await a.insert(accountUpdates).values([
      { ...common, id: 'z-old', status: 'succeeded' },
      { ...common, id: 'a-new', status: 'failed' },
    ])
    const status = (await listAccountUpdates(a))[0]
    expect(status.latest?.id).toBe('a-new')
    expect(status.success?.id).toBe('z-old')
  })
  it('records a no-op success separately from the latest purchase date; preview writes nothing', async () => {
    const { a, db } = await fixture()
    await postTransactions(a, { ...post(), rows: [row], commit: false })
    expect(await db.select().from(accountUpdates)).toEqual([])
    await postTransactions(a, { ...post(), rows: [row] })
    const second = await postTransactions(a, { ...post(), rows: [row] })
    expect(second.added).toBe(0)
    const receipts = await db.select().from(accountUpdates)
    expect(receipts).toHaveLength(2)
    expect(receipts.filter((r) => r.status === 'succeeded')).toHaveLength(2)
    expect(receipts.map((r) => r.added).sort()).toEqual([0, 1])
    expect((await loadLedger(a)).txns).toHaveLength(1)
    expect((await listAccountUpdates(a))[0].success?.finishedAt).toBeTruthy()
  })

  it('keeps separate provider IDs distinct even for identical purchases and repeated date windows', async () => {
    const { a } = await fixture()
    const rows = [identified, { ...identified, sourceId: 'source-2' }]
    expect(
      (
        await postTransactions(a, {
          ...post(),
          rows,
          sourceNamespace: 'test-connector',
        })
      ).added,
    ).toBe(2)
    expect(
      (
        await postTransactions(a, {
          ...post(),
          rows,
          sourceNamespace: 'test-connector',
        })
      ).added,
    ).toBe(0)
    expect((await loadLedger(a)).txns).toHaveLength(2)
  })

  it('updates a known provider purchase without losing its Move or note, even when its date changes', async () => {
    const { a } = await fixture()
    await postTransactions(a, {
      ...post(),
      rows: [identified],
      sourceNamespace: 'test-connector',
    })
    const id = (await loadLedger(a)).txns[0].id
    await moveTransaction(a, id, 'Treats')
    await noteTransaction(a, id, 'Keep this')
    const changed = await postTransactions(a, {
      ...post(),
      rows: [
        {
          ...identified,
          date: '2026-10-05',
          amount: 6,
          description: 'Coffee Shop Updated',
        },
      ],
      sourceNamespace: 'test-connector',
    })
    expect(changed).toMatchObject({ added: 0, updated: 1 })
    expect((await loadLedger(a)).txns[0]).toMatchObject({
      id,
      date: '2026-10-05',
      amount: 600,
      category: 'Treats',
      note: 'Keep this',
    })
  })

  it('links an unambiguous legacy purchase without replacing its ID or manual filing', async () => {
    const { a } = await fixture()
    await postTransactions(a, { ...post(), rows: [row] })
    const id = (await loadLedger(a)).txns[0].id
    await moveTransaction(a, id, 'Treats')
    await noteTransaction(a, id, 'A note')
    const linked = await postTransactions(a, {
      ...post(),
      rows: [identified],
      sourceNamespace: 'test-connector',
    })
    expect(linked).toMatchObject({ added: 0, linked: 1 })
    expect((await loadLedger(a)).txns[0]).toMatchObject({
      id,
      category: 'Treats',
      note: 'A note',
    })
    expect(await removeStarting(a)).toBe(0)
  })

  it('holds ambiguous legacy matches for review rather than merging or adding another purchase', async () => {
    const { a } = await fixture()
    await postTransactions(a, { ...post(), rows: [row, row] })
    const result = await postTransactions(a, {
      ...post(),
      rows: [identified],
      sourceNamespace: 'test-connector',
    })
    expect(result).toMatchObject({ added: 0, linked: 0 })
    expect(result.review).toHaveLength(1)
    expect((await loadLedger(a)).txns).toHaveLength(2)
    const status = (await listAccountUpdates(a))[0]
    expect(status.latest?.status).toBe('attention')
    expect(status.latest?.issues).toHaveLength(1)
    expect(status.success?.status).toBe('succeeded')
  })

  it('never collapses two different stores merely because their amounts and dates match', async () => {
    const { a } = await fixture()
    await postTransactions(a, { ...post(), rows: [row] })
    expect(
      (
        await postTransactions(a, {
          ...post(),
          rows: [{ ...row, description: 'Book Store' }],
        })
      ).added,
    ).toBe(1)
  })

  it('holds a possible date-shifted legacy match instead of silently adding a duplicate', async () => {
    const { a } = await fixture()
    await postTransactions(a, { ...post(), rows: [row] })
    const result = await postTransactions(a, {
      ...post(),
      rows: [{ ...identified, date: '2026-10-03' }],
      sourceNamespace: 'test-connector',
    })
    expect(result.added).toBe(0)
    expect(result.review[0].reason).toContain('different posting date')
    expect((await loadLedger(a)).txns).toHaveLength(1)
  })

  it('keeps identities, receipts and leases isolated across Households', async () => {
    const { a, b } = await fixture()
    await postTransactions(a, {
      ...post(),
      rows: [identified],
      sourceNamespace: 'test-connector',
    })
    expect((await listAccountUpdates(b))[0].latest).toBeNull()
    const lease = await acquireUpdate(a, 'Card')
    await expect(
      postTransactions(a, { ...post(), rows: [row] }),
    ).rejects.toThrow('already updating')
    await postTransactions(b, {
      ...post(),
      rows: [identified],
      sourceNamespace: 'test-connector',
    })
    await releaseUpdate(b, 'Card', lease) // cannot release A's lease
    await expect(acquireUpdate(a, 'Card')).rejects.toThrow('already updating')
    await releaseUpdate(a, 'Card', lease)
    expect((await loadLedger(b)).txns).toHaveLength(1)
  })

  it('rejects a contradictory source ID, records failure, releases the lease and retains the last success', async () => {
    const { a, db } = await fixture()
    await postTransactions(a, { ...post(), rows: [row] })
    await expect(
      postTransactions(a, {
        ...post(),
        rows: [identified, { ...identified, amount: 9 }],
        sourceNamespace: 'test-connector',
      }),
    ).rejects.toThrow('conflicting')
    const status = (await listAccountUpdates(a))[0]
    expect(status.latest?.status).toBe('failed')
    expect(status.success?.status).toBe('succeeded')
    expect(await db.select().from(accountUpdateLocks)).toEqual([])
    expect((await loadLedger(a)).txns).toHaveLength(1)
  })

  it('allows a crashed writer’s expired lease to be replaced, but never releases a newer lease', async () => {
    const { a } = await fixture()
    const old = await acquireUpdate(a, 'Card')
    await a
      .update(accountUpdateLocks)
      .set({ expiresAt: new Date(0) })
      .where(eq(accountUpdateLocks.token, old))
    const fresh = await acquireUpdate(a, 'Card')
    await releaseUpdate(a, 'Card', old)
    await expect(acquireUpdate(a, 'Card')).rejects.toThrow('already updating')
    await releaseUpdate(a, 'Card', fresh)
  })

  it('makes a partial multi-batch failure visible and resumes identified rows without duplicates or orphan imports', async () => {
    const { a, d1 } = await fixture()
    const original = d1.batch.bind(d1)
    let calls = 0
    d1.batch = ((statements: Array<D1PreparedStatement>) => {
      if (++calls === 2)
        return Promise.reject(new Error('Simulated later-batch failure'))
      return original(statements)
    }) as typeof d1.batch
    const rows = Array.from({ length: 400 }, (_, index) => ({
      ...row,
      sourceId: `s${index}`,
    }))
    await expect(
      postTransactions(a, {
        ...post(),
        rows,
        sourceNamespace: 'test-connector',
      }),
    ).rejects.toThrow('Simulated')
    const partial = await loadLedger(a)
    expect(partial.txns.length).toBeGreaterThan(0)
    expect(partial.txns.length).toBeLessThan(400)
    expect(partial.txns.every((t) => !t.starting)).toBe(true)
    d1.batch = original
    await postTransactions(a, {
      ...post(),
      rows,
      sourceNamespace: 'test-connector',
    })
    expect((await loadLedger(a)).txns).toHaveLength(400)
    expect((await listAccountUpdates(a))[0].success?.status).toBe('succeeded')
  })

  it('records excluded-only checks with the source range and refuses updates to closed Accounts', async () => {
    const { a } = await fixture()
    await postTransactions(a, {
      ...post(),
      rows: [],
      excluded: 3,
      coverage: { from: '2026-10-01', to: '2026-10-04' },
    })
    expect((await listAccountUpdates(a))[0].success).toMatchObject({
      added: 0,
      skipped: 3,
      fromDate: '2026-10-01',
      toDate: '2026-10-04',
    })
    await saveAccount(
      a,
      {
        name: 'Card',
        owner: 'Joint',
        kind: 'credit',
        institution: null,
        closed: true,
        securedBy: null,
      },
      false,
    )
    await expect(
      postTransactions(a, { ...post(), rows: [row] }),
    ).rejects.toThrow('Reopen')
  })

  it('cleans an accidentally added empty Account’s receipts without affecting another Household', async () => {
    const { a, b, db } = await fixture()
    await postTransactions(a, { ...post(), rows: [] })
    await postTransactions(b, { ...post(), rows: [] })
    await deleteAccount(a, 'Card')
    expect((await listAccountUpdates(b))[0].success?.status).toBe('succeeded')
    expect(await db.select().from(accountUpdates)).toHaveLength(1)
    expect(await db.select().from(transactions)).toHaveLength(0)
  })
})
