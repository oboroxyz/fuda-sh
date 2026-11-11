import { CONNECTED_APP_SCOPES, normalizeRedirectUri } from '@fuda/sdk'
import type {
  ConnectedAppEventView,
  ConnectedAppGrantView,
  ConnectedAppRequest,
  ConnectedAppScope,
  ConnectedAppView,
} from '@fuda/sdk'
import { and, asc, desc, eq, exists, gt, inArray, isNull, lt, sql } from 'drizzle-orm'

import { hashToken } from '../auth/session.ts'
import { base64UrlOf } from '../base64url.ts'
import type { Db } from '../db/client.ts'
import {
  connectedAppEvents,
  connectedAppRedirects,
  connectedApps,
  issuers,
  oauthCodes,
  oauthTokens,
} from '../db/schema.ts'
import { toHex } from '../hex.ts'
import { issuerOwnerKey, ownerKeyOf } from '../issuers/queries.ts'
import { issuerSummary } from '../issuers/views.ts'

// docs/specs/connected-apps.md#lifetimes
const CODE_TTL_SECONDS = 10 * 60
const ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
const APPS_PER_OWNER = 20
// How stale "last used" may be, so that using a token does not mean a D1 write
// on every request.
const LAST_USED_PRECISION_SECONDS = 60 * 60
const EVENTS_LISTED = 50

// The prefix makes a leaked token recognisable in a log or a secret scanner;
// only the hash is stored, as for sessions.
const ACCESS_TOKEN_PREFIX = 'fuda_at_'

const randomHex = (bytes: number): string => toHex(crypto.getRandomValues(new Uint8Array(bytes)))

type IssuerRow = typeof issuers.$inferSelect

// Stored as the space-separated OAuth form, read back in canonical order.
const scopeList = (stored: string): ConnectedAppScope[] =>
  CONNECTED_APP_SCOPES.filter((scope) => stored.split(' ').includes(scope))

const appView = (
  row: typeof connectedApps.$inferSelect,
  redirects: readonly (typeof connectedAppRedirects.$inferSelect)[],
): ConnectedAppView => ({
  clientId: row.clientId,
  createdAt: row.createdAt,
  name: row.name,
  redirectUris: redirects.filter((r) => r.clientId === row.clientId).map((r) => r.redirectUri),
})

const redirectsOf = async (
  db: Db,
  clientIds: readonly string[],
): Promise<(typeof connectedAppRedirects.$inferSelect)[]> =>
  clientIds.length === 0
    ? []
    : await db
        .select()
        .from(connectedAppRedirects)
        .where(inArray(connectedAppRedirects.clientId, [...clientIds]))
        .orderBy(asc(connectedAppRedirects.redirectUri))

export const listApps = async (db: Db, owner: string): Promise<ConnectedAppView[]> => {
  const rows = await db
    .select()
    .from(connectedApps)
    .where(eq(connectedApps.ownerAddress, owner))
    .orderBy(asc(connectedApps.createdAt), asc(connectedApps.clientId))
  const redirects = await redirectsOf(
    db,
    rows.map((row) => row.clientId),
  )
  return rows.map((row) => appView(row, redirects))
}

export const findApp = async (
  db: Db,
  clientId: string,
): Promise<(ConnectedAppView & { owner: string }) | null> => {
  const row = await db.select().from(connectedApps).where(eq(connectedApps.clientId, clientId)).get()
  if (row === undefined) {
    return null
  }
  return { ...appView(row, await redirectsOf(db, [row.clientId])), owner: row.ownerAddress }
}

