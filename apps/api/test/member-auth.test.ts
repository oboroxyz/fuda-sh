import type { MemberPassesResponse, PasskeysResponse, MemberSignInResponse } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import {
  accounts,
  memberPasses,
  members,
  passkeyChallenges,
  passkeys,
  rateLimits,
  sessions,
} from '../src/db/schema.ts'
import { appWith, fakeChain, testEnv } from './env.ts'
import { NOW } from './fixtures.ts'
import { SoftwarePasskey } from './software-passkey.ts'

const RP = { origin: 'https://app.fuda.sh', rpId: 'fuda.sh' }
const FLAG_UP_ONLY = 0x01
const FLAG_UP_ONLY_WITH_KEY = 0x41

const db = () => getDb({ DB: env.DB })

const statusOf = async (pending: Promise<Response>): Promise<number> => {
  const res = await pending
  return res.status
}

const jsonOf = async <T = unknown>(pending: Promise<Response>): Promise<T> => {
  const res = await pending
  return await res.json<T>()
}

const setup = () => {
  let now = NOW
  const app = appWith({ chain: fakeChain(), now: () => now })
  const bindings = testEnv({ WEBAUTHN_ORIGINS: RP.origin, WEBAUTHN_RP_ID: RP.rpId })
  const request = async (path: string, init: { body?: unknown; method?: string; token?: string } = {}) =>
    await app.request(
      path,
      {
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        headers: {
          'CF-Connecting-IP': '203.0.113.80',
          authorization: `Bearer ${init.token ?? ''}`,
          'content-type': 'application/json',
        },
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      },
      bindings,
    )
  const challengeFrom = async (path: string, token?: string): Promise<string> => {
    const res = await request(path, { body: {}, token })
    expect(res.status).toBe(200)
    const { challenge } = await res.json<{ challenge: string }>()
    return challenge
  }
  const register = async (passkey: SoftwarePasskey): Promise<MemberSignInResponse> => {
    const challenge = await challengeFrom('/v1/auth/member/register/options')
    const res = await request('/v1/auth/member/register', { body: await passkey.attest(challenge) })
    expect(res.status).toBe(200)
    return await res.json<MemberSignInResponse>()
  }
  const login = async (passkey: SoftwarePasskey): Promise<Response> => {
    const challenge = await challengeFrom('/v1/auth/member/login/options')
    return await request('/v1/auth/member/login', { body: await passkey.assert(challenge) })
  }
  const add = async (passkey: SoftwarePasskey, token: string): Promise<Response> => {
    const challenge = await challengeFrom('/v1/auth/member/passkeys/options', token)
    return await request('/v1/auth/member/passkeys', { body: await passkey.attest(challenge), token })
  }
  return {
    add,
    challengeFrom,
    login,
    register,
    request,
    setNow: (next: number) => {
      now = next
    },
  }
}

