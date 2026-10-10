import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { EXPORT_FORMATS, MAX_EXPORT_BYTES } from './exports'
import { listAccountUpdates } from './queries'
import { ingestAccountExport } from './ingest'
import type { AccountExportInput } from './ingest'
import { withMember } from '@/lib/auth/session'

export const getAccountUpdates = createServerFn({ method: 'GET' }).handler(() =>
  withMember(({ db }) => listAccountUpdates(db)),
)

export const updateAccountExport = createServerFn({ method: 'POST' })
  .validator((data: AccountExportInput) =>
    z
      .object({
        account: z.string().min(1).max(60),
        text: z.string().min(1).max(MAX_EXPORT_BYTES),
        format: z.enum(EXPORT_FORMATS),
        commit: z.boolean(),
      })
      .parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db, member }) => ingestAccountExport(db, data, member.email)),
  )