// null when the owner already has APPS_PER_OWNER apps.
export const registerApp = async (
  db: Db,
  owner: string,
  input: ConnectedAppRequest,
  now: number,
): Promise<ConnectedAppView | null> => {
  const clientId = `app_${randomHex(16)}`
  const redirects = input.redirectUris.flatMap((raw) => {
    const redirectUri = normalizeRedirectUri(raw)
    return redirectUri === null ? [] : [{ clientId, origin: new URL(redirectUri).origin, redirectUri }]
  })
  const [inserted] = await db.batch([
    db
      .insert(connectedApps)
      .select(sql`
      SELECT ${clientId}, ${now}, ${input.name}, ${owner}
      WHERE (SELECT count(*) FROM ${connectedApps} WHERE ${connectedApps.ownerAddress} = ${owner}) < ${APPS_PER_OWNER}
    `)
      .returning({ clientId: connectedApps.clientId }),
    ...redirects.map((redirect) =>
      db.insert(connectedAppRedirects).select(sql`
      SELECT ${clientId}, ${redirect.origin}, ${redirect.redirectUri}
      WHERE EXISTS (SELECT 1 FROM ${connectedApps} WHERE ${connectedApps.clientId} = ${clientId})
    `),
    ),
  ])
  if (inserted.length === 0) {
    return null
  }
  return {
    clientId,
    createdAt: now,
    name: input.name,
    redirectUris: redirects.map((r) => r.redirectUri).toSorted(),
  }
}

// Deleting an app ends every code and token it holds, in the same batch.
export const deleteApp = async (db: Db, owner: string, clientId: string): Promise<boolean> => {
  const owned = await db
    .select({ clientId: connectedApps.clientId })
    .from(connectedApps)
    .where(and(eq(connectedApps.clientId, clientId), eq(connectedApps.ownerAddress, owner)))
    .get()
  if (owned === undefined) {
    return false
  }
  await db.batch([
    db.delete(oauthCodes).where(eq(oauthCodes.clientId, clientId)),
    db.delete(oauthTokens).where(eq(oauthTokens.clientId, clientId)),
    db.delete(connectedAppRedirects).where(eq(connectedAppRedirects.clientId, clientId)),
    db.delete(connectedApps).where(eq(connectedApps.clientId, clientId)),
  ])
  return true
}

// Whether any registered app redirects to this origin (the CORS allowlist).
export const isRegisteredOrigin = async (db: Db, origin: string): Promise<boolean> =>
  (await db
    .select({ clientId: connectedAppRedirects.clientId })
    .from(connectedAppRedirects)
    .where(eq(connectedAppRedirects.origin, origin))
    .get()) !== undefined

export const appHasOrigin = async (db: Db, clientId: string, origin: string): Promise<boolean> =>
  (await db
    .select({ clientId: connectedAppRedirects.clientId })
    .from(connectedAppRedirects)
    .where(and(eq(connectedAppRedirects.clientId, clientId), eq(connectedAppRedirects.origin, origin)))
    .get()) !== undefined

export const mintCode = async (
  db: Db,
  p: {
    address: string
    clientId: string
    codeChallenge: string
    issuerId: string
    now: number
    redirectUri: string
    resource: string | null
    scope: readonly ConnectedAppScope[]
  },
): Promise<string> => {
  const code = randomHex(32)
  await db.batch([
    db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, p.now)),
    db.insert(oauthCodes).values({
      address: p.address,
      clientId: p.clientId,
      codeChallenge: p.codeChallenge,
      codeHash: await hashToken(code),
      createdAt: p.now,
      expiresAt: p.now + CODE_TTL_SECONDS,
      issuerId: p.issuerId,
      redirectUri: p.redirectUri,
      resource: p.resource,
      scope: p.scope.join(' '),
    }),
  ])
  return code
}

// RFC 7636 §4.6, S256: BASE64URL(SHA256(verifier)) must equal the challenge.
export const pkceChallenge = async (verifier: string): Promise<string> =>
  base64UrlOf(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))

export interface IssuedToken {
  accessToken: string
  expiresIn: number
  issuer: IssuerRow
  scope: ConnectedAppScope[]
}

