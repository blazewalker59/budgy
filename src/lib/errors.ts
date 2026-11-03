/**
 * What a caller may be shown: only messages written for Members. Anything
 * else (a database failure repeating its SQL and bound values, a library's
 * internals) gets the caller's fallback.
 */

/**
 * A failure whose message is written for a Member ("Reopen this account to
 * update it."). Never put credentials, raw responses or query text in one.
 * `userFacing` is an own property, so it survives server-function
 * serialization and the browser can tell these apart too.
 */
export class UserError extends Error {
  readonly userFacing = true
  constructor(message: string) {
    super(message)
    this.name = 'UserError'
  }
}

export function isUserError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error as { userFacing?: unknown }).userFacing === true
  )
}

export function clientMessage(error: unknown, fallback: string): string {
  return isUserError(error) ? error.message : fallback
}

/** What a server function's caller sees when the failure isn't a UserError. */
export const GENERIC_FAILURE = 'Something went wrong. Try again.'

/**
 * The error a server function sends to the browser: a UserError as it is,
 * anything else replaced so its message (and stack) stay on the server.
 * Redirects and not-found results aren't Errors and pass through.
 */
export function publicError(error: unknown): unknown {
  if (!(error instanceof Error) || isUserError(error)) return error
  return new UserError(GENERIC_FAILURE)
}

/**
 * A short, value-free description of an error for logs: its name, and its
 * cause's. Messages can carry SQL with bound values or response text.
 */
export function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return typeof error
  const cause = error.cause instanceof Error ? `(${error.cause.name})` : ''
  return `${error.name}${cause}`
}
