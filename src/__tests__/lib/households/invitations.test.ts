import { afterEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import {
  acceptInvite,
  createHousehold,
  createInvite,
  householdDetails,
  previewInvite,
  removeMember,
  revokeInvite,
  transferOwnership,
} from '@/lib/households/service'
import { canSignIn, canUseHousehold } from '@/lib/households/admission'
import {
  findMemberHousehold,
  requireHousehold,
} from '@/lib/households/membership'
import { createToken, hashToken, verifyToken } from '@/lib/agents/tokens'
import { loadLedger } from '@/lib/ledger/queries'
import {
  householdInvites,
  householdMembers,
  households,
  user,
} from '@/lib/db/schema'

const owner = { id: 'owner', email: 'owner@example.com', emailVerified: true }
const partner = {
  id: 'partner',
  email: 'partner@example.com',
  emailVerified: true,
}
const stranger = {
  id: 'stranger',
  email: 'stranger@example.com',
  emailVerified: true,
}
const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const sqlite of open.splice(0)) sqlite.close()
})

async function fixture() {
  const { db, sqlite, newClient } = testDatabase()
  open.push(sqlite)
  await db.insert(user).values(
    [owner, partner, stranger].map((person) => ({
      ...person,
      name: person.id,
    })),
  )
  const household = await createHousehold(db, owner, 'Our budget')
  const scope = await requireHousehold(newClient(), owner.id, household.id)
  return { db, sqlite, newClient, household, scope }
}

