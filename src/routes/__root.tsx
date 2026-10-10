import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouterState,
} from '@tanstack/react-router'
import appCss from '../styles.css?url'
import { THEME_BOOT, THEME_COLOR_BOOT } from '../lib/theme'
import type { QueryClient } from '@tanstack/react-query'
import { useLedgerQuery, useSession } from '@/lib/ledger/useLedger'
import { BookProvider } from '@/lib/ledger/book'
import { AppShell } from '@/components/layout/AppShell'
import { NotAllowed, SignIn } from '@/components/layout/SignIn'
import { useServiceWorker } from '@/lib/pwa'
import { Onboarding } from '@/components/households/Onboarding'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { title: 'Budgy' },
      { name: 'theme-color', content: '#f6f5f1' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
      { name: 'apple-mobile-web-app-title', content: 'Budgy' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'robots', content: 'noindex' },
      {
        name: 'description',
        content:
          'A shared household budget. See your spending, plan for bills and track balances together.',
      },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.json' },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    ],
  }),
  shellComponent: RootDocument,
  component: Gate,
  errorComponent: Crashed,
  notFoundComponent: () => (
    <p className="p-8 text-center text-muted">Page not found.</p>
  ),
})

/**
 * Budgy is for the Household's Members only (docs/adr/0001): a visitor
 * sees sign-in, a stranger who signed in is told so, a Member gets the app.
 */
function Gate() {
  useServiceWorker()
  const session = useSession()
  const state = session.data
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const invitation = /^\/join\/[^/]+$/.test(pathname)
  const ledger = useLedgerQuery(state?.status === 'member' && !invitation)
  if (session.isPending) return <Splash />
  if (session.isError) return <Crashed error={session.error} />
  if (state?.status === 'not-allowed') return <NotAllowed email={state.email} />
  if (state?.status !== 'member' && state?.status !== 'no-household')
    return <SignIn callbackURL={invitation ? pathname : '/'} />
  if (invitation) return <Outlet />
  if (state.status === 'no-household')
    return <Onboarding member={state.member} />
  if (ledger.isError) return <Crashed error={ledger.error} />
  if (!ledger.data) return <Splash />
  return (
    <BookProvider ledger={ledger.data}>
      <AppShell member={state.member}>
        <Outlet />
      </AppShell>
    </BookProvider>
  )
}

function Crashed({ error }: { error: unknown }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <p className="text-lg font-bold">Something went wrong</p>
      <p className="max-w-sm text-sm text-muted">
        {error instanceof Error ? error.message : 'Try reloading the page.'}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="min-h-11 rounded-full bg-foreground px-5 text-sm font-semibold text-background"
      >
        Reload
      </button>
    </div>
  )
}

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <img
        src="/favicon.svg"
        alt="Budgy"
        width={44}
        height={44}
        className="animate-pulse"
      />
    </div>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    // The boot script sets the theme class before hydration, so the
    // server-rendered class differs by design.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_COLOR_BOOT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