const uidOf = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`

const insertPass = async (
  n: number,
  level: 'bearer' | 'private' | 'signed' = 'bearer',
  holder: Hex | null = null,
) => {
  await db()
    .insert(members)
    .values({
      attestationUid: uidOf(n),
      createdAt: NOW,
      holder,
      level,
      memberId: `member-${n}`,
    })
}

const list = async (request: ReturnType<typeof setup>['request'], token: string) => {
  const { passes } = await jsonOf<MemberPassesResponse>(request('/v1/member/passes', { token }))
  return passes
}

describe('member passkey sign-in', () => {
  beforeEach(async () => {
    await db().delete(memberPasses)
    await db().delete(passkeys)
    await db().delete(passkeyChallenges)
    await db().delete(sessions)
    await db().delete(accounts)
    await db().delete(members)
    await db().delete(rateLimits)
  })

  describe('registering', () => {
    it('offers a required discoverable ES256 passkey for this site', async () => {
      const { request } = setup()
      const res = await request('/v1/auth/member/register/options', { body: {} })
      await expect(res.json()).resolves.toMatchObject({
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        pubKeyCredParams: [{ alg: -7 }],
        rp: { id: RP.rpId },
      })
    })

    it('creates an account and a session with no address', async () => {
      const { register, request } = setup()
      const passkey = new SoftwarePasskey(RP)
      const { accountId, token } = await register(passkey)
      expect(token).toMatch(/^[0-9a-f]{64}$/u)
      const me = await request('/v1/auth/member/me', { token })
      await expect(me.json()).resolves.toStrictEqual({ accountId })
      await expect(db().select().from(sessions).get()).resolves.toMatchObject({
        accountId,
        address: '',
        audience: 'member',
        issuerId: null,
      })
      await expect(db().select().from(passkeys).get()).resolves.toMatchObject({
        accountId,
        backedUp: 1,
        credentialId: passkey.credentialId,
      })
    })

    it('creates nothing for a ceremony that is abandoned', async () => {
      const { challengeFrom } = setup()
      await challengeFrom('/v1/auth/member/register/options')
      await expect(db().select().from(accounts)).resolves.toHaveLength(0)
    })

    it.each([
      ['another origin', { origin: 'https://evil.example' }],
      ['another site', { rpId: 'evil.example' }],
      ['no user verification', { flags: FLAG_UP_ONLY_WITH_KEY }],
    ])('refuses %s', async (_label, overrides) => {
      const { challengeFrom, request } = setup()
      const challenge = await challengeFrom('/v1/auth/member/register/options')
      const res = await request('/v1/auth/member/register', {
        body: await new SoftwarePasskey(RP).attest(challenge, overrides),
      })
      expect(res.status).toBe(401)
      await expect(db().select().from(accounts)).resolves.toHaveLength(0)
    })

    it('refuses a challenge it did not issue, and one used twice', async () => {
      const { challengeFrom, request } = setup()
      const made = await request('/v1/auth/member/register', {
        body: await new SoftwarePasskey(RP).attest('bm90LWlzc3VlZA'),
      })
      expect(made.status).toBe(401)
      const challenge = await challengeFrom('/v1/auth/member/register/options')
      const body = await new SoftwarePasskey(RP).attest(challenge)
      await expect(statusOf(request('/v1/auth/member/register', { body }))).resolves.toBe(200)
      await expect(statusOf(request('/v1/auth/member/register', { body }))).resolves.toBe(401)
    })

    it('refuses a challenge that has expired', async () => {
      const { challengeFrom, request, setNow } = setup()
      const challenge = await challengeFrom('/v1/auth/member/register/options')
      setNow(NOW + 301)
      const res = await request('/v1/auth/member/register', {
        body: await new SoftwarePasskey(RP).attest(challenge),
      })
      expect(res.status).toBe(401)
    })

    it('answers 400 for a malformed body', async () => {
      const { request } = setup()
      const res = await request('/v1/auth/member/register', { body: { id: 'x' } })
      expect(res.status).toBe(400)
    })
  })

  describe('signing in', () => {
    it('signs in to the same account', async () => {
      const { login, register } = setup()
      const passkey = new SoftwarePasskey(RP)
      const { accountId } = await register(passkey)
      const res = await login(passkey)
      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toMatchObject({ accountId })
      await expect(db().select().from(passkeys).get()).resolves.toMatchObject({ counter: 1, lastUsedAt: NOW })
    })

    it('refuses a passkey the account does not have', async () => {
      const { login } = setup()
      await expect(statusOf(login(new SoftwarePasskey(RP)))).resolves.toBe(401)
    })

    it('refuses a signature from another key', async () => {
      const { challengeFrom, register, request } = setup()
      const passkey = new SoftwarePasskey(RP)
      const other = new SoftwarePasskey(RP)
      await register(passkey)
      await register(other)
      const challenge = await challengeFrom('/v1/auth/member/login/options')
      const res = await request('/v1/auth/member/login', {
        body: await passkey.assert(challenge, { signWith: other }),
      })
      expect(res.status).toBe(401)
    })

    it.each([
      ['another origin', { origin: 'https://evil.example' }],
      ['no user verification', { flags: FLAG_UP_ONLY }],
    ])('refuses %s', async (_label, overrides) => {
      const { challengeFrom, register, request } = setup()
      const passkey = new SoftwarePasskey(RP)
      await register(passkey)
      const challenge = await challengeFrom('/v1/auth/member/login/options')
      const res = await request('/v1/auth/member/login', { body: await passkey.assert(challenge, overrides) })
      expect(res.status).toBe(401)
    })

    it('refuses a registration challenge for signing in', async () => {
      const { challengeFrom, register, request } = setup()
      const passkey = new SoftwarePasskey(RP)
      await register(passkey)
      const challenge = await challengeFrom('/v1/auth/member/register/options')
      const res = await request('/v1/auth/member/login', { body: await passkey.assert(challenge) })
      expect(res.status).toBe(401)
    })

    it('rate limits the ceremony', async () => {
      const { request } = setup()
      await db()
        .insert(rateLimits)
        .values({
          count: 1000,
          ip: '203.0.113.80',
          windowStart: Math.floor(NOW / 3600) * 3600,
        })
      const res = await request('/v1/auth/member/login/options', { body: {} })
      expect(res.status).toBe(429)
    })
  })

  describe('member sessions', () => {
    it('logs out', async () => {
      const { register, request } = setup()
      const { token } = await register(new SoftwarePasskey(RP))
      const out = await request('/v1/auth/member/logout', { body: {}, token })
      expect(out.status).toBe(200)
      await expect(statusOf(request('/v1/auth/member/me', { token }))).resolves.toBe(401)
    })

    it('expires', async () => {
      const { register, request, setNow } = setup()
      const { token } = await register(new SoftwarePasskey(RP))
      setNow(NOW + 31 * 86_400)
      await expect(statusOf(request('/v1/auth/member/me', { token }))).resolves.toBe(401)
    })

    it('does not accept a member session from before accounts', async () => {
      const { request } = setup()
      const raw = 'a'.repeat(64)
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))
      await db()
        .insert(sessions)
        .values({
          address: `0x${'11'.repeat(20)}`,
          audience: 'member',
          createdAt: NOW,
          expiresAt: NOW + 3600,
          tokenHash: [...hash].map((b) => b.toString(16).padStart(2, '0')).join(''),
        })
      await expect(statusOf(request('/v1/auth/member/me', { token: raw }))).resolves.toBe(401)
    })
  })

  describe('managing passkeys', () => {
    it('adds a passkey that then signs in to the same account', async () => {
      const { add, login, register, request } = setup()
      const first = new SoftwarePasskey(RP)
      const second = new SoftwarePasskey(RP)
      const { accountId, token } = await register(first)
      await expect(statusOf(add(second, token))).resolves.toBe(200)
      await expect(jsonOf(login(second))).resolves.toMatchObject({ accountId })
      const listed = await jsonOf<PasskeysResponse>(request('/v1/auth/member/passkeys', { token }))
      expect(listed.passkeys.map(({ id }) => id).toSorted()).toStrictEqual(
        [first.credentialId, second.credentialId].toSorted(),
      )
    })

    it('excludes the passkeys the account has, and keeps its user handle', async () => {
      const { register, request } = setup()
      const first = new SoftwarePasskey(RP)
      const { accountId, token } = await register(first)
      const res = await request('/v1/auth/member/passkeys/options', { body: {}, token })
      const options = await res.json<{ excludeCredentials: { id: string }[]; user: { id: string } }>()
      expect(options.excludeCredentials.map(({ id }) => id)).toStrictEqual([first.credentialId])
      const account = await db().select().from(accounts).get()
      expect(account?.id).toBe(accountId)
      expect(options.user.id).not.toBe('')
    })

    it('needs a session to add one', async () => {
      const { request } = setup()
      await expect(statusOf(request('/v1/auth/member/passkeys/options', { body: {} }))).resolves.toBe(401)
    })

    it("cannot use another account's challenge", async () => {
      const { challengeFrom, register, request } = setup()
      const a = await register(new SoftwarePasskey(RP))
      const b = await register(new SoftwarePasskey(RP))
      const challenge = await challengeFrom('/v1/auth/member/passkeys/options', a.token)
      const res = await request('/v1/auth/member/passkeys', {
        body: await new SoftwarePasskey(RP).attest(challenge),
        token: b.token,
      })
      expect(res.status).toBe(401)
    })

    it('stops at ten', async () => {
      const { add, register } = setup()
      const { token } = await register(new SoftwarePasskey(RP))
      for (let i = 1; i < 10; i += 1) {
        // oxlint-disable-next-line no-await-in-loop -- each ceremony follows the last, in a test
        await expect(statusOf(add(new SoftwarePasskey(RP), token))).resolves.toBe(200)
      }
      await expect(statusOf(add(new SoftwarePasskey(RP), token))).resolves.toBe(409)
    })

    it('removes a passkey, which can then no longer sign in', async () => {
      const { add, login, register, request } = setup()
      const first = new SoftwarePasskey(RP)
      const second = new SoftwarePasskey(RP)
      const { token } = await register(first)
      await add(second, token)
      const removed = await request(`/v1/auth/member/passkeys/${second.credentialId}`, {
        method: 'DELETE',
        token,
      })
      expect(removed.status).toBe(200)
      await expect(statusOf(login(second))).resolves.toBe(401)
    })

    it('keeps the last passkey', async () => {
      const { register, request } = setup()
      const passkey = new SoftwarePasskey(RP)
      const { token } = await register(passkey)
      const res = await request(`/v1/auth/member/passkeys/${passkey.credentialId}`, {
        method: 'DELETE',
        token,
      })
      expect(res.status).toBe(409)
      await expect(db().select().from(passkeys)).resolves.toHaveLength(1)
    })

    it("cannot remove another account's passkey", async () => {
      const { add, register, request } = setup()
      const victim = new SoftwarePasskey(RP)
      const a = await register(victim)
      await add(new SoftwarePasskey(RP), a.token)
      const b = await register(new SoftwarePasskey(RP))
      await add(new SoftwarePasskey(RP), b.token)
      const res = await request(`/v1/auth/member/passkeys/${victim.credentialId}`, {
        method: 'DELETE',
        token: b.token,
      })
      expect(res.status).toBe(409)
      await expect(db().select().from(passkeys)).resolves.toHaveLength(4)
    })
  })

  describe('keeping passes', () => {
    it('needs a session', async () => {
      const { request } = setup()
      await expect(statusOf(request('/v1/member/passes'))).resolves.toBe(401)
      await expect(statusOf(request('/v1/member/passes', { body: { uids: [] } }))).resolves.toBe(401)
    })

    it('links a pass, and a second device signing in finds it', async () => {
      const { login, register, request } = setup()
      await insertPass(1)
      const passkey = new SoftwarePasskey(RP)
      const { token } = await register(passkey)
      const linked = await request('/v1/member/passes', { body: { uids: [uidOf(1)] }, token })
      await expect(linked.json()).resolves.toStrictEqual({ linked: 1 })
      const signedIn = await jsonOf<MemberSignInResponse>(login(passkey))
      await expect(list(request, signedIn.token)).resolves.toMatchObject([
        { holder: `0x${'00'.repeat(20)}`, uid: uidOf(1) },
      ])
    })

    it('reports the holder of an on-chain pass', async () => {
      const { register, request } = setup()
      const holder: Hex = `0x${'11'.repeat(20)}`
      await insertPass(1, 'bearer', holder)
      const { token } = await register(new SoftwarePasskey(RP))
      await request('/v1/member/passes', { body: { uids: [uidOf(1)] }, token })
      await expect(list(request, token)).resolves.toMatchObject([{ holder, uid: uidOf(1) }])
    })

    it('is idempotent', async () => {
      const { register, request } = setup()
      await insertPass(1)
      const { token } = await register(new SoftwarePasskey(RP))
      await request('/v1/member/passes', { body: { uids: [uidOf(1)] }, token })
      await request('/v1/member/passes', { body: { uids: [uidOf(1)] }, token })
      await expect(list(request, token)).resolves.toHaveLength(1)
    })

    it('lets two accounts keep the same pass', async () => {
      const { register, request } = setup()
      await insertPass(1)
      const a = await register(new SoftwarePasskey(RP))
      const b = await register(new SoftwarePasskey(RP))
      await request('/v1/member/passes', { body: { uids: [uidOf(1)] }, token: a.token })
      await request('/v1/member/passes', { body: { uids: [uidOf(1)] }, token: b.token })
      await expect(list(request, a.token)).resolves.toHaveLength(1)
      await expect(list(request, b.token)).resolves.toHaveLength(1)
    })

    it('does not show one account the passes of another', async () => {
      const { register, request } = setup()
      await insertPass(1)
      const a = await register(new SoftwarePasskey(RP))
      const b = await register(new SoftwarePasskey(RP))
      await request('/v1/member/passes', { body: { uids: [uidOf(1)] }, token: a.token })
      await expect(list(request, b.token)).resolves.toHaveLength(0)
    })

    it.each(['signed', 'private'] as const)('skips a %s right', async (level) => {
      const { register, request } = setup()
      await insertPass(1, level)
      const { token } = await register(new SoftwarePasskey(RP))
      const res = await request('/v1/member/passes', { body: { uids: [uidOf(1)] }, token })
      await expect(res.json()).resolves.toStrictEqual({ linked: 0 })
    })

    it('skips what is unknown or malformed', async () => {
      const { register, request } = setup()
      const { token } = await register(new SoftwarePasskey(RP))
      const res = await request('/v1/member/passes', { body: { uids: [uidOf(9), 'nope'] }, token })
      await expect(res.json()).resolves.toStrictEqual({ linked: 0 })
    })

    it('takes up to fifty at once, and refuses more', async () => {
      const { register, request } = setup()
      const { token } = await register(new SoftwarePasskey(RP))
      for (let i = 1; i <= 50; i += 1) {
        // oxlint-disable-next-line no-await-in-loop -- fixture rows, in a test
        await insertPass(i)
      }
      const uids = Array.from({ length: 50 }, (_, i) => uidOf(i + 1))
      const ok = await request('/v1/member/passes', { body: { uids }, token })
      await expect(ok.json()).resolves.toStrictEqual({ linked: 50 })
      const over = await request('/v1/member/passes', { body: { uids: [...uids, uidOf(51)] }, token })
      expect(over.status).toBe(400)
    })
  })
})
