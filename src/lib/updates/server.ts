import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { EXPORT_FORMATS, EXPORT_TOO_LARGE, withinExportLimit } from './exports'
import { listAccountUpdates } from './queries'
import { ingestAccountExport } from './ingest'
import {
  addBankAccounts,
  connectSimplefin,
  disconnectSimplefin,
  discoverAccounts,
  listConnections,
  mapBankAccount,
  reconnectSimplefin,
} from './connections'
import {
  createUploadToken,
  listUploadTokens,
  revokeUploadToken,
} from './uploads'
import { syncConnection } from './sync'
import { queueAccountRetry, queueFirstSync } from './syncQueue'
import { bankKeys } from './crypto'
import type { BankAccountChoice } from './connections'
import type { AccountExportInput } from './ingest'
import type { ExportFormat } from './exports'
import { withMember } from '@/lib/auth/session'
import { accountInput } from '@/lib/model/accounts'
import { getCloudflareEnv } from '@/lib/db'

export const getAccountUpdates = createServerFn({ method: 'GET' }).handler(() =>
  withMember(({ db }) => listAccountUpdates(db)),
)

export const updateAccountExport = createServerFn({ method: 'POST' })
  .validator((data: AccountExportInput) =>
    z
      .object({
        account: z.string().min(1).max(60),
        text: z.string().min(1).refine(withinExportLimit, EXPORT_TOO_LARGE),
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
      connectSimplefin(db, member, data, bankKeys(getCloudflareEnv())),
    ),
  )

/** A new setup token for a connection Bridge stopped accepting; links stay. */
export const reconnectBank = createServerFn({ method: 'POST' })
  .validator((data: { id: string; setupToken: string }) =>
    z
      .object({
        id: z.string().min(1).max(64),
        setupToken: z.string().trim().min(1).max(4096),
      })
      .parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db }) =>
      reconnectSimplefin(db, data, bankKeys(getCloudflareEnv())),
    ),
  )

export const refreshBankAccounts = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) =>
    z.object({ id: z.string().min(1).max(64) }).parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db }) =>
      discoverAccounts(db, data.id, bankKeys(getCloudflareEnv())),
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
  .handler(({ data }) =>
    withMember(async ({ db }) => {
      await mapBankAccount(db, data)
      if (data.account !== null)
        await queueFirstSync(
          db,
          [data.connectionId],
          getCloudflareEnv().SYNC_QUEUE,
        )
    }),
  )

const bankKey = {
  connectionId: z.string().min(1).max(64),
  providerId: z.string().min(1).max(200),
}

/** Add discovered bank accounts at once: each made a Budgy Account, or linked. */
export const addFromBank = createServerFn({ method: 'POST' })
  .validator((data: { choices: Array<BankAccountChoice> }) =>
    z
      .object({
        choices: z
          .array(
            z.union([
              z.object({
                ...bankKey,
                create: accountInput.pick({
                  name: true,
                  owner: true,
                  kind: true,
                  institution: true,
                }),
              }),
              z.object({ ...bankKey, link: z.string().trim().min(1).max(60) }),
            ]),
          )
          .min(1)
          .max(50),
      })
      .parse(data),
  )
  .handler(({ data }) =>
    withMember(async ({ db }) => {
      const added = await addBankAccounts(db, data.choices)
      await queueFirstSync(
        db,
        data.choices.map((c) => c.connectionId),
        getCloudflareEnv().SYNC_QUEUE,
      )
      return added
    }),
  )

export const disconnectBank = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) =>
    z.object({ id: z.string().min(1).max(64) }).parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db }) => disconnectSimplefin(db, data.id)),
  )

export const syncBank = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) =>
    z.object({ id: z.string().min(1).max(64) }).parse(data),
  )
  .handler(({ data }) =>
    withMember(async ({ db }) => {
      const env = getCloudflareEnv()
      const results = await syncConnection(db, data.id, bankKeys(env))
      await queueAccountRetry(db, data.id, results, env.SYNC_QUEUE)
      return results
    }),
  )

/**
 * Try one linked bank account again on its own, after it failed (a
 * per-account request to Bridge, within the connection's daily cap).
 */
export const retryBankAccount = createServerFn({ method: 'POST' })
  .validator((data: { connectionId: string; providerId: string }) =>
    z.object(bankKey).parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db }) =>
      syncConnection(
        db,
        data.connectionId,
        bankKeys(getCloudflareEnv()),
        fetch,
        { only: [data.providerId] },
      ),
    ),
  )
