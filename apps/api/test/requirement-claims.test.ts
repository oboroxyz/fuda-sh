import { claimMessage, formatAgreementEvidence } from '@fuda/sdk'
import type { CardApplicantsResponse, CardInput, SelfServeIssueResponse } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import type { Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../src/db/client.ts'
import {
  cardAddressPasses,
  cardApplicants,
  cards,
  entryLog,
  memberPasses,
  members,
  passEvidence,
  slots,
} from '../src/db/schema.ts'
import { presentationRequirements } from '../src/requirements/presentation.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, ROOT, seedRoot, other } from './fixtures.ts'
import { CARD_INPUT, registerVenueWithCard, signIn } from './operator.ts'

const requirement = {
  assetId: `0x${'aa'.repeat(32)}`,
  kind: 'erc8432-agreement',
  registry: `0x${'bb'.repeat(20)}`,
} as const
const agreementId: Hex = `0x${'dd'.repeat(32)}`
const path = `/v1/issuers/${CARD_INPUT.handle}/${CARD_INPUT.card.slug}`
const db = () => getDb({ DB: env.DB })

const setup = async (changes: Partial<CardInput> = {}) => {
  const chain = fakeChain({ signer: ROOT })
  const app = appWith({ chain, now: () => NOW })
  const bindings = configuredEnv(seedRoot(chain), {
    API_BASE_URL: 'https://api.test',
    IP_REGISTRIES: requirement.registry,
  })
  const { token } = await signIn(app, bindings)
  await registerVenueWithCard(
    app,
    bindings,
    {
      ...CARD_INPUT,
      card: {
        ...CARD_INPUT.card,
        identity: 'address',
        record: 'offchain',
        requirements: [requirement],
        ...changes,
      },
    },
    token,
  )
  const card = await db().select().from(cards).get()
  if (card === undefined) {
    throw new Error('Card not created')
  }
  const key = privateKeyToAccount(generatePrivateKey())
  const grant = (
    change: {
      frozen?: boolean
      id?: Hex
      revoked?: boolean
      expiry?: bigint
      holder?: Hex
      creationMode?: number
      termsId?: Hex
    } = {},
  ) => {
    chain.seedAgreement({
      ...requirement,
      creationMode: 0,
      holder: key.address,
      id: agreementId,
      termsId: agreementId,
      ...change,
    })
  }
  const send = async (suffix: string, body: unknown, operatorToken = '') =>
    await app.request(
      suffix,
      {
        body: JSON.stringify(body),
        headers: {
          'CF-Connecting-IP': '203.0.113.92',
          authorization: `Bearer ${operatorToken}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
      bindings,
    )
  const claimBody = async () => ({
    holderAddress: key.address,
    signature: await key.signMessage({ message: claimMessage(card.id, key.address) }),
  })
  const claim = async () => await send(`${path}/issue`, await claimBody())
  const present = async (uid: Hex) => {
    const minted = await send('/v1/challenge', { uid })
    const { challenge, nonce } = await minted.json<{ challenge: string; nonce: Hex }>()
    return await send('/v1/verify-signed', {
      nonce,
      signature: await key.signMessage({ message: challenge }),
      uid,
    })
  }
  const applicants = async (operatorToken = token, query = '') =>
    await app.request(
      `/v1/issuers/me/cards/${card.id}/applicants${query}`,
      { headers: { authorization: `Bearer ${operatorToken}` } },
      bindings,
    )
  return { app, applicants, bindings, card, chain, claim, claimBody, grant, key, present, send, token }
}

describe('requirement applications and claims', () => {
  beforeEach(async () => {
    await env.DB.batch(
      [
        'pass_evidence',
        'card_address_passes',
        'card_applicants',
        'card_requirements',
        'offchain_attestations',
        'entry_log',
        'slots',
        'member_passes',
        'members',
        'card_stamp_settings',
        'cards',
        'sessions',
        'issuers',
        'rate_limits',
      ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
    )
  })

  it('applies idempotently without an account and lists only for the owner', async () => {
    const ctx = await setup()
    const body = { holderAddress: ctx.key.address }
    for (const _ of [0, 1]) {
      // oxlint-disable-next-line no-await-in-loop -- repeat the same application to verify idempotence
      const applied = await ctx.send(`${path}/apply`, body)
      expect(applied.status).toBe(200)
      // oxlint-disable-next-line no-await-in-loop -- inspect each response before the next request
      await expect(applied.json()).resolves.toStrictEqual({ applied: true })
    }
    const listed = await ctx.applicants()
    expect(listed.headers.get('cache-control')).toBe('no-store')
    await expect(listed.json()).resolves.toStrictEqual({
      applicants: [{ address: ctx.key.address.toLowerCase(), appliedAt: NOW }],
      next: null,
    })
    const second = await signIn(ctx.app, ctx.bindings, other)
    const result1 = await ctx.applicants(second.token)
    const result2 = await ctx.applicants('')
    const result3 = await ctx.send('/v1/issuers/missing/card/apply', body)
    expect([result1.status, result2.status, result3.status]).toStrictEqual([404, 401, 404])
  })

  it.each([{ identity: 'none', requirements: [] }, { claimUntil: NOW - 1 }] satisfies Partial<CardInput>[])(
    'refuses apply on unavailable Cards %j',
    async (changes) => {
      const ctx = await setup(changes)
      const applied = await ctx.send(`${path}/apply`, { holderAddress: ctx.key.address })
      expect(applied.status).toBe(changes.identity === 'none' ? 404 : 409)
      await expect(db().select().from(cardApplicants)).resolves.toHaveLength(0)
    },
  )

  it('lists applicants in pages, so early applications cannot hide later ones', async () => {
    const ctx = await setup()
    const rows = Array.from({ length: 101 }, (_, index) => ({
      address: `0x${index.toString(16).padStart(40, '0')}`,
      appliedAt: NOW,
      cardId: ctx.card.id,
    }))
    await Promise.all(
      [0, 30, 60, 90].map(
        async (start) =>
          await db()
            .insert(cardApplicants)
            .values(rows.slice(start, start + 30)),
      ),
    )
    const first = await ctx.applicants()
    const page = await first.json<CardApplicantsResponse>()
    expect(page.applicants).toHaveLength(100)
    expect(page.next).toBe(`${NOW}:${rows[99]?.address}`)
    const rest = await ctx.applicants(ctx.token, `?after=${page.next}`)
    await expect(rest.json()).resolves.toStrictEqual({
      applicants: [{ address: rows[100]?.address, appliedAt: NOW }],
      next: null,
    })
    const malformed = await ctx.applicants(ctx.token, '?after=1')
    expect(malformed.status).toBe(400)
  })

  it('checks signature, requirements, chain and capacity in order without reserving refused claims', async () => {
    const ctx = await setup({ capacity: 1 })
    await db().update(cards).set({ reserved: 1 }).where(eq(cards.id, ctx.card.id))
    const result4 = await ctx.send(`${path}/issue`, { holderAddress: ctx.key.address })
    const bad = await ctx.send(`${path}/issue`, { holderAddress: ctx.key.address, signature: '0x00' })

    const unmet = await ctx.claim()
    await expect(unmet.json()).resolves.toMatchObject({
      error: 'requirement_unmet',
      requirement: { detail: 'no-agreement', kind: requirement.kind },
    })
    ctx.grant()
    ctx.chain.failReads = true
    const result5 = await ctx.claim()
    ctx.chain.failReads = false
    const full = await ctx.claim()
    await expect(full.json()).resolves.toMatchObject({ error: 'card_sold_out' })
    const current = await db().select().from(cards).get()
    expect([result4.status, bad.status, result5.status, full.status, current?.reserved]).toStrictEqual([
      400, 403, 502, 409, 1,
    ])
    await expect(db().select().from(members)).resolves.toHaveLength(0)
  })

  it.each([
    { creationMode: 1, detail: 'not-granted' },
    { detail: 'wrong-terms', termsId: `0x${'ee'.repeat(32)}` },
  ] as const)(
    'refuses an unsuitable agreement without reserving a place %j',
    async ({ detail, ...change }) => {
      const ctx = await setup({ requirements: [{ ...requirement, termsId: agreementId }] })
      ctx.grant(change)
      const body = await ctx.claimBody()
      const response = await ctx.send(`${path}/issue`, { ...body, agreementId })
      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toStrictEqual({
        error: 'requirement_unmet',
        requirement: { detail, kind: requirement.kind },
      })
      const current = await db().select().from(cards).get()
      expect(current?.reserved).toBe(0)
    },
  )

  it('rejects a valid signature by another key without using capacity', async () => {
    const ctx = await setup()
    ctx.grant()
    const body = await ctx.claimBody()
    const response = await ctx.send(`${path}/issue`, { ...body, holderAddress: other.address })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toStrictEqual({ error: 'bad_signature' })
    const current = await db().select().from(cards).get()
    expect(current?.reserved).toBe(0)
  })

  it('returns one Signed pass for repeated and concurrent claims and one place used', async () => {
    const ctx = await setup({ capacity: 2 })
    ctx.grant()
    const responses = await Promise.all([ctx.claim(), ctx.claim()])
    const passes = await Promise.all(
      responses.map(async (response) => await response.json<SelfServeIssueResponse>()),
    )
    expect(passes[0]).toStrictEqual(passes[1])
    const repeated = await ctx.claim()
    await expect(repeated.json()).resolves.toStrictEqual(passes[0])
    const evidence = await db().select().from(passEvidence)
    const current = await db().select().from(cards).get()
    const issued = await db().select().from(members)
    const linked = await db().select().from(memberPasses)
    expect({
      evidence: evidence.map(({ kind, evidence: uri, position }) => ({ evidence: uri, kind, position })),
      issued: issued.length,
      linked: linked.length,
      reserved: current?.reserved,
      statuses: responses.map((r) => r.status),
    }).toStrictEqual({
      evidence: [
        {
          evidence: `ipagreement:${ctx.chain.chainId()}:${requirement.registry}/${agreementId}`,
          kind: requirement.kind,
          position: 0,
        },
      ],
      issued: 1,
      linked: 0,
      reserved: 1,
      statuses: [200, 200],
    })
    const [pass] = passes
    if (pass === undefined) {
      throw new Error('claim returned no pass')
    }
    const admitted = await ctx.present(pass.uid)
    await expect(admitted.json()).resolves.toMatchObject({
      decision: 'ADMIT',
      requirements: evidence.map(({ kind, evidence: uri }) => ({ evidence: uri, kind })),
    })
    const qr = await ctx.send('/v1/verify', { qr: pass.qr })
    await expect(qr.json()).resolves.toMatchObject({ reason: 'LEVEL_REQUIRED' })
  })

  it.each([{ revoked: true }, { frozen: true }, { expiry: 1n }, { holder: other.address }])(
    'rejects an inactive agreement and leaves a ticket unused %s',
    async (change) => {
      const ctx = await setup({ category: 'ticket' })
      ctx.grant()
      const result6 = await ctx.claim()
      const pass = await result6.json<SelfServeIssueResponse>()
      ctx.grant(change)
      const rejected = await ctx.present(pass.uid)
      await expect(rejected.json()).resolves.toMatchObject({
        decision: 'REJECT',
        reason: 'REQUIREMENT_UNMET',
        requirement: { detail: 'agreement-inactive', kind: requirement.kind },
      })
      await expect(db().select().from(slots)).resolves.toHaveLength(0)
      await expect(db().select().from(entryLog)).resolves.toMatchObject([
        { decision: 'REJECT', reason: 'REQUIREMENT_UNMET' },
      ])
      ctx.grant()
      const result7 = await ctx.present(pass.uid)
      await expect(result7.json()).resolves.toMatchObject({ decision: 'ADMIT' })
    },
  )

  it('keeps the pass and takes the evidence of a newly granted agreement on a repeated claim', async () => {
    const ctx = await setup()
    ctx.grant()
    const first = await ctx.claim()
    const pass = await first.json<SelfServeIssueResponse>()
    ctx.grant({ revoked: true })
    const ended = await ctx.claim()
    expect(ended.status).toBe(403)
    await expect(ended.json()).resolves.toStrictEqual({
      error: 'requirement_unmet',
      requirement: { detail: 'no-agreement', kind: requirement.kind },
    })
    const regranted: Hex = `0x${'7e'.repeat(32)}`
    ctx.grant({ id: regranted })
    const again = await ctx.claim()
    await expect(again.json()).resolves.toStrictEqual(pass)
    await expect(db().select().from(cards)).resolves.toMatchObject([{ reserved: 1 }])
    const admitted = await ctx.present(pass.uid)
    await expect(admitted.json()).resolves.toMatchObject({
      decision: 'ADMIT',
      requirements: [
        {
          evidence: formatAgreementEvidence({
            agreementId: regranted,
            chainId: ctx.chain.chainId(),
            registry: requirement.registry,
          }),
          kind: requirement.kind,
        },
      ],
    })
  })

  it.each(['expired', 'revoked', 'concurrent', 'used'] as const)(
    'handles an existing %s pass',
    async (state) => {
      const ctx = await setup({ category: state === 'used' ? 'ticket' : 'membership', validityDays: 1 })
      ctx.grant()
      const first = await ctx.claim()
      const old = await first.json<SelfServeIssueResponse>()
      await (state === 'used'
        ? ctx.present(old.uid)
        : db()
            .update(members)
            .set(state === 'revoked' ? { status: 'revoked' } : { validUntil: NOW - 1 })
            .where(eq(members.attestationUid, old.uid)))
      const responses = await Promise.all(state === 'concurrent' ? [ctx.claim(), ctx.claim()] : [ctx.claim()])
      const passes = await Promise.all(
        responses.map(async (response) => await response.json<SelfServeIssueResponse>()),
      )
      const [replacement] = passes
      expect(responses.map((response) => response.status)).toStrictEqual(
        state === 'concurrent' ? [200, 200] : [200],
      )
      expect(replacement?.uid === old.uid).toBe(state === 'used')
      expect(passes.every((pass) => pass.uid === replacement?.uid)).toBe(true)
      await expect(db().select().from(cardAddressPasses)).resolves.toMatchObject([
        { attestationUid: replacement?.uid },
      ])
      const current = await db().select().from(cards).get()
      const issued = await db().select().from(members)
      const used = await db().select().from(slots)
      expect({ issued: issued.length, reserved: current?.reserved, used: used.length }).toStrictEqual({
        issued: state === 'used' ? 1 : 2,
        reserved: state === 'used' ? 1 : 2,
        used: state === 'used' ? 1 : 0,
      })
    },
  )

  it('stops claim and presentation when a registry is removed without reading it', async () => {
    const ctx = await setup()
    ctx.grant()
    const first = await ctx.claim()
    const pass = await first.json<SelfServeIssueResponse>()
    ctx.bindings.IP_REGISTRIES = ''
    const reads = [
      vi.spyOn(ctx.chain, 'agreementCountOf'),
      vi.spyOn(ctx.chain, 'activeAgreementsOf'),
      vi.spyOn(ctx.chain, 'agreementOf'),
      vi.spyOn(ctx.chain, 'isActiveAgreementHolder'),
    ]
    for (const read of reads) {
      read.mockRejectedValue(new Error('Removed registry must not be read'))
    }
    const repeated = await ctx.claim()
    await expect(repeated.json()).resolves.toMatchObject({ requirement: { detail: 'registry-not-allowed' } })
    const shown = await ctx.present(pass.uid)
    await expect(shown.json()).resolves.toMatchObject({
      reason: 'REQUIREMENT_UNMET',
      requirement: { detail: 'registry-not-allowed' },
    })
    const fresh = await ctx.send(`${path}/issue`, {
      holderAddress: other.address,
      signature: await other.signMessage({ message: claimMessage(ctx.card.id, other.address) }),
    })
    await expect(fresh.json()).resolves.toMatchObject({ requirement: { detail: 'registry-not-allowed' } })
    for (const read of reads) {
      expect(read).not.toHaveBeenCalled()
    }
  })

  it('restores and renews outside the window, but refuses new claims after signature verification', async () => {
    const ctx = await setup()
    ctx.grant()
    const first = await ctx.claim()
    const pass = await first.json<SelfServeIssueResponse>()
    await db()
      .update(cards)
      .set({ claimUntil: NOW - 1 })
      .where(eq(cards.id, ctx.card.id))
    const restored = await ctx.claim()
    await expect(restored.json()).resolves.toStrictEqual(pass)
    ctx.grant({ revoked: true })
    ctx.grant({ id: `0x${'ef'.repeat(32)}` })
    const renewed = await ctx.claim()
    await expect(renewed.json()).resolves.toStrictEqual(pass)
    const bad = await ctx.send(`${path}/issue`, { holderAddress: ctx.key.address, signature: '0x00' })
    await expect(bad.json()).resolves.toStrictEqual({ error: 'bad_signature' })
    const reads = vi.spyOn(ctx.chain, 'agreementCountOf')
    const fresh = await ctx.send(`${path}/issue`, {
      holderAddress: other.address,
      signature: await other.signMessage({ message: claimMessage(ctx.card.id, other.address) }),
    })
    await expect(fresh.json()).resolves.toStrictEqual({ error: 'card_closed' })
    expect(reads).not.toHaveBeenCalled()
  })

  it('fails closed without evidence or readable chain', async () => {
    const ctx = await setup()
    ctx.grant()
    const result8 = await ctx.claim()
    const pass = await result8.json<SelfServeIssueResponse>()
    ctx.chain.failReads = true
    const repeated = await ctx.claim()
    expect(repeated.status).toBe(502)
    const result9 = await ctx.present(pass.uid)
    expect(result9.status).toBe(502)
    await expect(db().select().from(entryLog)).resolves.toHaveLength(0)
    ctx.chain.failReads = false
    await db().delete(passEvidence).where(eq(passEvidence.attestationUid, pass.uid))
    const result10 = await ctx.present(pass.uid)
    await expect(result10.json()).resolves.toMatchObject({ reason: 'REQUIREMENT_UNMET' })
  })
})
