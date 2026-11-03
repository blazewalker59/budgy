/**
 * Setup: the steps a new Household walks through, each done or not as the
 * Ledger shows it (it has Accounts, a Pay Schedule, Targets…), so progress
 * never drifts from the data. Only what the Ledger can't show is kept as a
 * mark: a step skipped, Categories reviewed, the checklist put away
 * (docs/adr/0013). Pure.
 */

import { z } from 'zod'
import { monthRange, shiftMonth } from './dates'
import { unsortedShare } from './sorting'
import type { LedgerIndex } from './ledger'

export const SETUP_STEPS = [
  'household',
  'partner',
  'categories',
  'connect',
  'history',
  'sort',
  'pay',
  'targets',
  'bills',
] as const
export type SetupStep = (typeof SETUP_STEPS)[number]

/** Steps the Ledger can't show as done; a Member marks them. */
export const MARKED_STEPS: ReadonlyArray<SetupStep> = ['categories']

export interface SetupMarks {
  /** Steps a Member skipped. */
  skipped: Array<SetupStep>
  /** Steps a Member finished that the Ledger can't show (MARKED_STEPS). */
  done: Array<SetupStep>
  /** The checklist put away for good. */
  dismissed: boolean
}

export const NO_MARKS: SetupMarks = { skipped: [], done: [], dismissed: false }

const step = z.enum(SETUP_STEPS)
export const setupMarksSchema = z.object({
  skipped: z.array(step).max(SETUP_STEPS.length),
  done: z.array(step).max(SETUP_STEPS.length),
  dismissed: z.boolean(),
})

export function parseSetupMarks(json: string | null | undefined): SetupMarks {
  if (!json) return NO_MARKS
  try {
    const parsed = setupMarksSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : NO_MARKS
  } catch {
    return NO_MARKS
  }
}

/** One mark changed: a step skipped, done, or back to as the Ledger says. */
export function markStep(
  marks: SetupMarks,
  id: SetupStep,
  mark: 'skipped' | 'done' | null,
): SetupMarks {
  const skipped = marks.skipped.filter((s) => s !== id)
  const done = marks.done.filter((s) => s !== id)
  if (mark === 'skipped') skipped.push(id)
  if (mark === 'done' && MARKED_STEPS.includes(id)) done.push(id)
  return { ...marks, skipped, done }
}

export interface SetupFacts {
  /** The Household's owners, Joint included. */
  owners: ReadonlyArray<string>
  /** Members of the Household, and invitations waiting (owners see them). */
  members: number
  invites: number
}

export interface StepState {
  id: SetupStep
  /** The Ledger shows it's done (or a Member said, for MARKED_STEPS). */
  done: boolean
  skipped: boolean
}

/** Purchases this share or more Uncategorized means sorting isn't done. */
const UNSORTED_SHARE = 0.05
/** Months before this one with purchases, for a Typical month to mean much. */
const HISTORY_MONTHS = 2

function isDone(
  id: SetupStep,
  ix: LedgerIndex,
  today: string,
  marks: SetupMarks,
  facts: SetupFacts,
): boolean {
  const l = ix.ledger
  switch (id) {
    case 'household':
      return facts.owners.length > 1
    case 'partner':
      return facts.members > 1 || facts.invites > 0
    case 'categories':
      return marks.done.includes('categories')
    case 'connect':
      return l.accounts.some((a) => !a.closed)
    case 'history': {
      const before = new Set(monthRange(shiftMonth(today.slice(0, 7), -1), 3))
      const months = new Set(l.txns.map((t) => t.month))
      return [...before].filter((m) => months.has(m)).length >= HISTORY_MONTHS
    }
    case 'sort': {
      const { unsorted, purchases } = unsortedShare(ix)
      return purchases > 0 && unsorted / purchases < UNSORTED_SHARE
    }
    case 'pay':
      return l.pay.length > 0
    case 'targets':
      return l.targets.length > 0
    case 'bills':
      return l.plans.length > 0
  }
}

/** Every step, in order, with its state. */
export function setupProgress(
  ix: LedgerIndex,
  today: string,
  marks: SetupMarks,
  facts: SetupFacts,
): Array<StepState> {
  return SETUP_STEPS.map((id) => ({
    id,
    done: isDone(id, ix, today, marks, facts),
    skipped: marks.skipped.includes(id),
  }))
}

/** Every step done or skipped: setup is finished. */
export function setupFinished(steps: ReadonlyArray<StepState>): boolean {
  return steps.every((s) => s.done || s.skipped)
}
