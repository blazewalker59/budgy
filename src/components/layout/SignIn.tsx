import { GoogleSignInButton, SignedOutHome } from './SignedOutHome'
import { signOut } from '@/lib/auth/client'

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
  if (callbackURL === '/') return <SignedOutHome />
  return (
    <Frame>
      <h1 className="text-2xl font-extrabold tracking-tight">
        Join your Household
      </h1>
      <p className="mt-2 text-sm text-muted">
        Sign in with the Google account your invitation was sent to. You’ll
        confirm before joining.
      </p>
      <div className="mt-6">
        <GoogleSignInButton callbackURL={callbackURL} />
      </div>
    </Frame>
  )
}

export function NotAllowed({ email }: { email: string }) {
  return (
    <Frame>
      <h1 className="text-xl font-bold">Budgy is invite-only</h1>
      <p className="mt-2 text-sm text-muted">
        {email} doesn’t have access. Sign in with the account your invitation
        was sent to, or ask a Household owner to invite you.
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
