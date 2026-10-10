import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { EXPORT_FORMATS, MAX_EXPORT_BYTES } from './exports'
import { listAccountUpdates } from './queries'
import { ingestAccountExport } from './ingest'
import {
  connectSimplefin,
  disconnectSimplefin,
  discoverAccounts,
  listConnections,
  mapBankAccount,
} from './connections'
import {
  createUploadToken,
  listUploadTokens,
  revokeUploadToken,
} from './uploads'
import type { AccountExportInput } from './ingest'
import type { ExportFormat } from './exports'
import { withMember } from '@/lib/auth/session'
import { getCloudflareEnv } from '@/lib/db'

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

// ─── Shortcut upload tokens ──────────────────────────────────────────────────

export const getUploadTokens = createServerFn({ method: 'GET' }).handler(() =>
  withMember(({ db }) => listUploadTokens(db)),
)

export const createAccountUploadToken = createServerFn({ method: 'POST' })
  .validator((data: { account: string; format: ExportFormat }) =>
    z
      .object({
        account: z.string().min(1).max(60),
        format: z.enum(EXPORT_FORMATS),
      })
      .parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db, member }) =>
      createUploadToken(db, member, data.account, data.format),
    ),
  )

export const revokeAccountUploadToken = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) =>
    z.object({ id: z.string().min(1).max(64) }).parse(data),
  )
  .handler(({ data }) => withMember(({ db }) => revokeUploadToken(db, data.id)))

// ─── SimpleFIN connections ───────────────────────────────────────────────────

export const getBankConnections = createServerFn({ method: 'GET' }).handler(
  () => withMember(({ db }) => listConnections(db)),
)

export const connectBank = createServerFn({ method: 'POST' })
  .validator((data: { name: string; setupToken: string }) =>
    z
      .object({
        name: z.string().trim().min(1).max(60),
        setupToken: z.string().trim().min(1).max(4096),
      })
      .parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db, member }) =>
      connectSimplefin(
        db,
        member,
        data,
        getCloudflareEnv().BANK_CONNECTION_KEY,
      ),
    ),
  )

export const refreshBankAccounts = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) =>
    z.object({ id: z.string().min(1).max(64) }).parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db }) =>
      discoverAccounts(db, data.id, getCloudflareEnv().BANK_CONNECTION_KEY),
    ),
  )

export const linkBankAccount = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      connectionId: string
      providerId: string
      account: string | null
    }) =>
      z
        .object({
          connectionId: z.string().min(1).max(64),
          providerId: z.string().min(1).max(200),
          account: z.string().min(1).max(60).nullable(),
        })
        .parse(data),
  )
  .handler(({ data }) => withMember(({ db }) => mapBankAccount(db, data)))

export const disconnectBank = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) =>
    z.object({ id: z.string().min(1).max(64) }).parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db }) => disconnectSimplefin(db, data.id)),
  )
