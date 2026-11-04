import type { PassBackup } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { cards, members, offchainAttestations, offchainRoots } from '../src/db/schema.ts'
import { restoreUrl } from '../src/pass/pass-row.ts'
import { anchorOffchainRoots } from '../src/passes/offchain-chores.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, ROOT, seedRoot } from './fixtures.ts'
import { CARD_INPUT, registerVenueWithCard, signIn } from './operator.ts'

const db = () => getDb({ DB: env.DB })

const setup = async () => {
  const chain = fakeChain({ signer: ROOT })
  const app = appWith({ chain, now: () => NOW })
  const bindings = configuredEnv(seedRoot(chain), {
    API_BASE_URL: 'https://api.test',
    PUBLIC_BASE_URL: 'https://fuda.test',
  })
  const { token } = await signIn(app, bindings)
  await registerVenueWithCard(
    app,
    bindings,
    { ...CARD_INPUT, card: { ...CARD_INPUT.card, record: 'offchain' } },
    token,
  )
  const claim = async (ip: string): Promise<{ uid: `0x${string}` }> => {
    const res = await app.request(
      `/v1/issuers/${CARD_INPUT.handle}/${CARD_INPUT.card.slug}/issue`,
      { headers: { 'CF-Connecting-IP': ip }, method: 'POST' },
      bindings,
    )
    return await res.json()
  }
  const backup = async (uid: string): Promise<Response> =>
    await app.request(`/pass/${uid}/backup`, {}, bindings)
  return { app, backup, bindings, chain, claim }
}

describe('GET /pass/:uid/backup', () => {
  beforeEach(async () => {
    await db().delete(offchainRoots)
    await db().delete(offchainAttestations)
    await db().delete(members)
    await db().delete(cards)
    await env.DB.prepare('DELETE FROM issuers').run()
    await env.DB.prepare('DELETE FROM rate_limits').run()
  })

  it('answers what is needed to keep and bring back an offchain pass', async () => {
    const { backup, claim } = await setup()
    const { uid } = await claim('203.0.113.90')
    const res = await backup(uid)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    await expect(res.json()).resolves.toMatchObject({
      attestation: { uid },
      handle: CARD_INPUT.handle,
      holder: `0x${'00'.repeat(20)}`,
      proof: null,
      qr: `fuda:v1:${uid}`,
      restoreUrl: `https://fuda.test/@${CARD_INPUT.handle}/${CARD_INPUT.card.slug}?uid=${uid}`,
      slug: CARD_INPUT.card.slug,
      uid,
      version: 1,
    })
  })

  it('adds the proof once the batch is timestamped', async () => {
    const { backup, chain, claim } = await setup()
    const { uid } = await claim('203.0.113.91')
    await claim('203.0.113.92')
    await anchorOffchainRoots(db(), chain, NOW)
    const res = await backup(uid)
    const body = await res.json<PassBackup>()
    const [root] = await db().select().from(offchainRoots)
    expect(body.proof).toMatchObject({ root: root?.root })
    expect(body.proof?.path).toHaveLength(1)
  })

  it('has no proof while the root is unsent', async () => {
    const { backup, chain, claim } = await setup()
    const { uid } = await claim('203.0.113.93')
    chain.failWrites = true
    await anchorOffchainRoots(db(), chain, NOW)
    const res = await backup(uid)
    await expect(res.json()).resolves.toMatchObject({ proof: null })
  })

  it('answers 404 for an unknown uid and 400 for a bad one', async () => {
    const { backup } = await setup()
    const unknown = await backup(`0x${'ab'.repeat(32)}`)
    expect(unknown.status).toBe(404)
    const bad = await backup('nope')
    expect(bad.status).toBe(400)
  })

  it('gives a card with no slug a link that still names the pass', () => {
    expect(restoreUrl('https://fuda.test', 'wassie-coffee', '', `0x${'ab'.repeat(32)}`)).toBe(
      `https://fuda.test/@wassie-coffee?uid=0x${'ab'.repeat(32)}`,
    )
  })
})
