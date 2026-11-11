import { and, eq, sql } from 'drizzle-orm'

import type { Db } from '../db/client.ts'
import { issuers, logoUploads } from '../db/schema.ts'
import {
  IMMUTABLE_CACHE_CONTROL,
  isLogoPrefix,
  LOGO_UPLOAD_TTL_SECONDS,
  objectKey,
  validateLogoSet,
} from './logo.ts'
import type { LogoRejection, LogoVariant } from './logo.ts'

export type StoredUpload = { ok: true; id: string; expiresAt: number } | { ok: false; reason: LogoRejection }

// Write the whole set, then stage it. A partial write is rolled back so a
// failed upload leaves no orphans behind; the objects are immutable, so
// nothing here ever overwrites a live logo.
export const storeLogoSet = async (
  bucket: R2Bucket,
  db: Db,
  p: { parts: Map<string, Uint8Array>; sessionTokenHash: string; now: number },
): Promise<StoredUpload> => {
  const checked = validateLogoSet(p.parts)
  if (!checked.ok) {
    return checked
  }
  const prefix = `logos/${crypto.randomUUID()}`
  const written: string[] = []
  const id = crypto.randomUUID()
  const expiresAt = p.now + LOGO_UPLOAD_TTL_SECONDS
  try {
    for (const object of checked.objects) {
      const key = objectKey(prefix, object.variant)
      // oxlint-disable-next-line no-await-in-loop -- a rollback needs to know exactly which objects landed
      await bucket.put(key, object.bytes, {
        httpMetadata: { cacheControl: IMMUTABLE_CACHE_CONTROL, contentType: 'image/png' },
      })
      written.push(key)
    }
    await db.insert(logoUploads).values({
      assetPrefix: prefix,
      createdAt: p.now,
      expiresAt,
      id,
      sessionTokenHash: p.sessionTokenHash,
      status: 'pending',
    })
  } catch (error) {
    await bucket.delete(written)
    throw error
  }
  return { expiresAt, id, ok: true }
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

export const readLogoObject = async (
  bucket: R2Bucket,
  prefix: string,
  variant: LogoVariant,
): Promise<LogoObject | null> => {
  if (!isLogoPrefix(prefix)) {
    return null
  }
  const object = await bucket.get(objectKey(prefix, variant))
  if (object === null) {
    return null
  }
  return { body: await object.arrayBuffer(), etag: object.httpEtag }
}
