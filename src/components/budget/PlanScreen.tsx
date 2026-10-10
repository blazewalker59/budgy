/**
 * Plan, in two tabs: the Budget (Targets against typical months and
 * take-home pay) and Bills (Planned Expenses and the months they make
 * heavy). Of the Lens it uses only the person: their typical months against
 * the household's Targets.
 */

import { useNavigate } from '@tanstack/react-router'
import { BudgetScreen } from './BudgetScreen'
import type { Lens } from '@/lib/model/lens'
import { filtersOf } from '@/lib/model/lens'
import { LensBar } from '@/components/lens/LensBar'
import { Segmented } from '@/components/shared/Layout'
import { UpcomingScreen } from '@/components/upcoming/UpcomingScreen'

type Tab = 'budget' | 'bills'

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'budget', label: 'Budget' },
  { value: 'bills', label: 'Bills' },
]

export function PlanScreen({ lens, tab }: { lens: Lens; tab: Tab }) {
  const navigate = useNavigate({ from: '/plan' })
  const owner = lens.people?.length === 1 ? lens.people[0] : undefined
  const others = filtersOf(lens).filter((f) => f.type !== 'person').length
  return (
    <div className="space-y-5">
      <div className="mx-auto max-w-4xl space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-extrabold tracking-tight">Plan</h1>
          <Segmented
            label="Plan section"
            value={tab}
            options={TABS}
            onChange={(t) =>
              void navigate({
                search: (s) => ({ ...s, tab: t === 'budget' ? undefined : t }),
              })
            }
          />
        </div>
        {tab === 'budget' && (
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
        )}
      </div>
      {tab === 'bills' ? <UpcomingScreen /> : <BudgetScreen owner={owner} />}
    </div>
  )
}
