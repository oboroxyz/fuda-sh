import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import {
  applePassDevices,
  applePassRegistrations,
  applePassUpdates,
  cards,
  cardStampSettings,
  entryLog,
  issuers,
  members,
  offchainAttestations,
  receptionRequests,
  sessions,
  slots,
  stampCredits,
} from '../src/db/schema.ts'
import type { Bindings } from '../src/env.ts'
import type { ApplePushResult, ApplePushSender } from '../src/pass/apple-push.ts'
import { applePassToken } from '../src/pass/apple-web-service.ts'
import { testCert } from './apple-cert.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, ROOT, seedRight, seedRoot } from './fixtures.ts'
import { CARD_INPUT, registerVenueWithCard, signIn } from './operator.ts'

const PASS_TYPE = 'pass.sh.fuda.membership'
const SECRET = 'web-service-secret'
const DEVICE = 'device-library-1'
const PUSH_TOKEN = 'ab'.repeat(32)
const db = getDb({ DB: env.DB })

const wipe = async (): Promise<void> => {
  await db.delete(applePassRegistrations)
  await db.delete(applePassDevices)
  await db.delete(applePassUpdates)
  await db.delete(cardStampSettings)
  await db.delete(stampCredits)
  await db.delete(receptionRequests)
  await db.delete(slots)
  await db.delete(entryLog)
  await db.delete(offchainAttestations)
  await db.delete(members)
  await db.delete(sessions)
  await db.delete(cards)
  await db.delete(issuers)
}

interface Pushed {
  passTypeId: string
  pushToken: string
}

interface WorldOptions {
  push?: ApplePushSender | null
  record?: 'offchain' | 'onchain'
  webService?: boolean
}

type PushAnswer = (pushToken: string) => Promise<ApplePushResult>

const SENT: PushAnswer = async () => await Promise.resolve({ outcome: 'sent' })

const world = async ({ push, record = 'onchain', webService = true }: WorldOptions = {}) => {
  const chain = fakeChain({ signer: ROOT })
  const delegation = seedRoot(chain)
  const pushed: Pushed[] = []
  let answer = SENT
  const recorder: ApplePushSender = async (pushToken, passTypeId) => {
    pushed.push({ passTypeId, pushToken })
    return await answer(pushToken)
  }
  const app = appWith({ applePush: push === undefined ? recorder : push, chain, now: () => NOW })
  const cert = await testCert()
  const bindings: Bindings = configuredEnv(delegation, {
    API_BASE_URL: 'https://api.test',
    APPLE_CERT_PEM: cert.certPem,
    APPLE_KEY_PEM: cert.keyPem,
    APPLE_PASS_TYPE_ID: PASS_TYPE,
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_WEB_SERVICE_SECRET: webService ? SECRET : undefined,
    APPLE_WWDR_PEM: cert.certPem,
  })
  const kept: Promise<unknown>[] = []
  const execution = {
    passThroughOnException: () => {},
    props: {},
    waitUntil: (promise: Promise<unknown>) => {
      kept.push(promise)
    },
  }
  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const response = await app.request(path, init, bindings, execution)
    await Promise.all(kept)
    return response
  }
  const { token } = await signIn(app, bindings)
  await registerVenueWithCard(app, bindings, { ...CARD_INPUT, card: { ...CARD_INPUT.card, record } }, token)
  const venue = await db.select().from(issuers).get()
  const card = await db.select().from(cards).get()
  if (venue === undefined || card === undefined) {
    throw new Error('the venue was not created')
  }
  await db.insert(cardStampSettings).values({ cardId: card.id, dailyLimit: 5, enabled: true, goal: 10 })
  const issueSeeded = async (memberId: string): Promise<Hex> => {
    const uid = seedRight(chain, delegation)
    await db.insert(members).values({
      attestationUid: uid,
      cardId: card.id,
      createdAt: NOW,
      issuerId: venue.id,
      level: 'bearer',
      memberId,
    })
    return uid
  }
  const authJson = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  return {
    authJson,
    bindings,
    card,
    issueSeeded,
    pushed,
    register: async (uid: Hex, device = DEVICE, pushToken = PUSH_TOKEN): Promise<Response> =>
      await request(`/apple/v1/devices/${device}/registrations/${PASS_TYPE}/${uid}`, {
        body: JSON.stringify({ pushToken }),
        headers: { authorization: `ApplePass ${await applePassToken(SECRET, uid)}` },
        method: 'POST',
      }),
    request,
    revoke: async (uid: Hex): Promise<Response> =>
      await request('/v1/revoke', { body: JSON.stringify({ uid }), headers: authJson, method: 'POST' }),
    setPushAnswer: (next: PushAnswer): void => {
      answer = next
    },
    stamp: async (uid: Hex): Promise<Response> =>
      await request('/v1/issuers/me/reception', {
        body: JSON.stringify({ qr: `fuda:v1:${uid}`, requestId: crypto.randomUUID() }),
        headers: authJson,
        method: 'POST',
      }),
  }
}

