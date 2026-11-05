import { PasskeyRegistrationBody } from '@fuda/sdk'
import type {
  ConnectedAppGrantsResponse,
  ConnectedAppResponse,
  IssuerCreateResponse,
  IssuerMeResponse,
  IssuerSwitchResponse,
  MemberSignInResponse,
  MembersResponse,
  OperatorMeResponse,
  OperatorSignInResponse,
  OwnedIssuersResponse,
  PasskeysResponse,
  TokenResponse,
} from '@fuda/sdk'
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { beforeEach, describe, expect, it } from 'vitest'

import { pkceChallenge } from '../src/connected-apps/store.ts'
import { getDb } from '../src/db/client.ts'
import { cards, issuers, members, stampCredits } from '../src/db/schema.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, seedRight, seedRoot } from './fixtures.ts'
import { CARD_INPUT, signIn } from './operator.ts'
import { SoftwarePasskey } from './software-passkey.ts'

const RP = { origin: 'https://dash.fuda.sh', rpId: 'fuda.sh' }
const REDIRECT_URI = 'https://shop.figma.site/callback'
const VERIFIER = 'v'.repeat(43)
const VENUE = { brandColor: '#112233', handle: 'account-cafe', name: 'Account Cafe', tagline: '' }

const db = () => getDb({ DB: env.DB })

const jsonOf = async <T>(pending: Promise<Response>): Promise<T> => {
  const res = await pending
  return await res.json<T>()
}

const statusOf = async (pending: Promise<Response>): Promise<number> => {
  const res = await pending
  return res.status
}

const setup = () => {
  const chain = fakeChain()
  const delegation = seedRoot(chain)
  const app = appWith({ chain, now: () => NOW })
  const bindings = configuredEnv(delegation, { WEBAUTHN_ORIGINS: RP.origin, WEBAUTHN_RP_ID: RP.rpId })
  const request = async (
    path: string,
    init: { body?: unknown; method?: string; origin?: string; token?: string } = {},
  ): Promise<Response> =>
    await app.request(
      path,
      {
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        headers: {
          'CF-Connecting-IP': '203.0.113.90',
          Origin: init.origin ?? RP.origin,
          authorization: `Bearer ${init.token ?? ''}`,
          'content-type': 'application/json',
        },
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      },
      bindings,
    )
  const challengeFrom = async (path: string): Promise<string> => {
    const { challenge } = await jsonOf<{ challenge: string }>(request(path, { body: {} }))
    return challenge
  }
  const register = async (
    passkey: SoftwarePasskey,
    audience: 'member' | 'operator' = 'operator',
  ): Promise<OperatorSignInResponse> => {
    const challenge = await challengeFrom(`/v1/auth/${audience}/register/options`)
    return await jsonOf(request(`/v1/auth/${audience}/register`, { body: await passkey.attest(challenge) }))
  }
  const login = async (passkey: SoftwarePasskey): Promise<OperatorSignInResponse> => {
    const challenge = await challengeFrom('/v1/auth/operator/login/options')
    return await jsonOf(request('/v1/auth/operator/login', { body: await passkey.assert(challenge) }))
  }
  const createVenue = async (token: string, venue = VENUE): Promise<IssuerCreateResponse> =>
    await jsonOf(request('/v1/issuers', { body: venue, token }))
  return { app, bindings, chain, createVenue, delegation, login, register, request }
}

type Harness = ReturnType<typeof setup>

const signedUp = async (h: Harness, venue = VENUE) => {
  const session = await h.register(new SoftwarePasskey(RP))
  const created = await h.createVenue(session.token, venue)
  return { accountId: session.accountId, issuerId: created.issuer.id, token: session.token }
}

const walletSession = async (h: Harness): Promise<string> => {
  const { token } = await signIn(h.app, h.bindings, privateKeyToAccount(generatePrivateKey()))
  return token
}

