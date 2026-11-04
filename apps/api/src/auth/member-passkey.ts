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
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { and, count, eq, gt, sql } from 'drizzle-orm'
import * as v from 'valibot'

import type { Db } from '../db/client.ts'
import { accounts, passkeyChallenges, passkeys } from '../db/schema.ts'
import type { AttestedPasskey } from '../eas/offchain.ts'
import type { Bindings } from '../env.ts'
import { toHex } from '../hex.ts'

const CHALLENGE_TTL_SECONDS = 300
const ES256 = -7
const MAX_PASSKEYS_PER_ACCOUNT = 10

type Purpose = 'add' | 'claim' | 'login' | 'register'

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
  // No allowCredentials: the member has not said who they are, so the system lists
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

type StoredPasskey = typeof passkeys.$inferSelect

// A verified assertion also moves the passkey's counter and last use, and a verifier that
// throws reads as a refusal.
const assertStored = async (
  db: Db,
  rp: RelyingParty,
  stored: StoredPasskey,
  challenge: string,
  response: AuthenticationResponseJSON,
  now: number,
): Promise<boolean> => {
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
      return false
    }
    await db
      .update(passkeys)
      .set({
        backedUp: result.authenticationInfo.credentialBackedUp ? 1 : 0,
        counter: result.authenticationInfo.newCounter,
        lastUsedAt: now,
      })
      .where(eq(passkeys.credentialId, stored.credentialId))
    return true
  } catch {
    return false
  }
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
  return (await assertStored(db, rp, stored, challenge, response, now))
    ? { accountId: stored.accountId }
    : null
}

// docs/specs/pass-types-and-flows.md#claiming-an-identified-pass. Limited to the account's
// own passkeys, so the system prompt offers no other.
export const claimOptions = async (
  db: Db,
  rp: RelyingParty,
  accountId: string,
  now: number,
): Promise<PublicKeyCredentialRequestOptionsJSON> => {
  const held = await db
    .select({ id: passkeys.credentialId, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.accountId, accountId))
  const options = await generateAuthenticationOptions({
    allowCredentials: held.map((row) => ({ id: row.id, transports: transportsOf(row.transports) })),
    rpID: rp.id,
    userVerification: 'required',
  })
  await storeChallenge(db, {
    accountId,
    challenge: options.challenge,
    now,
    purpose: 'claim',
    userHandle: null,
  })
  return options
}

// The passkey to bind, once this account's own passkey has answered this account's own
// challenge.
export const claimingPasskey = async (
  db: Db,
  rp: RelyingParty,
  accountId: string,
  response: AuthenticationResponseJSON,
  now: number,
): Promise<AttestedPasskey | null> => {
  const challenge = challengeOf(response.response.clientDataJSON)
  const spent = challenge === null ? null : await spendChallenge(db, { challenge, now, purpose: 'claim' })
  if (challenge === null || spent?.accountId !== accountId) {
    return null
  }
  const stored = await db
    .select()
    .from(passkeys)
    .where(and(eq(passkeys.credentialId, response.id), eq(passkeys.accountId, accountId)))
    .get()
  if (stored === undefined || !(await assertStored(db, rp, stored, challenge, response, now))) {
    return null
  }
  return { credentialId: stored.credentialId, publicKey: `0x${stored.publicKey}` }
}

// docs/specs/attestation-model.md#offchain-rights: the gate's challenge string, as bytes,
// is what the passkey signs.
export const gatePasskeyOptions = async (
  rp: RelyingParty,
  key: AttestedPasskey,
  message: string,
): Promise<PublicKeyCredentialRequestOptionsJSON> =>
  await generateAuthenticationOptions({
    allowCredentials: [{ id: key.credentialId }],
    challenge: message,
    rpID: rp.id,
    userVerification: 'required',
  })

export const verifyGateAssertion = async (
  rp: RelyingParty,
  key: AttestedPasskey,
  message: string,
  response: AuthenticationResponseJSON,
): Promise<boolean> => {
  // The verifier takes the key it is given and never compares the ids.
  if (response.id !== key.credentialId) {
    return false
  }
  try {
    const result = await verifyAuthenticationResponse({
      // The attestation fixes the key but cannot track a count that moves with every use,
      // and synced passkeys report none, so 0 skips the check. The one-time challenge is
      // what stops a replay here.
      credential: { counter: 0, id: key.credentialId, publicKey: bytesOfHex(key.publicKey.slice(2)) },
      expectedChallenge: isoBase64URL.fromUTF8String(message),
      expectedOrigin: rp.origins,
      expectedRPID: rp.id,
      requireUserVerification: true,
      response,
    })
    return result.verified
  } catch {
    return false
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
