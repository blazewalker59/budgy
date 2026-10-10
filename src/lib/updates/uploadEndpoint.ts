/**
 * `/api/updates/upload`: where the iPhone share-sheet Shortcut sends an
 * Account's CSV export (docs/adr/0010). The body is the raw CSV, with an
 * upload token as `Authorization: Bearer bu_…`. The same normalizer and
 * ingestion path as a browser upload, committed without a preview.
 */
import { eq } from 'drizzle-orm'
import { UPLOAD_TOKEN_PATTERN, verifyUploadToken } from './uploads'
import { ingestAccountExport } from './ingest'
import { BodyTooLarge, readLimited } from './http'
import { MAX_EXPORT_BYTES } from './exports'
import type { CloudflareEnv } from '@/lib/db'
import { dbFromD1 } from '@/lib/db'
import { uploadTokens } from '@/lib/db/schema'
import { canSignIn, canUseHousehold } from '@/lib/households/admission'
import { householdDatabase } from '@/lib/households/scope'

/** Shortcuts label a CSV many ways; the normalizer is what checks it. */
const NOT_A_FILE = [
  'application/json',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
]

/** Plain text, so a Shortcut can show the reply as a notification. */
function reply(message: string, status = 200) {
  return new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export async function serveUpload(
  request: Request,
  env: CloudflareEnv,
): Promise<Response> {
  if (request.method !== 'POST')
    return new Response('Method not allowed', {
      status: 405,
      headers: { allow: 'POST' },
    })
  // Shortcuts send no Origin; a page on another site never may upload.
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin)
    return reply('Forbidden', 403)

  const token = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get('authorization') ?? '',
  )?.[1]
  const db = dbFromD1(env.DB)
  const uploader =
    token && UPLOAD_TOKEN_PATTERN.test(token)
      ? await verifyUploadToken(db, token)
      : null
  if (
    !uploader ||
    !(await canSignIn(db, uploader.memberEmail, env.ALLOWED_EMAILS)) ||
    !(await canUseHousehold(
      db,
      uploader.memberEmail,
      uploader.householdId,
      env.ALLOWED_EMAILS,
    ))
  )
    return reply(
      'This Shortcut’s token was revoked or is invalid. Make a new one in Accounts → Updates.',
      401,
    )

  const type = request.headers
    .get('content-type')
    ?.split(';')[0]
    .trim()
    .toLowerCase()
  if (type && NOT_A_FILE.includes(type))
    return reply('Send the CSV file itself as the request body.', 415)
  let text: string
  try {
    text = await readLimited(request.body, MAX_EXPORT_BYTES)
  } catch (error) {
    return error instanceof BodyTooLarge
      ? reply('That file is over 2 MB. Choose a smaller CSV export.', 413)
      : reply('That file isn’t a readable CSV export.', 400)
  }

  try {
    const { summary } = await ingestAccountExport(
      householdDatabase(db, uploader.householdId),
      {
        account: uploader.account,
        format: uploader.format,
        text,
        commit: true,
      },
      `${uploader.memberEmail} via Shortcut`,
      'shortcut',
    )
    await db
      .update(uploadTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(uploadTokens.id, uploader.id))
    const present = summary.alreadyHad + summary.duplicates.length
    // Write-only: report counts, never purchases, filing or balances.
    return reply(
      `${uploader.account}: ${summary.added} added, ${present} already in Budgy, ${summary.notSpending} not spending.` +
        (summary.review.length
          ? ` ${summary.review.length} need review in Accounts → Updates.`
          : ''),
    )
  } catch (error) {
    // Ingestion messages are written for Members (bad rows, busy Account);
    // a database failure's message would echo SQL and values, so it doesn't.
    const message =
      error instanceof Error && !error.message.startsWith('Failed query')
        ? error.message
        : 'The update didn’t finish. Try again.'
    return reply(`${uploader.account} wasn’t updated. ${message}`, 422)
  }
}