describe('Household creation', () => {
  it('starts a private empty Ledger with generic categories and an owner', async () => {
    const { scope, household, db } = await fixture()
    expect(household).toMatchObject({ name: 'Our budget', role: 'owner' })
    const ledger = await loadLedger(scope)
    expect(ledger.txns).toEqual([])
    expect(ledger.accounts).toEqual([])
    expect(ledger.categories.length).toBeGreaterThan(10)
    expect(ledger.categories.map((c) => c.name)).not.toContain('Blaze personal')
    expect(ledger.categories.map((c) => c.name)).not.toContain('Alex personal')
    expect((await findMemberHousehold(db, owner.id))?.id).toBe(household.id)
    await expect(
      requireHousehold(db, partner.id, household.id),
    ).rejects.toThrow('access denied')
  })

  it('requires verified identity and rejects a second Household without orphan data', async () => {
    const { db } = await fixture()
    await expect(
      createHousehold(db, { ...partner, emailVerified: false }, 'Nope'),
    ).rejects.toThrow('verified')
    await expect(createHousehold(db, owner, 'Another')).rejects.toThrow(
      'already belong',
    )
    await expect(createHousehold(db, partner, '  ')).rejects.toThrow('Name')
    expect(await db.select().from(households)).toHaveLength(2) // initial + created
    expect(await findMemberHousehold(db, partner.id)).toBeNull()
  })

  it('rolls back the losing simultaneous creation rather than leaving an orphan Ledger', async () => {
    const { db, newClient } = await fixture()
    const results = await Promise.allSettled([
      createHousehold(db, partner, 'One'),
      createHousehold(newClient(), partner, 'Two'),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(
      await db
        .select()
        .from(householdMembers)
        .where(eq(householdMembers.memberId, partner.id)),
    ).toHaveLength(1)
    expect(await db.select().from(households)).toHaveLength(3)
  })
})

describe('Household invitations', () => {
  it('stores only a token hash, binds the email, and requires explicit acceptance', async () => {
    const { db, scope, household } = await fixture()
    const invitation = await createInvite(scope, owner, ' PARTNER@Example.com ')
    expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const stored = await db.select().from(householdInvites).get()
    expect(stored?.tokenHash).not.toBe(invitation.token)
    expect(stored?.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(await canSignIn(db, partner.email)).toBe(true)
    expect(await findMemberHousehold(db, partner.id)).toBeNull()
    await expect(previewInvite(db, stranger, invitation.token)).rejects.toThrow(
      'unavailable',
    )
    expect(await previewInvite(db, partner, invitation.token)).toMatchObject({
      householdId: household.id,
      name: 'Our budget',
    })
    expect(await findMemberHousehold(db, partner.id)).toBeNull()
    expect(await acceptInvite(db, partner, invitation.token)).toMatchObject({
      id: household.id,
      role: 'member',
    })
    expect((await findMemberHousehold(db, partner.id))?.role).toBe('member')
    expect(await canSignIn(db, partner.email)).toBe(true) // accepted invite no longer needed
    await expect(acceptInvite(db, partner, invitation.token)).rejects.toThrow(
      'unavailable',
    )
  })

  it('rejects revoked, expired, malformed, and unverified invitations', async () => {
    const { db, scope } = await fixture()
    const expired = await createInvite(
      scope,
      owner,
      partner.email,
      new Date('2020-01-01'),
    )
    await expect(acceptInvite(db, partner, expired.token)).rejects.toThrow(
      'unavailable',
    )
    expect(await canSignIn(db, partner.email)).toBe(false)
    const invite = await createInvite(scope, owner, partner.email)
    await expect(
      acceptInvite(db, { ...partner, emailVerified: false }, invite.token),
    ).rejects.toThrow('verified')
    await expect(previewInvite(db, partner, 'invalid')).rejects.toThrow(
      'unavailable',
    )
    await revokeInvite(scope, owner, invite.id)
    await expect(acceptInvite(db, partner, invite.token)).rejects.toThrow(
      'unavailable',
    )
    expect(await findMemberHousehold(db, partner.id)).toBeNull()
    expect(await canSignIn(db, partner.email)).toBe(false)
  })

  it('revokes the previous link on reissue and caps outstanding invitations', async () => {
    const { db, scope } = await fixture()
    const first = await createInvite(scope, owner, partner.email)
    const second = await createInvite(scope, owner, partner.email)
    await expect(previewInvite(db, partner, first.token)).rejects.toThrow(
      'unavailable',
    )
    expect(await previewInvite(db, partner, second.token)).toBeTruthy()
    for (let i = 0; i < 19; i++)
      await createInvite(scope, owner, `person${i}@example.com`)
    await expect(
      createInvite(scope, owner, 'overflow@example.com'),
    ).rejects.toThrow('not created')
    expect((await householdDetails(scope, owner)).invites).toHaveLength(20)
    expect(await createInvite(scope, owner, partner.email)).toBeTruthy() // replacement still allowed
  })

  it('never merges or replaces a recipient’s existing Household', async () => {
    const { db, scope } = await fixture()
    const other = await createHousehold(db, partner, 'Their budget')
    const invite = await createInvite(scope, owner, partner.email)
    await expect(acceptInvite(db, partner, invite.token)).rejects.toThrow(
      'already belong',
    )
    expect((await findMemberHousehold(db, partner.id))?.id).toBe(other.id)
  })

  it('allows one acceptance under concurrent join attempts', async () => {
    const { db, scope, newClient } = await fixture()
    const invite = await createInvite(scope, owner, partner.email)
    const results = await Promise.allSettled([
      acceptInvite(db, partner, invite.token),
      acceptInvite(newClient(), partner, invite.token),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(
      await db
        .select()
        .from(householdMembers)
        .where(eq(householdMembers.memberId, partner.id)),
    ).toHaveLength(1)
  })

  it('does not grant arbitrary sign-ups or expose invite hashes in management results', async () => {
    const { db, scope } = await fixture()
    expect(await canSignIn(db, stranger.email)).toBe(false)
    expect(await canSignIn(db, stranger.email, stranger.email)).toBe(true)
    await createInvite(scope, owner, partner.email)
    const details = await householdDetails(scope, owner)
    expect(details.invites[0]).not.toHaveProperty('tokenHash')
    expect(details.invites[0]).not.toHaveProperty('token')
  })

  it('does not restore access to old initial-Household users removed from the allowlist', async () => {
    const { db, scope } = await fixture()
    await db.insert(householdMembers).values({
      householdId: 'hh_initial',
      memberId: stranger.id,
      role: 'member',
    })
    expect(await canSignIn(db, stranger.email)).toBe(false)
    expect(await canSignIn(db, stranger.email, stranger.email)).toBe(true)
    await createInvite(scope, owner, stranger.email)
    expect(await canSignIn(db, stranger.email)).toBe(true) // can sign in to see an invitation
    expect(await canUseHousehold(db, stranger.email, 'hh_initial')).toBe(false) // not the old Ledger
  })
})

describe('Household membership management', () => {
  it('limits invitations and membership changes to the owner', async () => {
    const { db, scope, household, newClient } = await fixture()
    const invite = await createInvite(scope, owner, partner.email)
    await acceptInvite(db, partner, invite.token)
    const memberScope = await requireHousehold(
      newClient(),
      partner.id,
      household.id,
    )
    await expect(
      createInvite(memberScope, partner, stranger.email),
    ).rejects.toThrow('Only the Household owner')
    await expect(removeMember(memberScope, partner, owner.id)).rejects.toThrow(
      'Only the Household owner',
    )
    await expect(revokeInvite(memberScope, partner, invite.id)).rejects.toThrow(
      'Only the Household owner',
    )
    await expect(
      transferOwnership(memberScope, partner, owner.id),
    ).rejects.toThrow('Only the Household owner')
    await expect(createInvite(scope, stranger, stranger.email)).rejects.toThrow(
      'Only the Household owner',
    )
    expect((await householdDetails(memberScope, partner)).invites).toEqual([])
    expect((await householdDetails(memberScope, partner)).members).toHaveLength(
      2,
    )
  })

  it('removes access immediately and never resurrects old MCP tokens on rejoin', async () => {
    const { db, scope, household, newClient } = await fixture()
    const invite = await createInvite(scope, owner, partner.email)
    await acceptInvite(db, partner, invite.token)
    const memberScope = await requireHousehold(
      newClient(),
      partner.id,
      household.id,
    )
    const token = await createToken(memberScope, partner, 'Agent', ['read'])
    expect(await verifyToken(db, token.token)).toBeTruthy()
    const stored = await db
      .select()
      .from(householdInvites)
      .where(eq(householdInvites.id, invite.id))
      .get()
    if (!stored) throw new Error('Missing test invitation')
    const racedToken = 'r'.repeat(43)
    await db.insert(householdInvites).values({
      ...stored,
      id: 'raced-invitation',
      tokenHash: await hashToken(racedToken),
      acceptedAt: null,
      revokedAt: null,
    })
    await removeMember(scope, owner, partner.id)
    await expect(
      requireHousehold(db, partner.id, household.id),
    ).rejects.toThrow('access denied')
    expect(await verifyToken(db, token.token)).toBeNull()
    expect(await canSignIn(db, partner.email)).toBe(false)
    await expect(acceptInvite(db, partner, invite.token)).rejects.toThrow(
      'unavailable',
    )
    await expect(acceptInvite(db, partner, racedToken)).rejects.toThrow(
      'unavailable',
    )
    const rejoin = await createInvite(scope, owner, partner.email)
    await acceptInvite(db, partner, rejoin.token)
    expect(await verifyToken(db, token.token)).toBeNull()
    await expect(removeMember(scope, owner, owner.id)).rejects.toThrow(
      'Transfer ownership',
    )
  })

  it('cannot revoke or remove another Household’s data', async () => {
    const { db, scope, newClient } = await fixture()
    const other = await createHousehold(db, stranger, 'Other')
    const otherScope = await requireHousehold(
      newClient(),
      stranger.id,
      other.id,
    )
    const invite = await createInvite(otherScope, stranger, partner.email)
    await revokeInvite(scope, owner, invite.id)
    expect(await previewInvite(db, partner, invite.token)).toMatchObject({
      householdId: other.id,
    })
    await expect(removeMember(scope, owner, stranger.id)).rejects.toThrow(
      'isn’t in this Household',
    )
    expect((await findMemberHousehold(db, stranger.id))?.id).toBe(other.id)
  })

  it('transfers ownership atomically and keeps the former owner as a Member', async () => {
    const { db, scope, household, newClient } = await fixture()
    const invite = await createInvite(scope, owner, partner.email)
    await acceptInvite(db, partner, invite.token)
    await expect(transferOwnership(scope, owner, stranger.id)).rejects.toThrow(
      'isn’t in this Household',
    )
    expect((await findMemberHousehold(db, owner.id))?.role).toBe('owner')
    await transferOwnership(scope, owner, partner.id)
    expect((await findMemberHousehold(db, owner.id))?.role).toBe('member')
    expect((await findMemberHousehold(db, partner.id))?.role).toBe('owner')
    expect(
      await db
        .select()
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.householdId, household.id),
            eq(householdMembers.role, 'owner'),
          ),
        ),
    ).toHaveLength(1)
    await expect(createInvite(scope, owner, stranger.email)).rejects.toThrow(
      'Only the Household owner',
    )
    const newOwner = await requireHousehold(
      newClient(),
      partner.id,
      household.id,
    )
    expect(await createInvite(newOwner, partner, stranger.email)).toBeTruthy()
  })
})
