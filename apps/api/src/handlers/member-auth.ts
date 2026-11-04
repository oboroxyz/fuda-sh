import { LinkPassesBody, normalizeUid } from '@fuda/sdk'
import * as v from 'valibot'
import type { Hex } from 'viem'
import { defineHandler } from 'void'

import { linkPasses, listPasses } from '../auth/member-passes.ts'
import { claimOptions, relyingParty } from '../auth/passkey.ts'
import { createMemberSession, deleteSession } from '../auth/session.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { memberAuth } from '../middleware/member-auth.ts'
import { rateLimit } from '../middleware/rate-limit.ts'
import { passkeyCeremonies } from './passkey-ceremonies.ts'

const CEREMONY_BUDGET = 60

const ceremonies = passkeyCeremonies({
  accountOf: (c) => c.get('member').accountId,
  auth: memberAuth,
  signedIn: async (c, accountId) =>
    jsonResponse(c, {
      accountId,
      token: await createMemberSession(c.get('db'), accountId, c.get('now')()),
    }),
})

export const postV1AuthMemberRegisterOptions = ceremonies.registerOptions
export const postV1AuthMemberRegister = ceremonies.register
export const postV1AuthMemberLoginOptions = ceremonies.loginOptions
export const postV1AuthMemberLogin = ceremonies.login

export const postV1AuthMemberClaimOptions = defineHandler(
  rateLimit({ budget: CEREMONY_BUDGET }),
  memberAuth(),
  async (c) =>
    jsonResponse(
      c,
      await claimOptions(c.get('db'), relyingParty(c.env), c.get('member').accountId, c.get('now')()),
    ),
)

export const getV1AuthMemberMe = defineHandler(memberAuth(), (c) =>
  jsonResponse(c, { accountId: c.get('member').accountId }),
)

export const postV1AuthMemberLogout = defineHandler(memberAuth(), async (c) => {
  await deleteSession(c.get('db'), c.get('member').tokenHash)
  return jsonResponse(c, { loggedOut: true })
})

export const getV1AuthMemberPasskeys = ceremonies.list
export const postV1AuthMemberPasskeysOptions = ceremonies.addOptions
export const postV1AuthMemberPasskeysAuthorizeOptions = ceremonies.authorizeAddOptions
export const postV1AuthMemberPasskeys = ceremonies.add
export const deleteV1AuthMemberPasskey = ceremonies.remove

export const getV1MemberPasses = defineHandler(memberAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  return jsonResponse(c, { passes: await listPasses(c.get('db'), c.get('member').accountId) })
})

export const postV1MemberPasses = defineHandler(memberAuth(), async (c) => {
  const parsed = v.safeParse(LinkPassesBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  const uids = parsed.output.uids.map((uid) => normalizeUid(uid)).filter((uid): uid is Hex => uid !== null)
  const linked = await linkPasses(c.get('db'), c.get('member').accountId, uids, c.get('now')())
  return jsonResponse(c, { linked })
})
