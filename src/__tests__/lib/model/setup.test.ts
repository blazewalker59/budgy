import { describe, expect, it } from 'vitest'
import { ledger, paySchedule, plan, txn } from '@test/factories'
import { indexLedger } from '@/lib/model/ledger'
import {
  NO_MARKS,
  markStep,
  parseSetupMarks,
  setupFinished,
  setupProgress,
} from '@/lib/model/setup'

const TODAY = '2026-11-02'
const alone = { owners: ['Joint'], members: 1, invites: 0 }
const doneIds = (steps: ReturnType<typeof setupProgress>) =>
  steps.filter((s) => s.done).map((s) => s.id)

describe('Setup progress', () => {
  it('starts with nothing done for an empty Household', () => {
    const empty = indexLedger(ledger({ accounts: [] }))
    const steps = setupProgress(empty, TODAY, NO_MARKS, alone)
    expect(steps.map((s) => s.id)).toEqual([
      'household',
      'partner',
      'categories',
      'connect',
      'history',
      'sort',
      'pay',
      'targets',
      'bills',
    ])
    expect(doneIds(steps)).toEqual([])
    expect(setupFinished(steps)).toBe(false)
  })

  it('reads each step from the Ledger itself', () => {
    const ix = indexLedger(
      ledger({
        txns: [
          txn({ date: '2026-09-10' }),
          txn({ date: '2026-10-10' }),
          txn({ date: '2026-11-01', sourceCategory: 'Uncategorized' }),
        ],
        pay: [paySchedule()],
        targets: [{ category: 'Groceries', startsMonth: '2026-11', amount: 1 }],
        plans: [plan()],
      }),
    )
    const steps = setupProgress(ix, TODAY, NO_MARKS, {
      owners: ['Joint', 'Sam'],
      members: 1,
      invites: 1,
    })
    expect(doneIds(steps)).toEqual([
      'household',
      'partner',
      'connect',
      'history',
      'pay',
      'targets',
      'bills',
    ])
    // One in three purchases still Uncategorized: not sorted yet.
    expect(steps.find((s) => s.id === 'sort')?.done).toBe(false)
  })

  it('needs two of the last three months for history', () => {
    const one = indexLedger(ledger({ txns: [txn({ date: '2026-10-10' })] }))
    expect(
      setupProgress(one, TODAY, NO_MARKS, alone).find((s) => s.id === 'history')
        ?.done,
    ).toBe(false)
  })

  it('keeps marks for what the Ledger can’t show', () => {
    let marks = markStep(NO_MARKS, 'categories', 'done')
    marks = markStep(marks, 'bills', 'skipped')
    // Only some steps can be marked done by hand.
    marks = markStep(marks, 'pay', 'done')
    expect(marks).toEqual({
      skipped: ['bills'],
      done: ['categories'],
      dismissed: false,
    })
    const ix = indexLedger(ledger({ accounts: [] }))
    const steps = setupProgress(ix, TODAY, marks, alone)
    expect(doneIds(steps)).toEqual(['categories'])
    expect(steps.find((s) => s.id === 'bills')?.skipped).toBe(true)
    expect(markStep(marks, 'bills', null).skipped).toEqual([])
  })

  it('is finished when every step is done or skipped', () => {
    const ix = indexLedger(ledger({ accounts: [] }))
    const marks = {
      ...NO_MARKS,
      skipped: [
        'household',
        'partner',
        'categories',
        'connect',
        'history',
        'sort',
        'pay',
        'targets',
        'bills',
      ] as const,
    }
    expect(
      setupFinished(
        setupProgress(
          ix,
          TODAY,
          { ...marks, skipped: [...marks.skipped] },
          alone,
        ),
      ),
    ).toBe(true)
  })

  it('reads stored marks, ignoring anything broken', () => {
    expect(parseSetupMarks(null)).toEqual(NO_MARKS)
    expect(parseSetupMarks('{oops')).toEqual(NO_MARKS)
    expect(
      parseSetupMarks('{"skipped":["nope"],"done":[],"dismissed":false}'),
    ).toEqual(NO_MARKS)
    expect(
      parseSetupMarks('{"skipped":["pay"],"done":[],"dismissed":true}'),
    ).toEqual({ skipped: ['pay'], done: [], dismissed: true })
  })
})
