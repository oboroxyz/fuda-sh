import { forwardToApi, readCookie } from '@fuda/libs/worker'
import { SensitiveClaimBody } from '@fuda/sdk'
import type { Context } from 'hono'
import * as v from 'valibot'

import { MEMBER_COOKIE } from '../cookie-names.ts'

const isUncredentialed = async (request: Request): Promise<boolean> => {
  const path = new URL(request.url).pathname
  if (path === '/api/v1/challenge' || path === '/api/v1/verify-signed') {
    return true
  }
  if (!/^\/api\/v1\/issuers\/[^/]+\/[^/]+\/issue$/u.test(path)) {
    return false
  }
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => null)
  return v.safeParse(SensitiveClaimBody, body).success
}

export const forwardMemberApi = async (c: Context, apiBaseUrl: string): Promise<Response> =>
  await forwardToApi(c, {
    apiBaseUrl,
    expireOnUnauthorized: [MEMBER_COOKIE],
    token: (await isUncredentialed(c.req.raw)) ? null : readCookie(c, MEMBER_COOKIE),
  })
