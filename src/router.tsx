import { createRouter } from '@tanstack/react-router'
import {
  createIsomorphicFn,
  getGlobalStartContext,
} from '@tanstack/react-start'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import * as TanstackQuery from './integrations/tanstack-query/root-provider'

import { routeTree } from './routeTree.gen'

/**
 * This response's CSP nonce, from src/server.ts, for the scripts the server
 * renders (src/lib/securityHeaders.ts). The browser never needs one.
 */
const requestNonce = createIsomorphicFn()
  .server(() => {
    try {
      return (getGlobalStartContext() as { nonce?: string } | undefined)?.nonce
    } catch {
      return undefined
    }
  })
  .client(() => undefined)

export const getRouter = () => {
  const rqContext = TanstackQuery.getContext()

  const router = createRouter({
    routeTree,
    context: {
      ...rqContext,
    },
    defaultPreload: 'intent',
    scrollRestoration: true,
    ssr: { nonce: requestNonce() },
  })

  setupRouterSsrQueryIntegration({ router, queryClient: rqContext.queryClient })

  return router
}