const resetTables = async (): Promise<void> => {
  for (const table of [
    'stamp_credits',
    'reception_requests',
    'entry_log',
    'connected_app_events',
    'oauth_tokens',
    'oauth_codes',
    'connected_app_redirects',
    'connected_apps',
    'card_stamp_settings',
    'members',
    'cards',
    'issuers',
    'member_passes',
    'passkeys',
    'passkey_challenges',
    'sessions',
    'accounts',
    'rate_limits',
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- order follows the foreign keys
    await env.DB.exec(`DELETE FROM ${table}`)
  }
}

describe('operator accounts', () => {
  beforeEach(resetTables)

  describe('signing in with a passkey', () => {
    it('creates an account that has no issuer yet', async () => {
      const h = setup()
      const session = await h.register(new SoftwarePasskey(RP))
      expect(session.issuer).toBeNull()
      await expect(
        jsonOf<OperatorMeResponse>(h.request('/v1/auth/operator/me', { token: session.token })),
      ).resolves.toStrictEqual({ accountId: session.accountId, address: null })
    })

    it('keeps a venue under the account, with no address', async () => {
      const h = setup()
      const { accountId, issuerId, token } = await signedUp(h)
      const row = await db().select().from(issuers).where(eq(issuers.id, issuerId)).get()
      expect(row).toMatchObject({ operatorAddress: null, ownerAccountId: accountId })
      const me = await jsonOf<IssuerMeResponse>(h.request('/v1/issuers/me', { token }))
      expect(me.issuer).toMatchObject({ id: issuerId, operatorAddress: null })
    })

    it('binds a new session to the oldest venue of the account', async () => {
      const h = setup()
      const passkey = new SoftwarePasskey(RP)
      const { accountId, token } = await h.register(passkey)
      const created = await h.createVenue(token)
      const again = await h.login(passkey)
      expect(again).toMatchObject({ accountId, issuer: { id: created.issuer.id } })
      const owned = await jsonOf<OwnedIssuersResponse>(h.request('/v1/auth/issuers', { token: again.token }))
      expect(owned.activeIssuerId).toBe(created.issuer.id)
    })

    it('refuses a response from another origin', async () => {
      const h = setup()
      const challenge = await jsonOf<{ challenge: string }>(
        h.request('/v1/auth/operator/register/options', { body: {} }),
      )
      const foreign = new SoftwarePasskey({ origin: 'https://evil.example', rpId: RP.rpId })
      await expect(
        statusOf(
          h.request('/v1/auth/operator/register', { body: await foreign.attest(challenge.challenge) }),
        ),
      ).resolves.toBe(401)
    })

    it('adds and removes passkeys on the account', async () => {
      const h = setup()
      const first = new SoftwarePasskey(RP)
      const { token } = await h.register(first)
      const proof = await jsonOf<{ challenge: string }>(
        h.request('/v1/auth/operator/passkeys/authorize/options', { body: {}, token }),
      )
      const authorization = await first.assert(proof.challenge)
      const { challenge } = await jsonOf<{ challenge: string }>(
        h.request('/v1/auth/operator/passkeys/options', { body: {}, token }),
      )
      const second = new SoftwarePasskey(RP)
      await expect(
        statusOf(
          h.request('/v1/auth/operator/passkeys', {
            body: { ...v.parse(PasskeyRegistrationBody, await second.attest(challenge)), authorization },
            token,
          }),
        ),
      ).resolves.toBe(200)
      const { passkeys } = await jsonOf<PasskeysResponse>(h.request('/v1/auth/operator/passkeys', { token }))
      expect(passkeys).toHaveLength(2)
      await expect(
        statusOf(
          h.request(`/v1/auth/operator/passkeys/${encodeURIComponent(passkeys[0]?.id ?? '')}`, {
            method: 'DELETE',
            token,
          }),
        ),
      ).resolves.toBe(200)
      await expect(
        statusOf(
          h.request(`/v1/auth/operator/passkeys/${encodeURIComponent(passkeys[1]?.id ?? '')}`, {
            method: 'DELETE',
            token,
          }),
        ),
      ).resolves.toBe(409)
    })
  })

  describe('one person, two audiences', () => {
    it('signs a member passkey in to the dashboard as the same account', async () => {
      const h = setup()
      const passkey = new SoftwarePasskey(RP)
      const member = await h.register(passkey, 'member')
      const operator = await h.login(passkey)
      expect(operator.accountId).toBe(member.accountId)
      expect(operator.token).not.toBe(member.token)
    })

    it('refuses a member token on operator routes', async () => {
      const h = setup()
      const { issuerId } = await signedUp(h)
      const member: MemberSignInResponse = await h.register(new SoftwarePasskey(RP), 'member')
      for (const path of [
        '/v1/issuers/me',
        '/v1/auth/issuers',
        '/v1/auth/operator/me',
        '/v1/auth/operator/passkeys',
        '/v1/members',
      ]) {
        // oxlint-disable-next-line no-await-in-loop -- one assertion per route, order is irrelevant
        await expect(statusOf(h.request(path, { token: member.token }))).resolves.toBe(401)
      }
      await expect(
        statusOf(h.request('/v1/auth/switch', { body: { issuerId }, token: member.token })),
      ).resolves.toBe(401)
    })

    it('refuses an operator token on member routes', async () => {
      const h = setup()
      const { token } = await signedUp(h)
      for (const path of ['/v1/auth/member/me', '/v1/auth/member/passkeys', '/v1/member/passes']) {
        // oxlint-disable-next-line no-await-in-loop -- one assertion per route, order is irrelevant
        await expect(statusOf(h.request(path, { token }))).resolves.toBe(401)
      }
    })
  })

  describe('wallet sign-in', () => {
    it('still reaches the venue its address owns, and names no account', async () => {
      const h = setup()
      const account = privateKeyToAccount(generatePrivateKey())
      const first = await signIn(h.app, h.bindings, account)
      const created = await h.createVenue(first.token)
      const row = await db().select().from(issuers).where(eq(issuers.id, created.issuer.id)).get()
      expect(row).toMatchObject({ operatorAddress: account.address.toLowerCase(), ownerAccountId: null })

      const again = await signIn(h.app, h.bindings, account)
      expect(again.issuer).toMatchObject({ id: created.issuer.id })
      await expect(
        jsonOf<OperatorMeResponse>(h.request('/v1/auth/operator/me', { token: again.token })),
      ).resolves.toStrictEqual({ accountId: null, address: account.address.toLowerCase() })
    })

    it('has no passkeys to manage', async () => {
      const h = setup()
      const token = await walletSession(h)
      await expect(statusOf(h.request('/v1/auth/operator/passkeys', { token }))).resolves.toBe(409)
      await expect(
        statusOf(h.request('/v1/auth/operator/passkeys/options', { body: {}, token })),
      ).resolves.toBe(409)
    })
  })

  describe('ownership', () => {
    it('keeps a venue from another account and from any wallet', async () => {
      const h = setup()
      const mine = await signedUp(h)
      const stranger = await h.register(new SoftwarePasskey(RP))
      const others = [stranger.token, await walletSession(h)]
      for (const token of others) {
        // oxlint-disable-next-line no-await-in-loop -- sequential sessions keep the assertions readable
        const owned = await jsonOf<OwnedIssuersResponse>(h.request('/v1/auth/issuers', { token }))
        expect(owned.issuers).toStrictEqual([])
        // oxlint-disable-next-line no-await-in-loop -- sequential sessions keep the assertions readable
        await expect(
          statusOf(h.request('/v1/auth/switch', { body: { issuerId: mine.issuerId }, token })),
        ).resolves.toBe(404)
        // oxlint-disable-next-line no-await-in-loop -- sequential sessions keep the assertions readable
        const me = await jsonOf<IssuerMeResponse>(h.request('/v1/issuers/me', { token }))
        expect(me.issuer).toBeNull()
      }
    })

    it('switches between the venues of one account', async () => {
      const h = setup()
      const first = await signedUp(h)
      const second = await h.createVenue(first.token, { ...VENUE, handle: 'account-bar' })
      expect(second.token).toStrictEqual(expect.any(String))
      const owned = await jsonOf<OwnedIssuersResponse>(h.request('/v1/auth/issuers', { token: first.token }))
      expect(owned.issuers.map((row) => row.handle).toSorted()).toStrictEqual(['account-bar', 'account-cafe'])
      const switched = await jsonOf<IssuerSwitchResponse>(
        h.request('/v1/auth/switch', { body: { issuerId: second.issuer.id }, token: first.token }),
      )
      const me = await jsonOf<IssuerMeResponse>(h.request('/v1/issuers/me', { token: switched.token }))
      expect(me.issuer?.id).toBe(second.issuer.id)
    })

    it('counts the issuer limit per account', async () => {
      const h = setup()
      const { token } = await h.register(new SoftwarePasskey(RP))
      for (let n = 0; n < 10; n += 1) {
        // oxlint-disable-next-line no-await-in-loop -- creates in order so each counts the last
        await expect(
          statusOf(h.request('/v1/issuers', { body: { ...VENUE, handle: `shop-${n}` }, token })),
        ).resolves.toBe(201)
      }
      await expect(
        statusOf(h.request('/v1/issuers', { body: { ...VENUE, handle: 'shop-10' }, token })),
      ).resolves.toBe(409)
    })

    it('shows the members of its own venue only', async () => {
      const h = setup()
      const mine = await signedUp(h)
      const theirs = await signedUp(h, { ...VENUE, handle: 'other-cafe' })
      const cardOf = async (token: string) =>
        await h.request('/v1/issuers/cards', { body: CARD_INPUT.card, token })
      await expect(statusOf(cardOf(mine.token))).resolves.toBe(201)
      await expect(statusOf(cardOf(theirs.token))).resolves.toBe(201)
      const claimed = await jsonOf<{ uid: string }>(
        h.request(`/v1/issuers/${VENUE.handle}/${CARD_INPUT.card.slug}/issue`, { method: 'POST' }),
      )
      const list = async (token: string) => await jsonOf<MembersResponse>(h.request('/v1/members', { token }))
      const own = await list(mine.token)
      const other = await list(theirs.token)
      expect(own.members.map((row) => row.uid)).toStrictEqual([claimed.uid])
      expect(other.members).toStrictEqual([])
    })

    it('holds exactly one owner on every issuer', async () => {
      const row = {
        brandColor: '#000000',
        createdAt: NOW,
        handle: 'bad-owner',
        id: 'bad-owner',
        name: 'Bad',
      }
      await expect(db().insert(issuers).values(row)).rejects.toThrow(/Failed query/u)
      const { accountId } = await signedUp(setup())
      await expect(
        db()
          .insert(issuers)
          .values({ ...row, operatorAddress: `0x${'11'.repeat(20)}`, ownerAccountId: accountId }),
      ).rejects.toThrow(/Failed query/u)
    })
  })

  describe('connected apps', () => {
    const appFor = async (h: Harness, token: string): Promise<string> => {
      const created = await jsonOf<ConnectedAppResponse>(
        h.request('/v1/connected-apps', {
          body: { name: 'Shop app', redirectUris: [REDIRECT_URI] },
          token,
        }),
      )
      return created.app.clientId
    }

    const approve = async (
      h: Harness,
      p: { clientId: string; issuerId: string; token: string },
    ): Promise<Response> =>
      await h.request('/v1/oauth/authorize', {
        body: {
          clientId: p.clientId,
          codeChallenge: await pkceChallenge(VERIFIER),
          codeChallengeMethod: 'S256',
          issuerId: p.issuerId,
          redirectUri: REDIRECT_URI,
          state: 'state',
        },
        token: p.token,
      })

    const exchange = async (h: Harness, clientId: string, code: string): Promise<Response> =>
      await h.app.request(
        '/v1/oauth/token',
        {
          body: new URLSearchParams({
            client_id: clientId,
            code,
            code_verifier: VERIFIER,
            grant_type: 'authorization_code',
            redirect_uri: REDIRECT_URI,
          }).toString(),
          headers: {
            'CF-Connecting-IP': '203.0.113.91',
            Origin: new URL(REDIRECT_URI).origin,
            'content-type': 'application/x-www-form-urlencoded',
          },
          method: 'POST',
        },
        h.bindings,
      )

    const approved = async (h: Harness) => {
      const owner = await signedUp(h)
      const clientId = await appFor(h, owner.token)
      const res = await approve(h, { clientId, issuerId: owner.issuerId, token: owner.token })
      expect(res.status).toBe(200)
      const { redirectTo } = await res.json<{ redirectTo: string }>()
      const code = new URL(redirectTo).searchParams.get('code') ?? ''
      const issued = await exchange(h, clientId, code)
      expect(issued.status).toBe(200)
      const { access_token: accessToken } = await issued.json<TokenResponse>()
      return { ...owner, accessToken, clientId }
    }

    const connectStatus = async (h: Harness, accessToken: string): Promise<number> =>
      await statusOf(
        h.request('/v1/connect/issuer', { origin: new URL(REDIRECT_URI).origin, token: accessToken }),
      )

    it('registers, approves and exchanges for a venue the account owns', async () => {
      const h = setup()
      const { accessToken, token } = await approved(h)
      await expect(connectStatus(h, accessToken)).resolves.toBe(200)
      const { grants } = await jsonOf<ConnectedAppGrantsResponse>(
        h.request('/v1/connected-apps/grants', { token }),
      )
      expect(grants).toHaveLength(1)
    })

    it('hides the app and its approvals from another account', async () => {
      const h = setup()
      const owner = await approved(h)
      const stranger = await signedUp(h, { ...VENUE, handle: 'other-cafe' })
      const { apps } = await jsonOf<{ apps: unknown[] }>(
        h.request('/v1/connected-apps', { token: stranger.token }),
      )
      expect(apps).toStrictEqual([])
      const { grants } = await jsonOf<ConnectedAppGrantsResponse>(
        h.request('/v1/connected-apps/grants', { token: stranger.token }),
      )
      expect(grants).toStrictEqual([])
      await expect(
        statusOf(approve(h, { clientId: owner.clientId, issuerId: owner.issuerId, token: stranger.token })),
      ).resolves.toBe(403)
    })

    it('refuses to approve for a venue of another account', async () => {
      const h = setup()
      const owner = await signedUp(h)
      const stranger = await signedUp(h, { ...VENUE, handle: 'other-cafe' })
      const clientId = await appFor(h, owner.token)
      await expect(
        statusOf(approve(h, { clientId, issuerId: stranger.issuerId, token: owner.token })),
      ).resolves.toBe(404)
    })

    it('ends the token when the venue leaves the account that approved it', async () => {
      const h = setup()
      const { accessToken, issuerId } = await approved(h)
      const next = await h.register(new SoftwarePasskey(RP))
      await db().update(issuers).set({ ownerAccountId: next.accountId }).where(eq(issuers.id, issuerId))
      await expect(connectStatus(h, accessToken)).resolves.toBe(401)
    })
  })

  describe('reception', () => {
    it('records the stamp under the account', async () => {
      const h = setup()
      const uid = seedRight(h.chain, h.delegation, { level: 0, usageModel: 1 })
      const { accountId, issuerId, token } = await signedUp(h)
      const cardId = crypto.randomUUID()
      await db().insert(cards).values({
        category: 'membership',
        createdAt: NOW,
        id: cardId,
        issuerId,
        slug: 'coffee',
        title: 'Coffee',
      })
      await db().insert(members).values({
        attestationUid: uid,
        cardId,
        createdAt: NOW,
        issuerId,
        level: 'bearer',
        memberId: 'member-1',
      })
      await expect(
        statusOf(
          h.request(`/v1/issuers/me/cards/${cardId}/stamps`, {
            body: { dailyLimit: 1, enabled: true, goal: 10 },
            method: 'PUT',
            token,
          }),
        ),
      ).resolves.toBe(200)
      const scanned = await jsonOf<{ decision: string; stamp: { status: string } }>(
        h.request('/v1/issuers/me/reception', {
          body: { qr: `fuda:v1:${uid}`, requestId: crypto.randomUUID() },
          token,
        }),
      )
      expect(scanned).toMatchObject({ decision: 'ADMIT', stamp: { status: 'awarded' } })
      const credit = await db().select().from(stampCredits).get()
      expect(credit?.operatorAddress).toBe(`account:${accountId}`)
    })
  })

  describe('ENS claim', () => {
    it('answers that a wallet is required, on both claim routes', async () => {
      const h = setup()
      const { token } = await signedUp(h)
      for (const [path, body] of [
        ['/v1/issuers/me/ens/claim-voucher', {}],
        ['/v1/issuers/me/ens/claimed', { txHash: `0x${'ab'.repeat(32)}` }],
      ] as const) {
        // oxlint-disable-next-line no-await-in-loop -- one assertion per route, order is irrelevant
        const res = await h.app.request(
          path,
          {
            body: JSON.stringify(body),
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            method: 'POST',
          },
          {
            ...h.bindings,
            ENS_GAS_POLICY_ID: 'policy-1',
            ENS_PARENT_NAME: 'fuda.eth',
            ENS_PAYMASTER_UPSTREAM: 'https://paymaster.invalid/rpc',
            ENS_REGISTRAR_ADDRESS: `0x${'33'.repeat(20)}`,
            ENS_SEPOLIA_RPC_URL: 'https://sepolia.invalid/rpc',
            ENS_VOUCHER_KEY: `0x${'11'.repeat(32)}`,
          },
        )
        // oxlint-disable-next-line no-await-in-loop -- one assertion per route, order is irrelevant
        await expect(res.json()).resolves.toMatchObject({ error: 'wallet_required' })
        expect(res.status).toBe(409)
      }
    })
  })
})

describe('shared enrollment authorization', () => {
  beforeEach(resetTables)

  it.each(['member', 'operator'] as const)(
    'requires a fresh, purpose-bound account assertion for %s enrollment',
    async (audience) => {
      const h = setup()
      const first = new SoftwarePasskey(RP)
      const { token } = await h.register(first, audience)
      const options = async (path: string) =>
        await jsonOf<{ challenge: string }>(h.request(path, { body: {}, token }))
      const auth = await options(`/v1/auth/${audience}/passkeys/authorize/options`)
      const authorization = await first.assert(auth.challenge)
      const add = async () => {
        const registration = await options(`/v1/auth/${audience}/passkeys/options`)
        const credential = v.parse(
          PasskeyRegistrationBody,
          await new SoftwarePasskey(RP).attest(registration.challenge),
        )
        return await h.request(`/v1/auth/${audience}/passkeys`, {
          body: { ...credential, authorization },
          token,
        })
      }
      await expect(statusOf(add())).resolves.toBe(200)
      await expect(statusOf(add())).resolves.toBe(403)
    },
  )

  it.each(['login', 'claim', 'reset', 'expired', 'other-account'] as const)(
    'refuses an enrollment assertion for %s',
    async (purpose) => {
      const h = setup()
      const first = new SoftwarePasskey(RP)
      const { token } = await h.register(first)
      const other = await h.register(new SoftwarePasskey(RP))
      const paths = {
        claim: '/v1/auth/member/claim/options',
        expired: '/v1/auth/operator/passkeys/authorize/options',
        login: '/v1/auth/operator/login/options',
        'other-account': '/v1/auth/operator/passkeys/authorize/options',
        reset: '/v1/member/secret/reset/options',
      }
      const path = paths[purpose]
      const memberOptions = await h.request('/v1/auth/member/login/options', { body: {} })
      const memberChallenge = await memberOptions.json<{ challenge: string }>()
      const member = await jsonOf<MemberSignInResponse>(
        h.request('/v1/auth/member/login', { body: await first.assert(memberChallenge.challenge) }),
      )
      let proofToken = token
      if (purpose === 'other-account') {
        proofToken = other.token
      }
      if (purpose === 'claim' || purpose === 'reset') {
        proofToken = member.token
      }
      const options = await jsonOf<{ challenge: string }>(h.request(path, { body: {}, token: proofToken }))
      if (purpose === 'expired') {
        await env.DB.prepare('UPDATE passkey_challenges SET created_at=? WHERE challenge=?')
          .bind(NOW - 301, options.challenge)
          .run()
      }
      const registration = await jsonOf<{ challenge: string }>(
        h.request('/v1/auth/operator/passkeys/options', { body: {}, token }),
      )
      const added = await h.request('/v1/auth/operator/passkeys', {
        body: {
          ...v.parse(PasskeyRegistrationBody, await new SoftwarePasskey(RP).attest(registration.challenge)),
          authorization: await first.assert(options.challenge),
        },
        token,
      })
      expect(added.status).toBe(403)
      await expect(
        jsonOf<PasskeysResponse>(h.request('/v1/auth/operator/passkeys', { token })),
      ).resolves.toMatchObject({ passkeys: [{ id: first.credentialId }] })
    },
  )

  it('preserves account first-key enrollment with its authenticated session and registration challenge', async () => {
    const h = setup()
    const { accountId, token } = await h.register(new SoftwarePasskey(RP))
    await env.DB.prepare('DELETE FROM passkeys WHERE account_id=?').bind(accountId).run()
    const options = await jsonOf<{ challenge: string }>(
      h.request('/v1/auth/operator/passkeys/options', { body: {}, token }),
    )
    const first = new SoftwarePasskey(RP)
    const added = await h.request('/v1/auth/operator/passkeys', {
      body: await first.attest(options.challenge),
      token,
    })
    expect(added.status).toBe(200)
    await expect(h.login(first)).resolves.toMatchObject({ accountId })
  })
})
