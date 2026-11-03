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
  updateHouseholdSettings,
} from './service'
import { MAX_PEOPLE, MAX_PERSON } from './basics'
import { requireMember, withMember } from '@/lib/auth/session'
import { getCloudflareEnv, getDb } from '@/lib/db'

const TOKEN = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const HOUSEHOLD_NAME = z.string().trim().min(1).max(60)
const TIME_ZONE = z.string().min(1).max(64)
const PEOPLE = z.array(z.string().max(MAX_PERSON)).max(MAX_PEOPLE + 1)
export const getHousehold = createServerFn({ method: 'GET' }).handler(() =>
  withMember(({ db, member }) => householdDetails(db, member)),
)

export const startHousehold = createServerFn({ method: 'POST' })
  .validator(
    (data: { name: string; timeZone?: string; people?: Array<string> }) =>
      z
        .object({
          name: HOUSEHOLD_NAME,
          timeZone: TIME_ZONE.optional(),
          people: PEOPLE.optional(),
        })
        .parse(data),
  )
  .handler(async ({ data }) =>
    createHousehold(
      getDb(),
      await requireMember(),
      data.name,
      getCloudflareEnv().ALLOWED_EMAILS,
      { timeZone: data.timeZone, people: data.people },
    ),
  )

/** Any Member may rename the Household or change its time zone and people. */
export const saveHouseholdSettings = createServerFn({ method: 'POST' })
  .validator(
    (data: { name: string; timeZone: string; people: Array<string> }) =>
      z
        .object({ name: HOUSEHOLD_NAME, timeZone: TIME_ZONE, people: PEOPLE })
        .parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db, member }) => updateHouseholdSettings(db, member, data)),
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
