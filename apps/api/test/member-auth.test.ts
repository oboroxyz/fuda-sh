import type { MemberSignInResponse, SignInChallengeResponse } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import { privateKeyToAccount } from 'viem/accounts'
import { beforeEach, describe, expect, it } from 'vitest'

import { hashToken } from '../src/auth/session.ts'
import { getDb } from '../src/db/client.ts'
import { challenges, issuers, sessions } from '../src/db/schema.ts'
import type { Bindings } from '../src/env.ts'
import { appWith, fakeChain, testEnv } from './env.ts'
import { NOW } from './fixtures.ts'
import { CARD_INPUT, getJson, operator, postJson, signIn } from './operator.ts'

const member = privateKeyToAccount(`0x${'7b'.repeat(32)}`)

const memberSignIn = async (
  app: ReturnType<typeof appWith>,
  bindings: Bindings,
): Promise<MemberSignInResponse> => {
  const challenge = await postJson(app, bindings, '/v1/auth/member/challenge', {
    address: member.address,
  })
  const { message, nonce } = await challenge.json<SignInChallengeResponse>()
  const signature = await member.signMessage({ message })
  const verified = await postJson(app, bindings, '/v1/auth/member/verify', {
    address: member.address,
    nonce,
    signature,
  })
  expect(verified.status).toBe(200)
  return await verified.json<MemberSignInResponse>()
}

