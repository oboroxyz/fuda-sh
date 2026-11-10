import { apiOriginFor, forwardToApi } from '@fuda/libs/worker'
import { defineHandler } from 'void'

declare global {
  interface VoidGeneratedEnvBindings {
    API_BASE_URL?: string
  }
}

// The scanner's same-origin access to the api (../../../../docs/architecture.md#frontend-workers).
// The gate has no session, so nothing but the visitor's IP is added.
const forward = defineHandler(
  async (c) =>
    await forwardToApi(c, {
      apiBaseUrl: apiOriginFor(c.env.API_BASE_URL),
      expireOnUnauthorized: [],
      token: null,
    }),
)

export const GET = forward
export const POST = forward
