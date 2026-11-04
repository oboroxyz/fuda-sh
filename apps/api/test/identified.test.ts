import type { MemberPassesResponse, MemberSignInResponse } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { ZERO_ADDRESS } from '../src/chain/client.ts'
import { getDb } from '../src/db/client.ts'
import { cards, entryLog, members, offchainAttestations, passkeys, slots } from '../src/db/schema.ts'
import { decodeHolderKey, decodeOffchainPass, fromSignedJson } from '../src/eas/offchain.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, ROOT, seedRoot } from './fixtures.ts'
import { CARD_INPUT, postJson, registerVenueWithCard, signIn } from './operator.ts'
import { SoftwarePasskey } from './software-passkey.ts'

const RP = { origin: 'https://app.fuda.sh', rpId: 'fuda.sh' }
const CLAIM_PATH = `/v1/issuers/${CARD_INPUT.handle}/${CARD_INPUT.card.slug}/issue`
const FLAG_UP_ONLY = 0x01

const db = () => getDb({ DB: env.DB })

interface Issued {
  holder: Hex
  level: string
  memberNumber: string
  qr: string
  uid: Hex
}

interface Verdict {
  decision: string
  holder?: Hex
  reason: string
  stage?: string
}

interface Minted {
  challenge: string
  nonce: Hex
  webauthn?: { allowCredentials?: { id: string }[]; challenge: string; rpId?: string }
}

