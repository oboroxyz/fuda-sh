import type { SelfServeIssueResponse } from '@fuda/sdk'
import { apiFetch, fetchJson } from '@fuda/sdk/http'

import { cardFailureOf, issuePasskeyCard } from '../api.ts'
import type { CardFailure } from '../api.ts'
import { API_BASE_URL } from '../config.ts'

// What every passkey's PRF is asked about (docs/specs/pass-types-and-flows.md#sensitive-use).
// Changing it changes every answer, and so loses every Sensitive pass.
export const PRF_SALT = new TextEncoder().encode('fuda.sh/member-secret/prf/v1')

export type PasskeyFailure = 'cancelled' | 'network' | 'rejected' | 'unavailable'

export type PasskeyOutcome = { ok: true } | { ok: false; failure: PasskeyFailure }

// The system prompt was dismissed, timed out, or found no passkey. The browser does not
// say which, on purpose, so every one reads as "you can try again".
const CANCELLED_ERRORS = new Set(['AbortError', 'NotAllowedError'])

const failureOf = (result: { network?: boolean; status?: number }): PasskeyFailure => {
  if (result.network === true) {
    return 'network'
  }
  return result.status === 400 || result.status === 401 || result.status === 403 ? 'rejected' : 'unavailable'
}

const ceremony = async <T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | PasskeyOutcome> => {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    const cancelled = error instanceof Error && CANCELLED_ERRORS.has(error.name)
    return { failure: cancelled ? 'cancelled' : 'unavailable', ok: false }
  }
}

const postJson = async <T>(path: string): Promise<Result<T>> =>
  await apiFetch<T>(API_BASE_URL, path, { body: '{}', method: 'POST' })

// The Worker's session route spends the response and keeps the session in an HttpOnly
// cookie, so the browser never holds the token.
const spend = async (
  flow: 'login' | 'register',
  response: AuthenticationResponseJSON | RegistrationResponseJSON,
): Promise<PasskeyOutcome> => {
  const result = await fetchJson<{ ok: true }>('/session/passkey', {
    body: JSON.stringify({ flow, response }),
    method: 'POST',
  })
  return result.ok ? { ok: true } : { failure: failureOf(result), ok: false }
}

export const signInWithPasskey = async (): Promise<PasskeyOutcome> => {
  const options = await postJson<PublicKeyCredentialRequestOptionsJSON>('/auth/member/login/options')
  if (!options.ok) {
    return { failure: failureOf(options), ok: false }
  }
  const response = await ceremony<AuthenticationResponseJSON>(
    async () => await startAuthentication({ optionsJSON: options.body }),
  )
  return 'value' in response ? await spend('login', response.value) : response
}

export const createPasskeyAccount = async (): Promise<PasskeyOutcome> => {
  const options = await postJson<PublicKeyCredentialCreationOptionsJSON>('/auth/member/register/options')
  if (!options.ok) {
    return { failure: failureOf(options), ok: false }
  }
  const response = await ceremony<RegistrationResponseJSON>(
    async () => await startRegistration({ optionsJSON: options.body }),
  )
  return 'value' in response ? await spend('register', response.value) : response
}

export type AddPasskeyOutcome =
  | { ok: true; credentialId: string; prfOutput: Uint8Array<ArrayBuffer> | null }
  | { ok: false; failure: PasskeyFailure | 'limit' }

// A PRF answer is typed as any buffer source, and a view may sit inside a larger buffer.
export const bytesOfPrf = (source: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> =>
  source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : Uint8Array.from(new Uint8Array(source.buffer, source.byteOffset, source.byteLength))

export const addPasskey = async (): Promise<AddPasskeyOutcome> => {
  const authorize = await postJson<PublicKeyCredentialRequestOptionsJSON>(
    '/auth/member/passkeys/authorize/options',
  )
  if (!authorize.ok) {
    return { failure: failureOf(authorize), ok: false }
  }
  const authorization = await ceremony<AuthenticationResponseJSON>(
    async () => await startAuthentication({ optionsJSON: authorize.body }),
  )
  if (!('value' in authorization)) {
    return { failure: 'failure' in authorization ? authorization.failure : 'unavailable', ok: false }
  }
  const options = await postJson<PublicKeyCredentialCreationOptionsJSON>('/auth/member/passkeys/options')
  if (!options.ok) {
    return { failure: failureOf(options), ok: false }
  }
  // Some providers answer PRF at creation, which saves a prompt. The answer stays here: only
  // the attestation goes to the api.
  const response = await ceremony<RegistrationResponseJSON>(
    async () =>
      await startRegistration({
        optionsJSON: { ...options.body, extensions: { prf: { eval: { first: PRF_SALT } } } },
      }),
  )
  if (!('value' in response)) {
    return { failure: 'failure' in response ? response.failure : 'unavailable', ok: false }
  }
  const added = await apiFetch<{ added: true }>(API_BASE_URL, '/auth/member/passkeys', {
    body: JSON.stringify({
      ...response.value,
      authorization: authorization.value,
      clientExtensionResults: {},
    }),
    method: 'POST',
  })
  if (added.ok) {
    const first = response.value.clientExtensionResults.prf?.results?.first
    return {
      credentialId: response.value.id,
      ok: true,
      prfOutput: first === undefined ? null : bytesOfPrf(first),
    }
  }
  return added.status === 409 ? { failure: 'limit', ok: false } : { failure: failureOf(added), ok: false }
}

export type PasskeyClaim = { ok: true; body: SelfServeIssueResponse } | { ok: false; failure: CardFailure }

// docs/specs/pass-types-and-flows.md#claiming-an-identified-pass. The member's passkey
// answers a challenge made for this claim, and the pass is bound to whichever one did.
export const claimWithPasskey = async (
  handle: string,
  slug: string,
  source: string | null,
): Promise<PasskeyClaim> => {
  const options = await postJson<PublicKeyCredentialRequestOptionsJSON>('/auth/member/claim/options')
  if (!options.ok) {
    return { failure: cardFailureOf(options), ok: false }
  }
  const response = await ceremony<AuthenticationResponseJSON>(
    async () => await startAuthentication({ optionsJSON: options.body }),
  )
  if (!('value' in response)) {
    return { failure: 'passkey_cancelled', ok: false }
  }
  const issued = await issuePasskeyCard(handle, slug, source, response.value)
  return issued.ok ? { body: issued.body, ok: true } : { failure: cardFailureOf(issued), ok: false }
}

export const cancelPasskeyCeremony = (): void => {
  WebAuthnAbortService.cancelCeremony()
}
