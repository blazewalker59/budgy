/**
 * Setup, one step at a time, in order: each step says what it's for and
 * lets the Member do it here or jump to where it's done. Back, Skip and
 * Next move along; what's done is read from the Ledger (docs/adr/0013).
 */
import { Link, useNavigate } from '@tanstack/react-router'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { STEP_COPY, useSetupProgress } from './progress'
import { SetupStepView } from './SetupSteps'
import type { SetupStep } from '@/lib/model/setup'
import { SETUP_STEPS } from '@/lib/model/setup'
import { useSetup } from '@/lib/ledger/useLedger'
import { cn } from '@/lib/utils'

export function SetupScreen({ step: chosen }: { step?: SetupStep }) {
  const navigate = useNavigate({ from: '/setup' })
  const progress = useSetupProgress()
  const setup = useSetup()
  const step = chosen ?? progress.next?.id ?? SETUP_STEPS[0]
  const index = SETUP_STEPS.indexOf(step)
  const state = progress.steps[index]
  const go = (to: SetupStep | null) =>
    to
      ? void navigate({ search: { step: to } })
      : void navigate({ to: '/', search: {} })
  const after = SETUP_STEPS[index + 1] ?? null
  const before = index > 0 ? SETUP_STEPS[index - 1] : null

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-lg font-extrabold tracking-tight">Setup</h1>
          <p className="text-xs text-muted">
            {progress.settled} of {SETUP_STEPS.length} done
          </p>
        </div>
        <nav aria-label="Setup steps">
          <ol className="flex gap-1 overflow-x-auto pb-1">
            {progress.steps.map((s, i) => (
              <li key={s.id} className="shrink-0">
                <Link
                  to="/setup"
                  search={{ step: s.id }}
                  aria-current={s.id === step ? 'step' : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-1 rounded-full border border-border px-3 text-xs font-semibold text-muted',
                    s.id === step && 'border-foreground text-foreground',
                  )}
                >
                  {s.done ? (
                    <Check size={13} className="text-accent" aria-hidden />
                  ) : (
                    <span aria-hidden>{i + 1}</span>
                  )}
                  {STEP_COPY[s.id].title}
                  {s.done && <span className="sr-only">(done)</span>}
                  {!s.done && s.skipped && (
                    <span className="font-normal">(skipped)</span>
                  )}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      <section
        aria-labelledby="setup-step"
        className="space-y-3 rounded-xl border border-border bg-surface p-3"
      >
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Step {index + 1} of {SETUP_STEPS.length}
            {state.done && <span className="text-accent"> · Done</span>}
          </p>
          <h2 id="setup-step" className="text-base font-extrabold">
            {STEP_COPY[step].title}
          </h2>
          <p className="text-sm text-muted">{STEP_COPY[step].detail}</p>
        </div>
        <SetupStepView step={step} />
      </section>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!before}
          onClick={() => go(before)}
          className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-4 text-sm font-semibold disabled:opacity-40"
        >
          <ChevronLeft size={15} aria-hidden /> Back
        </button>
        <div className="ml-auto flex gap-2">
          {!state.done && (
            <button
              type="button"
              onClick={() => {
                setup.mutate({ step, mark: 'skipped' })
                go(after)
              }}
              className="min-h-11 rounded-full px-4 text-sm font-semibold text-muted"
            >
              Skip
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              // Reviewing Categories is done once the Member moves on.
              if (step === 'categories' && !state.done)
                setup.mutate({ step, mark: 'done' })
              go(after)
            }}
            className="inline-flex min-h-11 items-center gap-1 rounded-full bg-foreground px-4 text-sm font-semibold text-background"
          >
            {after ? 'Next' : 'Finish'}
            <ChevronRight size={15} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  )
}
