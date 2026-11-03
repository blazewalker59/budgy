import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Member } from '@/lib/auth/session'
import { startHousehold } from '@/lib/households/server'
import { signOut } from '@/lib/auth/client'
import { deviceTimeZone, firstName } from '@/lib/households/basics'
import { DEFAULT_TIME_ZONE } from '@/lib/model/dates'
import {
  PeopleEditor,
  TimeZoneSelect,
} from '@/components/households/HouseholdBasics'

export function Onboarding({ member }: { member: Member }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [timeZone, setTimeZone] = useState(() =>
    deviceTimeZone(DEFAULT_TIME_ZONE),
  )
  const [people, setPeople] = useState(() =>
    [firstName(member.name)].filter(Boolean),
  )
  const create = useMutation({
    mutationFn: () =>
      startHousehold({
        data: {
          name,
          timeZone,
          people: people.map((p) => p.trim()).filter(Boolean),
        },
      }),
    onSuccess: () => {
      queryClient.clear()
      // The rest of setup walks through accounts, categories and the plan.
      window.location.replace('/setup')
    },
  })
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <section className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <h1 className="text-xl font-extrabold">Start your Household</h1>
        <p className="text-sm text-muted">
          One budget, shared with the people you invite. No one else can see it.
        </p>
        <p className="text-xs text-muted">Signed in as {member.email}</p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <label
            className="block text-sm font-semibold"
            htmlFor="household-name"
          >
            Household name
          </label>
          <input
            id="household-name"
            className="field w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
            placeholder="Our household"
          />
          <p className="block text-sm font-semibold">Time zone</p>
          <p className="text-xs text-muted">
            Sets when your day and month start.
          </p>
          <TimeZoneSelect value={timeZone} onChange={setTimeZone} />
          <p className="block text-sm font-semibold">Who’s in it</p>
          <p className="text-xs text-muted">
            Spending can be filed to each person or to Joint. You can change
            this later.
          </p>
          <PeopleEditor people={people} onChange={setPeople} />
          <button
            type="submit"
            disabled={!name.trim() || create.isPending}
            className="min-h-11 w-full rounded-full bg-foreground px-5 text-sm font-semibold text-background disabled:opacity-50"
          >
            {create.isPending ? 'Creating…' : 'Create Household'}
          </button>
        </form>
        {create.isError && (
          <p role="alert" className="text-sm text-danger">
            {create.error.message}
          </p>
        )}
        <p className="text-xs text-muted">
          Invited to someone else’s Household? Open their invitation link
          instead.
        </p>
        <button
          type="button"
          className="text-sm font-semibold text-muted"
          onClick={() =>
            void signOut().then(() => {
              queryClient.clear()
              window.location.reload()
            })
          }
        >
          Use a different Google account
        </button>
      </section>
    </main>
  )
}