const setup = async (card: Partial<typeof CARD_INPUT.card> = {}) => {
  const chain = fakeChain({ signer: ROOT })
  const app = appWith({ chain, now: () => NOW })
  const bindings = configuredEnv(seedRoot(chain), {
    API_BASE_URL: 'https://api.test',
    WEBAUTHN_ORIGINS: RP.origin,
    WEBAUTHN_RP_ID: RP.rpId,
  })
  const { token: operator } = await signIn(app, bindings)
  await registerVenueWithCard(
    app,
    bindings,
    { ...CARD_INPUT, card: { ...CARD_INPUT.card, identity: 'passkey', record: 'offchain', ...card } },
    operator,
  )
  const request = async (path: string, body: unknown, token = ''): Promise<Response> =>
    await app.request(
      path,
      {
        body: JSON.stringify(body),
        headers: {
          'CF-Connecting-IP': '203.0.113.91',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
      bindings,
    )
  const optionsFrom = async (path: string, token = ''): Promise<{ challenge: string }> => {
    const res = await request(path, {}, token)
    expect(res.status).toBe(200)
    return await res.json<{ challenge: string }>()
  }
  const signUp = async (passkey: SoftwarePasskey): Promise<string> => {
    const { challenge } = await optionsFrom('/v1/auth/member/register/options')
    const res = await request('/v1/auth/member/register', await passkey.attest(challenge))
    expect(res.status).toBe(200)
    const { token } = await res.json<MemberSignInResponse>()
    return token
  }
  const claimWith = async (token: string, passkey: SoftwarePasskey): Promise<Response> => {
    const { challenge } = await optionsFrom('/v1/auth/member/claim/options', token)
    return await request(CLAIM_PATH, { webauthn: await passkey.assert(challenge) }, token)
  }
  const claimed = async (passkey: SoftwarePasskey): Promise<{ pass: Issued; token: string }> => {
    const token = await signUp(passkey)
    const res = await claimWith(token, passkey)
    expect(res.status).toBe(200)
    return { pass: await res.json<Issued>(), token }
  }
  const mint = async (uid: Hex): Promise<Minted> => {
    const res = await request('/v1/challenge', { uid })
    return await res.json<Minted>()
  }
  const present = async (
    uid: Hex,
    passkey: SoftwarePasskey,
    overrides: Parameters<SoftwarePasskey['assert']>[1] = {},
  ): Promise<Verdict> => {
    const minted = await mint(uid)
    const res = await request('/v1/verify-signed', {
      nonce: minted.nonce,
      uid,
      webauthn: await passkey.assert(minted.webauthn?.challenge ?? '', overrides),
    })
    expect(res.status).toBe(200)
    return await res.json<Verdict>()
  }
  return { app, bindings, chain, claimWith, claimed, mint, operator, optionsFrom, present, request, signUp }
}

const passkey = (): SoftwarePasskey => new SoftwarePasskey(RP)

describe('identified passes', () => {
  beforeEach(async () => {
    await db().delete(offchainAttestations)
    await db().delete(slots)
    await db().delete(entryLog)
    await db().delete(members)
    await db().delete(cards)
    await env.DB.prepare('DELETE FROM member_passes').run()
    await db().delete(passkeys)
    await env.DB.prepare('DELETE FROM sessions').run()
    await env.DB.prepare('DELETE FROM accounts').run()
    await env.DB.prepare('DELETE FROM issuers').run()
    await env.DB.prepare('DELETE FROM rate_limits').run()
  })

  describe('the card setting', () => {
    it('refuses a passkey on an on-chain card', async () => {
      const chain = fakeChain({ signer: ROOT })
      const app = appWith({ chain, now: () => NOW })
      const bindings = configuredEnv(seedRoot(chain))
      const { token } = await signIn(app, bindings)
      await registerVenueWithCard(app, bindings, CARD_INPUT, token)
      const res = await postJson(
        app,
        bindings,
        '/v1/issuers/cards',
        { ...CARD_INPUT.card, identity: 'passkey', record: 'onchain', slug: 'other' },
        token,
      )
      expect(res.status).toBe(400)
    })

    it('is refused by the database on an on-chain card too', async () => {
      const { app, bindings, operator } = await setup()
      const made = await postJson(
        app,
        bindings,
        '/v1/issuers/cards',
        { ...CARD_INPUT.card, record: 'onchain', slug: 'public' },
        operator,
      )
      expect(made.status).toBe(201)
      await expect(
        env.DB.prepare("UPDATE cards SET identity = 'passkey' WHERE slug = 'public'").run(),
      ).rejects.toThrow(/CHECK constraint/u)
    })

    it('tells a member page and defaults to none', async () => {
      const { app, bindings, operator } = await setup()
      const made = await postJson(
        app,
        bindings,
        '/v1/issuers/cards',
        { ...CARD_INPUT.card, identity: undefined, record: 'offchain', slug: 'plain' },
        operator,
      )
      expect(made.status).toBe(201)
      const venue = await app.request(`/v1/issuers/${CARD_INPUT.handle}`, {}, bindings)
      const { cards: listed } = await venue.json<{ cards: { identity: string; slug: string }[] }>()
      expect(Object.fromEntries(listed.map(({ identity, slug }) => [slug, identity]))).toStrictEqual({
        plain: 'none',
        [CARD_INPUT.card.slug]: 'passkey',
      })
    })

    it('cannot be changed by an edit', async () => {
      const { app, bindings, operator } = await setup()
      const [row] = await db().select({ id: cards.id }).from(cards)
      const res = await app.request(
        `/v1/issuers/me/cards/${row?.id ?? ''}`,
        {
          body: JSON.stringify({
            category: 'membership',
            claimFrom: null,
            claimUntil: null,
            description: '',
            identity: 'none',
            lockScreen: false,
            title: 'Membership Card',
            validFrom: null,
            validUntil: null,
            validityDays: null,
          }),
          headers: { authorization: `Bearer ${operator}`, 'content-type': 'application/json' },
          method: 'PUT',
        },
        bindings,
      )
      expect(res.status).toBe(400)
    })
  })

  describe('claiming', () => {
    it('signs the passkey into a pass with no address', async () => {
      const { claimed } = await setup()
      const key = passkey()
      const { pass } = await claimed(key)
      expect(pass).toMatchObject({ holder: ZERO_ADDRESS, level: 'signed' })

      const member = await db().select().from(members).where(eq(members.attestationUid, pass.uid)).get()
      expect(member).toMatchObject({ holder: null, level: 'signed' })

      const stored = await db()
        .select()
        .from(offchainAttestations)
        .where(eq(offchainAttestations.uid, pass.uid))
        .get()
      const signed = fromSignedJson(stored?.signed ?? '')
      const data = decodeOffchainPass(signed?.message.data ?? '0x')
      expect(signed?.message.recipient).toBe(ZERO_ADDRESS)
      expect(data.level).toBe(1)
      const registered = await db()
        .select()
        .from(passkeys)
        .where(eq(passkeys.credentialId, key.credentialId))
        .get()
      expect(decodeHolderKey(data.holderKey)).toStrictEqual({
        credentialId: key.credentialId,
        publicKey: `0x${registered?.publicKey ?? ''}`,
      })
    })

    it('keeps the pass on the account at once', async () => {
      const { app, bindings, claimed } = await setup()
      const { pass, token } = await claimed(passkey())
      const listed = await app.request(
        '/v1/member/passes',
        { headers: { authorization: `Bearer ${token}` } },
        bindings,
      )
      const { passes } = await listed.json<MemberPassesResponse>()
      expect(passes.map(({ uid }) => uid)).toStrictEqual([pass.uid])
    })

    it('reserves a capacity place like any other claim', async () => {
      const { claimWith, signUp } = await setup({ capacity: 1 })
      const first = passkey()
      const second = passkey()
      const firstToken = await signUp(first)
      const secondToken = await signUp(second)
      const taken = await claimWith(firstToken, first)
      expect(taken.status).toBe(200)
      const refused = await claimWith(secondToken, second)
      expect(refused.status).toBe(409)
      await expect(refused.json()).resolves.toStrictEqual({ error: 'card_sold_out' })
    })

    it('needs a member session', async () => {
      const { request, signUp, optionsFrom } = await setup()
      const key = passkey()
      const token = await signUp(key)
      const { challenge } = await optionsFrom('/v1/auth/member/claim/options', token)
      const res = await request(CLAIM_PATH, { webauthn: await key.assert(challenge) })
      expect(res.status).toBe(401)
      const noOptions = await request('/v1/auth/member/claim/options', {})
      expect(noOptions.status).toBe(401)
      await expect(db().select().from(members)).resolves.toStrictEqual([])
    })

    it('needs an assertion', async () => {
      const { request, signUp } = await setup()
      const res = await request(CLAIM_PATH, {}, await signUp(passkey()))
      expect(res.status).toBe(400)
    })

    it("refuses another account's passkey without ending the session", async () => {
      const { claimWith, signUp } = await setup()
      const mine = passkey()
      const theirs = passkey()
      const token = await signUp(mine)
      await signUp(theirs)
      const res = await claimWith(token, theirs)
      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toStrictEqual({ error: 'bad_passkey' })
      await expect(db().select().from(members)).resolves.toStrictEqual([])
    })

    it('refuses a challenge minted for another account', async () => {
      const { optionsFrom, request, signUp } = await setup()
      const mine = passkey()
      const mineToken = await signUp(mine)
      const otherToken = await signUp(passkey())
      const { challenge } = await optionsFrom('/v1/auth/member/claim/options', otherToken)
      const res = await request(CLAIM_PATH, { webauthn: await mine.assert(challenge) }, mineToken)
      expect(res.status).toBe(403)
    })

    it('refuses a challenge meant for signing in', async () => {
      const { optionsFrom, request, signUp } = await setup()
      const key = passkey()
      const token = await signUp(key)
      const { challenge } = await optionsFrom('/v1/auth/member/login/options')
      const res = await request(CLAIM_PATH, { webauthn: await key.assert(challenge) }, token)
      expect(res.status).toBe(403)
    })

    it('refuses a replayed challenge', async () => {
      const { optionsFrom, request, signUp } = await setup()
      const key = passkey()
      const token = await signUp(key)
      const { challenge } = await optionsFrom('/v1/auth/member/claim/options', token)
      const webauthn = await key.assert(challenge)
      const first = await request(CLAIM_PATH, { webauthn }, token)
      const again = await request(CLAIM_PATH, { webauthn }, token)
      expect([first.status, again.status]).toStrictEqual([200, 403])
      await expect(db().select().from(members)).resolves.toHaveLength(1)
    })
  })

  describe('presenting', () => {
    it('asks for the attested passkey only, on the exact challenge', async () => {
      const { claimed, mint } = await setup()
      const key = passkey()
      const { pass } = await claimed(key)
      const minted = await mint(pass.uid)
      expect(minted.webauthn?.allowCredentials?.map(({ id }) => id)).toStrictEqual([key.credentialId])
      expect(minted.webauthn?.rpId).toBe(RP.rpId)
      expect(atob(minted.webauthn?.challenge.replaceAll('-', '+').replaceAll('_', '/') ?? '')).toBe(
        minted.challenge,
      )
    })

    it('admits the passkey that claimed it, with no address', async () => {
      const { claimed, present } = await setup()
      const key = passkey()
      const { pass } = await claimed(key)
      await expect(present(pass.uid, key)).resolves.toStrictEqual({
        decision: 'ADMIT',
        holder: ZERO_ADDRESS,
        path: 'signature',
        reason: 'OK',
        venue: CARD_INPUT.handle,
      })
      await expect(db().select().from(entryLog).where(eq(entryLog.uid, pass.uid))).resolves.toMatchObject([
        { decision: 'ADMIT', path: 'signature', reason: 'OK' },
      ])
    })

    it('still admits when the account has dropped that passkey', async () => {
      const { claimed, present } = await setup()
      const key = passkey()
      const { pass } = await claimed(key)
      await db().delete(passkeys).where(eq(passkeys.credentialId, key.credentialId))
      await expect(present(pass.uid, key)).resolves.toMatchObject({ decision: 'ADMIT' })
    })

    it('refuses another passkey, named as itself or as the attested one', async () => {
      const { claimed, present } = await setup()
      const key = passkey()
      const other = passkey()
      const { pass } = await claimed(key)
      await expect(present(pass.uid, other)).resolves.toMatchObject({
        decision: 'REJECT',
        reason: 'BAD_SIGNATURE',
      })
      await expect(present(pass.uid, key, { signWith: other })).resolves.toMatchObject({
        decision: 'REJECT',
        reason: 'BAD_SIGNATURE',
      })
    })

    it('refuses a wrong origin, and a passkey that did not verify the user', async () => {
      const { claimed, present } = await setup()
      const key = passkey()
      const { pass } = await claimed(key)
      await expect(present(pass.uid, key, { origin: 'https://evil.test' })).resolves.toMatchObject({
        decision: 'REJECT',
        reason: 'BAD_SIGNATURE',
      })
      await expect(present(pass.uid, key, { flags: FLAG_UP_ONLY })).resolves.toMatchObject({
        decision: 'REJECT',
        reason: 'BAD_SIGNATURE',
      })
    })

    it('burns the challenge even when the assertion is wrong', async () => {
      const { claimed, mint, request } = await setup()
      const key = passkey()
      const { pass } = await claimed(key)
      const minted = await mint(pass.uid)
      const challenge = minted.webauthn?.challenge ?? ''
      const first = await request('/v1/verify-signed', {
        nonce: minted.nonce,
        uid: pass.uid,
        webauthn: await key.assert(challenge, { origin: 'https://evil.test' }),
      })
      await expect(first.json()).resolves.toMatchObject({ reason: 'BAD_SIGNATURE' })
      const replay = await request('/v1/verify-signed', {
        nonce: minted.nonce,
        uid: pass.uid,
        webauthn: await key.assert(challenge),
      })
      await expect(replay.json()).resolves.toMatchObject({ reason: 'BAD_CHALLENGE', stage: 'challenge' })
    })

    it('refuses a bare QR before touching the slot', async () => {
      const { app, bindings, claimed } = await setup({ category: 'ticket' })
      const { pass } = await claimed(passkey())
      const res = await postJson(app, bindings, '/v1/verify', { qr: pass.qr })
      await expect(res.json()).resolves.toMatchObject({ decision: 'REJECT', reason: 'LEVEL_REQUIRED' })
      await expect(db().select().from(slots)).resolves.toStrictEqual([])
    })

    it('refuses a wallet signature for this pass, and a passkey for a pass with no key', async () => {
      const { app, bindings, claimed, mint, operator, request } = await setup()
      const key = passkey()
      const { pass } = await claimed(key)
      const minted = await mint(pass.uid)
      const signed = await request('/v1/verify-signed', {
        nonce: minted.nonce,
        signature: `0x${'11'.repeat(65)}`,
        uid: pass.uid,
      })
      await expect(signed.json()).resolves.toMatchObject({ reason: 'BAD_SIGNATURE' })

      const made = await postJson(
        app,
        bindings,
        '/v1/issuers/cards',
        { ...CARD_INPUT.card, identity: 'none', record: 'offchain', slug: 'plain' },
        operator,
      )
      expect(made.status).toBe(201)
      const plain = await request(`/v1/issuers/${CARD_INPUT.handle}/plain/issue`, {})
      const { uid } = await plain.json<Issued>()
      const mintedPlain = await mint(uid)
      expect(mintedPlain.webauthn).toBeUndefined()
      const answered = await request('/v1/verify-signed', {
        nonce: mintedPlain.nonce,
        uid,
        webauthn: await key.assert('AAAA'),
      })
      await expect(answered.json()).resolves.toMatchObject({ reason: 'BAD_SIGNATURE' })
    })

    it('refuses a revoked pass', async () => {
      const { app, bindings, claimed, operator, present } = await setup()
      const key = passkey()
      const { pass } = await claimed(key)
      const revoked = await app.request(
        '/v1/revoke',
        {
          body: JSON.stringify({ uid: pass.uid }),
          headers: { authorization: `Bearer ${operator}`, 'content-type': 'application/json' },
          method: 'POST',
        },
        bindings,
      )
      expect(revoked.status).toBe(200)
      await expect(present(pass.uid, key)).resolves.toMatchObject({
        decision: 'REJECT',
        reason: 'REVOKED',
        stage: 'entitlement',
      })
    })

    it('admits a single-use pass once', async () => {
      const { claimed, present } = await setup({ category: 'ticket' })
      const key = passkey()
      const { pass } = await claimed(key)
      await expect(present(pass.uid, key)).resolves.toMatchObject({ decision: 'ADMIT' })
      await expect(present(pass.uid, key)).resolves.toMatchObject({
        decision: 'REJECT',
        reason: 'ALREADY_USED',
      })
    })
  })

  describe('keeping', () => {
    it('is not something another account can link by uid', async () => {
      const { claimed, request, signUp } = await setup()
      const { pass } = await claimed(passkey())
      const other = await signUp(passkey())
      const res = await request('/v1/member/passes', { uids: [pass.uid] }, other)
      await expect(res.json()).resolves.toStrictEqual({ linked: 0 })
    })

    it('says in its backup that the file does not restore use', async () => {
      const { app, bindings, claimed } = await setup()
      const { pass } = await claimed(passkey())
      const res = await app.request(`/pass/${pass.uid}/backup`, {}, bindings)
      await expect(res.json()).resolves.toMatchObject({ passkey: true, uid: pass.uid })
    })
  })
})
