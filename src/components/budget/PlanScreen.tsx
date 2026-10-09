/**
 * Plan: the Budget (Targets against typical months and take-home pay) and
 * what's ahead (Planned Expenses and the months they make heavy) on one
 * page. Of the Lens it uses only the person: their typical months against
 * the household's Targets.
 */

import { BudgetScreen } from './BudgetScreen'
import type { Lens } from '@/lib/model/lens'
import { filtersOf } from '@/lib/model/lens'
import { LensBar } from '@/components/lens/LensBar'
import { UpcomingScreen } from '@/components/upcoming/UpcomingScreen'

export function PlanScreen({ lens }: { lens: Lens }) {
  const owner = lens.people?.length === 1 ? lens.people[0] : undefined
  const others = filtersOf(lens).filter((f) => f.type !== 'person').length
  return (
    <div className="space-y-5">
      <div className="mx-auto max-w-4xl space-y-2">
        <h1 className="text-lg font-extrabold tracking-tight">Plan</h1>
        <LensBar
          page="/plan"
          note={
            (lens.people?.length ?? 0) > 1
              ? 'Plan follows one person at a time.'
              : others
                ? 'Plan uses only the person filter.'
                : undefined
          }
        />
      </div>
      <BudgetScreen owner={owner} />
      <div className="border-t border-border pt-4">
        <UpcomingScreen />
      </div>
    </div>
  )
}