const claimOffchain = async (
  request: (path: string, init: RequestInit) => Promise<Response>,
): Promise<Hex> => {
  const claimed = await request(`/v1/issuers/${CARD_INPUT.handle}/${CARD_INPUT.card.slug}/issue`, {
    headers: { 'CF-Connecting-IP': '203.0.113.70' },
    method: 'POST',
  })
  const { uid } = await claimed.json<{ uid: Hex }>()
  return uid
}

const auth = async (uid: Hex, secret = SECRET): Promise<Record<string, string>> => ({
  authorization: `ApplePass ${await applePassToken(secret, uid)}`,
})

const list = async (
  request: (path: string) => Promise<Response>,
  since?: string,
  device = DEVICE,
): Promise<Response> =>
  await request(
    `/apple/v1/devices/${device}/registrations/${PASS_TYPE}${since === undefined ? '' : `?passesUpdatedSince=${since}`}`,
  )

const statusOf = async (pending: Promise<Response>): Promise<number> => {
  const { status } = await pending
  return status
}

const listed = async (response: Response): Promise<{ lastUpdated: string; serialNumbers: string[] }> =>
  await response.json<{ lastUpdated: string; serialNumbers: string[] }>()

const serialsOf = async (pending: Promise<{ serialNumbers: string[] }>): Promise<string[]> => {
  const { serialNumbers } = await pending
  return serialNumbers
}

// A stored ZIP, so pass.json sits in the archive as plain bytes.
const passJsonOf = async (response: Response): Promise<string> =>
  new TextDecoder('latin1').decode(await response.arrayBuffer())

const stored = async (): Promise<{ devices: number; registrations: number }> => {
  const [devices, registrations] = await Promise.all([
    db.select().from(applePassDevices),
    db.select().from(applePassRegistrations),
  ])
  return { devices: devices.length, registrations: registrations.length }
}

const log = (body: string): RequestInit => ({
  body,
  headers: { 'CF-Connecting-IP': '203.0.113.9' },
  method: 'POST',
})

const passPath = (uid: Hex): string => `/apple/v1/passes/${PASS_TYPE}/${uid}`

