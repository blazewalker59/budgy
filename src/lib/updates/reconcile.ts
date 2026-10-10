/** Source identity and legacy reconciliation, independent of transport or D1. */
import type { PostedRow, Prepared } from '@/lib/import/posted'
import type { ImportRules } from '@/lib/import/rules'
import { preparePosted } from '@/lib/import/posted'
import { sha1Hex } from '@/lib/import/rows'
import { isSpending, storeName } from '@/lib/import/stores'

export interface ExistingPurchase {
  id: string
  date: string
  amount: number
  description: string
  sourceKey: string | null
}

export async function prepareIdentified(input: {
  account: string
  namespace: string
  rows: Array<PostedRow>
  existing: Array<ExistingPurchase>
  categories: Array<string>
  history: Parameters<typeof preparePosted>[0]['history']
  rules: ImportRules
  owners?: ReadonlyArray<string>
}) {
  if (
    !input.namespace ||
    input.namespace.length > 200 ||
    input.rows.some((r) => !r.sourceId)
  )
    throw new Error(
      'Identified updates require a namespace and an ID for every row',
    )
  const prepared: Prepared = {
    fresh: [],
    alreadyHad: 0,
    notSpending: 0,
    carried: 0,
    duplicates: [],
  }
  const links: Array<{ id: string; sourceKey: string }> = []
  const changes: Array<{
    id: string
    sourceKey: string
    date: string
    amount: number
    description: string
  }> = []
  const keys = new Map<string, string>()
  const conflicts: Array<{
    date: string
    description: string
    amount: number
    reason: string
  }> = []
  const byKey = new Map(
    input.existing.filter((t) => t.sourceKey).map((t) => [t.sourceKey!, t]),
  )
  const usedLegacy = new Set<string>()
  const seen = new Map<string, string>()
  for (const row of input.rows) {
    const sourceKey = await sha1Hex(
      JSON.stringify([input.namespace, row.sourceId]),
    )
    const signature = JSON.stringify([row.date, row.description, row.amount])
    if (seen.has(sourceKey)) {
      if (seen.get(sourceKey) !== signature)
        throw new Error(
          'A source ID describes conflicting purchases in this update',
        )
      prepared.alreadyHad++
      continue
    }
    seen.set(sourceKey, signature)
    const previous = byKey.get(sourceKey)
    if (previous) {
      if (!isSpending(row.description, input.rules)) {
        conflicts.push({
          date: row.date,
          description: row.description,
          amount: row.amount,
          reason:
            'An import rule now leaves this purchase out. Review it before removing it.',
        })
      } else if (
        previous.date !== row.date ||
        previous.amount !== Math.round(row.amount * 100) ||
        previous.description !== row.description
      ) {
        // The bank's text, not its Store: Store Rules file by the name
        // it was first given, which a merged upload's purchase keeps.
        changes.push({
          id: previous.id,
          sourceKey,
          date: row.date,
          amount: Math.round(row.amount * 100),
          description: row.description,
        })
      } else prepared.alreadyHad++
      continue
    }
    if (!isSpending(row.description, input.rules)) {
      prepared.notSpending++
      continue
    }
    const legacy = input.existing.filter(
      (t) =>
        !t.sourceKey &&
        !usedLegacy.has(t.id) &&
        t.amount === Math.round(row.amount * 100) &&
        storeName(t.description, input.rules).toLowerCase() ===
          storeName(row.description, input.rules).toLowerCase(),
    )
    const candidates = legacy.filter((t) => t.date === row.date)
    if (candidates.length > 1) {
      conflicts.push({
        date: row.date,
        description: row.description,
        amount: row.amount,
        reason:
          'Several existing purchases match. Nothing was added. Review the matches.',
      })
      continue
    }
    if (candidates.length === 1) {
      const match = candidates[0]
      usedLegacy.add(match.id)
      links.push({ id: match.id, sourceKey })
      continue
    }
    if (
      legacy.some(
        (t) =>
          Math.abs(
            new Date(`${t.date}T00:00:00Z`).getTime() -
              new Date(`${row.date}T00:00:00Z`).getTime(),
          ) <=
          3 * 86_400_000,
      )
    ) {
      conflicts.push({
        date: row.date,
        description: row.description,
        amount: row.amount,
        reason: 'This may match a purchase with a different date. Review it.',
      })
      continue
    }
    const fresh = await preparePosted({ ...input, rows: [row], existing: [] })
    prepared.notSpending += fresh.notSpending
    for (const txn of fresh.fresh) {
      const id = (
        await sha1Hex(JSON.stringify([input.account, sourceKey]))
      ).slice(0, 16)
      prepared.fresh.push({ ...txn, id })
      keys.set(id, sourceKey)
    }
  }
  return { prepared, links, changes, keys, conflicts }
}
