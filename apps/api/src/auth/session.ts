import { and, eq } from 'drizzle-orm'
import type { Hex } from 'viem'

import type { Db } from '../db/client.ts'
import { sessions } from '../db/schema.ts'
import { toHex } from '../hex.ts'

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

export type SessionAudience = 'member' | 'operator'

export interface Session {
  address: Hex
  issuerId: string | null
  tokenHash: string
}

export type OperatorSession = Session
export type MemberSession = Session

export type SessionResolution =
  | { kind: 'valid'; session: Session }
  | { kind: 'wrong-audience' }
  | { kind: 'invalid' }

export const hashToken = async (token: string): Promise<string> =>
  toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))

// The token is shown to the operator exactly once; only its hash is stored, so
// a leaked table cannot be replayed as a bearer credential.
export const createSession = async (
  db: Db,
  p: { address: Hex; audience: SessionAudience; issuerId: string | null; now: number },
): Promise<string> => {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)))
  await db.insert(sessions).values({
    address: p.address,
    audience: p.audience,
    createdAt: p.now,
    expiresAt: p.now + SESSION_TTL_SECONDS,
    issuerId: p.issuerId,
    tokenHash: await hashToken(token),
  })
  return token
}

export const resolveSession = async (
  db: Db,
  token: string,
  now: number,
  audience: SessionAudience,
): Promise<SessionResolution> => {
  const tokenHash = await hashToken(token)
  const row = await db
    .select({
      address: sessions.address,
      audience: sessions.audience,
      expiresAt: sessions.expiresAt,
      issuerId: sessions.issuerId,
    })
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .get()
  if (row === undefined) {
    return { kind: 'invalid' }
  }
  if (row.audience !== audience) {
    return { kind: 'wrong-audience' }
  }
  if (row.expiresAt <= now) {
    return { kind: 'invalid' }
  }
  // Written only from ADDRESS_RE-validated, lower-cased input (sign-in.ts).
  const address: Hex = `0x${row.address.slice(2)}`
  return { kind: 'valid', session: { address, issuerId: row.issuerId, tokenHash } }
}

export const deleteSession = async (db: Db, tokenHash: string): Promise<void> => {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash))
}

// The statement rather than its result, so the venue-create path can batch it
// with the issuer and card inserts instead of paying a second round trip.
export const attachIssuer = (db: Db, tokenHash: string, issuerId: string) =>
  db
    .update(sessions)
    .set({ issuerId })
    .where(and(eq(sessions.tokenHash, tokenHash), eq(sessions.audience, 'operator')))
