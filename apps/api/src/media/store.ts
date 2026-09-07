import { and, eq, lt } from 'drizzle-orm'

import type { Db } from '../db/client.ts'
import { logoUploads } from '../db/schema.ts'
import { isLogoPrefix, LOGO_UPLOAD_TTL_SECONDS, objectKey, validateLogoSet } from './logo.ts'
import type { LogoRejection, LogoVariant } from './logo.ts'

const IMMUTABLE = 'public, max-age=31536000, immutable'

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
  try {
    for (const object of checked.objects) {
      const key = objectKey(prefix, object.variant)
      // oxlint-disable-next-line no-await-in-loop -- a rollback needs to know exactly which objects landed
      await bucket.put(key, object.bytes, {
        httpMetadata: { cacheControl: IMMUTABLE, contentType: 'image/png' },
      })
      written.push(key)
    }
  } catch (error) {
    await Promise.all(
      written.map(async (key): Promise<void> => {
        await bucket.delete(key)
      }),
    )
    throw error
  }
  const id = crypto.randomUUID()
  const expiresAt = p.now + LOGO_UPLOAD_TTL_SECONDS
  await db.batch([
    db.delete(logoUploads).where(lt(logoUploads.expiresAt, p.now)),
    db.insert(logoUploads).values({
      assetPrefix: prefix,
      createdAt: p.now,
      expiresAt,
      id,
      sessionTokenHash: p.sessionTokenHash,
      status: 'pending',
    }),
  ])
  return { expiresAt, id, ok: true }
}

// The staged prefix, or null when the id is unknown, expired, already spent,
// or belongs to someone else's session. Marking it committed is the same
// statement, so two requests cannot both claim one upload.
export const claimLogoUpload = async (
  db: Db,
  p: { id: string; sessionTokenHash: string; now: number },
): Promise<string | null> => {
  const row = await db
    .select({ assetPrefix: logoUploads.assetPrefix })
    .from(logoUploads)
    .where(
      and(
        eq(logoUploads.id, p.id),
        eq(logoUploads.sessionTokenHash, p.sessionTokenHash),
        eq(logoUploads.status, 'pending'),
      ),
    )
    .get()
  if (row === undefined || !isLogoPrefix(row.assetPrefix)) {
    return null
  }
  const claimed = await db
    .update(logoUploads)
    .set({ status: 'committed' })
    .where(and(eq(logoUploads.id, p.id), eq(logoUploads.status, 'pending')))
    .run()
  return claimed.meta.changes > 0 ? row.assetPrefix : null
}

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
