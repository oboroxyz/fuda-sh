import { LinkPassesBody, normalizeUid } from '@fuda/sdk'
import * as v from 'valibot'
import type { Hex } from 'viem'
import { defineHandler } from 'void'

import { linkPasses, listPasses } from '../auth/member-passes.ts'
import {
  addOptions,
  addPasskey,
  claimOptions,
  claimingPasskey,
  listPasskeys,
  login,
  loginOptions,
  register,
  registerOptions,
  relyingParty,
  removePasskey,
} from '../auth/member-passkey.ts'
import { createSession, deleteSession } from '../auth/session.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { memberAuth } from '../middleware/member-auth.ts'
import { passkeyCeremonies } from './passkey-ceremonies.ts'

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
export const getV1AuthMemberPasskeys = ceremonies.list
export const postV1AuthMemberPasskeysOptions = ceremonies.addOptions
export const postV1AuthMemberPasskeys = ceremonies.add
export const deleteV1AuthMemberPasskey = ceremonies.remove

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

export const getV1AuthMemberPasskeys = defineHandler(memberAuth(), async (c) => {
  const rows = await listPasskeys(c.get('db'), c.get('member').accountId)
  return jsonResponse(c, {
    passkeys: rows.map(({ copy, ...row }) => ({
      ...row,
      backedUp: row.backedUp !== 0,
      holdsSecret: copy !== null,
    })),
  })
})

export const postV1AuthMemberPasskeysOptions = defineHandler(memberAuth(), async (c) => {
  const options = await addOptions(
    c.get('db'),
    relyingParty(c.env),
    c.get('member').accountId,
    c.get('now')(),
  )
  return options === null ? errorResponse(c, 'unauthorized', 401) : jsonResponse(c, options)
})

export const postV1AuthMemberPasskeysAuthorizeOptions = defineHandler(memberAuth(), async (c) =>
  jsonResponse(
    c,
    await claimOptions(
      c.get('db'),
      relyingParty(c.env),
      c.get('member').accountId,
      c.get('now')(),
      'authorize-add',
    ),
  ),
)

export const postV1AuthMemberPasskeys = defineHandler(memberAuth(), async (c) => {
  const parsed = v.safeParse(
    v.intersect([PasskeyRegistrationBody, v.object({ authorization: PasskeyAuthenticationBody })]),
    await c.req.json().catch(() => null),
  )
  if (!parsed.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  const authorized = await claimingPasskey(
    c.get('db'),
    relyingParty(c.env),
    c.get('member').accountId,
    parsed.output.authorization,
    c.get('now')(),
    'authorize-add',
  )
  if (authorized === null) {
    return errorResponse(c, 'bad_passkey', 403)
  }
  const result = await addPasskey(
    c.get('db'),
    relyingParty(c.env),
    c.get('member').accountId,
    parsed.output,
    c.get('now')(),
  )
  if (result === 'limit') {
    return errorResponse(c, 'passkey_limit', 409)
  }
  // 403 and not the ceremonies' usual 401, as for a claim: the session is fine, and the
  // member app's Worker ends a session on any 401 it forwards.
  return result === 'added' ? jsonResponse(c, { added: true }) : errorResponse(c, 'bad_passkey', 403)
})

// A refusal does not say whether the id exists on another account.
export const deleteV1AuthMemberPasskey = defineHandler(memberAuth(), async (c) => {
  const removed = await removePasskey(c.get('db'), c.get('member').accountId, c.req.param().id)
  return removed ? jsonResponse(c, { removed: true }) : errorResponse(c, 'last_passkey', 409)
})

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
