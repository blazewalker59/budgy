/**
 * What a caller may be shown. A database failure from Drizzle starts with
 * "Failed query" and repeats the SQL and the values bound into it.
 */
const QUERY_FAILURE = 'Failed query'

export function clientMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && !error.message.startsWith(QUERY_FAILURE))
    return error.message
  return fallback
}
