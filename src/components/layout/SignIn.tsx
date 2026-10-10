import { signIn, signOut } from '@/lib/auth/client'

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
        <img
          src="/favicon.svg"
          alt=""
          width={48}
          height={48}
          className="mx-auto mb-4"
        />
        {children}
      </div>
    </main>
  )
}

export function SignIn({ callbackURL = '/' }: { callbackURL?: string }) {
  return (
    <Frame>
      <h1 className="text-2xl font-extrabold tracking-tight">Budgy</h1>
      <p className="mt-2 text-sm text-muted">
        Our household budget: where the money went, and what’s coming.
      </p>
      <button
        type="button"
        onClick={() => void signIn.social({ provider: 'google', callbackURL })}
        className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-sm font-semibold text-background"
      >
        Sign in with Google
      </button>
    </Frame>
  )
}

export function NotAllowed({ email }: { email: string }) {
  return (
    <Frame>
      <h1 className="text-xl font-bold">Budgy is invite-only</h1>
      <p className="mt-2 text-sm text-muted">
        {email} doesn’t have access yet. Sign in with the Google account your
        invitation was sent to, or ask a Household owner for an invitation.
      </p>
      <button
        type="button"
        onClick={() => void signOut().then(() => window.location.reload())}
        className="mt-6 min-h-11 w-full rounded-full border border-border px-5 text-sm font-semibold"
      >
        Use a different account
      </button>
    </Frame>
  )
}
