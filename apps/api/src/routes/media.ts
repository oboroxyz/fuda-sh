import { isIssuerHandle } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import * as v from 'valibot'

import { issuers } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { issuerView } from '../issuers/views.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import {
  IMMUTABLE_CACHE_CONTROL,
  isLogoVariant,
  LOGO_VARIANTS,
  logoVersion,
  MAX_LOGO_SET_BYTES,
} from '../media/logo.ts'
import { claimLogoUpload, readLogoObject, storeLogoSet } from '../media/store.ts'
import { operatorAuth } from '../middleware/operator-auth.ts'

const CommitBody = v.object({ logoUploadId: v.pipe(v.string(), v.minLength(1)) })

export const mediaRoutes = new Hono<AppEnv>()

const partsOf = async (request: Request): Promise<Map<string, Uint8Array> | null> => {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return null
  }
  interface LogoPart {
    file: File
    variant: string
  }

  // FormData yields a string or a File, and only a File carries bytes.
  const asPart = (variant: string): LogoPart | null => {
    const value = form.get(variant)
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the FormData contract offers no other discriminator
    return value === null || typeof value === 'string' ? null : { file: value, variant }
  }

  const files = LOGO_VARIANTS.map(asPart).filter((part): part is LogoPart => part !== null)
  // The set cap is applied to the declared sizes first, so a hostile body is
  // refused before the isolate reads a single byte of it.
  if (files.reduce((sum, part) => sum + part.file.size, 0) > MAX_LOGO_SET_BYTES) {
    return null
  }
  const read = await Promise.all(
    files.map(async (part) => ({
      bytes: new Uint8Array(await part.file.arrayBuffer()),
      variant: part.variant,
    })),
  )
  return new Map(read.map((entry) => [entry.variant, entry.bytes]))
}

// Stages a venue logo. The venue may not exist yet — the first logo is chosen
// in the same form that creates it — so the upload is committed later, by
// POST /issuers or the commit route below.
mediaRoutes.post('/issuers/logo', operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const bucket = c.env.MEDIA_BUCKET
  if (bucket === undefined) {
    return errorResponse(c, 'media_not_configured', 501)
  }
  const parts = await partsOf(c.req.raw)
  if (parts === null) {
    return errorResponse(c, 'bad_upload', 400)
  }
  const stored = await storeLogoSet(bucket, c.get('db'), {
    now: c.get('now')(),
    parts,
    sessionTokenHash: c.get('operator').tokenHash,
  })
  if (!stored.ok) {
    return errorResponse(c, 'bad_upload', 400)
  }
  return jsonResponse(c, { expiresAt: stored.expiresAt, logoUploadId: stored.id }, 201)
})

// Points an existing venue at a staged upload.
mediaRoutes.post('/issuers/logo/commit', operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(CommitBody, body)
  const { issuerId, tokenHash } = c.get('operator')
  if (!parsed.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  const id = parsed.output.logoUploadId
  if (issuerId === null) {
    return errorResponse(c, 'not_found', 404)
  }
  const db = c.get('db')
  const prefix = await claimLogoUpload(db, { id, now: c.get('now')(), sessionTokenHash: tokenHash })
  if (prefix === null) {
    return errorResponse(c, 'upload_not_found', 400)
  }
  await db.update(issuers).set({ logoPrefix: prefix }).where(eq(issuers.id, issuerId))
  const row = await db.select().from(issuers).where(eq(issuers.id, issuerId)).get()
  return row === undefined
    ? errorResponse(c, 'not_found', 404)
    : jsonResponse(c, { issuer: issuerView(row, c.env.API_BASE_URL) })
})

// Public: the venue's mark. The key is resolved from the issuer row against a
// fixed variant list, so no caller-supplied path ever reaches R2.
mediaRoutes.get('/assets/:handle/logo/:variant', async (c) => {
  const handle = c.req.param('handle')
  const variant = c.req.param('variant')
  const bucket = c.env.MEDIA_BUCKET
  if (bucket === undefined || !isIssuerHandle(handle) || !isLogoVariant(variant)) {
    return errorResponse(c, 'not_found', 404)
  }
  const row = await c
    .get('db')
    .select({ logoPrefix: issuers.logoPrefix })
    .from(issuers)
    .where(eq(issuers.handle, handle))
    .get()
  if (row?.logoPrefix === undefined || row.logoPrefix === null) {
    return errorResponse(c, 'not_found', 404)
  }
  const object = await readLogoObject(bucket, row.logoPrefix, variant)
  if (object === null) {
    return errorResponse(c, 'not_found', 404)
  }
  // The route is keyed by handle, not by the object prefix, so the URL alone
  // does not say which mark it is: a link printed before a change points at
  // the same address as one printed after. Only a request that names the
  // current version may be cached forever; anything else — an old link, or a
  // client that built the URL itself — gets a short life so a replaced logo
  // corrects itself instead of persisting for a year.
  const versioned = c.req.query('v') === logoVersion(row.logoPrefix)
  const cacheControl = versioned ? IMMUTABLE_CACHE_CONTROL : 'public, max-age=60'
  if (c.req.header('if-none-match') === object.etag) {
    return new Response(null, { headers: { 'cache-control': cacheControl, etag: object.etag }, status: 304 })
  }
  return new Response(object.body, {
    headers: { 'cache-control': cacheControl, 'content-type': 'image/png', etag: object.etag },
  })
})
