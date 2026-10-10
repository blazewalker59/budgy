/** Public-facing introduction. The preview is fictional and never reads a Ledger. */
import {
  ArrowRight,
  CalendarDays,
  Check,
  PieChart,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { signIn } from '@/lib/auth/client'

export function GoogleSignInButton({
  callbackURL = '/',
  compact = false,
}: {
  callbackURL?: string
  compact?: boolean
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const start = async () => {
    setPending(true)
    setError(null)
    try {
      const result = await signIn.social({ provider: 'google', callbackURL })
      if (result.error) {
        setError(result.error.message ?? 'Couldn’t start sign-in. Try again.')
        setPending(false)
      }
    } catch {
      setError('Couldn’t start sign-in. Try again.')
      setPending(false)
    }
  }
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => void start()}
        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-foreground font-semibold text-background transition-colors hover:bg-accent disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${compact ? 'px-4 text-xs sm:text-sm' : 'w-full px-6 py-3 text-sm sm:w-auto'}`}
      >
        {pending ? 'Opening Google…' : 'Sign in with Google'}
        {!compact && <ArrowRight size={16} aria-hidden />}
      </button>
      {error && (
        <p role="alert" className="mt-2 max-w-sm text-sm text-over">
          {error}
        </p>
      )}
    </div>
  )
}

const FEATURES = [
  {
    icon: PieChart,
    title: 'Know where the money went',
    detail:
      'See spending by category, store, person or account, against your budget.',
  },
  {
    icon: CalendarDays,
    title: 'Plan for what’s coming',
    detail:
      'Budget for occasional bills like car insurance next to your monthly targets. See what’s due soon.',
  },
  {
    icon: Wallet,
    title: 'Track balances',
    detail:
      'Record balances for cards, savings, investments and loans. Follow your net worth over time.',
  },
  {
    icon: Users,
    title: 'Share it',
    detail: 'Invite your partner. You both see and edit the same budget.',
  },
] as const

export function SignedOutHome() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <a
          href="/"
          aria-label="Budgy home"
          className="flex items-center gap-2 text-xl font-extrabold tracking-tight"
        >
          <img src="/favicon.svg" alt="" width={30} height={30} /> budgy
        </a>
        <GoogleSignInButton compact />
      </header>

      <main>
        <section
          aria-labelledby="welcome-heading"
          className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-14 pt-8 sm:px-8 sm:pb-20 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16"
        >
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-accent">
              <span className="size-1.5 rounded-full bg-accent" aria-hidden /> A
              budget for two
            </p>
            <h1
              id="welcome-heading"
              className="max-w-xl text-4xl leading-[1.08] font-extrabold tracking-tight sm:text-5xl lg:text-6xl"
            >
              Know your spending.
              <br />
              <span className="text-accent">Plan life together.</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-relaxed text-muted sm:text-lg">
              Your purchases, budget and upcoming bills in one place, shared
              with your partner.
            </p>
            <div className="mt-8 space-y-3">
              <GoogleSignInButton />
              <p className="max-w-sm text-xs leading-relaxed text-muted">
                Invite-only for now. Got an invitation? Open its link and sign
                in with the Google account it was sent to.
              </p>
            </div>
            <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted">
              <ShieldCheck
                size={16}
                className="mt-0.5 shrink-0 text-accent"
                aria-hidden
              />{' '}
              Only people in your Household can see your budget.
            </p>
          </div>
          <BudgetPreview />
        </section>

        <section
          aria-labelledby="features-heading"
          className="border-y border-border bg-surface/60"
        >
          <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
            <p className="text-xs font-bold tracking-widest text-accent uppercase">
              What you get
            </p>
            <h2
              id="features-heading"
              className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl"
            >
              More than a list of transactions
            </h2>
            <div className="mt-9 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(({ icon: Icon, title, detail }) => (
                <article key={title}>
                  <div className="mb-4 flex size-10 items-center justify-center rounded-xl border border-border bg-background text-accent">
                    <Icon size={20} aria-hidden />
                  </div>
                  <h3 className="text-base font-bold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    {detail}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          aria-labelledby="start-heading"
          className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[1fr_1.2fr] lg:gap-16"
        >
          <div>
            <p className="text-xs font-bold tracking-widest text-accent uppercase">
              Getting started
            </p>
            <h2
              id="start-heading"
              className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl"
            >
              Start with what you have
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-muted">
              Link your banks through SimpleFIN Bridge to sync them
              automatically, or upload the exports you download.
            </p>
          </div>
          <ol className="space-y-5">
            {[
              [
                'Set up your Household',
                'Create it and invite your partner, or accept an invitation.',
              ],
              [
                'Add your accounts',
                'Upload transaction exports and record balances. Store Rules categorize purchases for you.',
              ],
              [
                'Set your budget',
                'Set monthly targets, add occasional bills, and check the month together.',
              ],
            ].map(([title, detail], index) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-sm font-bold">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    {detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-6 text-xs text-muted sm:px-8">
        <p className="font-semibold">budgy · A household budget for two</p>
      </footer>
    </div>
  )
}

function BudgetPreview() {
  return (
    <section
      aria-label="Illustrative budget preview"
      className="relative rounded-3xl border border-border bg-surface p-5 shadow-xl shadow-foreground/5 sm:p-7"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-extrabold">Your month, at a glance</span>
        <span className="rounded-full bg-sunken px-2.5 py-1 text-[10px] font-semibold text-muted">
          Example data
        </span>
      </div>
      <div className="mt-6 rounded-2xl bg-accent-soft p-5">
        <p className="text-xs font-semibold text-accent">Everyday spending</p>
        <p className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
          $1,685{' '}
          <span className="text-sm font-medium tracking-normal text-muted">
            of $2,400
          </span>
        </p>
        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-accent/15"
          aria-hidden
        >
          <div className="h-full w-[70.2%] rounded-full bg-accent" />
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-accent">
          <Check size={14} aria-hidden /> $715 left in the plan
        </p>
      </div>
      <div className="mt-6 space-y-4">
        <p className="text-[10px] font-bold tracking-wider text-muted uppercase">
          A few everyday categories
        </p>
        {[
          {
            name: 'Groceries',
            spent: '$425',
            target: '$650',
            width: '65.4%',
            color: 'bg-need',
          },
          {
            name: 'Drinks & dining',
            spent: '$230',
            target: '$250',
            width: '92%',
            color: 'bg-nice',
          },
          {
            name: 'Shopping',
            spent: '$110',
            target: '$200',
            width: '55%',
            color: 'bg-planned',
          },
        ].map((category) => (
          <div key={category.name}>
            <div className="mb-1.5 flex justify-between gap-2 text-xs">
              <span className="font-semibold">{category.name}</span>
              <span>
                {category.spent}{' '}
                <span className="text-muted">/ {category.target}</span>
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-sunken"
              aria-hidden
            >
              <div
                className={`h-full rounded-full ${category.color}`}
                style={{ width: category.width }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-center gap-3 rounded-xl border border-border p-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-planned-soft text-planned">
          <CalendarDays size={18} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold">Car insurance</p>
          <p className="mt-0.5 text-[11px] text-muted">
            Planned ahead · due next month
          </p>
        </div>
        <span className="text-sm font-bold">$320</span>
      </div>
      <p className="mt-4 text-center text-[10px] text-muted">
        Example data, not a real Household.
      </p>
    </section>
  )
}
