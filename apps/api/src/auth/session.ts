import { and, eq, gt } from 'drizzle-orm'
import type { Hex } from 'viem'

import type { Db } from '../db/client.ts'
import { sessions } from '../db/schema.ts'

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

export interface OperatorSession {
  address: Hex
  issuerId: string | null
  tokenHash: string
}

const toHex = (bytes: Uint8Array): string => {
  let hex = ''
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0')
  }
  return hex
}

export const hashToken = async (token: string): Promise<string> =>
  toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))

// The token is shown to the operator exactly once; only its hash is stored, so
// a leaked table cannot be replayed as a bearer credential.
export const createSession = async (
  db: Db,
  p: { address: Hex; issuerId: string | null; now: number },
): Promise<string> => {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)))
  await db.insert(sessions).values({
    address: p.address,
    createdAt: p.now,
    expiresAt: p.now + SESSION_TTL_SECONDS,
    issuerId: p.issuerId,
    tokenHash: await hashToken(token),
  })
  return token
}

export const resolveSession = async (db: Db, token: string, now: number): Promise<OperatorSession | null> => {
  const tokenHash = await hashToken(token)
  const row = await db
    .select({ address: sessions.address, issuerId: sessions.issuerId })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .get()
  if (row === undefined) {
    return null
  }
  // Written only from ADDRESS_RE-validated, lower-cased input (sign-in.ts).
  const address: Hex = `0x${row.address.slice(2)}`
  return { address, issuerId: row.issuerId, tokenHash }
}

export const deleteSession = async (db: Db, tokenHash: string): Promise<void> => {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash))
}

export const attachIssuer = async (db: Db, tokenHash: string, issuerId: string): Promise<void> => {
  await db.update(sessions).set({ issuerId }).where(eq(sessions.tokenHash, tokenHash))
}
