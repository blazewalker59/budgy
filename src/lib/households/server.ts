import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  acceptInvite,
  createHousehold,
  createInvite,
  householdDetails,
  previewInvite,
  removeMember,
  revokeInvite,
  transferOwnership,
} from './service'
import { requireMember, withMember } from '@/lib/auth/session'
import { getDb } from '@/lib/db'

const TOKEN = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const getHousehold = createServerFn({ method: 'GET' }).handler(() =>
  withMember(({ db, member }) => householdDetails(db, member)),
)

export const startHousehold = createServerFn({ method: 'POST' })
  .validator((data: { name: string }) =>
    z.object({ name: z.string().trim().min(1).max(60) }).parse(data),
  )
  .handler(async ({ data }) =>
    createHousehold(getDb(), await requireMember(), data.name),
  )

export const inviteToHousehold = createServerFn({ method: 'POST' })
  .validator((data: { email: string }) =>
    z.object({ email: z.string().trim().email().max(254) }).parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db, member }) => createInvite(db, member, data.email)),
  )

export const cancelHouseholdInvite = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db, member }) => revokeInvite(db, member, data.id)),
  )

export const getHouseholdInvite = createServerFn({ method: 'POST' })
  .validator((data: { token: string }) =>
    z.object({ token: TOKEN }).parse(data),
  )
  .handler(async ({ data }) =>
    previewInvite(getDb(), await requireMember(), data.token),
  )

export const joinHousehold = createServerFn({ method: 'POST' })
  .validator((data: { token: string }) =>
    z.object({ token: TOKEN }).parse(data),
  )
  .handler(async ({ data }) =>
    acceptInvite(getDb(), await requireMember(), data.token),
  )

export const removeHouseholdMember = createServerFn({ method: 'POST' })
  .validator((data: { memberId: string }) =>
    z.object({ memberId: z.string().min(1).max(128) }).parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db, member }) => removeMember(db, member, data.memberId)),
  )

export const transferHouseholdOwnership = createServerFn({ method: 'POST' })
  .validator((data: { memberId: string }) =>
    z.object({ memberId: z.string().min(1).max(128) }).parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db, member }) =>
      transferOwnership(db, member, data.memberId),
    ),
  )
