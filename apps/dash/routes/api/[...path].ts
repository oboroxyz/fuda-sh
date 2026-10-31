import { forwardToApi } from '@fuda/libs/worker'
import { defineHandler } from 'void'

import { readCredential, SESSION_COOKIES } from '../../src/server/cookies.ts'

// Same-origin access to the api for the browser, carrying the session cookie's
// credential (docs/adr/0010-void-pages-and-frontend-workers.md).
const forward = defineHandler(
  async (c) =>
    await forwardToApi(c, {
      apiBaseUrl: c.env.API_BASE_URL,
      expireOnUnauthorized: SESSION_COOKIES,
      token: readCredential(c)?.token ?? null,
    }),
)

export const GET = forward
export const POST = forward
export const PUT = forward
export const PATCH = forward
export const DELETE = forward
