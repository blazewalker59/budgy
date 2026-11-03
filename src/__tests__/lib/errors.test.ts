import { describe, expect, it, vi } from 'vitest'
import { fromCrossJSON, toCrossJSONAsync } from 'seroval'
import {
  GENERIC_FAILURE,
  UserError,
  clientMessage,
  errorCode,
  isUserError,
  publicError,
} from '@/lib/errors'
import { SimplefinError } from '@/lib/updates/simplefinClient'
import { publicErrors } from '@/start'

describe('clientMessage', () => {
  it('shows only messages written for a Member', () => {
    expect(clientMessage(new UserError('Bad row 4'), 'Try again.')).toBe(
      'Bad row 4',
    )
    expect(clientMessage(new SimplefinError('auth'), 'Try again.')).toContain(
      'SimpleFIN no longer accepts',
    )
    for (const error of [
      new Error('Failed query: insert into transactions values (?)'),
      new Error('D1_ERROR: UNIQUE constraint failed'),
      new TypeError('x is undefined'),
      'nope',
    ])
      expect(clientMessage(error, 'Try again.')).toBe('Try again.')
  })

  it('still recognizes a UserError after server-function serialization', async () => {
    const json = await toCrossJSONAsync(new UserError('Reopen this account'), {
      refs: new Map(),
    })
    const received = fromCrossJSON(JSON.parse(JSON.stringify(json)), {
      refs: new Map(),
    })
    expect(isUserError(received)).toBe(true)
    expect(clientMessage(received, 'Try again.')).toBe('Reopen this account')
  })
})

describe('publicError', () => {
  it('replaces anything but a UserError, and passes non-errors through', () => {
    const user = new UserError('Name your Household')
    expect(publicError(user)).toBe(user)
    const hidden = publicError(new Error('Failed query: select secret'))
    expect(isUserError(hidden)).toBe(true)
    expect((hidden as Error).message).toBe(GENERIC_FAILURE)
    const redirect = { isRedirect: true }
    expect(publicError(redirect)).toBe(redirect)
  })

  it('logs only an error’s name, never its message', () => {
    const cause = new Error('values: alice@example.com')
    expect(errorCode(new Error('Failed query: secret', { cause }))).toBe(
      'Error(Error)',
    )
  })
})

describe('the server-function error middleware', () => {
  const run = (thrown: unknown) =>
    (
      publicErrors.options.server as unknown as (ctx: {
        next: () => Promise<unknown>
      }) => Promise<unknown>
    )({ next: () => Promise.reject(thrown) })

  it('lets a UserError through and hides everything else', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(run(new UserError('Only the owner'))).rejects.toThrow(
      'Only the owner',
    )
    await expect(
      run(new Error('Failed query: update user set email = ?')),
    ).rejects.toThrow(GENERIC_FAILURE)
    expect(JSON.stringify(log.mock.calls)).not.toContain('Failed query')
    log.mockRestore()
  })
})
