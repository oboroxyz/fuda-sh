import { PasskeyAuthenticationBody, PasskeyRegistrationBody } from '@fuda/sdk'
import type { Context, MiddlewareHandler } from 'hono'
import * as v from 'valibot'
import { defineHandler } from 'void'

import {
  addOptions,
  addPasskey,
  listPasskeys,
  login,
  loginOptions,
  register,
  registerOptions,
  relyingParty,
  removePasskey,
} from '../auth/passkey.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { rateLimit } from '../middleware/rate-limit.ts'

// docs/specs/pass-types-and-flows.md#passkey-ceremonies. Ceremonies per hour per IP.
// Each takes two requests, and someone who cancels the system prompt starts another.
const CEREMONY_BUDGET = 60

const registrationBody = async (c: Context<AppEnv>) =>
  v.safeParse(PasskeyRegistrationBody, await c.req.json().catch(() => null))

// What separates the audiences: which session a ceremony ends in, and how a signed-in
// request names its account. One account and its passkeys serve both, because a person
// who runs a shop and holds passes is one person.
interface PasskeyAudience {
  // The account the session names; null for an operator signed in with a wallet.
  accountOf: (c: Context<AppEnv>) => string | null
  auth: () => MiddlewareHandler<AppEnv>
  signedIn: (c: Context<AppEnv>, accountId: string) => Promise<Response>
}

export const passkeyCeremonies = (audience: PasskeyAudience) => {
  const forAccount = (run: (c: Context<AppEnv>, accountId: string) => Promise<Response>) =>
    defineHandler(audience.auth(), async (c) => {
      const accountId = audience.accountOf(c)
      return accountId === null ? errorResponse(c, 'no_account', 409) : await run(c, accountId)
    })

  return {
    add: forAccount(async (c, accountId) => {
      const parsed = await registrationBody(c)
      if (!parsed.success) {
        return errorResponse(c, 'bad_input', 400)
      }
      const result = await addPasskey(
        c.get('db'),
        relyingParty(c.env),
        accountId,
        parsed.output,
        c.get('now')(),
      )
      if (result === 'limit') {
        return errorResponse(c, 'passkey_limit', 409)
      }
      return result === 'added' ? jsonResponse(c, { added: true }) : errorResponse(c, 'bad_passkey', 401)
    }),

    addOptions: forAccount(async (c, accountId) => {
      const options = await addOptions(c.get('db'), relyingParty(c.env), accountId, c.get('now')())
      return options === null ? errorResponse(c, 'unauthorized', 401) : jsonResponse(c, options)
    }),

    list: forAccount(async (c, accountId) => {
      const rows = await listPasskeys(c.get('db'), accountId)
      return jsonResponse(c, {
        passkeys: rows.map(({ copy, ...row }) => ({
          ...row,
          backedUp: row.backedUp !== 0,
          holdsSecret: copy !== null,
        })),
      })
    }),

    login: defineHandler(rateLimit({ budget: CEREMONY_BUDGET }), async (c) => {
      const parsed = v.safeParse(PasskeyAuthenticationBody, await c.req.json().catch(() => null))
      if (!parsed.success) {
        return errorResponse(c, 'bad_input', 400)
      }
      const signedIn = await login(c.get('db'), relyingParty(c.env), parsed.output, c.get('now')())
      return signedIn === null
        ? errorResponse(c, 'bad_passkey', 401)
        : await audience.signedIn(c, signedIn.accountId)
    }),

    loginOptions: defineHandler(rateLimit({ budget: CEREMONY_BUDGET }), async (c) =>
      jsonResponse(c, await loginOptions(c.get('db'), relyingParty(c.env), c.get('now')())),
    ),

    register: defineHandler(rateLimit({ budget: CEREMONY_BUDGET }), async (c) => {
      const parsed = await registrationBody(c)
      if (!parsed.success) {
        return errorResponse(c, 'bad_input', 400)
      }
      const created = await register(c.get('db'), relyingParty(c.env), parsed.output, c.get('now')())
      return created === null
        ? errorResponse(c, 'bad_passkey', 401)
        : await audience.signedIn(c, created.accountId)
    }),

    registerOptions: defineHandler(rateLimit({ budget: CEREMONY_BUDGET }), async (c) =>
      jsonResponse(c, await registerOptions(c.get('db'), relyingParty(c.env), c.get('now')())),
    ),

    // A refusal does not say whether the id exists on another account.
    remove: forAccount(async (c, accountId) => {
      const removed = await removePasskey(c.get('db'), accountId, c.req.param().id)
      return removed ? jsonResponse(c, { removed: true }) : errorResponse(c, 'last_passkey', 409)
    }),
  }
}
