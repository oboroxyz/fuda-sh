import type {
  Hex,
  MemberSecretResponse,
  MemberVaultResponse,
  SelfServeIssueResponse,
} from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'
import { base64URLStringToBuffer } from '@simplewebauthn/browser'
import * as v from 'valibot'

import { cardFailureOf, issueSensitiveCard } from '../api.ts'
import type { CardFailure } from '../api.ts'
import { API_BASE_URL } from '../config.ts'
import { addPasskey, PRF_SALT } from './auth.ts'
import type { AddPasskeyOutcome } from './auth.ts'
import {
  mergeEntries,
  newMemberSecret,
  newPassSalt,
  openEntries,
  passKeyFrom,
  sealEntries,
  unwrapSecret,
  wrapSecret,
} from './member-secret.ts'
import type { Sealed, VaultEntry } from './member-secret.ts'

// docs/specs/pass-types-and-flows.md#sensitive-use. The server only ever gets ciphertext,
// an address, and a count.

type Bytes = Uint8Array<ArrayBuffer>

export type PrfAnswer =
  | { kind: 'result'; credentialId: string; output: Bytes }
  | { kind: 'none' }
  | { kind: 'cancelled' }

export interface SensitiveIo {
  addCopy: (copy: Sealed & { credentialId: string; first: boolean }) => Promise<Result<{ added: true }>>
  addPasskey: () => Promise<AddPasskeyOutcome>
  askPrf: (request: { allow: readonly string[]; rpId: string }) => Promise<PrfAnswer>
  claim: (
    handle: string,
    slug: string,
    source: string | null,
    holderAddress: Hex,
  ) => Promise<Result<SelfServeIssueResponse>>
  countOutcome: (outcome: 'no_prf' | 'prf') => Promise<void>
  readSecret: () => Promise<Result<MemberSecretResponse>>
  readVault: () => Promise<Result<MemberVaultResponse>>
  storage: () => Pick<Storage, 'getItem' | 'removeItem' | 'setItem'> | null
  writeVault: (sealed: Sealed, expectedVersion: number) => Promise<Result<{ version: number }>>
}

const bytesOf = (source: BufferSource): Bytes =>
  source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength))

// A prompt on the device only. The server checks nothing here, so its challenge is random
// and goes nowhere: what matters is what the passkey's PRF answers. A browser reports the
// feature whatever the provider does, so only this result says whether it is there.
const askPrf: SensitiveIo['askPrf'] = async ({ allow, rpId }) => {
  let credential: Credential | null
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        allowCredentials: allow.map((id) => ({ id: base64URLStringToBuffer(id), type: 'public-key' })),
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        extensions: { prf: { eval: { first: PRF_SALT } } },
        rpId,
        userVerification: 'required',
      },
    })
  } catch {
    return { kind: 'cancelled' }
  }
  if (!(credential instanceof PublicKeyCredential)) {
    return { kind: 'cancelled' }
  }
  const first = credential.getClientExtensionResults().prf?.results?.first
  return first === undefined
    ? { kind: 'none' }
    : { credentialId: credential.id, kind: 'result', output: bytesOf(first) }
}

