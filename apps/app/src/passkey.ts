import { PRF_EVAL_INPUT } from '@fuda/stealth'

export type PrfResult =
  | { ok: true; output: Uint8Array }
  | { ok: false; reason: 'unsupported' | 'cancelled' | 'error'; detail: string }

const EVAL_INPUT = new TextEncoder().encode(PRF_EVAL_INPUT)

// WebAuthn treats `user.id` as the account identity: a create() with a fresh
// random id mints a *second* credential on the same authenticator, so a member
// who taps "Create passkey" twice ends up with two passkeys (two different PRF
// outputs, two meta-addresses, and a picker at every get()). Re-using one stable
// id makes the repeat ceremony replace the existing credential instead.
export const USER_ID_KEY = 'fuda.passkey.user-id'
const USER_ID_BYTES = 16
const USER_ID_HEX_RE = /^[0-9a-f]{32}$/u

export type IdStorage = Pick<Storage, 'getItem' | 'setItem'>

const hexOf = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

// Backed by an ArrayBuffer, never a SharedArrayBuffer: WebAuthn's `user.id` is a
// BufferSource, which the shared-buffer case does not satisfy.
const bytesOfHex = (hex: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(hex.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16))

// Generated once and kept: a cleared store (or a browser that denies storage
// outright) only costs the member a duplicate credential, never a crash, so
// every access is wrapped rather than trusted.
export const passkeyUserId = (storage: IdStorage): Uint8Array<ArrayBuffer> => {
  try {
    const stored = storage.getItem(USER_ID_KEY)
    if (stored !== null && USER_ID_HEX_RE.test(stored)) {
      return bytesOfHex(stored)
    }
  } catch {
    // storage blocked: fall through to a fresh id
  }
  const fresh = crypto.getRandomValues(new Uint8Array(USER_ID_BYTES))
  try {
    storage.setItem(USER_ID_KEY, hexOf(fresh))
  } catch {
    // storage blocked: the id lives for this ceremony only
  }
  return fresh
}

// The PRF result is typed as a BufferSource: an ArrayBuffer today, but a view
// over a larger buffer is equally legal, so the window is honoured rather than
// assumed away.
const bytesOf = (source: BufferSource): Uint8Array =>
  source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength)

const prfOf = (credential: Credential | null): PrfResult => {
  if (!(credential instanceof PublicKeyCredential)) {
    return { detail: 'no credential', ok: false, reason: 'error' }
  }
  const first = credential.getClientExtensionResults().prf?.results?.first
  if (first === undefined) {
    return {
      detail: 'this passkey or platform does not support the PRF extension',
      ok: false,
      reason: 'unsupported',
    }
  }
  return { ok: true, output: bytesOf(first) }
}

// A refused prompt is the member's own choice, not a failure of the ceremony:
// DOMException extends Error, so the NotAllowedError check survives the narrowing.
const failure = (error: Error | null): PrfResult => ({
  detail: error?.message ?? 'passkey ceremony failed',
  ok: false,
  reason: error instanceof DOMException && error.name === 'NotAllowedError' ? 'cancelled' : 'error',
})

// Some platforms only report PRF support at get() time, so every path ends in a
// get() with the pinned eval input: the PRF output is a function of that input
// and must never change.
export const loadPasskey = async (rpId: string): Promise<PrfResult> => {
  try {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        extensions: { prf: { eval: { first: EVAL_INPUT } } },
        rpId,
        userVerification: 'required',
      },
    })
    return prfOf(credential)
  } catch (error) {
    return failure(error instanceof Error ? error : null)
  }
}

export const createPasskey = async (
  rpId: string,
  userName: string,
  storage: IdStorage = globalThis.localStorage,
): Promise<PrfResult> => {
  try {
    await navigator.credentials.create({
      publicKey: {
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        extensions: { prf: {} },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        rp: { id: rpId, name: 'fuda' },
        user: { displayName: userName, id: passkeyUserId(storage), name: userName },
      },
    })
  } catch (error) {
    return failure(error instanceof Error ? error : null)
  }
  return await loadPasskey(rpId)
}
