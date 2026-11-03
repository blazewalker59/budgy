/**
 * The Household's basics, as fields: its time zone and the people in it.
 * Used when a Household is created and on the Household page after.
 */
import { useMemo } from 'react'
import { Plus, X } from 'lucide-react'
import {
  JOINT,
  MAX_PEOPLE,
  MAX_PERSON,
  timeZones,
  zoneLabel,
} from '@/lib/households/basics'
import { Dropdown } from '@/components/shared/Dropdown'

export function TimeZoneSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (zone: string) => void
}) {
  const options = useMemo(() => {
    const groups = new Map<string, Array<{ value: string; label: string }>>()
    for (const zone of timeZones()) {
      const region = zone.includes('/') ? zone.split('/')[0] : 'Other'
      const list = groups.get(region) ?? []
      list.push({ value: zone, label: zoneLabel(zone) })
      groups.set(region, list)
    }
    return [...groups].map(([group, list]) => ({
      group,
      options: list.sort((a, b) => a.label.localeCompare(b.label)),
    }))
  }, [])
  return (
    <Dropdown
      value={value}
      onChange={onChange}
      label="Time zone"
      className="min-h-11 w-full"
      options={options}
    />
  )
}

/**
 * The people spending is filed by, besides Joint (always there). Each can
 * own Accounts; it's not who can sign in.
 */
export function PeopleEditor({
  people,
  onChange,
}: {
  people: Array<string>
  onChange: (people: Array<string>) => void
}) {
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        <li className="flex min-h-11 items-center rounded-lg bg-sunken px-3 text-sm text-muted">
          {JOINT} <span className="ml-1 text-xs">(shared, always here)</span>
        </li>
        {people.map((person, i) => (
          <li key={i} className="flex items-center gap-2">
            <input
              aria-label={`Person ${i + 1}`}
              className="field min-h-11 flex-1"
              value={person}
              maxLength={MAX_PERSON}
              placeholder="Name"
              onChange={(e) =>
                onChange(people.map((p, j) => (j === i ? e.target.value : p)))
              }
            />
            <button
              type="button"
              aria-label={`Remove ${person || `person ${i + 1}`}`}
              onClick={() => onChange(people.filter((_, j) => j !== i))}
              className="flex size-11 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-foreground"
            >
              <X size={16} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {people.length < MAX_PEOPLE && (
        <button
          type="button"
          onClick={() => onChange([...people, ''])}
          className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-3 text-sm font-semibold"
        >
          <Plus size={14} aria-hidden /> Add a person
        </button>
      )}
    </div>
  )
}

/** Stored owners as the editor shows them: everyone but Joint. */
export function peopleOf(owners: ReadonlyArray<string>): Array<string> {
  return owners.filter((o) => o !== JOINT)
}