const storageOrNull = (): ReturnType<SensitiveIo['storage']> => {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

export const defaultSensitiveIo: SensitiveIo = {
  addCopy: async (copy) =>
    await apiFetch(API_BASE_URL, '/member/secret', { body: JSON.stringify(copy), method: 'POST' }),
  addPasskey,
  askPrf,
  claim: issueSensitiveCard,
  countOutcome: async (outcome) => {
    await apiFetch(API_BASE_URL, '/member/secret/outcome', {
      body: JSON.stringify({ outcome }),
      method: 'POST',
    })
  },
  readSecret: async () => await apiFetch<MemberSecretResponse>(API_BASE_URL, '/member/secret'),
  readVault: async () => await apiFetch<MemberVaultResponse>(API_BASE_URL, '/member/vault'),
  storage: storageOrNull,
  writeVault: async (sealed, expectedVersion) =>
    await apiFetch(API_BASE_URL, '/member/vault', {
      body: JSON.stringify({ ...sealed, expectedVersion }),
      method: 'PUT',
    }),
}

export type OpenedSecret =
  | { kind: 'open'; secret: Bytes }
  // The passkey answered with no PRF result, and the account holds no secret yet.
  | { kind: 'no_prf' }
  | { kind: 'cancelled' }
  // A passkey that should hold a copy could not open one.
  | { kind: 'unopenable' }
  | { kind: 'failed' }

const unwrapOwn = async (
  state: MemberSecretResponse,
  answer: Extract<PrfAnswer, { kind: 'result' }>,
): Promise<OpenedSecret> => {
  const copy = state.copies.find((entry) => entry.credentialId === answer.credentialId)
  const secret = copy === undefined ? null : await unwrapSecret(copy, answer.output)
  return secret === null ? { kind: 'unopenable' } : { kind: 'open', secret }
}

// The first passkey to answer starts the secret. Another device that got there first wins,
// and this one then reads what it wrote.
const startSecret = async (
  io: SensitiveIo,
  answer: Extract<PrfAnswer, { kind: 'result' }>,
): Promise<OpenedSecret> => {
  const secret = newMemberSecret()
  const added = await io.addCopy({
    ...(await wrapSecret(secret, answer.output)),
    credentialId: answer.credentialId,
    first: true,
  })
  if (added.ok) {
    await io.countOutcome('prf')
    return { kind: 'open', secret }
  }
  if (added.status !== 409) {
    return { kind: 'failed' }
  }
  const state = await io.readSecret()
  return state.ok ? await unwrapOwn(state.body, answer) : { kind: 'failed' }
}

// One passkey prompt. `only` narrows it to a passkey just added.
export const openMemberSecret = async (io: SensitiveIo, only?: string): Promise<OpenedSecret> => {
  const state = await io.readSecret()
  if (!state.ok) {
    return { kind: 'failed' }
  }
  const { allowCredentials, copies, rpId } = state.body
  const answer = await io.askPrf({
    allow: only === undefined ? allowCredentials.map((row) => row.id) : [only],
    rpId,
  })
  if (answer.kind === 'cancelled') {
    return { kind: 'cancelled' }
  }
  if (answer.kind === 'none') {
    if (copies.length > 0) {
      return { kind: 'unopenable' }
    }
    await io.countOutcome('no_prf')
    return { kind: 'no_prf' }
  }
  return copies.length === 0 ? await startSecret(io, answer) : await unwrapOwn(state.body, answer)
}

const PENDING_KEY = 'fuda.sensitive.pending.v1'
const VAULT_WRITE_ATTEMPTS = 4

// A claim is two requests, because the uid exists only once the api has signed. If the second
// fails the salt is the only way to this pass, so it waits here, sealed, for the next time
// the secret is open.
const SealedJson = v.object({ ciphertext: v.string(), iv: v.string() })

const readPending = async (io: SensitiveIo, secret: Bytes): Promise<VaultEntry[]> => {
  const raw = io.storage()?.getItem(PENDING_KEY) ?? null
  if (raw === null) {
    return []
  }
  try {
    const parsed = v.safeParse(SealedJson, JSON.parse(raw))
    return parsed.success ? ((await openEntries(parsed.output, secret)) ?? []) : []
  } catch {
    return []
  }
}

const keepPending = async (
  io: SensitiveIo,
  secret: Bytes,
  entries: readonly VaultEntry[],
): Promise<void> => {
  const storage = io.storage()
  if (storage !== null) {
    storage.setItem(PENDING_KEY, JSON.stringify(await sealEntries(entries, secret)))
  }
}

const clearPending = (io: SensitiveIo): void => {
  io.storage()?.removeItem(PENDING_KEY)
}

export type VaultRead = { ok: true; entries: VaultEntry[]; version: number } | { ok: false }

const readEntries = async (io: SensitiveIo, secret: Bytes): Promise<VaultRead> => {
  const read = await io.readVault()
  if (!read.ok) {
    return { ok: false }
  }
  const { vault } = read.body
  if (vault === null) {
    return { entries: [], ok: true, version: 0 }
  }
  const entries = await openEntries(vault, secret)
  return entries === null ? { ok: false } : { entries, ok: true, version: vault.version }
}

// A write names the version it read. Someone else's write in between sends this one back to
// read theirs and add to it, so a second device cannot silently drop a pass.
const saveEntries = async (
  io: SensitiveIo,
  secret: Bytes,
  added: readonly VaultEntry[],
): Promise<VaultRead> => {
  let attempt = 0
  while (attempt < VAULT_WRITE_ATTEMPTS) {
    attempt += 1
    // oxlint-disable-next-line no-await-in-loop -- each try reads what the last one lost to
    const current = await readEntries(io, secret)
    if (!current.ok) {
      return current
    }
    const entries = mergeEntries(current.entries, added)
    if (entries.length === current.entries.length) {
      return current
    }
    // oxlint-disable-next-line no-await-in-loop -- as above
    const written = await io.writeVault(await sealEntries(entries, secret), current.version)
    if (written.ok) {
      return { entries, ok: true, version: written.body.version }
    }
    if (written.status !== 409) {
      return { ok: false }
    }
  }
  return { ok: false }
}

// What the /rights list shows, once a passkey has opened the secret. Anything a failed
// write left waiting goes in first.
export const readVaultEntries = async (io: SensitiveIo, secret: Bytes): Promise<VaultRead> => {
  const pending = await readPending(io, secret)
  if (pending.length === 0) {
    return await readEntries(io, secret)
  }
  const saved = await saveEntries(io, secret, pending)
  if (saved.ok) {
    clearPending(io)
  }
  return saved
}

export type SensitiveClaim =
  | { ok: true; body: SelfServeIssueResponse; saved: boolean }
  | { ok: false; failure: CardFailure | 'no_prf' }

const failureOfOpen = (opened: Exclude<OpenedSecret, { kind: 'open' }>): CardFailure | 'no_prf' => {
  if (opened.kind === 'no_prf') {
    return 'no_prf'
  }
  if (opened.kind === 'cancelled') {
    return 'passkey_cancelled'
  }
  return opened.kind === 'unopenable' ? 'secret_unopenable' : 'network'
}

export const claimSensitive = async (
  io: SensitiveIo,
  card: { cardTitle: string; slug: string; source: string | null; venue: string },
  only?: string,
): Promise<SensitiveClaim> => {
  const opened = await openMemberSecret(io, only)
  if (opened.kind !== 'open') {
    return { failure: failureOfOpen(opened), ok: false }
  }
  const salt = newPassSalt()
  const key = await passKeyFrom(opened.secret, salt)
  const issued = await io.claim(card.venue, card.slug, card.source, key.address)
  if (!issued.ok) {
    return { failure: cardFailureOf(issued), ok: false }
  }
  const entry: VaultEntry = { cardTitle: card.cardTitle, salt, uid: issued.body.uid, venue: card.venue }
  const pending = await readPending(io, opened.secret)
  const saved = await saveEntries(io, opened.secret, [...pending, entry])
  if (saved.ok) {
    clearPending(io)
  } else {
    await keepPending(io, opened.secret, [...pending, entry])
  }
  return { body: issued.body, ok: true, saved: saved.ok }
}

// These sentences reach the verdict screen, and entry-copy.ts holds their translations.
export const SECRET_NOT_OPENED = 'The passkey that opens this pass was not used. Try again on a device that has it.'
export const PASS_NOT_IN_VAULT = 'This pass is not on this account. Sign in with the account that received it.'

export const signForPass = async (io: SensitiveIo, uid: Hex, message: string): Promise<Hex> => {
  const opened = await openMemberSecret(io)
  if (opened.kind !== 'open') {
    throw new Error(SECRET_NOT_OPENED)
  }
  const read = await readVaultEntries(io, opened.secret)
  const entry = read.ok ? read.entries.find((row) => row.uid === uid) : undefined
  if (entry === undefined) {
    throw new Error(PASS_NOT_IN_VAULT)
  }
  const key = await passKeyFrom(opened.secret, entry.salt)
  return await key.signMessage({ message })
}

export type AddWithSecret =
  | { ok: true; holdsSecret: boolean }
  | { ok: false; failure: Extract<AddPasskeyOutcome, { ok: false }>['failure'] | 'secret_unopenable' }

// A new passkey can hold a copy only if both answer: an old one opens the secret, the new one seals
// it. A new passkey with no PRF still signs in, and just cannot open Sensitive passes.
export const addPasskeyKeepingSecret = async (io: SensitiveIo): Promise<AddWithSecret> => {
  const state = await io.readSecret()
  if (!state.ok) {
    return { failure: state.network ? 'network' : 'unavailable', ok: false }
  }
  if (state.body.copies.length === 0) {
    const plain = await io.addPasskey()
    return plain.ok ? { holdsSecret: false, ok: true } : plain
  }
  const opened = await openMemberSecret(io)
  if (opened.kind === 'cancelled') {
    return { failure: 'cancelled', ok: false }
  }
  if (opened.kind !== 'open') {
    return { failure: 'secret_unopenable', ok: false }
  }
  const added = await io.addPasskey()
  if (!added.ok) {
    return added
  }
  const answer: PrfAnswer =
    added.prfOutput === null
      ? await io.askPrf({ allow: [added.credentialId], rpId: state.body.rpId })
      : { credentialId: added.credentialId, kind: 'result', output: added.prfOutput }
  if (answer.kind !== 'result') {
    return { holdsSecret: false, ok: true }
  }
  const copied = await io.addCopy({
    ...(await wrapSecret(opened.secret, answer.output)),
    credentialId: added.credentialId,
    first: false,
  })
  return { holdsSecret: copied.ok, ok: true }
}
