import { normalizeUid } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'
import type { Context } from 'hono'
import * as v from 'valibot'
import { defineHandler } from 'void'

import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { DEFAULT_BUDGET, rateLimit } from '../middleware/rate-limit.ts'
import {
  passUpdatedAt,
  registerDevice,
  unregisterDevice,
  updatedSerials,
} from '../pass/apple-registrations.ts'
import { appleAuthorized, appleWebServiceFrom } from '../pass/apple-web-service.ts'
import type { AppleWebService } from '../pass/apple-web-service.ts'
import { loadPassRow } from '../pass/pass-row.ts'
import { buildApplePass } from './pass.ts'

// docs/specs/pass-types-and-flows.md#apple-wallet-updates. The paths and answers are
// Apple's: developer.apple.com/documentation/walletpasses.

const DeviceId = v.pipe(v.string(), v.regex(/^[\w.-]{1,255}$/u))
// Goes into the APNs request path, so nothing but hex gets through.
const RegisterBody = v.object({ pushToken: v.pipe(v.string(), v.regex(/^[\da-f]{1,512}$/iu)) })
const LogBody = v.object({
  logs: v.pipe(v.array(v.pipe(v.string(), v.maxLength(2048))), v.maxLength(50)),
})

type Service = { ok: true; service: AppleWebService } | { ok: false; res: Response }

const serviceFor = (c: Context<AppEnv>, passTypeId: string | undefined): Service => {
  c.header('cache-control', 'no-store')
  const service = appleWebServiceFrom(c.env)
  if (service === null) {
    return { ok: false, res: errorResponse(c, 'apple_not_configured', 501) }
  }
  return passTypeId === service.passTypeId
    ? { ok: true, service }
    : { ok: false, res: errorResponse(c, 'not_found', 404) }
}

type AuthorizedPass = { ok: true; uid: Hex } | { ok: false; res: Response }

const authorizedPass = async (
  c: Context<AppEnv>,
  passTypeId: string,
  serial: string,
): Promise<AuthorizedPass> => {
  const found = serviceFor(c, passTypeId)
  if (!found.ok) {
    return found
  }
  const uid = normalizeUid(serial)
  return uid !== null && (await appleAuthorized(found.service.secret, uid, c.req.header('authorization')))
    ? { ok: true, uid }
    : { ok: false, res: errorResponse(c, 'unauthorized', 401) }
}

export const postAppleRegistration = defineHandler(async (c) => {
  const { deviceId, passTypeId, serial } = c.req.param()
  const auth = await authorizedPass(c, passTypeId, serial)
  if (!auth.ok) {
    return auth.res
  }
  const device = v.safeParse(DeviceId, deviceId)
  const body = v.safeParse(RegisterBody, await c.req.json().catch(() => null))
  if (!device.success || !body.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  const found = await loadPassRow(c, auth.uid)
  if (!found.ok) {
    return found.res
  }
  const created = await registerDevice(c.env.DB, {
    deviceId: device.output,
    now: c.get('now')(),
    pushToken: body.output.pushToken,
    serial,
    uid: auth.uid,
  })
  return c.body(null, created ? 201 : 200)
})

export const deleteAppleRegistration = defineHandler(async (c) => {
  const { deviceId, passTypeId, serial } = c.req.param()
  const auth = await authorizedPass(c, passTypeId, serial)
  if (!auth.ok) {
    return auth.res
  }
  const device = v.safeParse(DeviceId, deviceId)
  if (!device.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  await unregisterDevice(c.env.DB, device.output, auth.uid)
  return c.body(null, 200)
})

const tagOf = (raw: string | undefined): number => {
  const tag = Number(raw)
  return Number.isSafeInteger(tag) && tag > 0 ? tag : 0
}

// No Authorization header on this one: the request names no pass, and Apple has the
// device library id act as the shared secret. An unknown device simply has nothing new.
export const getAppleRegistrations = defineHandler(async (c) => {
  const { deviceId, passTypeId } = c.req.param()
  const found = serviceFor(c, passTypeId)
  if (!found.ok) {
    return found.res
  }
  const device = v.safeParse(DeviceId, deviceId)
  if (!device.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  const updated = await updatedSerials(c.env.DB, device.output, tagOf(c.req.query('passesUpdatedSince')))
  return updated === null ? c.body(null, 204) : jsonResponse(c, updated)
})

const httpDate = (seconds: number): string => new Date(seconds * 1000).toUTCString()

// Revocation does not refuse this: a revoked pass still answers, showing it no longer applies.
export const getApplePass = defineHandler(async (c) => {
  const { passTypeId, serial } = c.req.param()
  const auth = await authorizedPass(c, passTypeId, serial)
  if (!auth.ok) {
    return auth.res
  }
  const found = await loadPassRow(c, auth.uid)
  if (!found.ok) {
    return found.res
  }
  const updatedAt = await passUpdatedAt(c.env.DB, auth.uid)
  const since = Date.parse(c.req.header('if-modified-since') ?? '')
  if (updatedAt !== null && updatedAt * 1000 <= since) {
    return c.body(null, 304, { 'last-modified': httpDate(updatedAt) })
  }
  const pkpass = await buildApplePass(c, found.row)
  if (pkpass === null) {
    return errorResponse(c, 'apple_not_configured', 501)
  }
  return new Response(pkpass, {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/vnd.apple.pkpass',
      'last-modified': httpDate(updatedAt ?? c.get('now')()),
    },
  })
})

// Carries no credential, per Apple, so it is rate limited and bounded and writes only to
// the Worker's log. Wallet reports its own web service errors here.
export const postAppleLog = defineHandler(rateLimit({ budget: DEFAULT_BUDGET }), async (c) => {
  c.header('cache-control', 'no-store')
  const body = v.safeParse(LogBody, await c.req.json().catch(() => null))
  if (!body.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  // oxlint-disable-next-line no-console -- Wallet's own report is only useful in wrangler tail
  console.warn('[fuda-api] Wallet log', JSON.stringify(body.output.logs))
  return c.body(null, 200)
})
