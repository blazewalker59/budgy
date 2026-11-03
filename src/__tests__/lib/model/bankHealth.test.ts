import { describe, expect, it } from 'vitest'
import type { HealthAccount } from '@/lib/model/bankHealth'
import {
  checkedAgo,
  connectionHealth,
  syncingLabel,
  troubleLabel,
} from '@/lib/model/bankHealth'

const bank = (over: Partial<HealthAccount>): HealthAccount => ({
  providerId: 'p',
  name: 'Account',
  institution: 'Bank',
  account: null,
  present: true,
  connId: null,
  problem: null,
  problemKind: null,
  ...over,
})

// Several logins on one Bridge connection: three need a sign-in, one of
// them (NewRez) feeds nothing in Budgy yet; Chase is fine.
const accounts = [
  bank({
    providerId: 'a1',
    name: '529 A',
    institution: 'Path2College 529 Plan',
    connId: 'CON-529',
    account: 'Kid 529',
  }),
  bank({
    providerId: 'a2',
    name: '529 B',
    institution: 'Path2College 529 Plan',
    connId: 'CON-529',
    account: 'Other kid 529',
  }),
  bank({
    providerId: 'a3',
    name: '401k',
    institution: 'ADP Retirement Services',
    connId: 'CON-ADP',
    account: 'Work 401(k)',
  }),
  bank({
    providerId: 'a4',
    name: 'Loan#',
    institution: 'NewRez',
    connId: 'CON-NEWREZ',
  }),
  bank({
    providerId: 'a5',
    name: 'Visa',
    institution: 'Chase',
    connId: 'CON-CHASE',
    account: 'Visa',
  }),
]
const signIn = (connId: string, name: string) => ({
  kind: 'con.auth',
  message: `Connection to ${name} may need attention. Auth required`,
  connId,
})

describe('connectionHealth', () => {
  it('groups Bridge problems by bank, with the Budgy Accounts each affects', () => {
    const health = connectionHealth(accounts, [
      signIn('CON-529', 'Path2College 529 Plan'),
      signIn('CON-ADP', 'ADP Retirement Services'),
      signIn('CON-NEWREZ', 'NewRez'),
    ])
    expect(health.linked).toBe(4)
    expect(health.syncing).toBe(1)
    expect(health.banks).toEqual([
      {
        institution: 'ADP Retirement Services',
        trouble: 'sign-in',
        said: [
          'Connection to ADP Retirement Services may need attention. Auth required',
        ],
        affects: ['Work 401(k)'],
      },
      {
        institution: 'NewRez',
        trouble: 'sign-in',
        said: ['Connection to NewRez may need attention. Auth required'],
        affects: [],
      },
      {
        institution: 'Path2College 529 Plan',
        trouble: 'sign-in',
        said: [
          'Connection to Path2College 529 Plan may need attention. Auth required',
        ],
        affects: ['Kid 529', 'Other kid 529'],
      },
    ])
    expect(syncingLabel(health)).toBe('1 of 4 linked accounts syncing')
    expect(troubleLabel(health)).toBe('3 banks need a sign-in')
  })

  it('is healthy with no problems', () => {
    const health = connectionHealth(accounts, null)
    expect(health.banks).toEqual([])
    expect(syncingLabel(health)).toBe('All 4 linked accounts syncing')
    expect(troubleLabel(health)).toBeNull()
  })

  it('puts an account-level failure on its own bank, after sign-ins', () => {
    const health = connectionHealth(accounts, [
      { kind: 'act.failed', message: 'Try again later', accountId: 'a5' },
      signIn('CON-ADP', 'ADP Retirement Services'),
    ])
    expect(health.banks.map((b) => [b.institution, b.trouble])).toEqual([
      ['ADP Retirement Services', 'sign-in'],
      ['Chase', 'failed'],
    ])
    expect(troubleLabel(health)).toBe(
      '1 bank needs a sign-in · 1 bank had trouble',
    )
  })

  it('counts what an Account’s own last sync found, once per bank', () => {
    const health = connectionHealth(
      accounts.map((a) =>
        a.providerId === 'a1' ? { ...a, problemKind: 'reauth' as const } : a,
      ),
      [signIn('CON-529', 'Path2College 529 Plan')],
    )
    expect(health.banks).toHaveLength(1)
    expect(health.banks[0].affects).toEqual(['Kid 529', 'Other kid 529'])
    expect(health.syncing).toBe(2)
  })

  it('names a bank from Bridge’s message when no account shares its login', () => {
    const health = connectionHealth([], [signIn('CON-X', 'Ally Bank')])
    expect(health.banks[0].institution).toBe('Ally Bank')
    expect(syncingLabel(health)).toBe('Nothing linked yet')
  })
})

describe('checkedAgo', () => {
  const now = new Date('2026-11-02T22:00:00Z')
  it('says how long ago, roughly', () => {
    expect(checkedAgo(new Date('2026-11-02T21:59:40Z'), now)).toBe('just now')
    expect(checkedAgo(new Date('2026-11-02T21:48:00Z'), now)).toBe('12 min ago')
    expect(checkedAgo(new Date('2026-11-02T19:00:00Z'), now)).toBe(
      '3 hours ago',
    )
    expect(checkedAgo(new Date('2026-11-01T20:00:00Z'), now)).toBe('yesterday')
  })
})
