import { PasskeyRegistrationBody, challengeMessage } from '@fuda/sdk'
import type {
  IssuerPassesResponse,
  PasskeysResponse,
  MemberSecretResponse,
  MemberSignInResponse,
  MemberVaultResponse,
} from '@fuda/sdk'
import { createExecutionContext, createScheduledController, env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import type { Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ZERO_ADDRESS } from '../src/chain/client.ts'
import { getDb } from '../src/db/client.ts'
import {
  cards,
  cardStampSettings,
  challenges,
  entryLog,
  memberPasses,
  members,
  memberSecretCopies,
  memberSecretOutcomes,
  memberVaults,
  offchainAttestations,
  passkeys,
  receptionRequests,
  slots,
  stampCredits,
} from '../src/db/schema.ts'
import { decodeOffchainPass, fromSignedJson } from '../src/eas/offchain.ts'
import {
  purgeSensitiveEntries,
  sensitiveEntryLogsJob,
  SENSITIVE_ENTRY_RETENTION_SECONDS,
} from '../src/passes/entry-log-retention.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, ROOT, seedRoot } from './fixtures.ts'
import { CARD_INPUT, getJson, postJson, registerVenueWithCard, signIn } from './operator.ts'
import { SoftwarePasskey } from './software-passkey.ts'

const RP = { origin: 'https://app.fuda.sh', rpId: 'fuda.sh' }
const CLAIM_PATH = `/v1/issuers/${CARD_INPUT.handle}/${CARD_INPUT.card.slug}/issue`
const IV = 'AAAAAAAAAAAAAAAA'
const WRITE_TOKEN = 'A'.repeat(43)

const db = () => getDb({ DB: env.DB })

interface Issued {
  holder: Hex
  level: string
  memberNumber: string
  qr: string
  uid: Hex
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
    { ...CARD_INPUT, card: { ...CARD_INPUT.card, identity: 'sensitive', record: 'offchain', ...card } },
    operator,
  )
  const send = async (method: string, path: string, body?: unknown, token = ''): Promise<Response> =>
    await app.request(
      path,
      {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          'CF-Connecting-IP': '203.0.113.92',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        method,
      },
      bindings,
    )
  const owners = new Map<string, SoftwarePasskey>()
  const signUp = async (passkey: SoftwarePasskey): Promise<string> => {
    const options = await send('POST', '/v1/auth/member/register/options', {})
    const { challenge } = await options.json<{ challenge: string }>()
    const res = await send('POST', '/v1/auth/member/register', await passkey.attest(challenge))
    expect(res.status).toBe(200)
    const { token } = await res.json<MemberSignInResponse>()
    owners.set(token, passkey)
    return token
  }
  const addPasskey = async (passkey: SoftwarePasskey, token: string): Promise<void> => {
    const authorized = await send('POST', '/v1/auth/member/passkeys/authorize/options', {}, token)
    const auth = await authorized.json<{ challenge: string }>()
    const authorization = await owners.get(token)?.assert(auth.challenge)
    const options = await send('POST', '/v1/auth/member/passkeys/options', {}, token)
    const { challenge } = await options.json<{ challenge: string }>()
    const res = await send(
      'POST',
      '/v1/auth/member/passkeys',
      { ...v.parse(PasskeyRegistrationBody, await passkey.attest(challenge)), authorization },
      token,
    )
    expect(res.status).toBe(200)
  }
  const claim = async (holderAddress: Hex): Promise<Issued> => {
    const res = await send('POST', CLAIM_PATH, { holderAddress })
    expect(res.status).toBe(200)
    return await res.json<Issued>()
  }
  const copy = async (
    token: string,
    passkey: SoftwarePasskey,
    first: boolean,
    ciphertext = 'wrapped',
  ): Promise<Response> =>
    await send(
      'POST',
      '/v1/member/secret',
      { ciphertext, credentialId: passkey.credentialId, first, iv: IV, writeToken: WRITE_TOKEN },
      token,
    )
  const reset = async (token: string): Promise<Response> => {
    const options = await send('POST', '/v1/member/secret/reset/options', {}, token)
    const { challenge } = await options.json<{ challenge: string }>()
    return await send('DELETE', '/v1/member/secret', await owners.get(token)?.assert(challenge), token)
  }
  return { addPasskey, app, bindings, chain, claim, copy, operator, reset, send, signUp }
}

const passkey = (): SoftwarePasskey => new SoftwarePasskey(RP)

const newKey = () => privateKeyToAccount(generatePrivateKey())

const statusOf = async (res: Promise<Response>): Promise<number> => {
  const { status } = await res
  return status
}

const present = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  uid: Hex,
  sign: (p: { message: string }) => Promise<Hex>,
): Promise<Response> => {
  const minted = await ctx.send('POST', '/v1/challenge', { uid })
  const { challenge, nonce, webauthn } = await minted.json<{
    challenge: string
    nonce: Hex
    webauthn?: unknown
  }>()
  expect(webauthn).toBeUndefined()
  expect(challenge).toBe(challengeMessage(uid, nonce))
  return await ctx.send('POST', '/v1/verify-signed', {
    nonce,
    signature: await sign({ message: challenge }),
    uid,
  })
}

