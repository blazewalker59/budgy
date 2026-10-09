import { Link, useRouterState } from '@tanstack/react-router'
import {
  Bot,
  Download,
  LayoutList,
  LogOut,
  Moon,
  PieChart,
  Receipt,
  Search,
  Sun,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import type { Member } from '@/lib/auth/session'
import { signOut } from '@/lib/auth/client'
import { currentTheme, setTheme } from '@/lib/theme'
import { useInstall } from '@/lib/pwa'
import { keepLens } from '@/lib/ledger/search'
import { openPalette } from '@/lib/ledger/useLens'
import { cn } from '@/lib/utils'
import { CommandPalette } from '@/components/lens/CommandPalette'

/** Four places; the Lens (the filters) follows from one to the next. */
const NAV = [
  { to: '/', label: 'Overview', icon: PieChart },
  { to: '/spending', label: 'Spending', icon: Receipt },
  { to: '/plan', label: 'Plan', icon: LayoutList },
  { to: '/accounts', label: 'Accounts', icon: Wallet },
] as const

export function AppShell({
  member,
  children,
}: {
  member: Member
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh bg-background pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-6">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-11 max-w-6xl items-center gap-3 px-3">
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm font-extrabold"
          >
            <img src="/favicon.svg" alt="" width={22} height={22} />
            budgy
          </Link>
          <nav className="hidden flex-1 items-center gap-0.5 sm:flex">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                search={keepLens}
                activeOptions={{ exact: n.to === '/', includeSearch: false }}
                className="rounded-full px-2.5 py-1 text-[13px] font-medium text-muted hover:text-foreground"
                activeProps={{
                  className: 'bg-surface text-foreground shadow-sm',
                }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <CommandPalette />
            <ThemeButton />
            <MemberMenu member={member} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-3 pt-3">{children}</main>
      <BottomBar />
    </div>
  )
}

/**
 * The phone's tab bar, in liquid glass: a floating capsule whose lit pill
 * glides to the open tab, and beside it a round search button that opens
 * the palette (where iOS puts search).
 */
function BottomBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const active = NAV.findIndex((n) =>
    n.to === '/' ? pathname === '/' : pathname.startsWith(n.to),
  )
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex items-end gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden">
      <nav
        aria-label="Main"
        className="glass pointer-events-auto relative flex h-[60px] flex-1 items-stretch rounded-full p-1"
      >
        {active >= 0 && (
          <span
            aria-hidden
            className="glass-pill absolute inset-y-1 left-1 rounded-full"
            style={{
              width: `calc((100% - 0.5rem) / ${NAV.length})`,
              transform: `translateX(${active * 100}%)`,
            }}
          />
        )}
        {NAV.map((n, i) => (
          <Link
            key={n.to}
            to={n.to}
            search={keepLens}
            activeOptions={{ exact: n.to === '/', includeSearch: false }}
            className={cn(
              'relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[10px] font-semibold transition-colors',
              i === active
                ? 'text-accent'
                : 'text-muted active:text-foreground',
            )}
          >
            <n.icon
              size={20}
              strokeWidth={i === active ? 2.4 : 2}
              aria-hidden
            />
            {n.label}
          </Link>
        ))}
      </nav>
      <button
        type="button"
        onClick={() => openPalette()}
        aria-label="Search or filter"
        className="glass pointer-events-auto flex size-[60px] shrink-0 items-center justify-center rounded-full text-foreground active:scale-95"
      >
        <Search size={22} aria-hidden />
      </button>
    </div>
  )
}

function ThemeButton() {
  return (
    <button
      type="button"
      aria-label="Switch light or dark"
      onClick={() => setTheme(currentTheme() === 'dark' ? 'light' : 'dark')}
      className="flex size-8 items-center justify-center rounded-full text-muted hover:text-foreground"
    >
      <Sun size={16} className="hidden dark:block" aria-hidden />
      <Moon size={16} className="dark:hidden" aria-hidden />
    </button>
  )
}

function MemberMenu({ member }: { member: Member }) {
  const [open, setOpen] = useState(false)
  const install = useInstall()
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Account"
        className="flex size-8 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-xs font-bold text-accent"
      >
        {member.image ? (
          <img src={member.image} alt="" className="size-8" />
        ) : (
          member.name.slice(0, 1).toUpperCase()
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-10 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
          <p className="px-2 py-1 text-sm font-semibold">{member.name}</p>
          <p className="truncate px-2 pb-1.5 text-xs text-muted">
            {member.email}
          </p>
          {install.kind === 'prompt' && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                install.install()
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-sunken"
            >
              <Download size={15} aria-hidden /> Install app
            </button>
          )}
          {install.kind === 'ios' && (
            <p className="flex gap-2 rounded-lg px-2 py-1.5 text-xs text-muted">
              <Download size={15} className="shrink-0" aria-hidden />
              <span>
                Install: tap Share, then <strong>Add to Home Screen</strong>.
              </span>
            </p>
          )}
          <Link
            to="/agents"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-sunken"
          >
            <Bot size={15} aria-hidden /> Agents
          </Link>
          <button
            type="button"
            onClick={() => void signOut().then(() => window.location.reload())}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-sunken"
          >
            <LogOut size={15} aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
