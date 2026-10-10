import { describe, expect, it } from 'vitest'
import { clientMessage } from '@/lib/errors'

describe('clientMessage', () => {
  it('keeps a message written for a person and hides a query failure', () => {
    expect(clientMessage(new Error('Bad row 4'), 'Try again.')).toBe(
      'Bad row 4',
    )
    expect(
      clientMessage(
        new Error('Failed query: insert into transactions values (?)'),
        'Try again.',
      ),
    ).toBe('Try again.')
    expect(clientMessage('nope', 'Try again.')).toBe('Try again.')
  })
})
