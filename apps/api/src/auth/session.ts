import { and, eq, isNull } from 'drizzle-orm'
import type { Hex } from 'viem'

import type { Db } from '../db/client.ts'
import { sessions } from '../db/schema.ts'
import { toHex } from '../hex.ts'
import type { OperatorPrincipal } from './principal.ts'

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

type SessionAudience = 'member' | 'operator'

export interface OperatorSession {
  issuerId: string | null
  principal: OperatorPrincipal
  tokenHash: string
}

export interface MemberSession {
  accountId: string
  tokenHash: string
}

export type SessionResolution<S> =
  | { kind: 'valid'; session: S }
  | { kind: 'wrong-audience' }
  | { kind: 'invalid' }

export const hashToken = async (token: string): Promise<string> =>
  toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))

// The token is shown to the operator exactly once; only its hash is stored, so
// a leaked table cannot be replayed as a bearer credential. `address` stays empty on
// a session that names an account, because the column is NOT NULL.
const insertSession = async (
  db: Db,
  p: {
    accountId: string | null
    address: string
    audience: SessionAudience
    issuerId: string | null
    now: number
  },
): Promise<string> => {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)))
  await db.insert(sessions).values({
    ...p,
    createdAt: p.now,
    expiresAt: p.now + SESSION_TTL_SECONDS,
    tokenHash: await hashToken(token),
  })
  return token
}

export const createMemberSession = async (db: Db, accountId: string, now: number): Promise<string> =>
  await insertSession(db, { accountId, address: '', audience: 'member', issuerId: null, now })

export const createOperatorSession = async (
  db: Db,
  p: { issuerId: string | null; now: number; principal: OperatorPrincipal },
): Promise<string> =>
  await insertSession(db, {
    accountId: p.principal.kind === 'account' ? p.principal.accountId : null,
    address: p.principal.kind === 'wallet' ? p.principal.address : '',
    audience: 'operator',
    issuerId: p.issuerId,
    now: p.now,
  })

const resolveRow = async (db: Db, token: string, now: number, audience: SessionAudience) => {
  const tokenHash = await hashToken(token)
  const row = await db
    .select({
      accountId: sessions.accountId,
      address: sessions.address,
      audience: sessions.audience,
      expiresAt: sessions.expiresAt,
      issuerId: sessions.issuerId,
    })
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .get()
  if (row === undefined || row.expiresAt <= now) {
    return { kind: 'invalid' as const }
  }
  return row.audience === audience
    ? { kind: 'valid' as const, row, tokenHash }
    : { kind: 'wrong-audience' as const }
}

const principalOf = (row: { accountId: string | null; address: string }): OperatorPrincipal | null => {
  if (row.accountId !== null) {
    return { accountId: row.accountId, kind: 'account' }
  }
  // Written only from ADDRESS_RE-validated, lower-cased input (handlers/auth.ts).
  const address: Hex = `0x${row.address.slice(2)}`
  return row.address === '' ? null : { address, kind: 'wallet' }
}

export const resolveOperatorSession = async (
  db: Db,
  token: string,
  now: number,
): Promise<SessionResolution<OperatorSession>> => {
  const resolved = await resolveRow(db, token, now, 'operator')
  if (resolved.kind !== 'valid') {
    return resolved
  }
  const principal = principalOf(resolved.row)
  return principal === null
    ? { kind: 'invalid' }
    : {
        kind: 'valid',
        session: { issuerId: resolved.row.issuerId, principal, tokenHash: resolved.tokenHash },
      }
}

export const resolveMemberSession = async (
  db: Db,
  token: string,
  now: number,
): Promise<SessionResolution<MemberSession>> => {
  const resolved = await resolveRow(db, token, now, 'member')
  if (resolved.kind !== 'valid') {
    return resolved
  }
  // A session from before accounts names only an address, and signs in again.
  return resolved.row.accountId === null
    ? { kind: 'invalid' }
    : { kind: 'valid', session: { accountId: resolved.row.accountId, tokenHash: resolved.tokenHash } }
}

// The issuer a session is bound to, read fresh: a create that meant to bind
// the session checks it took, since another request may have bound it first.
export const sessionIssuerId = async (db: Db, tokenHash: string): Promise<string | null> => {
  const row = await db
    .select({ issuerId: sessions.issuerId })
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .get()
  return row?.issuerId ?? null
}

export const deleteSession = async (db: Db, tokenHash: string): Promise<void> => {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash))
}

// The statement rather than its result, so the venue-create path can batch it
// with the issuer and card inserts instead of paying a second round trip. Only
// a session with no issuer yet is bound: a token never changes the issuer it
// acts for, so another tab holding it can never write to a different one
// (../../../../docs/specs/pass-types-and-flows.md#issuer-onboarding-and-the-handle-route).
export const attachIssuer = (db: Db, tokenHash: string, issuerId: string) =>
  db
    .update(sessions)
    .set({ issuerId })
    .where(
      and(eq(sessions.tokenHash, tokenHash), eq(sessions.audience, 'operator'), isNull(sessions.issuerId)),
    )
