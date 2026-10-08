/**
 * How the Budget splits up: each Category's share of the typical month and
 * of the Targets, biggest first, with the small ones folded together.
 */

export interface MixSlice {
  name: string
  typical: number
  target: number
  /** 0–1 of all typical spending. */
  typicalShare: number
  /** 0–1 of all Targets. */
  targetShare: number
}

export const EVERYTHING_ELSE = 'Everything else'

export function budgetMix(
  rows: Array<{ name: string; typical: number; target: number }>,
  top = 9,
): Array<MixSlice> {
  const typicalTotal = rows.reduce((n, r) => n + Math.max(r.typical, 0), 0)
  const targetTotal = rows.reduce((n, r) => n + Math.max(r.target, 0), 0)
  const sorted = rows
    .filter((r) => r.typical > 0 || r.target > 0)
    .sort(
      (a, b) =>
        Math.max(b.typical, b.target) - Math.max(a.typical, a.target) ||
        a.name.localeCompare(b.name),
    )
  const head = sorted.slice(0, top)
  const tail = sorted.slice(top)
  if (tail.length > 1)
    head.push({
      name: EVERYTHING_ELSE,
      typical: tail.reduce((n, r) => n + Math.max(r.typical, 0), 0),
      target: tail.reduce((n, r) => n + Math.max(r.target, 0), 0),
    })
  else head.push(...tail)
  return head.map((r) => ({
    ...r,
    typicalShare: typicalTotal ? Math.max(r.typical, 0) / typicalTotal : 0,
    targetShare: targetTotal ? Math.max(r.target, 0) / targetTotal : 0,
  }))
}
