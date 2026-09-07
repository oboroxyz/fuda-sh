import type { MembersResponse } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Bindings } from '../src/env.ts'
import { appWith, fakeChain, testEnv } from './env.ts'
import { CARD_INPUT, getJson, postJson, SECOND_CARD, signIn } from './operator.ts'

const ADMIN = 'admin-token'

const bindings = (): Bindings => testEnv({ ADMIN_TOKEN: ADMIN })

// A second venue, so "sees only its own" has something to be wrong about.
const OTHER_VENUE = { ...CARD_INPUT, handle: 'other-cafe', name: 'Other Cafe' }

// The member's tap: no account, no token, and the client IP the budget counts.
let nextIp = 0
const claim = async (app: ReturnType<typeof appWith>, path: string): Promise<Response> => {
  nextIp += 1
  return await app.request(
    path,
    { headers: { 'CF-Connecting-IP': `203.0.113.${nextIp}` }, method: 'POST' },
    bindings(),
  )
}

const venue = async (
  app: ReturnType<typeof appWith>,
  input: typeof CARD_INPUT,
): Promise<{ token: string; uid: string; memberNumber: string }> => {
  const account = privateKeyToAccount(generatePrivateKey())
  const { token } = await signIn(app, bindings(), account)
  await postJson(app, bindings(), '/v1/issuers', input, token)
  const claimed = await claim(app, `/v1/issuers/${input.handle}/${input.card.slug}/issue`)
  const body = await claimed.json<{ memberNumber: string; uid: string }>()
  return { memberNumber: body.memberNumber, token, uid: body.uid }
}

const resetTables = async (): Promise<void> => {
  await env.DB.exec('DELETE FROM members')
  await env.DB.exec('DELETE FROM cards')
  await env.DB.exec('DELETE FROM issuers')
  await env.DB.exec('DELETE FROM sessions')
  await env.DB.exec('DELETE FROM rate_limits')
}

describe('operator-scoped members and revoke', () => {
  beforeEach(resetTables)

  it('shows a venue its own members and not another venue’s', async () => {
    const app = appWith({ chain: fakeChain() })
    const mine = await venue(app, CARD_INPUT)
    const theirs = await venue(app, OTHER_VENUE)

    const listed = await getJson(app, bindings(), '/v1/members', mine.token)
    const { members } = await listed.json<MembersResponse>()

    expect(members.map((row) => row.uid)).toStrictEqual([mine.uid])
    expect(members.map((row) => row.uid)).not.toContain(theirs.uid)
  })

  it('still shows fuda’s admin token every venue', async () => {
    const app = appWith({ chain: fakeChain() })
    const mine = await venue(app, CARD_INPUT)
    const theirs = await venue(app, OTHER_VENUE)

    const listed = await getJson(app, bindings(), '/v1/members', ADMIN)
    const { members } = await listed.json<MembersResponse>()

    expect(members.map((row) => row.uid).toSorted()).toStrictEqual([mine.uid, theirs.uid].toSorted())
  })

  it('lets a venue revoke its own right', async () => {
    const app = appWith({ chain: fakeChain() })
    const mine = await venue(app, CARD_INPUT)

    const revoked = await postJson(app, bindings(), '/v1/revoke', { uid: mine.uid }, mine.token)

    expect(revoked.status).toBe(200)
    await expect(revoked.json()).resolves.toStrictEqual({ revoked: true, uid: mine.uid })
  })

  it('hides another venue’s right behind a 404 rather than refusing it', async () => {
    const app = appWith({ chain: fakeChain() })
    const mine = await venue(app, CARD_INPUT)
    const theirs = await venue(app, OTHER_VENUE)

    const refused = await postJson(app, bindings(), '/v1/revoke', { uid: theirs.uid }, mine.token)

    expect(refused.status).toBe(404)
    const stillListed = await getJson(app, bindings(), '/v1/members', theirs.token)
    await expect(stillListed.json<MembersResponse>()).resolves.toMatchObject({
      members: [{ status: 'active' }],
    })
  })

  it('refuses a token that is neither a session nor the admin token', async () => {
    const app = appWith({ chain: fakeChain() })
    await venue(app, CARD_INPUT)

    const listed = await getJson(app, bindings(), '/v1/members', 'not-a-token')

    expect(listed.status).toBe(401)
  })
})

describe('a venue with a second card', () => {
  beforeEach(resetTables)

  it('keeps both cards’ members in one list', async () => {
    const app = appWith({ chain: fakeChain() })
    const mine = await venue(app, CARD_INPUT)
    await postJson(app, bindings(), '/v1/issuers/cards', SECOND_CARD, mine.token)
    const second = await claim(app, `/v1/issuers/${CARD_INPUT.handle}/${SECOND_CARD.slug}/issue`)
    const { uid } = await second.json<{ uid: string }>()

    const listed = await getJson(app, bindings(), '/v1/members', mine.token)
    const { members } = await listed.json<MembersResponse>()

    expect(members.map((row) => row.uid).toSorted()).toStrictEqual([mine.uid, uid].toSorted())
  })
})
