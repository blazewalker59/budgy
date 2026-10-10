/**
 * The months ahead: everyday Targets plus set-aside Planned Expenses on
 * their due dates, so a lumpy month is visible before it arrives. Monthly
 * bills are inside the Targets already.
 */

import { shiftMonth } from './dates'
import { isHousing, targetFor } from './ledger'
import { setAside } from './plans'
import type { LedgerIndex } from './ledger'
import type { Occurrence } from './plans'

export interface ForecastMonth {
  month: string
  everyday: number
  housing: number
  planned: number
  occurrences: Array<Occurrence>
}

export function forecast(
  ix: LedgerIndex,
  fromMonth: string,
  count: number,
  occurrences: Array<Occurrence>,
): Array<ForecastMonth> {
  const names = [...ix.categories.keys()]
  return Array.from({ length: count }, (_, i) => {
    const month = shiftMonth(fromMonth, i)
    let everyday = 0
    let housing = 0
    for (const name of names) {
      const target = targetFor(ix, name, month) ?? 0
      if (isHousing(ix, name)) housing += target
      else everyday += target
    }
    const due = occurrences.filter(
      (o) => o.due.slice(0, 7) === month && setAside(o.plan),
    )
    const planned = due.reduce(
      (n, o) => n + (o.paidBy ? o.paidBy.amount : o.plan.amount),
      0,
    )
    return { month, everyday, housing, planned, occurrences: due }
  })
}
