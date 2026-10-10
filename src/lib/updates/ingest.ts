/** Shared export adapter for the browser today and an Account-bound upload
 * token later. Authentication supplies the scope; CSV never chooses it. */
import { normalizeExport } from './exports'
import { finishReceipt, startReceipt } from './receipts'
import type { HouseholdDatabase } from '@/lib/households/scope'
import type { ExportFormat } from './exports'
import type { UpdateSource } from './receipts'
import { accountInputs } from '@/lib/db/schema'
import { householdRow } from '@/lib/households/scope'
import { findAccount, postTransactions } from '@/lib/ledger/accounts'
import { isDebt } from '@/lib/model/accounts'

export interface AccountExportInput {
  account: string
  text: string
  format: ExportFormat
  commit: boolean
}

export async function ingestAccountExport(
  db: HouseholdDatabase,
  data: AccountExportInput,
  updatedBy: string,
  source: UpdateSource = 'uploaded',
) {
  const account = await findAccount(db, data.account)
  if (account.closed) throw new Error('Reopen this Account before updating it')
  if (!['credit', 'checking', 'savings'].includes(account.kind))
    throw new Error(
      'This Account uses recorded balances. Open its Account sheet to record a balance or import its history.',
    )
  if (data.format === 'apple-card' && account.kind !== 'credit')
    throw new Error('Choose a credit-card Account for an Apple Card export')
  let normalized: ReturnType<typeof normalizeExport>
  try {
    normalized = normalizeExport(data.text, data.format, isDebt(account))
  } catch (error) {
    if (data.commit) {
      const id = crypto.randomUUID()
      await startReceipt(db, {
        id,
        account: account.name,
        source,
        updatedBy,
        dates: [],
      })
      await finishReceipt(db, id, null)
    }
    throw error
  }
  if (data.commit)
    await db
      .insert(accountInputs)
      .values(householdRow(db, { account: account.name, format: data.format }))
      .onConflictDoUpdate({
        target: [accountInputs.householdId, accountInputs.account],
        set: { format: data.format },
      })
  const summary = await postTransactions(db, {
    account: account.name,
    rows: normalized.rows,
    commit: data.commit,
    importedBy: updatedBy,
    via: source,
    excluded: normalized.excluded,
    coverage:
      normalized.fromDate && normalized.toDate
        ? { from: normalized.fromDate, to: normalized.toDate }
        : undefined,
  })
  return {
    summary,
    excluded: normalized.excluded,
    fromDate: normalized.fromDate,
    toDate: normalized.toDate,
    total: normalized.total,
  }
}