describe('sensitive use', () => {
  beforeEach(async () => {
    await db().delete(stampCredits)
    await db().delete(receptionRequests)
    await db().delete(memberSecretCopies)
    await db().delete(memberVaults)
    await db().delete(memberSecretOutcomes)
    await db().delete(offchainAttestations)
    await db().delete(slots)
    await db().delete(entryLog)
    await db().delete(members)
    await db().delete(cardStampSettings)
    await db().delete(cards)
    await env.DB.prepare('DELETE FROM member_passes').run()
    await db().delete(passkeys)
    await env.DB.prepare('DELETE FROM sessions').run()
    await env.DB.prepare('DELETE FROM accounts').run()
    await env.DB.prepare('DELETE FROM issuers').run()
    await env.DB.prepare('DELETE FROM rate_limits').run()
  })

  describe('entry retention', () => {
    it('stores only uid, time, and row id for signed decisions and QR rejection', async () => {
      const ctx = await setup()
      const key = newKey()
      const { qr, uid } = await ctx.claim(key.address)
      const admitted = await present(ctx, uid, key.signMessage)
      await expect(admitted.json()).resolves.toMatchObject({
        decision: 'ADMIT',
      })
      const rejected = await present(ctx, uid, newKey().signMessage)
      await expect(rejected.json()).resolves.toMatchObject({
        reason: 'BAD_SIGNATURE',
      })
      await ctx.send('POST', '/v1/verify', { qr })
      const rows = await db().select().from(entryLog)
      expect(rows).toHaveLength(3)
      for (const row of rows) {
        expect(row).toStrictEqual({
          at: NOW,
          attendanceUid: null,
          decision: null,
          id: row.id,
          path: null,
          reason: null,
          receptionId: null,
          uid,
        })
      }
    })

    it('expires Sensitive reception receipts with their logs and keeps retries harmless', async () => {
      const ctx = await setup()
      const { qr, uid } = await ctx.claim(newKey().address)
      const requestId = crypto.randomUUID()
      const reception = await ctx.send('POST', '/v1/issuers/me/reception', { qr, requestId }, ctx.operator)
      const receipt = await reception.json()
      const repeated = await ctx.send('POST', '/v1/issuers/me/reception', { qr, requestId }, ctx.operator)
      await expect(repeated.json()).resolves.toStrictEqual(receipt)
      await expect(db().select().from(entryLog)).resolves.toMatchObject([
        { decision: null, path: null, reason: null, receptionId: null, uid },
      ])
      await sensitiveEntryLogsJob(
        createScheduledController({ scheduledTime: (NOW + SENSITIVE_ENTRY_RETENTION_SECONDS + 1) * 1000 }),
        // SAFETY: this scheduled job reads only DB; the test omits Void's unused default bindings.
        ctx.bindings as Parameters<typeof sensitiveEntryLogsJob>[1],
        createExecutionContext(),
      )
      expect({
        logs: await db().select().from(entryLog),
        receipts: await db().select().from(receptionRequests),
      }).toStrictEqual({ logs: [], receipts: [] })
      await expect(purgeSensitiveEntries(env.DB, NOW + SENSITIVE_ENTRY_RETENTION_SECONDS + 1)).resolves.toBe(
        0,
      )
      const after = await ctx.send('POST', '/v1/issuers/me/reception', { qr, requestId }, ctx.operator)
      await expect(after.json()).resolves.toMatchObject({ decision: 'REJECT', reason: 'LEVEL_REQUIRED' })
    })

    it('keeps the retention boundary and other cards, including stamped entries and receipts', async () => {
      const ctx = await setup()
      const key = newKey()
      const { uid } = await ctx.claim(key.address)
      await present(ctx, uid, key.signMessage)
      const recent = await ctx.claim(newKey().address)
      await ctx.send('POST', '/v1/verify', { qr: recent.qr })
      await db()
        .update(entryLog)
        .set({ at: NOW + 1 })
        .where(eq(entryLog.uid, recent.uid))
      const recentLogs = await db().select().from(entryLog).where(eq(entryLog.uid, recent.uid))

      await ctx.send(
        'POST',
        '/v1/issuers/cards',
        { ...CARD_INPUT.card, record: 'offchain', slug: 'standard' },
        ctx.operator,
      )
      const claimed = await ctx.send('POST', `/v1/issuers/${CARD_INPUT.handle}/standard/issue`, {})
      const standard = await claimed.json<Issued>()
      await ctx.send('POST', '/v1/verify', { qr: standard.qr })
      const standardCard = await db().select().from(cards).where(eq(cards.slug, 'standard')).get()
      await ctx.send(
        'PUT',
        `/v1/issuers/me/cards/${standardCard?.id}/stamps`,
        { dailyLimit: 1, enabled: true, goal: 10 },
        ctx.operator,
      )
      const stamped = await ctx.send(
        'POST',
        '/v1/issuers/me/reception',
        { qr: standard.qr, requestId: crypto.randomUUID() },
        ctx.operator,
      )
      await expect(stamped.json()).resolves.toMatchObject({ stamp: { status: 'awarded' } })
      const keptLogs = await db().select().from(entryLog).where(eq(entryLog.uid, standard.uid))
      const keptCredits = await db().select().from(stampCredits)
      const keptReceipts = await db().select().from(receptionRequests)

      await expect(purgeSensitiveEntries(env.DB, NOW + SENSITIVE_ENTRY_RETENTION_SECONDS)).resolves.toBe(0)
      await expect(purgeSensitiveEntries(env.DB, NOW + SENSITIVE_ENTRY_RETENTION_SECONDS + 1)).resolves.toBe(
        1,
      )
      expect({
        credits: await db().select().from(stampCredits),
        logs: await db().select().from(entryLog).orderBy(entryLog.id),
        receipts: await db().select().from(receptionRequests),
      }).toStrictEqual({ credits: keptCredits, logs: [...recentLogs, ...keptLogs], receipts: keptReceipts })
      const foreignKeys = await env.DB.prepare('PRAGMA foreign_key_check').all()
      expect(foreignKeys.results).toStrictEqual([])
    })

    it('keeps single use consumed after its log is purged without retaining the entry time', async () => {
      const ctx = await setup({ category: 'ticket', validityDays: null })
      const key = newKey()
      const { uid } = await ctx.claim(key.address)
      const admitted = await present(ctx, uid, key.signMessage)
      await expect(admitted.json()).resolves.toMatchObject({ decision: 'ADMIT' })
      await expect(db().select().from(slots)).resolves.toStrictEqual([
        { consumedAt: 0, slot: 'default', uid },
      ])
      await expect(purgeSensitiveEntries(env.DB, NOW + SENSITIVE_ENTRY_RETENTION_SECONDS + 1)).resolves.toBe(
        1,
      )
      await expect(db().select().from(entryLog)).resolves.toStrictEqual([])
      const replay = await present(ctx, uid, key.signMessage)
      const list = await getJson(ctx.app, ctx.bindings, '/v1/issuers/me/passes', ctx.operator)
      expect({ list: await list.json(), replay: await replay.json() }).toMatchObject({
        list: {
          cardStats: [{ active: 0, issued: 1, unknown: 0 }],
          page: { total: 1 },
          passes: [{ stamps: 0, status: 'consumed', uid }],
          summary: { active: 0, stamps: 0, total: 1, unknown: 0 },
        },
        replay: { decision: 'REJECT', reason: 'ALREADY_USED' },
      })
    })

    it('leaves member and dashboard counts intact with no retained entries', async () => {
      const ctx = await setup()
      const key = newKey()
      const { uid } = await ctx.claim(key.address)
      await present(ctx, uid, key.signMessage)
      await purgeSensitiveEntries(env.DB, NOW + SENSITIVE_ENTRY_RETENTION_SECONDS + 1)
      await expect(db().select().from(entryLog)).resolves.toStrictEqual([])
      const listed = await getJson(ctx.app, ctx.bindings, '/v1/issuers/me/passes', ctx.operator)
      expect(listed.status).toBe(200)
      await expect(listed.json()).resolves.toMatchObject({
        cardStats: [{ active: 1, issued: 1, unknown: 0 }],
        page: { total: 1 },
        passes: [{ stamps: 0, status: 'active', uid }],
        summary: { active: 1, stamps: 0, total: 1, unknown: 0 },
      })
      const membersList = await getJson(ctx.app, ctx.bindings, '/v1/members', ctx.operator)
      await expect(membersList.json()).resolves.toMatchObject({
        members: [{ holder: null, sensitive: true, uid }],
      })
    })

    it('bounds a run and drains the remainder harmlessly on retry', async () => {
      const { claim } = await setup()
      const { uid } = await claim(newKey().address)
      await env.DB.prepare(`
        WITH RECURSIVE rows(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM rows WHERE n < 801)
        INSERT INTO entry_log (uid, at) SELECT ?1, ?2 FROM rows
      `)
        .bind(uid, NOW)
        .run()
      await expect(purgeSensitiveEntries(env.DB, NOW + SENSITIVE_ENTRY_RETENTION_SECONDS + 1)).resolves.toBe(
        800,
      )
      await expect(db().select().from(entryLog)).resolves.toHaveLength(1)
      await expect(purgeSensitiveEntries(env.DB, NOW + SENSITIVE_ENTRY_RETENTION_SECONDS + 1)).resolves.toBe(
        1,
      )
      await expect(purgeSensitiveEntries(env.DB, NOW + SENSITIVE_ENTRY_RETENTION_SECONDS + 1)).resolves.toBe(
        0,
      )
    })

    it('also removes stale Sensitive challenges if no later challenge mint sweeps them', async () => {
      const ctx = await setup()
      const key = newKey()
      const { uid } = await ctx.claim(key.address)
      await present(ctx, uid, key.signMessage)
      await expect(db().select().from(challenges).where(eq(challenges.uid, uid))).resolves.toHaveLength(1)
      await db()
        .insert(challenges)
        .values([
          { createdAt: NOW, nonce: 'unrelated', uid: 'unrelated' },
          { createdAt: NOW + 1, nonce: 'recent', uid },
        ])
      await purgeSensitiveEntries(env.DB, NOW + SENSITIVE_ENTRY_RETENTION_SECONDS + 1)
      const left = await db().select().from(challenges).where(eq(challenges.uid, uid))
      expect(left).toMatchObject([{ createdAt: NOW + 1, nonce: 'recent', usedAt: null }])
      await expect(
        db().select().from(challenges).where(eq(challenges.nonce, 'unrelated')),
      ).resolves.toHaveLength(1)
    })
  })

  describe('recovery integrity', () => {
    it('refuses session-only Start over without losing recovery', async () => {
      const { copy, send, signUp } = await setup()
      const own = passkey()
      const token = await signUp(own)
      await copy(token, own, true)
      const reset = await send('DELETE', '/v1/member/secret', undefined, token)
      expect(reset.status).toBe(400)
      const state = await send('GET', '/v1/member/secret', undefined, token)
      await expect(state.json<MemberSecretResponse>()).resolves.toMatchObject({
        copies: [{ credentialId: own.credentialId }],
      })
    })

    it('refuses a junk second copy and keeps the only copy-holder', async () => {
      const { addPasskey, copy, send, signUp } = await setup()
      const first = passkey()
      const second = passkey()
      const token = await signUp(first)
      await addPasskey(second, token)
      await copy(token, first, true)
      const planted = await send(
        'POST',
        '/v1/member/secret',
        {
          ciphertext: 'junkcopy',
          credentialId: second.credentialId,
          first: false,
          iv: IV,
        },
        token,
      )
      expect(planted.status).toBe(400)
      const removed = await send('DELETE', `/v1/auth/member/passkeys/${first.credentialId}`, undefined, token)
      expect(removed.status).toBe(409)
    })

    it('refuses session-only replacement of a vault', async () => {
      const { copy, send, signUp } = await setup()
      const own = passkey()
      const token = await signUp(own)
      await copy(token, own, true)
      await send(
        'PUT',
        '/v1/member/vault',
        {
          ciphertext: 'realvault',
          expectedVersion: 0,
          iv: IV,
          writeToken: 'A'.repeat(43),
        },
        token,
      )
      const corrupt = await send(
        'PUT',
        '/v1/member/vault',
        {
          ciphertext: 'junkvault',
          expectedVersion: 1,
          iv: IV,
        },
        token,
      )
      expect(corrupt.status).toBe(400)
      const after = await send('GET', '/v1/member/vault', undefined, token)
      await expect(after.json<MemberVaultResponse>()).resolves.toMatchObject({
        vault: { ciphertext: 'realvault' },
      })
    })
  })

  describe('recovery proofs', () => {
    it('requires the secret token even when a session knows the current version', async () => {
      const { addPasskey, copy, send, signUp } = await setup()
      const own = passkey()
      const other = passkey()
      const token = await signUp(own)
      await addPasskey(other, token)
      await copy(token, own, true)
      const before = await db().select().from(memberSecretCopies)
      const badCopy = await send(
        'POST',
        '/v1/member/secret',
        {
          ciphertext: 'junkcopy',
          credentialId: other.credentialId,
          first: false,
          iv: IV,
          writeToken: 'B'.repeat(43),
        },
        token,
      )
      expect(badCopy.status).toBe(403)
      const badVault = await send(
        'PUT',
        '/v1/member/vault',
        {
          ciphertext: 'junkvault',
          expectedVersion: 0,
          iv: IV,
          writeToken: 'B'.repeat(43),
        },
        token,
      )
      expect(badVault.status).toBe(403)
      await expect(db().select().from(memberSecretCopies)).resolves.toStrictEqual(before)
      await expect(db().select().from(memberVaults)).resolves.toStrictEqual([])
      const state = await send('GET', '/v1/member/secret', undefined, token)
      await expect(state.text()).resolves.not.toContain(WRITE_TOKEN)
    })

    it('cannot turn a stolen session into a passkey that authorizes Start over', async () => {
      const { copy, send, signUp } = await setup()
      const own = passkey()
      const attacker = passkey()
      const token = await signUp(own)
      await copy(token, own, true)
      const options = await send('POST', '/v1/auth/member/passkeys/options', {}, token)
      const { challenge } = await options.json<{ challenge: string }>()
      const registration = v.parse(PasskeyRegistrationBody, await attacker.attest(challenge))
      const added = await send('POST', '/v1/auth/member/passkeys', registration, token)
      expect(added.status).toBe(400)
      const proofOptions = await send('POST', '/v1/auth/member/passkeys/authorize/options', {}, token)
      const auth = await proofOptions.json<{ challenge: string }>()
      const forged = await send(
        'POST',
        '/v1/auth/member/passkeys',
        {
          ...registration,
          authorization: await attacker.assert(auth.challenge),
        },
        token,
      )
      expect(forged.status).toBe(403)
      const resetOptions = await send('POST', '/v1/member/secret/reset/options', {}, token)
      const reset = await resetOptions.json<{ challenge: string }>()
      const refused = await send('DELETE', '/v1/member/secret', await attacker.assert(reset.challenge), token)
      expect(refused.status).toBe(403)
      await expect(db().select().from(memberSecretCopies)).resolves.toHaveLength(1)
    })

    it.each(['claim', 'login', 'other-account', 'expired', 'origin', 'verification'])(
      'refuses a reset assertion with %s and preserves recovery',
      async (failure) => {
        const { copy, send, signUp } = await setup()
        const own = passkey()
        const token = await signUp(own)
        await copy(token, own, true)
        const other = failure === 'other-account' ? await signUp(passkey()) : token
        const paths = {
          claim: '/v1/auth/member/claim/options',
          login: '/v1/auth/member/login/options',
        }
        const path =
          failure === 'claim' || failure === 'login' ? paths[failure] : '/v1/member/secret/reset/options'
        const options = await send('POST', path, {}, other)
        const { challenge } = await options.json<{ challenge: string }>()
        if (failure === 'expired') {
          await env.DB.prepare('UPDATE passkey_challenges SET created_at = ? WHERE challenge = ?')
            .bind(NOW - 301, challenge)
            .run()
        }
        const assertion = await own.assert(challenge, {
          flags: failure === 'verification' ? 1 : undefined,
          origin: failure === 'origin' ? 'https://evil.test' : undefined,
        })
        const refused = await send('DELETE', '/v1/member/secret', assertion, token)
        expect(refused.status).toBe(403)
        await expect(db().select().from(memberSecretCopies)).resolves.toHaveLength(1)
      },
    )

    it('requires a new assertion for each reset and leaves old passes for the shop to revoke', async () => {
      const ctx = await setup()
      const own = passkey()
      const token = await ctx.signUp(own)
      await ctx.copy(token, own, true)
      const key = newKey()
      const issued = await ctx.claim(key.address)
      const options = await ctx.send('POST', '/v1/member/secret/reset/options', {}, token)
      const { challenge } = await options.json<{ challenge: string }>()
      const assertion = await own.assert(challenge)
      await expect(statusOf(ctx.send('DELETE', '/v1/member/secret', assertion, token))).resolves.toBe(200)
      await expect(statusOf(ctx.send('DELETE', '/v1/member/secret', assertion, token))).resolves.toBe(403)
      const admitted = await present(ctx, issued.uid, key.signMessage)
      await expect(admitted.json()).resolves.toMatchObject({
        decision: 'ADMIT',
      })
      const [row] = await db().select().from(members).where(eq(members.attestationUid, issued.uid))
      expect(row?.status).toBe('active')
      await expect(
        statusOf(
          ctx.send(
            'PUT',
            '/v1/member/vault',
            {
              ciphertext: 'oldwrite',
              expectedVersion: 0,
              iv: IV,
              writeToken: WRITE_TOKEN,
            },
            token,
          ),
        ),
      ).resolves.toBe(403)
    })
  })

  describe('the card setting', () => {
    it('refuses Sensitive use on an on-chain card', async () => {
      const chain = fakeChain({ signer: ROOT })
      const app = appWith({ chain, now: () => NOW })
      const bindings = configuredEnv(seedRoot(chain))
      const { token } = await signIn(app, bindings)
      await registerVenueWithCard(app, bindings, CARD_INPUT, token)
      const res = await postJson(
        app,
        bindings,
        '/v1/issuers/cards',
        {
          ...CARD_INPUT.card,
          identity: 'sensitive',
          record: 'onchain',
          slug: 'badge',
        },
        token,
      )
      expect(res.status).toBe(400)
    })

    it('keeps an existing card at its setting through the column move', async () => {
      await setup()
      const [card] = await db().select({ identity: cards.identity }).from(cards)
      expect(card?.identity).toBe('sensitive')
      await expect(
        env.DB.prepare(`UPDATE cards SET record = 'onchain' WHERE identity = 'sensitive'`).run(),
      ).rejects.toThrow(/CHECK/u)
    })

    it('refuses Stamps and integrations for the card', async () => {
      const { app, bindings, operator } = await setup()
      const [card] = await db().select().from(cards)
      const headers = { authorization: `Bearer ${operator}`, 'content-type': 'application/json' }
      const stamps = await app.request(
        `/v1/issuers/me/cards/${card?.id}/stamps`,
        {
          body: JSON.stringify({ dailyLimit: 1, enabled: true, goal: 5 }),
          headers,
          method: 'PUT',
        },
        bindings,
      )
      expect(stamps.status).toBe(409)
      await expect(stamps.json()).resolves.toMatchObject({ error: 'stamps_not_supported' })
      const integrations = await app.request(
        `/v1/issuers/me/cards/${card?.id}/integrations`,
        { body: JSON.stringify({ badges: ['human'] }), headers, method: 'PUT' },
        bindings,
      )
      expect(integrations.status).toBe(409)
      await expect(integrations.json()).resolves.toMatchObject({ error: 'integrations_not_supported' })
      await expect(db().select().from(cardStampSettings)).resolves.toStrictEqual([])
    })
  })

  describe('claiming', () => {
    it('attests the address in the pass and leaves no account behind', async () => {
      const { claim, signUp } = await setup()
      await signUp(passkey())
      const key = newKey()
      const issued = await claim(key.address)
      expect(issued).toMatchObject({ holder: ZERO_ADDRESS, level: 'signed' })
      const [stored] = await db()
        .select()
        .from(offchainAttestations)
        .where(eq(offchainAttestations.uid, issued.uid))
      const signed = fromSignedJson(stored?.signed ?? '')
      const pass = decodeOffchainPass(signed?.message.data ?? '0x')
      expect(pass.holderKey).toBe(key.address.toLowerCase())
      expect(signed?.message.recipient).toBe(ZERO_ADDRESS)
      await expect(db().select().from(memberPasses)).resolves.toStrictEqual([])
      const [member] = await db().select().from(members).where(eq(members.attestationUid, issued.uid))
      expect(member?.holder).toBeNull()
    })

    it('wants an address, and nothing else makes one', async () => {
      const { send } = await setup()
      const missing = await send('POST', CLAIM_PATH, {})
      expect(missing.status).toBe(400)
      const wrong = await send('POST', CLAIM_PATH, { holderAddress: '0x1234' })
      expect(wrong.status).toBe(400)
      await expect(db().select().from(members)).resolves.toStrictEqual([])
    })

    it('needs no session and reads none', async () => {
      const { send } = await setup()
      const res = await send('POST', CLAIM_PATH, { holderAddress: newKey().address })
      expect(res.status).toBe(200)
    })

    it('gives each claim its own record, so two keys share nothing but the card', async () => {
      const { claim } = await setup()
      const first = await claim(newKey().address)
      const second = await claim(newKey().address)
      expect(first.uid).not.toBe(second.uid)
    })
  })

  describe('presenting', () => {
    it('admits the key the pass attests, without reading the chain for the signature', async () => {
      const ctx = await setup()
      const key = newKey()
      const { uid } = await ctx.claim(key.address)
      const verifyMessage = vi.spyOn(ctx.chain, 'verifyMessage')
      const res = await present(ctx, uid, key.signMessage)
      await expect(res.json()).resolves.toMatchObject({
        decision: 'ADMIT',
        holder: ZERO_ADDRESS,
        path: 'signature',
      })
      expect(verifyMessage).not.toHaveBeenCalled()
    })

    it('refuses any other key, and burns the challenge doing so', async () => {
      const ctx = await setup()
      const { uid } = await ctx.claim(newKey().address)
      const minted = await ctx.send('POST', '/v1/challenge', { uid })
      const { challenge, nonce } = await minted.json<{ challenge: string; nonce: Hex }>()
      const wrong = await ctx.send('POST', '/v1/verify-signed', {
        nonce,
        signature: await newKey().signMessage({ message: challenge }),
        uid,
      })
      await expect(wrong.json()).resolves.toMatchObject({ decision: 'REJECT', reason: 'BAD_SIGNATURE' })
      const replay = await ctx.send('POST', '/v1/verify-signed', {
        nonce,
        signature: await newKey().signMessage({ message: challenge }),
        uid,
      })
      await expect(replay.json()).resolves.toMatchObject({ reason: 'BAD_CHALLENGE' })
    })

    it('refuses a signature that recovers to nothing, and a passkey answer', async () => {
      const ctx = await setup()
      const { uid } = await ctx.claim(newKey().address)
      const minted = await ctx.send('POST', '/v1/challenge', { uid })
      const { nonce } = await minted.json<{ nonce: Hex }>()
      const garbled = await ctx.send('POST', '/v1/verify-signed', {
        nonce,
        signature: `0x${'11'.repeat(65)}`,
        uid,
      })
      await expect(garbled.json()).resolves.toMatchObject({ reason: 'BAD_SIGNATURE' })
      const again = await ctx.send('POST', '/v1/challenge', { uid })
      const second = await again.json<{ nonce: Hex }>()
      const answered = await ctx.send('POST', '/v1/verify-signed', {
        nonce: second.nonce,
        uid,
        webauthn: await passkey().assert('AAAA'),
      })
      await expect(answered.json()).resolves.toMatchObject({ reason: 'BAD_SIGNATURE' })
    })

    it('refuses a bare QR', async () => {
      const { app, bindings, claim } = await setup()
      const { qr } = await claim(newKey().address)
      const res = await postJson(app, bindings, '/v1/verify', { qr })
      await expect(res.json()).resolves.toMatchObject({ decision: 'REJECT', reason: 'LEVEL_REQUIRED' })
    })

    it('rejects a membership while the chain is unreadable, unlike a Standard pass', async () => {
      const ctx = await setup()
      const key = newKey()
      const { uid } = await ctx.claim(key.address)
      ctx.chain.failReads = true
      const minted = await ctx.send('POST', '/v1/challenge', { uid })
      const { challenge, nonce } = await minted.json<{ challenge: string; nonce: Hex }>()
      const res = await ctx.send('POST', '/v1/verify-signed', {
        nonce,
        signature: await key.signMessage({ message: challenge }),
        uid,
      })
      expect(res.status).toBe(502)
      await expect(res.json()).resolves.toMatchObject({ error: 'chain_error' })
      await expect(db().select().from(entryLog)).resolves.toStrictEqual([])
    })

    it('records no Attendance', async () => {
      const ctx = await setup()
      const key = newKey()
      const { uid } = await ctx.claim(key.address)
      const attest = vi.spyOn(ctx.chain, 'attest')
      const res = await present(ctx, uid, key.signMessage)
      await expect(res.json()).resolves.toMatchObject({ decision: 'ADMIT' })
      expect(attest).not.toHaveBeenCalled()
    })
  })

  describe('what the pass does not have', () => {
    it.each(['', '/card', '/backup', '/google', '/apple.pkpass'])(
      'answers 404 at /pass/uid%s',
      async (path) => {
        const { app, bindings, claim } = await setup()
        const { uid } = await claim(newKey().address)
        const res = await app.request(`/pass/${uid}${path}`, {}, bindings)
        expect(res.status).toBe(404)
      },
    )

    it('cannot be linked to an account by uid', async () => {
      const { claim, send, signUp } = await setup()
      const { uid } = await claim(newKey().address)
      const token = await signUp(passkey())
      const res = await send('POST', '/v1/member/passes', { uids: [uid] }, token)
      await expect(res.json()).resolves.toStrictEqual({ linked: 0 })
      await expect(db().select().from(memberPasses)).resolves.toStrictEqual([])
    })

    it('still counts for the Issuer, with nothing that names the holder', async () => {
      const { app, bindings, claim, operator } = await setup()
      const { uid } = await claim(newKey().address)
      const res = await getJson(app, bindings, '/v1/issuers/me/passes', operator)
      expect(res.status).toBe(200)
      const body = await res.json<IssuerPassesResponse>()
      expect(body.summary).toMatchObject({ active: 1, total: 1 })
      expect(body.passes[0]).toMatchObject({ holder: null, uid })
      const list = await getJson(app, bindings, '/v1/members', operator)
      await expect(list.json()).resolves.toMatchObject({
        members: [{ holder: null, sensitive: true, uid }],
      })
    })
  })

  describe('the member secret', () => {
    it('needs a session', async () => {
      const { send } = await setup()
      for (const [method, path] of [
        ['GET', '/v1/member/secret'],
        ['GET', '/v1/member/vault'],
      ] as const) {
        // oxlint-disable-next-line no-await-in-loop -- each request follows the last, in a test
        const res = await send(method, path)
        expect(res.status).toBe(401)
      }
    })

    it('offers every passkey before a copy exists, and only those with one after', async () => {
      const { addPasskey, copy, send, signUp } = await setup()
      const first = passkey()
      const second = passkey()
      const token = await signUp(first)
      await addPasskey(second, token)
      const before = await send('GET', '/v1/member/secret', undefined, token)
      const empty = await before.json<MemberSecretResponse>()
      expect(empty).toMatchObject({ copies: [], rpId: RP.rpId })
      expect(empty.allowCredentials.map((row) => row.id).toSorted()).toStrictEqual(
        [first.credentialId, second.credentialId].toSorted(),
      )
      await expect(statusOf(copy(token, first, true))).resolves.toBe(200)
      const after = await send('GET', '/v1/member/secret', undefined, token)
      const held = await after.json<MemberSecretResponse>()
      expect(held.copies).toStrictEqual([{ ciphertext: 'wrapped', credentialId: first.credentialId, iv: IV }])
      expect(held.allowCredentials.map((row) => row.id)).toStrictEqual([first.credentialId])
    })

    it('lets one secret start, so two devices enrolling at once cannot each begin their own', async () => {
      const { addPasskey, copy, signUp } = await setup()
      const first = passkey()
      const second = passkey()
      const token = await signUp(first)
      await addPasskey(second, token)
      await expect(statusOf(copy(token, first, true))).resolves.toBe(200)
      const raced = await copy(token, second, true, 'other')
      expect(raced.status).toBe(409)
      await expect(raced.json()).resolves.toMatchObject({ error: 'secret_conflict' })
    })

    it('adds a second copy only beside a first, and never replaces one', async () => {
      const { addPasskey, copy, send, signUp } = await setup()
      const first = passkey()
      const second = passkey()
      const token = await signUp(first)
      await addPasskey(second, token)
      await expect(statusOf(copy(token, second, false))).resolves.toBe(403)
      await expect(statusOf(copy(token, first, true))).resolves.toBe(200)
      await expect(statusOf(copy(token, second, false))).resolves.toBe(200)
      await expect(statusOf(copy(token, second, false, 'replaced'))).resolves.toBe(409)
      const res = await send('GET', '/v1/member/secret', undefined, token)
      const { copies } = await res.json<MemberSecretResponse>()
      expect(copies.map((row) => row.ciphertext)).toStrictEqual(['wrapped', 'wrapped'])
    })

    it("refuses a copy for another account's passkey", async () => {
      const { copy, signUp } = await setup()
      const mine = await signUp(passkey())
      const theirs = passkey()
      await signUp(theirs)
      await expect(statusOf(copy(mine, theirs, true))).resolves.toBe(409)
    })

    it('refuses bytes that are not a sealed copy', async () => {
      const { send, signUp } = await setup()
      const own = passkey()
      const token = await signUp(own)
      const res = await send(
        'POST',
        '/v1/member/secret',
        {
          ciphertext: 'x'.repeat(4096),
          credentialId: own.credentialId,
          first: true,
          iv: IV,
          writeToken: WRITE_TOKEN,
        },
        token,
      )
      expect(res.status).toBe(400)
    })

    it('shows which passkeys can open Sensitive passes', async () => {
      const { addPasskey, copy, send, signUp } = await setup()
      const first = passkey()
      const second = passkey()
      const token = await signUp(first)
      await addPasskey(second, token)
      await copy(token, first, true)
      const res = await send('GET', '/v1/auth/member/passkeys', undefined, token)
      const body = await res.json<PasskeysResponse>()
      expect(Object.fromEntries(body.passkeys.map((row) => [row.id, row.holdsSecret]))).toStrictEqual({
        [first.credentialId]: true,
        [second.credentialId]: false,
      })
    })

    it('keeps the last passkey with a copy, and lets a copy go with its passkey', async () => {
      const { addPasskey, copy, send, signUp } = await setup()
      const first = passkey()
      const second = passkey()
      const third = passkey()
      const token = await signUp(first)
      await addPasskey(second, token)
      await addPasskey(third, token)
      await copy(token, first, true)
      const remove = async (key: SoftwarePasskey): Promise<number> => {
        const res = await send('DELETE', `/v1/auth/member/passkeys/${key.credentialId}`, undefined, token)
        return res.status
      }
      await expect(remove(first)).resolves.toBe(409)
      await expect(remove(third)).resolves.toBe(200)
      await copy(token, second, false)
      await expect(remove(first)).resolves.toBe(200)
      const left = await db().select().from(memberSecretCopies)
      expect(left.map((row) => row.credentialId)).toStrictEqual([second.credentialId])
      await expect(remove(second)).resolves.toBe(409)
    })
  })

  describe('starting over', () => {
    it("clears this account's copies and vault, and lets a new secret start", async () => {
      const { copy, reset, send, signUp } = await setup()
      const lost = passkey()
      const token = await signUp(lost)
      await copy(token, lost, true)
      await send(
        'PUT',
        '/v1/member/vault',
        { ciphertext: 'sealed', expectedVersion: 0, iv: IV, writeToken: WRITE_TOKEN },
        token,
      )
      await expect(statusOf(reset(token))).resolves.toBe(200)
      const secret = await send('GET', '/v1/member/secret', undefined, token)
      await expect(secret.json<MemberSecretResponse>()).resolves.toMatchObject({ copies: [] })
      const vault = await send('GET', '/v1/member/vault', undefined, token)
      await expect(vault.json<MemberVaultResponse>()).resolves.toStrictEqual({ vault: null })
      await expect(statusOf(copy(token, lost, true, 'newstart'))).resolves.toBe(200)
    })

    it("leaves another account's alone, and needs a session", async () => {
      const { copy, reset, send, signUp } = await setup()
      const theirs = passkey()
      const other = await signUp(theirs)
      await copy(other, theirs, true)
      const mine = await signUp(passkey())
      await reset(mine)
      await expect(db().select().from(memberSecretCopies)).resolves.toHaveLength(1)
      await expect(statusOf(send('DELETE', '/v1/member/secret'))).resolves.toBe(401)
    })

    it('lets the passkey that held the last copy go afterwards', async () => {
      const { addPasskey, copy, reset, send, signUp } = await setup()
      const first = passkey()
      const token = await signUp(first)
      await addPasskey(passkey(), token)
      await copy(token, first, true)
      const remove = `/v1/auth/member/passkeys/${first.credentialId}`
      await expect(statusOf(send('DELETE', remove, undefined, token))).resolves.toBe(409)
      await reset(token)
      await expect(statusOf(send('DELETE', remove, undefined, token))).resolves.toBe(200)
    })
  })

  describe('the vault', () => {
    it('starts empty and keeps what is written', async () => {
      const { copy, send, signUp } = await setup()
      const own = passkey()
      const token = await signUp(own)
      await copy(token, own, true)
      const before = await send('GET', '/v1/member/vault', undefined, token)
      await expect(before.json<MemberVaultResponse>()).resolves.toStrictEqual({ vault: null })
      const put = await send(
        'PUT',
        '/v1/member/vault',
        { ciphertext: 'sealed', expectedVersion: 0, iv: IV, writeToken: WRITE_TOKEN },
        token,
      )
      await expect(put.json()).resolves.toStrictEqual({ version: 1 })
      const after = await send('GET', '/v1/member/vault', undefined, token)
      await expect(after.json<MemberVaultResponse>()).resolves.toStrictEqual({
        vault: { ciphertext: 'sealed', iv: IV, version: 1 },
      })
    })

    it('sends a writer that has not read the current version back to read it', async () => {
      const { copy, send, signUp } = await setup()
      const own = passkey()
      const token = await signUp(own)
      await copy(token, own, true)
      const write = async (ciphertext: string, expectedVersion: number): Promise<Response> =>
        await send(
          'PUT',
          '/v1/member/vault',
          { ciphertext, expectedVersion, iv: IV, writeToken: WRITE_TOKEN },
          token,
        )
      await expect(statusOf(write('one', 0))).resolves.toBe(200)
      await expect(statusOf(write('two', 1))).resolves.toBe(200)
      const stale = await write('stale', 1)
      await expect(stale.json()).resolves.toMatchObject({ error: 'vault_conflict' })
      const fresh = await write('stale', 0)
      expect(fresh.status).toBe(409)
      const res = await send('GET', '/v1/member/vault', undefined, token)
      await expect(res.json<MemberVaultResponse>()).resolves.toMatchObject({
        vault: { ciphertext: 'two', version: 2 },
      })
    })

    it('keeps each account to its own vault', async () => {
      const { copy, send, signUp } = await setup()
      const own = passkey()
      const mine = await signUp(own)
      await copy(mine, own, true)
      const theirs = await signUp(passkey())
      await send(
        'PUT',
        '/v1/member/vault',
        { ciphertext: 'mine', expectedVersion: 0, iv: IV, writeToken: WRITE_TOKEN },
        mine,
      )
      const res = await send('GET', '/v1/member/vault', undefined, theirs)
      await expect(res.json<MemberVaultResponse>()).resolves.toStrictEqual({ vault: null })
    })
  })

  describe('the enrollment count', () => {
    it('keeps a number per outcome and nothing else', async () => {
      const { send, signUp } = await setup()
      const token = await signUp(passkey())
      for (const outcome of ['no_prf', 'no_prf', 'prf']) {
        // oxlint-disable-next-line no-await-in-loop -- each request follows the last, in a test
        await send('POST', '/v1/member/secret/outcome', { outcome }, token)
      }
      const rows = await db().select().from(memberSecretOutcomes)
      expect(Object.fromEntries(rows.map((row) => [row.outcome, row.total]))).toStrictEqual({
        no_prf: 2,
        prf: 1,
      })
      expect(Object.keys(rows[0] ?? {}).toSorted()).toStrictEqual(['outcome', 'total'])
    })

    it('takes only an outcome it knows', async () => {
      const { send, signUp } = await setup()
      const token = await signUp(passkey())
      const unknown = await send('POST', '/v1/member/secret/outcome', { outcome: 'bitwarden' }, token)
      expect(unknown.status).toBe(400)
    })
  })
})
