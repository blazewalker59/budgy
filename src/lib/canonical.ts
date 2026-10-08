/**
 * Production has one address (CANONICAL_HOST, e.g. sportsline.dev): a
 * request on any other host (www, workers.dev) gets a permanent redirect to
 * the same path there, so there is one sign-in and one cache. Unset in
 * local development, where nothing redirects.
 */
export function canonicalRedirect(
  url: URL,
  method: string,
  canonicalHost?: string,
): Response | null {
  if (!canonicalHost || url.hostname === canonicalHost) return null
  const target = `https://${canonicalHost}${url.pathname}${url.search}`
  // 301 for reads; 308 keeps the method and body for anything else.
  return Response.redirect(
    target,
    method === 'GET' || method === 'HEAD' ? 301 : 308,
  )
}
