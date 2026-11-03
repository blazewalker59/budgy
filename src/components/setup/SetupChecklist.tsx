/**
 * "Finish setup" on Overview: every step, done or not as the Ledger shows
 * it, each opening its step on Setup. It goes once every step is done or
 * skipped, or when a Member puts it away (docs/adr/0013).
 */
import { Link } from '@tanstack/react-router'
import { Check, ChevronRight, X } from 'lucide-react'
import { STEP_COPY, useSetupProgress } from './progress'
import { useBook } from '@/lib/ledger/book'
import { useSetup } from '@/lib/ledger/useLedger'
import { cn } from '@/lib/utils'

/** Whether setup still has something to offer: not finished, not put away. */
export function useSetupOpen(): boolean {
  const { ix } = useBook()
  const progress = useSetupProgress()
  return !ix.ledger.setup.dismissed && !progress.finished
}

export function SetupChecklist() {
  const progress = useSetupProgress()
  const setup = useSetup()
  const open = useSetupOpen()
  if (!open) return null
  const total = progress.steps.length
  return (
    <section
      aria-labelledby="finish-setup"
      className="space-y-2 rounded-xl border border-accent/40 bg-surface p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="finish-setup" className="text-sm font-bold">
            Finish setup
          </h2>
          <p className="text-xs text-muted">
            {progress.settled} of {total} done. A few minutes each.
          </p>
        </div>
        <button
          type="button"
          aria-label="Put setup away"
          title="Put away (it stays under your account menu)"
          onClick={() => setup.mutate({ dismissed: true })}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-foreground"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${(progress.settled / total) * 100}%` }}
        />
      </div>
      <ol className="grid gap-x-3 sm:grid-cols-2">
        {progress.steps.map((s) => (
          <li key={s.id}>
            <Link
              to="/setup"
              search={{ step: s.id }}
              className="flex min-h-11 items-center gap-2 text-[13px]"
            >
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border',
                  s.done
                    ? 'border-accent bg-accent text-surface'
                    : 'border-border',
                )}
              >
                {s.done && <Check size={12} aria-hidden />}
              </span>
              <span
                className={cn(
                  'flex-1',
                  (s.done || s.skipped) && 'text-muted',
                  s.done && 'line-through',
                )}
              >
                {STEP_COPY[s.id].title}
                {s.done && <span className="sr-only"> (done)</span>}
                {!s.done && s.skipped && (
                  <span className="text-xs"> · skipped</span>
                )}
              </span>
              <ChevronRight size={14} className="text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
      {progress.next && (
        <Link
          to="/setup"
          search={{ step: progress.next.id }}
          className="inline-flex min-h-11 items-center rounded-full bg-foreground px-4 text-sm font-semibold text-background"
        >
          Next: {STEP_COPY[progress.next.id].title}
        </Link>
      )}
    </section>
  )
}
