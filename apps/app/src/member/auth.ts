import { apiFetch, fetchJson } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'
import { startAuthentication, startRegistration, WebAuthnAbortService } from '@simplewebauthn/browser'
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser'

import { API_BASE_URL } from '../config.ts'

export type PasskeyFailure = 'cancelled' | 'network' | 'rejected' | 'unavailable'

export type PasskeyOutcome = { ok: true } | { ok: false; failure: PasskeyFailure }

// The system prompt was dismissed, timed out, or found no passkey. The browser does not
// say which, on purpose, so every one reads as "you can try again".
const CANCELLED_ERRORS = new Set(['AbortError', 'NotAllowedError'])

const failureOf = (result: { network?: boolean; status?: number }): PasskeyFailure => {
  if (result.network === true) {
    return 'network'
  }
  return result.status === 401 || result.status === 400 ? 'rejected' : 'unavailable'
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

export type AddPasskeyOutcome = PasskeyOutcome | { ok: false; failure: 'limit' }

export const addPasskey = async (): Promise<AddPasskeyOutcome> => {
  const options = await postJson<PublicKeyCredentialCreationOptionsJSON>('/auth/member/passkeys/options')
  if (!options.ok) {
    return { failure: failureOf(options), ok: false }
  }
  const response = await ceremony<RegistrationResponseJSON>(
    async () => await startRegistration({ optionsJSON: options.body }),
  )
  if (!('value' in response)) {
    return response
  }
  const added = await apiFetch<{ added: true }>(API_BASE_URL, '/auth/member/passkeys', {
    body: JSON.stringify(response.value),
    method: 'POST',
  })
  if (added.ok) {
    return { ok: true }
  }
  return added.status === 409 ? { failure: 'limit', ok: false } : { failure: failureOf(added), ok: false }
}

export const cancelPasskeyCeremony = (): void => {
  WebAuthnAbortService.cancelCeremony()
}