describe('the Wallet web service', () => {
  beforeEach(wipe)

  describe('registering a device', () => {
    it('answers 201, then 200 and keeps the rotated push token', async () => {
      const { issueSeeded, register } = await world()
      const uid = await issueSeeded('m1')
      await expect(statusOf(register(uid))).resolves.toBe(201)
      await expect(statusOf(register(uid, DEVICE, 'cd'.repeat(32)))).resolves.toBe(200)
      const device = await db.select().from(applePassDevices).get()
      expect(device?.pushToken).toBe('cd'.repeat(32))
      const rows = await db.select().from(applePassRegistrations)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ deviceId: DEVICE, serial: uid, uid })
    })

    it('refuses a missing token, another pass token and another scheme', async () => {
      const { issueSeeded, request } = await world()
      const uid = await issueSeeded('m1')
      const other = await issueSeeded('m2')
      const path = `/apple/v1/devices/${DEVICE}/registrations/${PASS_TYPE}/${uid}`
      const body = JSON.stringify({ pushToken: PUSH_TOKEN })
      const refused: Record<string, string>[] = [
        {},
        await auth(other),
        await auth(uid, 'another-secret'),
        { authorization: `Bearer ${await applePassToken(SECRET, uid)}` },
      ]
      const statuses = await Promise.all(
        refused.map(async (headers) => await statusOf(request(path, { body, headers, method: 'POST' }))),
      )
      expect(statuses).toStrictEqual([401, 401, 401, 401])
      await expect(db.select().from(applePassRegistrations)).resolves.toHaveLength(0)
    })

    it('answers 404 for a pass type that is not this deployment and 401 for a junk serial', async () => {
      const { issueSeeded, request } = await world()
      const uid = await issueSeeded('m1')
      const body = JSON.stringify({ pushToken: PUSH_TOKEN })
      const wrongType = await request(`/apple/v1/devices/${DEVICE}/registrations/pass.other/${uid}`, {
        body,
        headers: await auth(uid),
        method: 'POST',
      })
      expect(wrongType.status).toBe(404)
      const junk = await request(`/apple/v1/devices/${DEVICE}/registrations/${PASS_TYPE}/nope`, {
        body,
        headers: await auth(uid),
        method: 'POST',
      })
      expect(junk.status).toBe(401)
    })

    it('parses the push token, because it ends up in the APNs path', async () => {
      const { issueSeeded, register, request } = await world()
      const uid = await issueSeeded('m1')
      await expect(statusOf(register(uid, DEVICE, '../../evil'))).resolves.toBe(400)
      const noBody = await request(`/apple/v1/devices/${DEVICE}/registrations/${PASS_TYPE}/${uid}`, {
        body: 'not json',
        headers: await auth(uid),
        method: 'POST',
      })
      expect(noBody.status).toBe(400)
      await expect(db.select().from(applePassDevices)).resolves.toHaveLength(0)
    })

    it('answers 404 for a token over a pass that does not exist', async () => {
      const { register } = await world()
      await expect(statusOf(register(`0x${'9'.repeat(64)}`))).resolves.toBe(404)
    })
  })

  describe('unregistering a device', () => {
    it('removes the registration, and the device with its last registration', async () => {
      const { issueSeeded, register, request } = await world()
      const first = await issueSeeded('m1')
      const second = await issueSeeded('m2')
      await register(first)
      await register(second)
      const remove = async (uid: Hex): Promise<Response> =>
        await request(`/apple/v1/devices/${DEVICE}/registrations/${PASS_TYPE}/${uid}`, {
          headers: await auth(uid),
          method: 'DELETE',
        })
      await expect(statusOf(remove(first))).resolves.toBe(200)
      await expect(stored()).resolves.toStrictEqual({ devices: 1, registrations: 1 })
      await expect(statusOf(remove(second))).resolves.toBe(200)
      await expect(stored()).resolves.toStrictEqual({ devices: 0, registrations: 0 })
      await expect(statusOf(remove(second))).resolves.toBe(200)
    })

    it('refuses a wrong token and leaves the registration', async () => {
      const { issueSeeded, register, request } = await world()
      const uid = await issueSeeded('m1')
      await register(uid)
      const refused = await request(`/apple/v1/devices/${DEVICE}/registrations/${PASS_TYPE}/${uid}`, {
        headers: { authorization: 'ApplePass wrong' },
        method: 'DELETE',
      })
      expect(refused.status).toBe(401)
      await expect(db.select().from(applePassRegistrations)).resolves.toHaveLength(1)
    })
  })

  describe('listing updated serials', () => {
    it('answers 204 for a device it does not know', async () => {
      const { request } = await world()
      await expect(statusOf(list(request))).resolves.toBe(204)
    })

    it('answers every registered pass with no tag, then 204 from the tag it gave', async () => {
      const { issueSeeded, register, request } = await world()
      const uid = await issueSeeded('m1')
      await register(uid)
      const first = await list(request)
      expect(first.status).toBe(200)
      const body = await listed(first)
      expect(body.serialNumbers).toStrictEqual([uid])
      await expect(statusOf(list(request, body.lastUpdated))).resolves.toBe(204)
    })

    it('treats a malformed tag as no tag', async () => {
      const { issueSeeded, register, request } = await world()
      const uid = await issueSeeded('m1')
      await register(uid)
      const body = await listed(await list(request, 'garbage'))
      expect(body.serialNumbers).toStrictEqual([uid])
    })

    it('surfaces a pass with a changed tag after a stamp', async () => {
      const { issueSeeded, register, request, stamp } = await world()
      const uid = await issueSeeded('m1')
      await register(uid)
      const before = await listed(await list(request))
      await expect(statusOf(stamp(uid))).resolves.toBe(200)
      const after = await listed(await list(request, before.lastUpdated))
      expect(after.serialNumbers).toStrictEqual([uid])
      expect(Number(after.lastUpdated)).toBeGreaterThan(Number(before.lastUpdated))
      await expect(statusOf(list(request, after.lastUpdated))).resolves.toBe(204)
    })

    it('does not lose a second pass that changes in the second the device last asked', async () => {
      const { issueSeeded, register, request, stamp } = await world()
      const first = await issueSeeded('m1')
      const second = await issueSeeded('m2')
      await register(first)
      await register(second)
      await stamp(first)
      const asked = await listed(await list(request))
      await stamp(second)
      const next = await listed(await list(request, asked.lastUpdated))
      expect(next.serialNumbers).toStrictEqual([second])
    })

    it('answers only for the device asking', async () => {
      const { issueSeeded, register, request } = await world()
      await register(await issueSeeded('m1'))
      await expect(statusOf(list(request, undefined, 'another-device'))).resolves.toBe(204)
    })
  })

  describe('getting the latest pass', () => {
    it('refuses a wrong token', async () => {
      const { issueSeeded, request } = await world()
      const uid = await issueSeeded('m1')
      await expect(statusOf(request(passPath(uid)))).resolves.toBe(401)
      const other = await issueSeeded('m2')
      await expect(statusOf(request(passPath(uid), { headers: await auth(other) }))).resolves.toBe(401)
    })

    it('answers the pass, naming this web service, with Last-Modified', async () => {
      const { issueSeeded, register, request } = await world()
      const uid = await issueSeeded('m1')
      await register(uid)
      const res = await request(passPath(uid), { headers: await auth(uid) })
      expect([res.status, res.headers.get('content-type'), res.headers.get('last-modified')]).toStrictEqual([
        200,
        'application/vnd.apple.pkpass',
        new Date(NOW * 1000).toUTCString(),
      ])
      const json = await passJsonOf(res)
      expect(json).toContain('"webServiceURL":"https://api.test/apple"')
      expect(json).toContain(`"authenticationToken":"${await applePassToken(SECRET, uid)}"`)
      expect(json).not.toContain('"voided"')
    })

    it('answers 304 until a stamp changes it, even within the same second', async () => {
      const { issueSeeded, register, request, stamp } = await world()
      const uid = await issueSeeded('m1')
      await register(uid)
      const first = await request(passPath(uid), { headers: await auth(uid) })
      const lastModified = first.headers.get('last-modified') ?? ''
      const conditional = { ...(await auth(uid)), 'if-modified-since': lastModified }
      await expect(statusOf(request(passPath(uid), { headers: conditional }))).resolves.toBe(304)
      await stamp(uid)
      const updated = await request(passPath(uid), { headers: conditional })
      expect(updated.status).toBe(200)
      expect(updated.headers.get('last-modified')).not.toBe(lastModified)
    })

    it.each(['onchain', 'offchain'] as const)(
      'still serves a %s pass once revoked, showing it is no longer valid',
      async (record) => {
        const { issueSeeded, pushed, register, request, revoke } = await world({ record })
        const uid = record === 'onchain' ? await issueSeeded('m1') : await claimOffchain(request)
        await register(uid)
        const before = await listed(await list(request))
        await expect(statusOf(revoke(uid))).resolves.toBe(200)
        expect(pushed).toHaveLength(1)
        await expect(serialsOf(listed(await list(request, before.lastUpdated)))).resolves.toStrictEqual([uid])
        const res = await request(passPath(uid), { headers: await auth(uid) })
        const json = await passJsonOf(res)
        expect([res.status, json.includes('"voided":true'), json.includes('No longer valid')]).toStrictEqual([
          200,
          true,
          true,
        ])
      },
    )
  })

  describe('the log endpoint', () => {
    it('takes what Wallet reports, without a credential', async () => {
      const { request } = await world()
      const res = await request('/apple/v1/log', log(JSON.stringify({ logs: ['a failure'] })))
      expect(res.status).toBe(200)
    })

    it('refuses a payload that is not Apple shape, or is unbounded', async () => {
      const { request } = await world()
      await expect(statusOf(request('/apple/v1/log', log('{"logs":"nope"}')))).resolves.toBe(400)
      const flood = JSON.stringify({ logs: Array.from({ length: 51 }, () => 'x') })
      await expect(statusOf(request('/apple/v1/log', log(flood)))).resolves.toBe(400)
    })
  })

  describe('pushing a change', () => {
    it('pushes each registered device on the pass type topic after a stamp', async () => {
      const { issueSeeded, pushed, register, stamp } = await world()
      const uid = await issueSeeded('m1')
      await register(uid)
      await register(uid, 'device-library-2', 'cd'.repeat(32))
      await expect(statusOf(stamp(uid))).resolves.toBe(200)
      expect(pushed.map(({ pushToken }) => pushToken).toSorted()).toStrictEqual([PUSH_TOKEN, 'cd'.repeat(32)])
      expect(pushed.every(({ passTypeId }) => passTypeId === PASS_TYPE)).toBe(true)
    })

    it('has the new tag in place before the push goes out', async () => {
      const { issueSeeded, register, request, setPushAnswer, stamp } = await world()
      const uid = await issueSeeded('m1')
      await register(uid)
      const before = await listed(await list(request))
      let tagAtPush = 0
      setPushAnswer(async () => {
        const row = await db.select().from(applePassRegistrations).get()
        tagAtPush = row?.updatedTag ?? 0
        return { outcome: 'sent' }
      })
      await stamp(uid)
      expect(tagAtPush).toBeGreaterThan(Number(before.lastUpdated))
    })

    it('drops a device whose token APNs says is gone, and only that one', async () => {
      const { issueSeeded, register, setPushAnswer, stamp } = await world()
      const uid = await issueSeeded('m1')
      await register(uid)
      await register(uid, 'device-library-2', 'cd'.repeat(32))
      setPushAnswer(
        async (pushToken) =>
          await Promise.resolve(
            pushToken === PUSH_TOKEN ? { outcome: 'token_invalid' } : { outcome: 'sent' },
          ),
      )
      await stamp(uid)
      const kept = await db.select().from(applePassDevices)
      expect(kept.map(({ deviceId }) => deviceId)).toStrictEqual(['device-library-2'])
      await expect(stored()).resolves.toStrictEqual({ devices: 1, registrations: 1 })
    })

    it('keeps a device that registered a fresh token while the old one was being refused', async () => {
      const { issueSeeded, register, setPushAnswer, stamp } = await world()
      const uid = await issueSeeded('m1')
      await register(uid)
      const fresh = 'cd'.repeat(32)
      setPushAnswer(async () => {
        await db.update(applePassDevices).set({ pushToken: fresh })
        return { outcome: 'token_invalid' }
      })
      await stamp(uid)
      const device = await db.select().from(applePassDevices).get()
      expect(device?.pushToken).toBe(fresh)
      await expect(stored()).resolves.toStrictEqual({ devices: 1, registrations: 1 })
    })

    it('keeps a device after any other refusal', async () => {
      const { issueSeeded, register, setPushAnswer, stamp } = await world()
      const uid = await issueSeeded('m1')
      await register(uid)
      setPushAnswer(
        async () => await Promise.resolve({ outcome: 'failed', reason: 'BadCertificate', status: 403 }),
      )
      await expect(statusOf(stamp(uid))).resolves.toBe(200)
      await expect(db.select().from(applePassDevices)).resolves.toHaveLength(1)
    })

    it('never fails the stamp when the push throws', async () => {
      const { issueSeeded, register, request, setPushAnswer, stamp } = await world()
      const uid = await issueSeeded('m1')
      await register(uid)
      const before = await listed(await list(request))
      setPushAnswer(async () => await Promise.reject(new Error('connection refused')))
      const res = await stamp(uid)
      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toMatchObject({ decision: 'ADMIT' })
      await expect(db.select().from(stampCredits)).resolves.toHaveLength(1)
      await expect(statusOf(list(request, before.lastUpdated))).resolves.toBe(200)
    })

    it('pushes nothing for a pass with no device', async () => {
      const { issueSeeded, pushed, stamp } = await world()
      await stamp(await issueSeeded('m1'))
      expect(pushed).toHaveLength(0)
    })

    it('refreshes every pass under a venue that was edited', async () => {
      const { authJson, issueSeeded, pushed, register, request } = await world()
      const first = await issueSeeded('m1')
      const second = await issueSeeded('m2')
      await register(first)
      await register(second, 'device-library-2', 'cd'.repeat(32))
      const before = await listed(await list(request))
      await expect(
        statusOf(
          request('/v1/issuers/me', {
            body: JSON.stringify({ brandColor: '#112233', name: 'New name', tagline: '' }),
            headers: authJson,
            method: 'PUT',
          }),
        ),
      ).resolves.toBe(200)
      expect(pushed).toHaveLength(2)
      await expect(serialsOf(listed(await list(request, before.lastUpdated)))).resolves.toStrictEqual([first])
      const row = await db.select().from(applePassUpdates).where(eq(applePassUpdates.uid, second)).get()
      expect(row?.tag).toBeGreaterThan(Number(before.lastUpdated))
    })

    it('refreshes the passes under a card whose stamp settings changed', async () => {
      const { authJson, card, issueSeeded, pushed, register, request } = await world()
      const uid = await issueSeeded('m1')
      await register(uid)
      const before = await listed(await list(request))
      await expect(
        statusOf(
          request(`/v1/issuers/me/cards/${card.id}/stamps`, {
            body: JSON.stringify({ dailyLimit: 1, enabled: true, goal: 12 }),
            headers: authJson,
            method: 'PUT',
          }),
        ),
      ).resolves.toBe(200)
      expect(pushed).toHaveLength(1)
      await expect(serialsOf(listed(await list(request, before.lastUpdated)))).resolves.toStrictEqual([uid])
    })
  })

  describe('with the certificate binding missing', () => {
    it('still records the change for pull to refresh, and pushes nothing', async () => {
      const { issueSeeded, register, request, stamp } = await world({ push: null })
      const uid = await issueSeeded('m1')
      await register(uid)
      const before = await listed(await list(request))
      await expect(statusOf(stamp(uid))).resolves.toBe(200)
      await expect(serialsOf(listed(await list(request, before.lastUpdated)))).resolves.toStrictEqual([uid])
    })
  })

  describe('with the secret unset', () => {
    it('answers 501 on every route', async () => {
      const { issueSeeded, request } = await world({ webService: false })
      const uid = await issueSeeded('m1')
      const registrations = `/apple/v1/devices/${DEVICE}/registrations/${PASS_TYPE}`
      const statuses = await Promise.all([
        statusOf(
          request(`${registrations}/${uid}`, {
            body: JSON.stringify({ pushToken: PUSH_TOKEN }),
            headers: await auth(uid),
            method: 'POST',
          }),
        ),
        statusOf(request(`${registrations}/${uid}`, { headers: await auth(uid), method: 'DELETE' })),
        statusOf(request(registrations)),
        statusOf(request(`/apple/v1/passes/${PASS_TYPE}/${uid}`, { headers: await auth(uid) })),
      ])
      expect(statuses).toStrictEqual([501, 501, 501, 501])
    })

    it('builds a snapshot that names no web service', async () => {
      const { issueSeeded, request } = await world({ webService: false })
      const uid = await issueSeeded('m1')
      const pass = await request(`/pass/${uid}/apple.pkpass`)
      expect(pass.status).toBe(200)
      const json = await passJsonOf(pass)
      expect(json).not.toContain('webServiceURL')
      expect(json).not.toContain('authenticationToken')
      expect(json).not.toContain('"Status"')
    })

    it('records nothing and pushes nothing when a pass changes', async () => {
      const { issueSeeded, pushed, stamp } = await world({ webService: false })
      await expect(statusOf(stamp(await issueSeeded('m1')))).resolves.toBe(200)
      expect(pushed).toHaveLength(0)
      await expect(db.select().from(applePassUpdates)).resolves.toHaveLength(0)
    })
  })

  it('names the web service in a fresh download once the secret is set', async () => {
    const { issueSeeded, request } = await world()
    const uid = await issueSeeded('m1')
    const pass = await request(`/pass/${uid}/apple.pkpass`)
    await expect(passJsonOf(pass)).resolves.toContain('"webServiceURL":"https://api.test/apple"')
  })
})
