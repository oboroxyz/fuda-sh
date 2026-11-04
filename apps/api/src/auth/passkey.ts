import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { and, count, eq, gt, sql } from 'drizzle-orm'
import * as v from 'valibot'

import type { Db } from '../db/client.ts'
import { accounts, passkeyChallenges, passkeys } from '../db/schema.ts'
import type { Bindings } from '../env.ts'
import { toHex } from '../hex.ts'

const CHALLENGE_TTL_SECONDS = 300
const ES256 = -7
const MAX_PASSKEYS_PER_ACCOUNT = 10

type Purpose = 'add' | 'login' | 'register'

export interface RelyingParty {
  id: string
  origins: string[]
}

export const relyingParty = (env: Pick<Bindings, 'WEBAUTHN_ORIGINS' | 'WEBAUTHN_RP_ID'>): RelyingParty => ({
  id: env.WEBAUTHN_RP_ID,
  origins: env.WEBAUTHN_ORIGINS.split(',').map((origin) => origin.trim()),
})

const bytesOfHex = (hex: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(hex.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16))

const storeChallenge = async (
  db: Db,
  p: {
    accountId: string | null
    challenge: string
    now: number
    purpose: Purpose
    userHandle: string | null
  },
): Promise<void> => {
  await db.insert(passkeyChallenges).values({
    accountId: p.accountId,
    challenge: p.challenge,
    createdAt: p.now,
    purpose: p.purpose,
    userHandle: p.userHandle,
  })
}

// Spent by deleting it, in one statement, so two requests cannot both use it. A wrong
// response still burns its challenge, as at the gate.
const spendChallenge = async (
  db: Db,
  p: { challenge: string; now: number; purpose: Purpose },
): Promise<{ accountId: string | null; userHandle: string | null } | null> =>
  (await db
    .delete(passkeyChallenges)
    .where(
      and(
        eq(passkeyChallenges.challenge, p.challenge),
        eq(passkeyChallenges.purpose, p.purpose),
        gt(passkeyChallenges.createdAt, p.now - CHALLENGE_TTL_SECONDS),
      ),
    )
    .returning({ accountId: passkeyChallenges.accountId, userHandle: passkeyChallenges.userHandle })
    .get()) ?? null

const ClientData = v.object({ challenge: v.string() })

// The challenge the response claims. It only finds the row: the library then checks it
// against the same value, and the origin and signature with it.
const challengeOf = (clientDataJSON: string): string | null => {
  try {
    const padded = clientDataJSON.replaceAll('-', '+').replaceAll('_', '/')
    const parsed = v.safeParse(ClientData, JSON.parse(atob(padded)))
    return parsed.success ? parsed.output.challenge : null
  } catch {
    return null
  }
}

const transportsOf = (stored: string): AuthenticatorTransport[] => {
  const parsed = v.safeParse(
    v.array(v.picklist(['ble', 'hybrid', 'internal', 'nfc', 'usb'])),
    JSON.parse(stored),
  )
  return parsed.success ? parsed.output : []
}

const creationOptions = async (
  rp: RelyingParty,
  userHandle: string,
  exclude: { id: string; transports: string[] }[],
): Promise<PublicKeyCredentialCreationOptionsJSON> =>
  await generateRegistrationOptions({
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: exclude,
    rpID: rp.id,
    rpName: 'fuda',
    supportedAlgorithmIDs: [ES256],
    userDisplayName: 'fuda',
    userID: bytesOfHex(userHandle),
    userName: 'fuda',
  })

export const registerOptions = async (
  db: Db,
  rp: RelyingParty,
  now: number,
): Promise<PublicKeyCredentialCreationOptionsJSON> => {
  const userHandle = toHex(crypto.getRandomValues(new Uint8Array(32)))
  const options = await creationOptions(rp, userHandle, [])
  await storeChallenge(db, {
    accountId: null,
    challenge: options.challenge,
    now,
    purpose: 'register',
    userHandle,
  })
  return options
}

export const addOptions = async (
  db: Db,
  rp: RelyingParty,
  accountId: string,
  now: number,
): Promise<PublicKeyCredentialCreationOptionsJSON | null> => {
  const account = await db.select().from(accounts).where(eq(accounts.id, accountId)).get()
  if (account === undefined) {
    return null
  }
  const existing = await db
    .select({ id: passkeys.credentialId, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.accountId, accountId))
  const options = await creationOptions(
    rp,
    account.userHandle,
    existing.map((row) => ({ id: row.id, transports: transportsOf(row.transports) })),
  )
  await storeChallenge(db, {
    accountId,
    challenge: options.challenge,
    now,
    purpose: 'add',
    userHandle: account.userHandle,
  })
  return options
}

export const loginOptions = async (
  db: Db,
  rp: RelyingParty,
  now: number,
): Promise<PublicKeyCredentialRequestOptionsJSON> => {
  // No allowCredentials: the person has not said who they are, so the system lists
  // every passkey it holds for this site.
  const options = await generateAuthenticationOptions({ rpID: rp.id, userVerification: 'required' })
  await storeChallenge(db, {
    accountId: null,
    challenge: options.challenge,
    now,
    purpose: 'login',
    userHandle: null,
  })
  return options
}

