/** Server functions for Money in (docs/adr/0011). */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { fileMoneyIn, listMoneyIn } from './service'
import type { MoneyInFiling } from './service'
import { withMember } from '@/lib/auth/session'
import { MONEY_IN_USES } from '@/lib/model/moneyIn'

export const getMoneyIn = createServerFn({ method: 'GET' }).handler(() =>
  withMember(({ db }) => listMoneyIn(db)),
)

export const fileMoney = createServerFn({ method: 'POST' })
  .validator((data: MoneyInFiling) =>
    z
      .object({
        id: z.string().min(1).max(16),
        use: z.enum(MONEY_IN_USES),
        category: z.string().trim().min(1).max(60).nullable().optional(),
        offset: z.number().int().min(1).max(100_000_000).nullable().optional(),
        note: z.string().trim().max(200).nullable().optional(),
      })
      .parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db, member }) => fileMoneyIn(db, data, member.email)),
  )
