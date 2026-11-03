/**
 * The Household's name, time zone and people. Any Member may change them;
 * who is in the Household is the owner's (docs/adr/0013).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { PeopleEditor, TimeZoneSelect, peopleOf } from './HouseholdBasics'
import type { Household } from '@/lib/households/service'
import { saveHouseholdSettings } from '@/lib/households/server'
import { HOUSEHOLD_KEY } from '@/lib/households/useHousehold'
import { LEDGER_KEY, SESSION_KEY } from '@/lib/ledger/useLedger'

export function HouseholdSettings({
  household,
  onSaved,
}: {
  household: Pick<Household, 'name' | 'timeZone' | 'owners'>
  onSaved?: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(household.name)
  const [timeZone, setTimeZone] = useState(household.timeZone)
  const [people, setPeople] = useState(() => peopleOf(household.owners))
  const [saved, setSaved] = useState(false)
  const save = useMutation({
    mutationFn: () =>
      saveHouseholdSettings({
        data: {
          name,
          timeZone,
          people: people.map((p) => p.trim()).filter(Boolean),
        },
      }),
    onSuccess: async () => {
      setSaved(true)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SESSION_KEY }),
        queryClient.invalidateQueries({ queryKey: HOUSEHOLD_KEY }),
        queryClient.invalidateQueries({ queryKey: LEDGER_KEY }),
      ])
      onSaved?.()
    },
  })
  const edit =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      setSaved(false)
      set(v)
    }
  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-3">
      <h2 className="text-sm font-bold">Household</h2>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <label className="block space-y-1 text-sm font-semibold">
          Name
          <input
            className="field min-h-11 w-full font-normal"
            value={name}
            maxLength={60}
            required
            onChange={(e) => edit(setName)(e.target.value)}
          />
        </label>
        <div className="space-y-1">
          <p className="text-sm font-semibold">Time zone</p>
          <TimeZoneSelect value={timeZone} onChange={edit(setTimeZone)} />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold">People</p>
          <p className="text-xs text-muted">
            Who spending is filed to. Not who can sign in.
          </p>
          <PeopleEditor people={people} onChange={edit(setPeople)} />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!name.trim() || save.isPending}
            className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          {saved && (
            <p role="status" className="text-sm text-accent">
              Saved.
            </p>
          )}
        </div>
        {save.isError && (
          <p role="alert" className="text-sm text-danger">
            {save.error.message}
          </p>
        )}
      </form>
    </section>
  )
}
