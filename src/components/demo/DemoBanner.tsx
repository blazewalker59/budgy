/**
 * Shown on every screen while an admin acts as a Demo persona
 * (docs/adr/0015), so a demo is never mistaken for a real Household.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { SampleDownloads } from './SampleDownloads'
import type { DemoContext } from '@/lib/auth/session'
import { exitDemo, resetDemoPersona } from '@/lib/demo/server'

/** A persona switch reuses nothing cached: reload from the server. */
export function reloadAs(path = '/', clear: () => void) {
  clear()
  window.location.replace(path)
}

export function DemoBanner({ demo }: { demo: DemoContext }) {
  const queryClient = useQueryClient()
  const clear = () => queryClient.clear()
  const reset = useMutation({
    mutationFn: () =>
      resetDemoPersona({ data: { personaId: demo.persona.id } }),
    onSuccess: () => reloadAs('/', clear),
  })
  const exit = useMutation({
    mutationFn: () => exitDemo(),
    onSuccess: () => reloadAs('/', clear),
  })
  const busy = reset.isPending || exit.isPending
  return (
    <div
      role="region"
      aria-label="Demo"
      className="sticky top-0 z-30 flex h-10 items-center gap-3 overflow-x-auto whitespace-nowrap bg-amber-300 px-3 text-xs text-black"
    >
      <strong className="font-extrabold">
        Demo: acting as {demo.persona.name}
      </strong>
      <span aria-hidden>·</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (
            window.confirm(
              `Reset ${demo.persona.name} to the start? Their demo Household and everything in it is deleted.`,
            )
          )
            reset.mutate()
        }}
        className="font-semibold underline underline-offset-2 disabled:opacity-50"
      >
        Reset to start
      </button>
      <span aria-hidden>·</span>
      <a href="/admin" className="font-semibold underline underline-offset-2">
        Switch persona
      </a>
      <span aria-hidden>·</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => exit.mutate()}
        className="font-semibold underline underline-offset-2 disabled:opacity-50"
      >
        Exit demo
      </button>
      <span aria-hidden>·</span>
      <SampleDownloads compact />
      {(reset.isError || exit.isError) && (
        <span role="alert" className="font-semibold text-red-800">
          {(reset.error ?? exit.error)?.message}
        </span>
      )}
    </div>
  )
}
