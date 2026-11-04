import { MemberSecretCopyBody, MemberSecretOutcomeBody, MemberVaultBody } from '@fuda/sdk'
import * as v from 'valibot'
import { defineHandler } from 'void'

import {
  addSecretCopy,
  clearSecret,
  countOutcome,
  memberSecret,
  readVault,
  writeVault,
} from '../auth/member-secret.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { memberAuth } from '../middleware/member-auth.ts'

// docs/specs/pass-types-and-flows.md#sensitive-use

export const getV1MemberSecret = defineHandler(memberAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  return jsonResponse(c, await memberSecret(c.get('db'), c.env.WEBAUTHN_RP_ID, c.get('member').accountId))
})

export const postV1MemberSecret = defineHandler(memberAuth(), async (c) => {
  const parsed = v.safeParse(MemberSecretCopyBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  const added = await addSecretCopy(c.env.DB, c.get('member').accountId, parsed.output, c.get('now')())
  return added ? jsonResponse(c, { added: true }) : errorResponse(c, 'secret_conflict', 409)
})

export const deleteV1MemberSecret = defineHandler(memberAuth(), async (c) => {
  await clearSecret(c.get('db'), c.get('member').accountId)
  return jsonResponse(c, { cleared: true })
})

export const postV1MemberSecretOutcome = defineHandler(memberAuth(), async (c) => {
  const parsed = v.safeParse(MemberSecretOutcomeBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  await countOutcome(c.get('db'), parsed.output.outcome)
  return jsonResponse(c, { counted: true })
})

export const getV1MemberVault = defineHandler(memberAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  return jsonResponse(c, { vault: await readVault(c.get('db'), c.get('member').accountId) })
})

export const putV1MemberVault = defineHandler(memberAuth(), async (c) => {
  const parsed = v.safeParse(MemberVaultBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  const version = await writeVault(c.get('db'), c.get('member').accountId, parsed.output, c.get('now')())
  return version === null ? errorResponse(c, 'vault_conflict', 409) : jsonResponse(c, { version })
})
