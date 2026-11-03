import { afterEach, describe, expect, it } from 'vitest'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import {
  householdDatabase,
  householdRow,
  inHousehold,
} from '@/lib/households/scope'
import { bankAccounts, bankConnections, households } from '@/lib/db/schema'
import { saveAccount } from '@/lib/ledger/accounts'
import { loadLedger } from '@/lib/ledger/queries'
import { addBankAccounts, listConnections } from '@/lib/updates/connections'
import { guessAccountKind } from '@/lib/model/accounts'

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

async function fixture() {
  const { db, sqlite, newClient } = testDatabase()
  open.push(sqlite)
  await db.insert(households).values([
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ])
  const a = householdDatabase(db, 'a')
  const b = householdDatabase(newClient(), 'b')
  for (const scope of [a, b]) {
    await scope.insert(bankConnections).values(
      householdRow(scope, {
        id: `c-${scope.householdId}`,
        name: 'SimpleFIN',
        createdBy: 'm',
        encryptedAccess: 'x',
        accessHash: `h-${scope.householdId}`,
        status: 'ready' as const,
      }),
    )
    await scope.insert(bankAccounts).values(
      ['Sapphire Visa', 'Everyday Checking', 'Euro Savings', 'Old card'].map(
        (name, i) =>
          householdRow(scope, {
            connectionId: `c-${scope.householdId}`,
            providerId: `p${i}`,
            name,
            institution: 'Chase',
            currency: name.startsWith('Euro') ? 'EUR' : 'USD',
            present: name !== 'Old card',
          }),
      ),
    )
  }
  await saveAccount(
    a,
    {
      name: 'Checking',
      owner: 'Joint',
      kind: 'checking',
      institution: null,
      closed: false,
      securedBy: null,
    },
    true,
  )
  return { a, b }
}

const card = {
  name: 'Sapphire',
  owner: 'Sam',
  kind: 'credit' as const,
  institution: 'Chase',
}

describe('Adding discovered bank accounts at once', () => {
  it('creates and links new Accounts, and links existing ones', async () => {
    const { a, b } = await fixture()
    await expect(
      addBankAccounts(a, [
        { connectionId: 'c-a', providerId: 'p0', create: card },
        { connectionId: 'c-a', providerId: 'p1', link: 'checking' },
      ]),
    ).resolves.toEqual({ added: 1, linked: 2 })
    const ledger = await loadLedger(a)
    expect(ledger.accounts.find((x) => x.name === 'Sapphire')).toMatchObject({
      owner: 'Sam',
      kind: 'credit',
      institution: 'Chase',
      closed: false,
    })
    const [connection] = await listConnections(a)
    expect(
      Object.fromEntries(connection.accounts.map((x) => [x.name, x.account])),
    ).toEqual({
      'Sapphire Visa': 'Sapphire',
      'Everyday Checking': 'Checking',
      'Euro Savings': null,
      'Old card': null,
    })
    // Nothing in the other Household moved.
    expect((await loadLedger(b)).accounts).toEqual([])
    expect(
      (await listConnections(b))[0].accounts.every((x) => x.account === null),
    ).toBe(true)
  })

  it('adds nothing when any choice fails', async () => {
    const { a } = await fixture()
    const attempts = [
      [
        { connectionId: 'c-a', providerId: 'p0', create: card },
        {
          connectionId: 'c-a',
          providerId: 'p2',
          create: { ...card, name: 'E' },
        },
      ],
      [
        { connectionId: 'c-a', providerId: 'p0', create: card },
        {
          connectionId: 'c-a',
          providerId: 'p3',
          create: { ...card, name: 'O' },
        },
      ],
      [
        { connectionId: 'c-a', providerId: 'p0', create: card },
        { connectionId: 'c-a', providerId: 'p1', create: card },
      ],
      [
        { connectionId: 'c-a', providerId: 'p0', create: card },
        { connectionId: 'c-a', providerId: 'p0', link: 'Checking' },
      ],
      [
        {
          connectionId: 'c-a',
          providerId: 'p0',
          create: { ...card, name: 'CHECKING' },
        },
      ],
      [{ connectionId: 'c-a', providerId: 'p0', link: 'Nope' }],
    ]
    const errors = []
    for (const choices of attempts)
      errors.push(
        await addBankAccounts(a, choices).then(
          () => null,
          (e: Error) => e.message,
        ),
      )
    expect(errors).toEqual([
      'Budgy only supports USD accounts.',
      'That bank account no longer exists.',
      'Sapphire is chosen for two bank accounts.',
      'Sapphire Visa is chosen twice.',
      "There's already an account named CHECKING.",
      'No account named "Nope".',
    ])
    expect((await loadLedger(a)).accounts.map((x) => x.name)).toEqual([
      'Checking',
    ])
    const rows = await a
      .select()
      .from(bankAccounts)
      .where(inHousehold(a, bankAccounts))
    expect(rows.every((r) => r.account === null)).toBe(true)
  })

  it('won’t link an Account that’s already fed, or a bank account already linked', async () => {
    const { a } = await fixture()
    await addBankAccounts(a, [
      { connectionId: 'c-a', providerId: 'p1', link: 'Checking' },
    ])
    await expect(
      addBankAccounts(a, [
        { connectionId: 'c-a', providerId: 'p0', link: 'Checking' },
      ]),
    ).rejects.toThrow('Checking is already linked to Everyday Checking.')
    await expect(
      addBankAccounts(a, [
        { connectionId: 'c-a', providerId: 'p1', create: card },
      ]),
    ).rejects.toThrow('Everyday Checking already feeds Checking.')
  })

  it('can’t reach another Household’s bank accounts', async () => {
    const { a, b } = await fixture()
    await expect(
      addBankAccounts(a, [
        { connectionId: 'c-b', providerId: 'p0', create: card },
      ]),
    ).rejects.toThrow('That bank account no longer exists.')
    expect((await loadLedger(a)).accounts.map((x) => x.name)).toEqual([
      'Checking',
    ])
    expect((await loadLedger(b)).accounts).toEqual([])
  })
})

describe('Guessing a shared account’s kind', () => {
  it('reads the usual words in a bank’s account names', () => {
    expect(guessAccountKind('Sapphire Preferred Visa')).toBe('credit')
    expect(guessAccountKind('Amex Gold Card')).toBe('credit')
    expect(guessAccountKind('Total Checking')).toBe('checking')
    expect(guessAccountKind('High Yield Savings')).toBe('savings')
    expect(guessAccountKind('Roth IRA')).toBe('retirement')
    expect(guessAccountKind('401(k) Plan')).toBe('retirement')
    expect(guessAccountKind('NY 529 College Plan')).toBe('education')
    expect(guessAccountKind('Home Mortgage')).toBe('loan')
    expect(guessAccountKind('Individual Brokerage')).toBe('brokerage')
    expect(guessAccountKind('Account 1234')).toBe('other')
  })
})
