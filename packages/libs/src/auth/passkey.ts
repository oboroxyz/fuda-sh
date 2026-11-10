import type { PasskeysResponse, PasskeyView } from '@fuda/sdk'
import type { ApiInit, Result } from '@fuda/sdk/http'
import { startAuthentication, startRegistration, WebAuthnAbortService } from '@simplewebauthn/browser'
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser'

export type PasskeyFailure = 'cancelled' | 'network' | 'rejected' | 'unavailable'

export type PasskeyOutcome<S> = { ok: true; session: S } | { ok: false; failure: PasskeyFailure }

export type AddPasskeyOutcome = { ok: true } | { ok: false; failure: PasskeyFailure | 'limit' }

// How a frontend reaches the api, and its own Worker's session routes. Each adds what
// that frontend's requests need, so the ceremonies know only the paths.
export interface PasskeyTransport {
  api: <T>(path: string, init?: ApiInit) => Promise<Result<T>>
  session: <T>(url: string, init: ApiInit) => Promise<Result<T>>
}

// The system prompt was dismissed, timed out, or found no passkey. The browser does not
// say which, on purpose, so every one reads as "you can try again".
const CANCELLED_ERRORS = new Set(['AbortError', 'NotAllowedError'])

const failureOf = (result: { network: boolean; status: number }): PasskeyFailure => {
  if (result.network) {
    return 'network'
  }
  return result.status === 401 || result.status === 400 || result.status === 403 ? 'rejected' : 'unavailable'
}

const ceremony = async <T>(
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; failure: PasskeyFailure }> => {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    const cancelled = error instanceof Error && CANCELLED_ERRORS.has(error.name)
    return { failure: cancelled ? 'cancelled' : 'unavailable', ok: false }
  }
}

export const cancelPasskeyCeremony = (): void => {
  WebAuthnAbortService.cancelCeremony()
}

// docs/specs/pass-types-and-flows.md#member-sign-in. `S` is what the frontend's
// session route answers: the Worker spends the response and keeps the session in an
// HttpOnly cookie, so the browser never holds the token.
export const passkeyClient = <S>(audience: 'member' | 'operator', transport: PasskeyTransport) => {
  const base = `/auth/${audience}`
  const optionsFrom = async <T>(path: string): Promise<Result<T>> =>
    await transport.api<T>(`${base}${path}`, { body: '{}', method: 'POST' })

  const spend = async (
    flow: 'login' | 'register',
    response: AuthenticationResponseJSON | RegistrationResponseJSON,
  ): Promise<PasskeyOutcome<S>> => {
    const result = await transport.session<S>('/session/passkey', {
      body: JSON.stringify({ flow, response }),
      method: 'POST',
    })
    return result.ok ? { ok: true, session: result.body } : { failure: failureOf(result), ok: false }
  }

  return {
    add: async (): Promise<AddPasskeyOutcome> => {
      const existing = await transport.api<PasskeysResponse>(`${base}/passkeys`)
      if (!existing.ok) {
        return { failure: failureOf(existing), ok: false }
      }
      let authorization: AuthenticationResponseJSON | undefined
      if (existing.body.passkeys.length > 0) {
        const prompt = await optionsFrom<PublicKeyCredentialRequestOptionsJSON>('/passkeys/authorize/options')
        if (!prompt.ok) {
          return { failure: failureOf(prompt), ok: false }
        }
        const proof = await ceremony(async () => await startAuthentication({ optionsJSON: prompt.body }))
        if (!proof.ok) {
          return proof
        }
        authorization = proof.value
      }
      const options = await optionsFrom<PublicKeyCredentialCreationOptionsJSON>('/passkeys/options')
      if (!options.ok) {
        return { failure: failureOf(options), ok: false }
      }
      const response = await ceremony<RegistrationResponseJSON>(
        async () => await startRegistration({ optionsJSON: options.body }),
      )
      if (!response.ok) {
        return response
      }
      const added = await transport.api<{ added: true }>(`${base}/passkeys`, {
        body: JSON.stringify({ ...response.value, authorization }),
        method: 'POST',
      })
      if (added.ok) {
        return { ok: true }
      }
      return added.status === 409 ? { failure: 'limit', ok: false } : { failure: failureOf(added), ok: false }
    },

    create: async (): Promise<PasskeyOutcome<S>> => {
      const options = await optionsFrom<PublicKeyCredentialCreationOptionsJSON>('/register/options')
      if (!options.ok) {
        return { failure: failureOf(options), ok: false }
      }
      const response = await ceremony<RegistrationResponseJSON>(
        async () => await startRegistration({ optionsJSON: options.body }),
      )
      return response.ok ? await spend('register', response.value) : response
    },

    list: async (): Promise<PasskeyView[]> => {
      const result = await transport.api<PasskeysResponse>(`${base}/passkeys`)
      if (!result.ok) {
        throw new Error(result.error)
      }
      return result.body.passkeys
    },

    remove: async (id: string): Promise<boolean> => {
      const result = await transport.api(`${base}/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' })
      return result.ok
    },

    signIn: async (): Promise<PasskeyOutcome<S>> => {
      const options = await optionsFrom<PublicKeyCredentialRequestOptionsJSON>('/login/options')
      if (!options.ok) {
        return { failure: failureOf(options), ok: false }
      }
      const response = await ceremony<AuthenticationResponseJSON>(
        async () => await startAuthentication({ optionsJSON: options.body }),
      )
      return response.ok ? await spend('login', response.value) : response
    },
  }
}
