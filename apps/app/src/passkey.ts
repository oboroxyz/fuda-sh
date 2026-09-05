import { PRF_EVAL_INPUT } from '@fuda/stealth'

export type PrfResult =
  | { ok: true; output: Uint8Array }
  | { ok: false; reason: 'unsupported' | 'cancelled' | 'error'; detail: string }

const EVAL_INPUT = new TextEncoder().encode(PRF_EVAL_INPUT)

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

export const createPasskey = async (rpId: string, userName: string): Promise<PrfResult> => {
  try {
    await navigator.credentials.create({
      publicKey: {
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        extensions: { prf: {} },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        rp: { id: rpId, name: 'fuda' },
        user: { displayName: userName, id: crypto.getRandomValues(new Uint8Array(16)), name: userName },
      },
    })
  } catch (error) {
    return failure(error instanceof Error ? error : null)
  }
  return await loadPasskey(rpId)
}
