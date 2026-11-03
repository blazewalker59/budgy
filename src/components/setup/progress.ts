/**
 * Setup's steps as the Member sees them: their names and what each is for,
 * and every step's state for this Household right now.
 */
import { useMemo } from 'react'
import type { SetupStep, StepState } from '@/lib/model/setup'
import { useBook } from '@/lib/ledger/book'
import { useHousehold } from '@/lib/households/useHousehold'
import { useSession } from '@/lib/ledger/useLedger'
import { setupFinished, setupProgress } from '@/lib/model/setup'

export const STEP_COPY: Record<SetupStep, { title: string; detail: string }> = {
  household: {
    title: 'Your Household',
    detail: 'Its name, time zone and who’s in it.',
  },
  partner: {
    title: 'Invite your partner',
    detail: 'Share the budget. Skip this if it’s just you.',
  },
  categories: {
    title: 'Review categories',
    detail: 'Hide the ones you don’t need and rename the rest.',
  },
  connect: {
    title: 'Connect your money',
    detail: 'Add your cards and bank accounts.',
  },
  history: {
    title: 'Bring in history',
    detail: 'A few months back makes the Budget useful.',
  },
  sort: {
    title: 'Sort your spending',
    detail: 'File the stores that came in Uncategorized.',
  },
  pay: {
    title: 'Add your pay',
    detail: 'Take-home pay, so the Budget has a ceiling.',
  },
  targets: {
    title: 'Set Targets',
    detail: 'What each category should cost a month.',
  },
  bills: {
    title: 'Plan bills',
    detail: 'Insurance, renewals and other lumpy bills.',
  },
}

const NONE: ReadonlyArray<string> = []

export interface Progress {
  steps: Array<StepState>
  finished: boolean
  /** Done or skipped. */
  settled: number
  /** The first step not done or skipped. */
  next: StepState | undefined
}

export function useSetupProgress(): Progress {
  const book = useBook()
  const session = useSession()
  const household = useHousehold()
  const owners =
    session.data?.status === 'member' ? session.data.household.owners : NONE
  const members = household.data?.members.length ?? 1
  const invites = household.data?.invites.length ?? 0
  return useMemo(() => {
    const steps = setupProgress(book.ix, book.today, book.ix.ledger.setup, {
      owners,
      members,
      invites,
    })
    return {
      steps,
      finished: setupFinished(steps),
      settled: steps.filter((s) => s.done || s.skipped).length,
      next: steps.find((s) => !s.done && !s.skipped),
    }
  }, [book, owners, members, invites])
}