const verifiedCredential = async (
  rp: RelyingParty,
  response: RegistrationResponseJSON,
  challenge: string,
) => {
  try {
    const result = await verifyRegistrationResponse({
      expectedChallenge: challenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.id,
      requireUserVerification: true,
      response,
      supportedAlgorithmIDs: [ES256],
    })
    return result.verified ? result.registrationInfo : null
  } catch {
    return null
  }
}

type VerifiedCredential = NonNullable<Awaited<ReturnType<typeof verifiedCredential>>>

const passkeyRow = (accountId: string, info: VerifiedCredential, now: number) => ({
  accountId,
  backedUp: info.credentialBackedUp ? 1 : 0,
  counter: info.credential.counter,
  createdAt: now,
  credentialId: info.credential.id,
  publicKey: toHex(info.credential.publicKey),
  transports: JSON.stringify(info.credential.transports ?? []),
})

// The account exists only once its first passkey has verified, so an abandoned
// ceremony leaves nothing behind.
export const register = async (
  db: Db,
  rp: RelyingParty,
  response: RegistrationResponseJSON,
  now: number,
): Promise<{ accountId: string } | null> => {
  const challenge = challengeOf(response.response.clientDataJSON)
  const spent = challenge === null ? null : await spendChallenge(db, { challenge, now, purpose: 'register' })
  if (challenge === null || spent === null || spent.userHandle === null) {
    return null
  }
  const info = await verifiedCredential(rp, response, challenge)
  if (info === null) {
    return null
  }
  const accountId = crypto.randomUUID()
  await db.batch([
    db.insert(accounts).values({ createdAt: now, id: accountId, userHandle: spent.userHandle }),
    db.insert(passkeys).values(passkeyRow(accountId, info, now)),
  ])
  return { accountId }
}

export type AddPasskeyResult = 'added' | 'limit' | 'rejected'

export const addPasskey = async (
  db: Db,
  rp: RelyingParty,
  accountId: string,
  response: RegistrationResponseJSON,
  now: number,
): Promise<AddPasskeyResult> => {
  const challenge = challengeOf(response.response.clientDataJSON)
  const spent = challenge === null ? null : await spendChallenge(db, { challenge, now, purpose: 'add' })
  if (challenge === null || spent?.accountId !== accountId) {
    return 'rejected'
  }
  const info = await verifiedCredential(rp, response, challenge)
  if (info === null) {
    return 'rejected'
  }
  const row = await db
    .select({ total: count() })
    .from(passkeys)
    .where(eq(passkeys.accountId, accountId))
    .get()
  if ((row?.total ?? 0) >= MAX_PASSKEYS_PER_ACCOUNT) {
    return 'limit'
  }
  await db.insert(passkeys).values(passkeyRow(accountId, info, now))
  return 'added'
}

export const login = async (
  db: Db,
  rp: RelyingParty,
  response: AuthenticationResponseJSON,
  now: number,
): Promise<{ accountId: string } | null> => {
  const challenge = challengeOf(response.response.clientDataJSON)
  const spent = challenge === null ? null : await spendChallenge(db, { challenge, now, purpose: 'login' })
  if (challenge === null || spent === null) {
    return null
  }
  const stored = await db.select().from(passkeys).where(eq(passkeys.credentialId, response.id)).get()
  if (stored === undefined) {
    return null
  }
  try {
    const result = await verifyAuthenticationResponse({
      credential: {
        counter: stored.counter,
        id: stored.credentialId,
        publicKey: bytesOfHex(stored.publicKey),
        transports: transportsOf(stored.transports),
      },
      expectedChallenge: challenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.id,
      requireUserVerification: true,
      response,
    })
    if (!result.verified) {
      return null
    }
    await db
      .update(passkeys)
      .set({
        backedUp: result.authenticationInfo.credentialBackedUp ? 1 : 0,
        counter: result.authenticationInfo.newCounter,
        lastUsedAt: now,
      })
      .where(eq(passkeys.credentialId, stored.credentialId))
    return { accountId: stored.accountId }
  } catch {
    return null
  }
}

export const listPasskeys = async (db: Db, accountId: string) =>
  await db
    .select({
      backedUp: passkeys.backedUp,
      createdAt: passkeys.createdAt,
      id: passkeys.credentialId,
      lastUsedAt: passkeys.lastUsedAt,
    })
    .from(passkeys)
    .where(eq(passkeys.accountId, accountId))
    .orderBy(passkeys.createdAt)

// One statement, so two requests cannot each remove a different one of the last two
// and leave an account no one can sign in to.
export const removePasskey = async (db: Db, accountId: string, id: string): Promise<boolean> => {
  const removed = await db
    .delete(passkeys)
    .where(
      and(
        eq(passkeys.credentialId, id),
        eq(passkeys.accountId, accountId),
        sql`(SELECT COUNT(*) FROM passkeys WHERE account_id = ${accountId}) > 1`,
      ),
    )
    .returning({ id: passkeys.credentialId })
    .get()
  return removed !== undefined
}
