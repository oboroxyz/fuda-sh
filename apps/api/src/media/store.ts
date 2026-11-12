import { IMAGE_SETS } from '@fuda/sdk'
import type { ImageSetSpec } from '@fuda/sdk'
import { and, eq, sql } from 'drizzle-orm'

import type { Db } from '../db/client.ts'
import { issuers, logoUploads } from '../db/schema.ts'
import { IMMUTABLE_CACHE_CONTROL, LOGO_UPLOAD_TTL_SECONDS, objectKey, validateImageSet } from './logo.ts'
import type { LogoRejection } from './logo.ts'

// Write the whole set under a fresh prefix. `record` runs inside the same
// rollback, so a set whose bookkeeping fails leaves no orphans behind; the
// objects are immutable, so nothing here ever overwrites a live image.
export const storeImageSet = async (
  bucket: R2Bucket,
  parts: Map<string, Uint8Array>,
  spec: ImageSetSpec,
  record: (prefix: string) => Promise<void> = async () => {
    await Promise.resolve()
  },
): Promise<{ ok: true; prefix: string } | { ok: false; reason: LogoRejection }> => {
  const checked = validateImageSet(parts, spec)
  if (!checked.ok) {
    return checked
  }
  const prefix = `${spec.prefix}/${crypto.randomUUID()}`
  const written: string[] = []
  try {
    for (const object of checked.objects) {
      const key = objectKey(prefix, object.variant)
      // oxlint-disable-next-line no-await-in-loop -- a rollback needs to know exactly which objects landed
      await bucket.put(key, object.bytes, {
        httpMetadata: { cacheControl: IMMUTABLE_CACHE_CONTROL, contentType: 'image/png' },
      })
      written.push(key)
    }
    await record(prefix)
  } catch (error) {
    await bucket.delete(written)
    throw error
  }
  return { ok: true, prefix }
}

export type StoredUpload = { ok: true; id: string; expiresAt: number } | { ok: false; reason: LogoRejection }

// A logo is staged: its row lets a later issuer write claim it, and lets the
// sweep reclaim it if nobody does.
export const storeLogoSet = async (
  bucket: R2Bucket,
  db: Db,
  p: { parts: Map<string, Uint8Array>; sessionTokenHash: string; now: number },
): Promise<StoredUpload> => {
  const id = crypto.randomUUID()
  const expiresAt = p.now + LOGO_UPLOAD_TTL_SECONDS
  const stored = await storeImageSet(bucket, p.parts, IMAGE_SETS.logo, async (assetPrefix) => {
    await db.insert(logoUploads).values({
      assetPrefix,
      createdAt: p.now,
      expiresAt,
      id,
      sessionTokenHash: p.sessionTokenHash,
      status: 'pending',
    })
  })
  return stored.ok ? { expiresAt, id, ok: true } : stored
}

// Evaluate inside the issuer write so a concurrent claim or sweep cannot
// invalidate a prefix read before the batch started.
export const pendingLogoPrefix = (p: { id: string; sessionTokenHash: string; now: number }) => sql<
  string | null
>`(SELECT asset_prefix FROM logo_uploads
  WHERE id = ${p.id} AND session_token_hash = ${p.sessionTokenHash}
    AND status = 'pending' AND expires_at > ${p.now})`

// Run after the issuer write in the same batch. Only the upload attached by
// that write is consumed; a failed write rolls the whole batch back.
export const consumeIssuerLogo = (db: Db, issuerId: string) =>
  db
    .update(logoUploads)
    .set({ status: 'committed' })
    .where(
      and(
        eq(logoUploads.status, 'pending'),
        eq(
          logoUploads.assetPrefix,
          sql`(SELECT ${issuers.logoPrefix} FROM ${issuers} WHERE ${issuers.id} = ${issuerId})`,
        ),
      ),
    )

export interface LogoObject {
  body: ArrayBuffer
  etag: string
}

export const readImageObject = async (
  bucket: R2Bucket,
  prefix: string,
  variant: string,
  spec: ImageSetSpec = IMAGE_SETS.logo,
): Promise<LogoObject | null> => {
  if (
    !new RegExp(`^${spec.prefix}/[0-9a-f-]{36}$`, 'u').test(prefix) ||
    !Object.hasOwn(spec.variants, variant)
  ) {
    return null
  }
  const object = await bucket.get(objectKey(prefix, variant))
  if (object === null) {
    return null
  }
  return { body: await object.arrayBuffer(), etag: object.httpEtag }
}

export const readLogoObject = readImageObject