// Spends the code first, so a second redemption finds nothing whatever the
// outcome of the first: a code is single-use even when its verifier was wrong.
// A second redemption also ends the token the first one issued, because one of
// the two callers should not have had the code (RFC 6749 §4.1.2). A new token
// replaces the live ones for the same app, Issuer and resource.
// `resource` is what the token request named, if anything; the token always
// carries what was approved.
export const redeemCode = async (
  db: Db,
  p: {
    clientId: string
    code: string
    codeVerifier: string
    now: number
    redirectUri: string
    resource: string | undefined
  },
): Promise<IssuedToken | null> => {
  const codeHash = await hashToken(p.code)
  const spent = await db
    .update(oauthCodes)
    .set({ usedAt: p.now })
    .where(and(eq(oauthCodes.codeHash, codeHash), isNull(oauthCodes.usedAt), gt(oauthCodes.expiresAt, p.now)))
    .returning()
    .get()
  if (spent === undefined) {
    await db.batch([
      db.update(oauthCodes).set({ replayedAt: p.now }).where(eq(oauthCodes.codeHash, codeHash)),
      db
        .update(oauthTokens)
        .set({ revokedAt: p.now })
        .where(and(eq(oauthTokens.codeHash, codeHash), isNull(oauthTokens.revokedAt))),
    ])
    return null
  }
  if (
    spent.clientId !== p.clientId ||
    spent.redirectUri !== p.redirectUri ||
    (p.resource !== undefined && spent.resource !== p.resource) ||
    spent.codeChallenge !== (await pkceChallenge(p.codeVerifier))
  ) {
    return null
  }
  const issuer = await db.select().from(issuers).where(eq(issuers.id, spent.issuerId)).get()
  // The issuer may have moved to another owner since approval; the code was
  // the old owner's consent, not the new one's.
  if (issuer === undefined || ownerKeyOf(issuer) !== spent.address) {
    return null
  }
  const accessToken = `${ACCESS_TOKEN_PREFIX}${randomHex(32)}`
  const [, inserted] = await db.batch([
    db
      .update(oauthTokens)
      .set({ revokedAt: p.now })
      .where(
        and(
          eq(oauthTokens.clientId, spent.clientId),
          eq(oauthTokens.issuerId, spent.issuerId),
          eq(oauthTokens.address, spent.address),
          spent.resource === null ? isNull(oauthTokens.resource) : eq(oauthTokens.resource, spent.resource),
          isNull(oauthTokens.revokedAt),
        ),
      ),
    // A replay can arrive after spending the code and before this batch.
    db
      .insert(oauthTokens)
      .select(
        db
          .select({
            address: oauthCodes.address,
            clientId: oauthCodes.clientId,
            codeHash: oauthCodes.codeHash,
            createdAt: sql<number>`${p.now}`.as('created_at'),
            expiresAt: sql<number>`${p.now + ACCESS_TOKEN_TTL_SECONDS}`.as('expires_at'),
            id: sql<string>`${crypto.randomUUID()}`.as('id'),
            issuerId: oauthCodes.issuerId,
            lastUsedAt: sql<null>`NULL`.as('last_used_at'),
            resource: oauthCodes.resource,
            revokedAt: sql<null>`NULL`.as('revoked_at'),
            scope: oauthCodes.scope,
            tokenHash: sql<string>`${await hashToken(accessToken)}`.as('token_hash'),
          })
          .from(oauthCodes)
          .where(and(eq(oauthCodes.codeHash, codeHash), isNull(oauthCodes.replayedAt))),
      )
      .returning({ id: oauthTokens.id }),
  ])
  if (inserted.length === 0) {
    return null
  }
  return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, issuer, scope: scopeList(spent.scope) }
}

export interface AccessGrant {
  address: string
  clientId: string
  id: string
  issuerId: string
  // the MCP server this token is for; null for the /v1/connect routes
  resource: string | null
  scope: ConnectedAppScope[]
}

const liveToken = (now: number) =>
  and(isNull(oauthTokens.revokedAt), gt(oauthTokens.expiresAt, now), eq(issuerOwnerKey, oauthTokens.address))

// A live token whose issuer is still owned by the principal that approved it.
export const resolveAccessToken = async (db: Db, token: string, now: number): Promise<AccessGrant | null> => {
  const row = await db
    .select({
      address: oauthTokens.address,
      clientId: oauthTokens.clientId,
      id: oauthTokens.id,
      issuerId: oauthTokens.issuerId,
      lastUsedAt: oauthTokens.lastUsedAt,
      resource: oauthTokens.resource,
      scope: oauthTokens.scope,
    })
    .from(oauthTokens)
    .innerJoin(issuers, eq(issuers.id, oauthTokens.issuerId))
    .where(and(eq(oauthTokens.tokenHash, await hashToken(token)), liveToken(now)))
    .get()
  if (row === undefined) {
    return null
  }
  const { lastUsedAt, ...grant } = row
  if (lastUsedAt === null || lastUsedAt <= now - LAST_USED_PRECISION_SECONDS) {
    await db.update(oauthTokens).set({ lastUsedAt: now }).where(eq(oauthTokens.id, grant.id))
  }
  return { ...grant, scope: scopeList(grant.scope) }
}

