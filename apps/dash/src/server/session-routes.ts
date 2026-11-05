import { apiHeaders, crossOriginWrite, spendPasskey, spendWalletSignature } from '@fuda/libs/worker'
import type { IssuerView, OperatorSignInResponse, SignInResponse } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Context } from 'hono'
import * as v from 'valibot'

import { endSession, readCredential, startAdminSession, startOperatorSession } from './cookies.ts'

const AdminBody = v.object({ token: v.string() })

export const verifyOperator = async (c: Context, apiBaseUrl: string): Promise<Response> => {
  const result = await spendWalletSignature<SignInResponse>(c, apiBaseUrl, '/auth/verify')
  if (!result.ok) {
    return result.response
  }
  startOperatorSession(c, result.body.token)
  return c.json({ issuer: result.body.issuer } satisfies { issuer: IssuerView | null })
}

export const passkeySession = async (c: Context, apiBaseUrl: string): Promise<Response> => {
  const result = await spendPasskey<OperatorSignInResponse>(c, apiBaseUrl, 'operator')
  if (!result.ok) {
    return result.response
  }
  startOperatorSession(c, result.body.token)
  return c.json({ issuer: result.body.issuer } satisfies { issuer: IssuerView | null })
}

// The admin token is not checked here: an api with ADMIN_TOKEN unset accepts
// any value, and a wrong one shows as the first admin read's 401.
export const startAdmin = async (c: Context): Promise<Response> => {
  const refused = crossOriginWrite(c)
  if (refused !== null) {
    return refused
  }
  const parsed = v.safeParse(AdminBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'bad_input' }, 400)
  }
  startAdminSession(c, parsed.output.token.trim())
  return c.json({ ok: true })
}

// Local sign-out always succeeds; ending the operator session at the api is
// best effort, as it was when the browser held the token.
export const signOut = async (c: Context, apiBaseUrl: string): Promise<Response> => {
  const refused = crossOriginWrite(c)
  if (refused !== null) {
    return refused
  }
  const credential = readCredential(c)
  endSession(c)
  if (credential?.kind === 'operator') {
    await apiFetch(apiBaseUrl, '/auth/logout', {
      body: '{}',
      headers: apiHeaders(c, credential.token),
      method: 'POST',
    })
  }
  return c.json({ ok: true })
}
