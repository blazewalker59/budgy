import { Link } from '@tanstack/react-router'
import {
  CalendarClock,
  LayoutList,
  LogOut,
  Moon,
  PieChart,
  Receipt,
  Sun,
  Upload,
} from 'lucide-react'
import { useState } from 'react'
import type { Member } from '@/lib/auth/session'
import { signOut } from '@/lib/auth/client'
import { currentTheme, setTheme } from '@/lib/theme'

const NAV = [
  { to: '/', label: 'Month', icon: PieChart },
  { to: '/spending', label: 'Spending', icon: Receipt },
  { to: '/budget', label: 'Budget', icon: LayoutList },
  { to: '/upcoming', label: 'Upcoming', icon: CalendarClock },
  { to: '/import', label: 'Import', icon: Upload },
] as const

export function AppShell({
  member,
  children,
}: {
  member: Member
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh bg-background pb-20 sm:pb-8">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2 font-extrabold">
            <img src="/favicon.svg" alt="" width={26} height={26} />
            budgy
          </Link>
          <nav className="hidden flex-1 items-center gap-1 sm:flex">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                activeOptions={{ exact: n.to === '/', includeSearch: false }}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-muted hover:text-foreground"
                activeProps={{
                  className: 'bg-surface text-foreground shadow-sm',
                }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeButton />
            <MemberMenu member={member} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pt-5">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        {NAV.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.to === '/', includeSearch: false }}
            className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted"
            activeProps={{ className: 'text-accent' }}
          >
            <n.icon size={20} aria-hidden />
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}

function ThemeButton() {
  return (
    <button
      type="button"
      aria-label="Switch light or dark"
      onClick={() => setTheme(currentTheme() === 'dark' ? 'light' : 'dark')}
      className="flex size-9 items-center justify-center rounded-full text-muted hover:text-foreground"
    >
      <Sun size={18} className="hidden dark:block" aria-hidden />
      <Moon size={18} className="dark:hidden" aria-hidden />
    </button>
  )
}

function MemberMenu({ member }: { member: Member }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Account"
        className="flex size-9 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-sm font-bold text-accent"
      >
        {member.image ? (
          <img src={member.image} alt="" className="size-9" />
        ) : (
          member.name.slice(0, 1).toUpperCase()
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 w-56 rounded-xl border border-border bg-surface p-2 shadow-lg">
          <p className="px-2 py-1 text-sm font-semibold">{member.name}</p>
          <p className="truncate px-2 pb-2 text-xs text-muted">
            {member.email}
          </p>
          <button
            type="button"
            onClick={() => void signOut().then(() => window.location.reload())}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-sunken"
          >
            <LogOut size={16} aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
