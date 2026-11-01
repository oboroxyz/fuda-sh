import { apiOriginFor, forwardToApi, readCookie } from '@fuda/libs/worker'
import { defineHandler } from 'void'

import { MEMBER_COOKIE } from '../../src/cookie-names.ts'

// Same-origin access to the api for the browser, carrying the member session
// cookie's credential (docs/adr/0010-void-pages-and-frontend-workers.md).
const forward = defineHandler(
  async (c) =>
    await forwardToApi(c, {
      apiBaseUrl: apiOriginFor(c.env.API_BASE_URL),
      expireOnUnauthorized: [MEMBER_COOKIE],
      token: readCookie(c, MEMBER_COOKIE),
    }),
)

export const GET = forward
export const POST = forward
export const PUT = forward
export const PATCH = forward
export const DELETE = forward
