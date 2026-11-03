/**
 * TanStack Start's global middleware (picked up from src/start.ts).
 *
 * - Server functions only accept same-origin requests (TanStack's CSRF
 *   middleware, which this file must now name since it replaces the default).
 * - A server function's failure reaches the browser only if it is a
 *   UserError; anything else becomes a generic message, so a database error
 *   never shows its SQL or values (src/lib/errors.ts).
 */
import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from '@tanstack/react-start'
import { errorCode, isUserError, publicError } from '@/lib/errors'

const csrf = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

export const publicErrors = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    try {
      return await next()
    } catch (error) {
      if (error instanceof Error && !isUserError(error))
        console.error('Server function failed:', errorCode(error))
      throw publicError(error)
    }
  },
)

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf],
  functionMiddleware: [publicErrors],
}))