describe('member sign-in', () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
    await db.delete(sessions)
    await db.delete(challenges)
    await db.delete(issuers)
  })

  it('mints a member challenge with the member signature message', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = testEnv()
    const challenge = await postJson(app, bindings, '/v1/auth/member/challenge', {
      address: member.address,
    })

    expect(challenge.status).toBe(200)
    expect(challenge.headers.get('cache-control')).toBe('no-store')
    const body = await challenge.json<SignInChallengeResponse>()
    expect(body.message).toBe(`fuda.sh member sign-in\nnonce: ${body.nonce}`)
  })

  it('creates and reads a member session without an issuer', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = testEnv()
    const signedIn = await memberSignIn(app, bindings)

    expect(signedIn.address).toBe(member.address.toLowerCase())
    expect(signedIn.token).toMatch(/^[0-9a-f]{64}$/u)
    const stored = await getDb({ DB: env.DB }).select().from(sessions).get()
    expect(stored).toMatchObject({ audience: 'member', issuerId: null })

    const me = await getJson(app, bindings, '/v1/auth/member/me', signedIn.token)
    expect(me.status).toBe(200)
    await expect(me.json()).resolves.toStrictEqual({ address: member.address.toLowerCase() })
  })

  it('logs out a member session', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = testEnv()
    const signedIn = await memberSignIn(app, bindings)

    const loggedOut = await postJson(app, bindings, '/v1/auth/member/logout', {}, signedIn.token)
    expect(loggedOut.status).toBe(200)
    expect(loggedOut.headers.get('cache-control')).toBe('no-store')
    await expect(loggedOut.json()).resolves.toStrictEqual({ loggedOut: true })

    const afterLogout = await getJson(app, bindings, '/v1/auth/member/me', signedIn.token)
    expect(afterLogout.status).toBe(401)
  })

  it('rejects an expired member session', async () => {
    let now = NOW
    const app = appWith({ chain: fakeChain(), now: () => now })
    const bindings = testEnv()
    const { token } = await memberSignIn(app, bindings)

    now = NOW + 31 * 86_400
    const expired = await getJson(app, bindings, '/v1/auth/member/me', token)

    expect(expired.status).toBe(401)
  })

  it('rejects a member challenge on the operator verifier', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = testEnv()
    const challenge = await postJson(app, bindings, '/v1/auth/member/challenge', {
      address: member.address,
    })
    const { message, nonce } = await challenge.json<SignInChallengeResponse>()
    const memberSignature = await member.signMessage({ message })

    const wrongAudience = await postJson(app, bindings, '/v1/auth/verify', {
      address: member.address,
      nonce,
      signature: memberSignature,
    })
    expect(wrongAudience.status).toBe(401)
    await expect(wrongAudience.json()).resolves.toStrictEqual({ error: 'bad_challenge' })

    const accepted = await postJson(app, bindings, '/v1/auth/member/verify', {
      address: member.address,
      nonce,
      signature: memberSignature,
    })
    expect(accepted.status).toBe(200)
  })

  it('rejects an operator challenge on the member verifier', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = testEnv()
    const operatorChallenge = await postJson(app, bindings, '/v1/auth/challenge', {
      address: operator.address,
    })
    const operatorBody = await operatorChallenge.json<SignInChallengeResponse>()
    const operatorSignature = await operator.signMessage({ message: operatorBody.message })
    const memberRejected = await postJson(app, bindings, '/v1/auth/member/verify', {
      address: operator.address,
      nonce: operatorBody.nonce,
      signature: operatorSignature,
    })
    expect(memberRejected.status).toBe(401)
    await expect(memberRejected.json()).resolves.toStrictEqual({ error: 'bad_challenge' })

    const operatorAccepted = await postJson(app, bindings, '/v1/auth/verify', {
      address: operator.address,
      nonce: operatorBody.nonce,
      signature: operatorSignature,
    })
    expect(operatorAccepted.status).toBe(200)
  })

  it('rejects operator credentials on member session endpoints', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = testEnv()
    const { token } = await signIn(app, bindings)

    const me = await getJson(app, bindings, '/v1/auth/member/me', token)
    const logout = await postJson(app, bindings, '/v1/auth/member/logout', {}, token)

    expect(me.status).toBe(401)
    expect(logout.status).toBe(401)
    const retained = await getJson(app, bindings, '/v1/issuers/me', token)
    expect(retained.status).toBe(200)
  })

  it.each([
    ['configured admin', testEnv({ ADMIN_TOKEN: 'admin-token' })],
    ['open admin', testEnv({ ADMIN_TOKEN: undefined })],
  ])('rejects member credentials from every operator route with %s', async (_name, bindings) => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const { token } = await memberSignIn(app, bindings)

    const responses = await Promise.all([
      getJson(app, bindings, '/v1/issuers/me', token),
      postJson(app, bindings, '/v1/issuers', CARD_INPUT, token),
      getJson(app, bindings, '/v1/members', token),
      postJson(app, bindings, '/v1/revoke', { uid: `0x${'01'.repeat(32)}` }, token),
    ])

    expect(responses.map((response) => response.status)).toStrictEqual([401, 401, 401, 401])
  })

  it('deletes only the signed-out audience session', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = testEnv()
    const memberSession = await memberSignIn(app, bindings)
    const operatorSession = await signIn(app, bindings)
    const logout = await postJson(app, bindings, '/v1/auth/member/logout', {}, memberSession.token)
    const operatorMe = await getJson(app, bindings, '/v1/issuers/me', operatorSession.token)
    const memberMe = await getJson(app, bindings, '/v1/auth/member/me', memberSession.token)
    expect([logout.status, operatorMe.status, memberMe.status]).toStrictEqual([200, 200, 401])
  })

  it('defaults a pre-audience session row to operator access', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = testEnv()
    const token = 'legacy-operator-token'
    await env.DB.prepare(
      'INSERT INTO sessions (token_hash, address, issuer_id, created_at, expires_at) VALUES (?, ?, NULL, ?, ?)',
    )
      .bind(await hashToken(token), operator.address.toLowerCase(), NOW, NOW + 60)
      .run()

    const operatorMe = await getJson(app, bindings, '/v1/issuers/me', token)
    const memberMe = await getJson(app, bindings, '/v1/auth/member/me', token)

    expect(operatorMe.status).toBe(200)
    expect(memberMe.status).toBe(401)
  })
})
