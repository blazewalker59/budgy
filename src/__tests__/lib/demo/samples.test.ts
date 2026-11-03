import { afterEach, describe, expect, it } from 'vitest'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import type { AccountKind } from '@/lib/model/types'
import { SAMPLES, sampleCsv } from '@/lib/demo/samples'
import { householdDatabase } from '@/lib/households/scope'
import { households } from '@/lib/db/schema'
import { recordBalances, saveAccount } from '@/lib/ledger/accounts'
import { ingestAccountExport } from '@/lib/updates/ingest'
import { detectExport } from '@/lib/updates/exports'
import { parseBalanceHistory } from '@/lib/import/history'
import { loadLedger } from '@/lib/ledger/queries'
import { indexLedger } from '@/lib/model/ledger'
import { setupProgress } from '@/lib/model/setup'

const TODAY = '2026-11-02'
const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const sqlite of open.splice(0)) sqlite.close()
})

async function household() {
  const { sqlite, newClient } = testDatabase()
  open.push(sqlite)
  const db = householdDatabase(newClient(), 'demo')
  await newClient()
    .insert(households)
    .values({ id: 'demo', name: 'Demo', demo: true })
  const add = (name: string, kind: AccountKind) =>
    saveAccount(
      db,
      {
        name,
        owner: 'Joint',
        kind,
        institution: null,
        closed: false,
        securedBy: null,
      },
      true,
    )
  return { db, add }
}

describe('the sample exports', () => {
  it('are the same file for the same day, and plainly synthetic', () => {
    for (const { kind } of SAMPLES) {
      expect(sampleCsv(kind, TODAY)).toBe(sampleCsv(kind, TODAY))
      expect(sampleCsv(kind, TODAY)).not.toMatch(/blaze|alex/i)
    }
  })

  it('import through the Members’ upload paths, enough for setup’s history step', async () => {
    const { db, add } = await household()
    await add('Apple Card', 'credit')
    await add('Checking', 'checking')
    await add('Savings', 'savings')

    const card = sampleCsv('apple-card', TODAY)
    expect(detectExport(card)).toBe('apple-card')
    const cardIn = await ingestAccountExport(
      db,
      { account: 'Apple Card', text: card, format: 'apple-card', commit: true },
      'Sam (demo)',
    )
    expect(cardIn.summary.added).toBeGreaterThan(100)

    const checking = await ingestAccountExport(
      db,
      {
        account: 'Checking',
        text: sampleCsv('bank', TODAY),
        format: 'money-out-negative',
        commit: true,
      },
      'Sam (demo)',
    )
    expect(checking.summary.added).toBeGreaterThan(20)

    const history = parseBalanceHistory(sampleCsv('balances', TODAY))
    expect(history.kind).toBe('balances')
    if (history.kind !== 'balances') return
    expect(history.skipped).toBe(0)
    await recordBalances(
      db,
      history.rows.map((r) => ({ account: 'Savings', ...r })),
      'Sam (demo)',
    )

    const ledger = await loadLedger(db)
    const months = new Set(ledger.txns.map((t) => t.month))
    expect(months).toEqual(
      new Set([
        '2026-06',
        '2026-07',
        '2026-08',
        '2026-09',
        '2026-10',
        '2026-11',
      ]),
    )
    // A refund, and paychecks as Money in rather than spending.
    expect(ledger.txns.some((t) => t.amount < 0)).toBe(true)
    expect(ledger.txns.some((t) => /payroll/i.test(t.description))).toBe(false)
    expect(ledger.balances.filter((b) => b.account === 'Savings')).toHaveLength(
      history.rows.length,
    )
    const steps = setupProgress(indexLedger(ledger), TODAY, ledger.setup, {
      owners: ['Joint'],
      members: 1,
      invites: 0,
    })
    expect(steps.find((s) => s.id === 'history')?.done).toBe(true)
    expect(steps.find((s) => s.id === 'connect')?.done).toBe(true)
  })
})