// RFC 7009: the app ends its own token. Unknown tokens are not an error.
export const revokeByToken = async (db: Db, token: string, clientId: string, now: number): Promise<void> => {
  await db
    .update(oauthTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(oauthTokens.tokenHash, await hashToken(token)),
        eq(oauthTokens.clientId, clientId),
        isNull(oauthTokens.revokedAt),
      ),
    )
}

export const listGrants = async (
  db: Db,
  address: string,
  now: number,
  baseUrl: string,
): Promise<ConnectedAppGrantView[]> => {
  const rows = await db
    .select({ app: connectedApps, issuer: issuers, token: oauthTokens })
    .from(oauthTokens)
    .innerJoin(connectedApps, eq(connectedApps.clientId, oauthTokens.clientId))
    .innerJoin(issuers, eq(issuers.id, oauthTokens.issuerId))
    .where(and(eq(oauthTokens.address, address), liveToken(now)))
    .orderBy(desc(oauthTokens.createdAt), asc(oauthTokens.id))
  return rows.map(({ app, issuer, token }) => ({
    appName: app.name,
    clientId: app.clientId,
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
    id: token.id,
    issuer: issuerSummary(issuer, baseUrl),
    lastUsedAt: token.lastUsedAt,
    scope: scopeList(token.scope),
  }))
}

export const revokeGrant = async (db: Db, address: string, id: string, now: number): Promise<boolean> => {
  const revoked = await db
    .update(oauthTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(oauthTokens.id, id),
        eq(oauthTokens.address, address),
        exists(
          db
            .select({ id: issuers.id })
            .from(issuers)
            .where(and(eq(issuers.id, oauthTokens.issuerId), liveToken(now))),
        ),
      ),
    )
    .returning({ id: oauthTokens.id })
    .get()
  return revoked !== undefined
}

// One attempted write by an approved app. The write has already happened by
// now, on chain perhaps, so a failure to record it must not turn it into an error.
export const recordEvent = async (
  db: Db,
  grant: AccessGrant,
  event: { action: string; error: string | null; now: number; subject: string | null },
): Promise<void> => {
  try {
    const app = await db
      .select({ name: connectedApps.name })
      .from(connectedApps)
      .where(eq(connectedApps.clientId, grant.clientId))
      .get()
    await db.insert(connectedAppEvents).values({
      action: event.action,
      address: grant.address,
      appName: app?.name ?? grant.clientId,
      clientId: grant.clientId,
      createdAt: event.now,
      error: event.error,
      id: crypto.randomUUID(),
      issuerId: grant.issuerId,
      subject: event.subject,
      tokenId: grant.id,
    })
  } catch (error) {
    // oxlint-disable-next-line no-console -- a lost record must be visible in the Worker's logs
    console.error('[fuda-api] could not record a connected-app event', event.action, error)
  }
}

export const listEvents = async (db: Db, address: string): Promise<ConnectedAppEventView[]> => {
  const rows = await db
    .select({ event: connectedAppEvents, handle: issuers.handle })
    .from(connectedAppEvents)
    .leftJoin(issuers, eq(issuers.id, connectedAppEvents.issuerId))
    .where(eq(connectedAppEvents.address, address))
    .orderBy(desc(connectedAppEvents.createdAt), asc(connectedAppEvents.id))
    .limit(EVENTS_LISTED)
  return rows.map(({ event, handle }) => ({
    action: event.action,
    appName: event.appName,
    createdAt: event.createdAt,
    error: event.error,
    id: event.id,
    issuerHandle: handle,
    subject: event.subject,
  }))
}
