import { CONNECTED_APP_SCOPES, normalizeRedirectUri } from '@fuda/sdk'
import type {
  ConnectedAppGrantView,
  ConnectedAppRequest,
  ConnectedAppScope,
  ConnectedAppView,
  ConnectedIssuerView,
} from '@fuda/sdk'
import { and, asc, count, desc, eq, gt, inArray, isNull, lt } from 'drizzle-orm'

import { hashToken } from '../auth/session.ts'
import type { Db } from '../db/client.ts'
import { connectedAppRedirects, connectedApps, issuers, oauthCodes, oauthTokens } from '../db/schema.ts'
import { toHex } from '../hex.ts'
import { logoUrlFor } from '../media/logo.ts'

// docs/specs/connected-apps.md#lifetimes
export const CODE_TTL_SECONDS = 10 * 60
export const ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
export const APPS_PER_OWNER = 20

// The prefix makes a leaked token recognisable in a log or a secret scanner;
// only the hash is stored, as for sessions.
const ACCESS_TOKEN_PREFIX = 'fuda_at_'

const randomHex = (bytes: number): string => toHex(crypto.getRandomValues(new Uint8Array(bytes)))

type IssuerRow = typeof issuers.$inferSelect

export const connectedIssuerView = (row: IssuerRow, baseUrl: string): ConnectedIssuerView => ({
  handle: row.handle,
  id: row.id,
  logoUrl: logoUrlFor(baseUrl, row.handle, row.logoPrefix),
  name: row.name,
})

// Stored as the space-separated OAuth form, read back in canonical order.
export const scopeList = (stored: string): ConnectedAppScope[] =>
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
  const owned = await db
    .select({ n: count() })
    .from(connectedApps)
    .where(eq(connectedApps.ownerAddress, owner))
    .get()
  if ((owned?.n ?? 0) >= APPS_PER_OWNER) {
    return null
  }
  const clientId = `app_${randomHex(16)}`
  const redirects = input.redirectUris.flatMap((raw) => {
    const redirectUri = normalizeRedirectUri(raw)
    return redirectUri === null ? [] : [{ clientId, origin: new URL(redirectUri).origin, redirectUri }]
  })
  // At most CONNECTED_APP_REDIRECT_URI_MAX rows of three values: far below
  // D1's 100-parameter limit for one statement.
  await db.batch([
    db.insert(connectedApps).values({ clientId, createdAt: now, name: input.name, ownerAddress: owner }),
    db.insert(connectedAppRedirects).values(redirects),
  ])
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

// Every issuer the signed-in address owns, for the consent screen's choice.
// Read as a list so the screen is already right when one account holds several.
export const issuersOwnedBy = async (db: Db, address: string): Promise<IssuerRow[]> =>
  await db
    .select()
    .from(issuers)
    .where(eq(issuers.operatorAddress, address))
    .orderBy(asc(issuers.createdAt), asc(issuers.id))

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
      scope: p.scope.join(' '),
    }),
  ])
  return code
}

const base64Url = (bytes: ArrayBuffer): string =>
  btoa(String.fromCodePoint(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')

// RFC 7636 §4.6, S256: BASE64URL(SHA256(verifier)) must equal the challenge.
export const pkceChallenge = async (verifier: string): Promise<string> =>
  base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))

export interface IssuedToken {
  accessToken: string
  expiresIn: number
  issuer: IssuerRow
  scope: ConnectedAppScope[]
}

// Spends the code first, so a second redemption finds nothing whatever the
// outcome of the first: a code is single-use even when its verifier was wrong.
export const redeemCode = async (
  db: Db,
  p: { clientId: string; code: string; codeVerifier: string; now: number; redirectUri: string },
): Promise<IssuedToken | null> => {
  const spent = await db
    .update(oauthCodes)
    .set({ usedAt: p.now })
    .where(
      and(
        eq(oauthCodes.codeHash, await hashToken(p.code)),
        isNull(oauthCodes.usedAt),
        gt(oauthCodes.expiresAt, p.now),
      ),
    )
    .returning()
    .get()
  if (
    spent === undefined ||
    spent.clientId !== p.clientId ||
    spent.redirectUri !== p.redirectUri ||
    spent.codeChallenge !== (await pkceChallenge(p.codeVerifier))
  ) {
    return null
  }
  const issuer = await db.select().from(issuers).where(eq(issuers.id, spent.issuerId)).get()
  // The issuer may have moved to another owner since approval; the code was
  // the old owner's consent, not the new one's.
  if (issuer === undefined || issuer.operatorAddress !== spent.address) {
    return null
  }
  const accessToken = `${ACCESS_TOKEN_PREFIX}${randomHex(32)}`
  await db.insert(oauthTokens).values({
    address: spent.address,
    clientId: spent.clientId,
    createdAt: p.now,
    expiresAt: p.now + ACCESS_TOKEN_TTL_SECONDS,
    id: crypto.randomUUID(),
    issuerId: spent.issuerId,
    scope: spent.scope,
    tokenHash: await hashToken(accessToken),
  })
  return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, issuer, scope: scopeList(spent.scope) }
}

export interface AccessGrant {
  clientId: string
  id: string
  issuerId: string
  scope: ConnectedAppScope[]
}

// A live token whose issuer is still owned by the address that approved it.
export const resolveAccessToken = async (db: Db, token: string, now: number): Promise<AccessGrant | null> => {
  const row = await db
    .select({
      clientId: oauthTokens.clientId,
      id: oauthTokens.id,
      issuerId: oauthTokens.issuerId,
      scope: oauthTokens.scope,
    })
    .from(oauthTokens)
    .innerJoin(issuers, eq(issuers.id, oauthTokens.issuerId))
    .where(
      and(
        eq(oauthTokens.tokenHash, await hashToken(token)),
        isNull(oauthTokens.revokedAt),
        gt(oauthTokens.expiresAt, now),
        eq(issuers.operatorAddress, oauthTokens.address),
      ),
    )
    .get()
  return row === undefined ? null : { ...row, scope: scopeList(row.scope) }
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
    .where(
      and(eq(oauthTokens.address, address), isNull(oauthTokens.revokedAt), gt(oauthTokens.expiresAt, now)),
    )
    .orderBy(desc(oauthTokens.createdAt), asc(oauthTokens.id))
  return rows.map(({ app, issuer, token }) => ({
    appName: app.name,
    clientId: app.clientId,
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
    id: token.id,
    issuer: connectedIssuerView(issuer, baseUrl),
    scope: scopeList(token.scope),
  }))
}

export const revokeGrant = async (db: Db, address: string, id: string, now: number): Promise<boolean> => {
  const revoked = await db
    .update(oauthTokens)
    .set({ revokedAt: now })
    .where(and(eq(oauthTokens.id, id), eq(oauthTokens.address, address), isNull(oauthTokens.revokedAt)))
    .returning({ id: oauthTokens.id })
    .get()
  return revoked !== undefined
}
