import { afterEach, describe, expect, it } from 'vitest'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import type { HouseholdDatabase } from '@/lib/households/scope'
import { householdDatabase } from '@/lib/households/scope'
import {
  createLabel,
  deleteLabel,
  labelAccounts,
  updateLabel,
} from '@/lib/ledger/labels'
import { saveAccount } from '@/lib/ledger/accounts'
import { loadLedger } from '@/lib/ledger/queries'
import { households } from '@/lib/db/schema'
import { accountInput } from '@/lib/model/accounts'
import { labelInput } from '@/lib/model/labels'

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

const account = (name: string, owner = 'Joint') => ({
  name,
  owner,
  kind: 'education' as const,
  institution: null,
  closed: false,
  securedBy: null,
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
  for (const scope of [a, b])
    for (const name of ['Addie 529', 'Addie Trump Account', 'Asher 529'])
      await saveAccount(scope, account(name), true)
  return { a, b }
}

const accountsOf = async (db: HouseholdDatabase) =>
  Object.fromEntries(
    (await loadLedger(db)).accounts.map((x) => [
      x.name,
      { label: x.label, displayName: x.displayName },
    ]),
  )

describe('Account labels', () => {
  it('are added, listed by name, and unique in any case', async () => {
    const { a } = await fixture()
    await createLabel(a, { name: 'Asher', color: 'blue' })
    await createLabel(a, { name: ' Addie ', color: 'pink' })
    expect((await loadLedger(a)).labels).toEqual([
      { name: 'Addie', color: 'pink' },
      { name: 'Asher', color: 'blue' },
    ])
    await expect(
      createLabel(a, { name: 'addie', color: 'red' }),
    ).rejects.toThrow('already a label called addie')
  })

  it('are set on an Account with its Shown as, by any case', async () => {
    const { a } = await fixture()
    await createLabel(a, { name: 'Addie', color: 'pink' })
    await saveAccount(
      a,
      { ...account('Addie 529'), label: 'ADDIE', displayName: ' 529 ' },
      false,
    )
    expect((await accountsOf(a))['Addie 529']).toEqual({
      label: 'Addie',
      displayName: '529',
    })
    // Left out: kept. Null: cleared.
    await saveAccount(a, account('Addie 529'), false)
    expect((await accountsOf(a))['Addie 529'].label).toBe('Addie')
    await saveAccount(
      a,
      { ...account('Addie 529'), label: null, displayName: '' },
      false,
    )
    expect((await accountsOf(a))['Addie 529']).toEqual({
      label: null,
      displayName: null,
    })
  })

  it('can be given to a new Account', async () => {
    const { a } = await fixture()
    await createLabel(a, { name: 'Addie', color: 'pink' })
    await saveAccount(
      a,
      { ...account('Addie Savings'), label: 'Addie', displayName: 'Savings' },
      true,
    )
    expect((await accountsOf(a))['Addie Savings']).toEqual({
      label: 'Addie',
      displayName: 'Savings',
    })
  })

  it('renames everywhere it’s used, and recolours, at once', async () => {
    const { a } = await fixture()
    await createLabel(a, { name: 'Addie', color: 'pink' })
    await createLabel(a, { name: 'Asher', color: 'blue' })
    await labelAccounts(a, 'Addie', [
      { name: 'Addie 529', displayName: '529' },
      { name: 'Addie Trump Account', displayName: 'Trump Account' },
    ])
    await updateLabel(a, 'Addie', { name: 'Adelaide', color: 'violet' })
    const ledger = await loadLedger(a)
    expect(ledger.labels).toContainEqual({ name: 'Adelaide', color: 'violet' })
    expect(ledger.labels.some((l) => l.name === 'Addie')).toBe(false)
    expect(await accountsOf(a)).toMatchObject({
      'Addie 529': { label: 'Adelaide', displayName: '529' },
      'Addie Trump Account': { label: 'Adelaide' },
      'Asher 529': { label: null },
    })
    // A case-only rename of itself is fine; another's name isn't.
    await updateLabel(a, 'Adelaide', { name: 'ADELAIDE', color: 'violet' })
    await expect(
      updateLabel(a, 'ADELAIDE', { name: 'asher', color: 'violet' }),
    ).rejects.toThrow('already a label called asher')
    await expect(
      updateLabel(a, 'Nobody', { name: 'X', color: 'red' }),
    ).rejects.toThrow('no label called Nobody')
  })

  it('deleted, leave their Accounts with their Shown as', async () => {
    const { a } = await fixture()
    await createLabel(a, { name: 'Addie', color: 'pink' })
    await labelAccounts(a, 'Addie', [{ name: 'Addie 529', displayName: '529' }])
    await deleteLabel(a, 'Addie')
    expect((await loadLedger(a)).labels).toEqual([])
    expect((await accountsOf(a))['Addie 529']).toEqual({
      label: null,
      displayName: '529',
    })
  })

  it('label several Accounts all or none', async () => {
    const { a } = await fixture()
    await createLabel(a, { name: 'Addie', color: 'pink' })
    await expect(
      labelAccounts(a, 'Addie', [
        { name: 'Addie 529', displayName: '529' },
        { name: 'Nope', displayName: null },
      ]),
    ).rejects.toThrow('No account named Nope')
    expect((await accountsOf(a))['Addie 529'].label).toBeNull()
    await expect(
      labelAccounts(a, 'Nobody', [{ name: 'Addie 529', displayName: null }]),
    ).rejects.toThrow('no label called Nobody')
    expect(
      await labelAccounts(a, 'addie', [
        { name: 'Addie 529', displayName: '529' },
        { name: 'Addie Trump Account', displayName: 'Trump Account' },
      ]),
    ).toBe(2)
    expect((await accountsOf(a))['Addie Trump Account']).toEqual({
      label: 'Addie',
      displayName: 'Trump Account',
    })
  })
})

describe('Account labels between Households', () => {
  it('are never seen, changed or deleted by another Household', async () => {
    const { a, b } = await fixture()
    await createLabel(a, { name: 'Addie', color: 'pink' })
    await labelAccounts(a, 'Addie', [{ name: 'Addie 529', displayName: '529' }])
    expect((await loadLedger(b)).labels).toEqual([])
    // B can have its own of the same name.
    await createLabel(b, { name: 'Addie', color: 'green' })
    await updateLabel(b, 'Addie', { name: 'Kid', color: 'red' })
    await deleteLabel(b, 'Kid')
    expect((await loadLedger(a)).labels).toEqual([
      { name: 'Addie', color: 'pink' },
    ])
    expect((await accountsOf(a))['Addie 529']).toEqual({
      label: 'Addie',
      displayName: '529',
    })
  })

  it('can’t be set on an Account of another Household', async () => {
    const { a, b } = await fixture()
    await createLabel(a, { name: 'Addie', color: 'pink' })
    await expect(
      saveAccount(b, { ...account('Addie 529'), label: 'Addie' }, false),
    ).rejects.toThrow('no label called Addie')
    await expect(
      labelAccounts(b, 'Addie', [{ name: 'Addie 529', displayName: '529' }]),
    ).rejects.toThrow('no label called Addie')
    expect((await accountsOf(b))['Addie 529']).toEqual({
      label: null,
      displayName: null,
    })
    // Renaming B's label never touches A's Accounts using the same name.
    await createLabel(b, { name: 'Addie', color: 'green' })
    await labelAccounts(b, 'Addie', [{ name: 'Asher 529', displayName: null }])
    await updateLabel(b, 'Addie', { name: 'Kid', color: 'green' })
    await labelAccounts(a, 'Addie', [{ name: 'Asher 529', displayName: null }])
    expect((await accountsOf(a))['Asher 529'].label).toBe('Addie')
    expect((await accountsOf(b))['Asher 529'].label).toBe('Kid')
  })
})

describe('label input', () => {
  it('takes a name of 1–30 characters and a palette colour only', () => {
    expect(labelInput.parse({ name: ' Addie ', color: 'pink' })).toEqual({
      name: 'Addie',
      color: 'pink',
    })
    expect(() => labelInput.parse({ name: '', color: 'pink' })).toThrow()
    expect(() =>
      labelInput.parse({ name: 'x'.repeat(31), color: 'pink' }),
    ).toThrow()
    expect(() =>
      labelInput.parse({ name: 'Addie', color: '#ff0000' }),
    ).toThrow()
  })

  it('bounds an Account’s label and Shown as', () => {
    const base = { ...account('Addie 529') }
    expect(accountInput.parse({ ...base, displayName: '' }).displayName).toBe(
      null,
    )
    expect(accountInput.parse(base)).not.toHaveProperty('label', null)
    expect(() =>
      accountInput.parse({ ...base, displayName: 'x'.repeat(61) }),
    ).toThrow()
    expect(() =>
      accountInput.parse({ ...base, label: 'x'.repeat(31) }),
    ).toThrow()
  })
})
