/**
 * Server functions for the demo sandbox (docs/adr/0015). Each one is only
 * `runAdmin`: the admin check runs on the server, on every call.
 */
import { createServerFn } from '@tanstack/react-start'
import { ADMIN_INPUTS, runAdmin } from './admin'

export const getDemoPersonas = createServerFn({ method: 'GET' }).handler(() =>
  runAdmin('personas', undefined),
)

export const newDemoPersona = createServerFn({ method: 'POST' })
  .validator((data: { label: string }) =>
    ADMIN_INPUTS.createPersona.parse(data),
  )
  .handler(({ data }) => runAdmin('createPersona', data))

export const actAsDemoPersona = createServerFn({ method: 'POST' })
  .validator((data: { personaId: string }) => ADMIN_INPUTS.actAs.parse(data))
  .handler(({ data }) => runAdmin('actAs', data))

export const exitDemo = createServerFn({ method: 'POST' }).handler(() =>
  runAdmin('exitDemo', undefined),
)

export const resetDemoPersona = createServerFn({ method: 'POST' })
  .validator((data: { personaId: string }) => ADMIN_INPUTS.reset.parse(data))
  .handler(({ data }) => runAdmin('reset', data))

export const deleteDemoPersona = createServerFn({ method: 'POST' })
  .validator((data: { personaId: string }) =>
    ADMIN_INPUTS.deletePersona.parse(data),
  )
  .handler(({ data }) => runAdmin('deletePersona', data))

export const replayDemoInvite = createServerFn({ method: 'POST' })
  .validator((data: { fromPersonaId: string; label: string }) =>
    ADMIN_INPUTS.replayInvite.parse(data),
  )
  .handler(({ data }) => runAdmin('replayInvite', data))
