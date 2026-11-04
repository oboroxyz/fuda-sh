import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { beforeEach, describe, expect, it } from 'vitest'

import { ZERO_ADDRESS } from '../src/chain/client.ts'
import { getDb } from '../src/db/client.ts'
import { cards, entryLog, members, offchainAttestations, slots } from '../src/db/schema.ts'
import {
  decodeOffchainPass,
  fromSignedJson,
  offchainTypedData,
  offchainUid,
  toSignedJson,
} from '../src/eas/offchain.ts'
import type { SignedOffchain } from '../src/eas/offchain.ts'
import type { Bindings } from '../src/env.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, ROOT, seedRoot } from './fixtures.ts'
import { CARD_INPUT, postJson, registerVenueWithCard, signIn } from './operator.ts'

const db = () => getDb({ DB: env.DB })

interface Issued {
  holder: Hex
  level: string
  memberNumber: string
  qr: string
  uid: Hex
}

const setup = async (card: Partial<typeof CARD_INPUT.card> = {}, overrides: Partial<Bindings> = {}) => {
  const chain = fakeChain({ signer: ROOT })
  const del = seedRoot(chain)
  let now = NOW
  const app = appWith({ chain, now: () => now })
  const bindings = configuredEnv(del, { API_BASE_URL: 'https://api.test', ...overrides })
  const { token } = await signIn(app, bindings)
  await registerVenueWithCard(
    app,
    bindings,
    { ...CARD_INPUT, card: { ...CARD_INPUT.card, record: 'offchain', ...card } },
    token,
  )
  const claim = async (ip = '203.0.113.70'): Promise<Response> =>
    await app.request(
      `/v1/issuers/${CARD_INPUT.handle}/${CARD_INPUT.card.slug}/issue`,
      { headers: { 'CF-Connecting-IP': ip }, method: 'POST' },
      bindings,
    )
  const scan = async (qr: string): Promise<Response> => await postJson(app, bindings, '/v1/verify', { qr })
  const issue = async (): Promise<Issued> => {
    const res = await claim()
    return await res.json<Issued>()
  }
  const verdict = async (qr: string): Promise<unknown> => {
    const res = await scan(qr)
    return await res.json()
  }
  return {
    app,
    bindings,
    chain,
    claim,
    issue,
    scan,
    setNow: (next: number) => {
      now = next
    },
    token,
    verdict,
  }
}

const signedRow = async (uid: Hex): Promise<SignedOffchain> => {
  const row = await db().select().from(offchainAttestations).where(eq(offchainAttestations.uid, uid)).get()
  const signed = row === undefined ? null : fromSignedJson(row.signed)
  if (signed === null) {
    throw new Error('no signed attestation for that uid')
  }
  return signed
}

const storeRow = async (uid: Hex, signed: SignedOffchain): Promise<void> => {
  await db()
    .update(offchainAttestations)
    .set({ signed: toSignedJson(signed) })
    .where(eq(offchainAttestations.uid, uid))
}

const signedRowStatus = async (uid: Hex): Promise<string | null> => {
  const row = await db().select().from(offchainAttestations).where(eq(offchainAttestations.uid, uid)).get()
  return row?.revokeTx ?? null
}

describe('offchain standard passes', () => {
  beforeEach(async () => {
    await db().delete(offchainAttestations)
    await db().delete(slots)
    await db().delete(entryLog)
    await db().delete(members)
    await db().delete(cards)
    await env.DB.prepare('DELETE FROM issuers').run()
    await env.DB.prepare('DELETE FROM rate_limits').run()
  })

  describe('issuing', () => {
    it('makes offchain the default for a new card', async () => {
      const { app, bindings, token } = await setup()
      const { record: _record, ...withoutRecord } = CARD_INPUT.card
      const res = await postJson(
        app,
        bindings,
        '/v1/issuers/cards',
        { ...withoutRecord, slug: 'second' },
        token,
      )
      expect(res.status).toBeLessThan(300)
      const [created] = await db().select().from(cards).where(eq(cards.slug, 'second'))
      expect(created?.record).toBe('offchain')
    })

    it('keeps a card that asks for on-chain on chain', async () => {
      const { chain, issue } = await setup({ record: 'onchain' })
      const issued = await issue()
      expect(issued.holder).not.toBe(ZERO_ADDRESS)
      expect(chain.attestations.has(issued.uid)).toBe(true)
    })

    it('signs a pass with no transaction and no holder', async () => {
      const { chain, claim } = await setup()
      const before = chain.txs.length
      const res = await claim()
      expect(res.status).toBe(200)
      const issued = await res.json<Issued>()
      expect(chain.txs).toHaveLength(before)
      expect(issued).toMatchObject({ holder: ZERO_ADDRESS, level: 'bearer', qr: `fuda:v1:${issued.uid}` })
      const member = await db().select().from(members).where(eq(members.attestationUid, issued.uid)).get()
      expect(member).toMatchObject({ holder: null, level: 'bearer', memberId: issued.memberNumber })
    })

    it('signs the D1 member number and the venue into the attestation', async () => {
      const { issue } = await setup()
      const issued = await issue()
      const signed = await signedRow(issued.uid)
      expect(offchainUid(signed.message)).toBe(issued.uid)
      expect(signed.message.recipient).toBe(ZERO_ADDRESS)
      const [card] = await db().select().from(cards)
      expect(decodeOffchainPass(signed.message.data)).toMatchObject({
        card: card?.id,
        level: 0,
        memberNumber: issued.memberNumber,
        venue: CARD_INPUT.handle,
      })
    })

    it('answers 501 without a signer and takes no place', async () => {
      const chain = fakeChain({ signer: null })
      const seeded = fakeChain({ signer: ROOT })
      const del = seedRoot(seeded)
      const signing = appWith({ chain: seeded, now: () => NOW })
      const bindings = configuredEnv(del)
      const { token } = await signIn(signing, bindings)
      await registerVenueWithCard(
        signing,
        bindings,
        { ...CARD_INPUT, card: { ...CARD_INPUT.card, record: 'offchain' } },
        token,
      )
      const unsigned = appWith({ chain, now: () => NOW })
      const res = await unsigned.request(
        `/v1/issuers/${CARD_INPUT.handle}/${CARD_INPUT.card.slug}/issue`,
        { headers: { 'CF-Connecting-IP': '203.0.113.71' }, method: 'POST' },
        bindings,
      )
      expect(res.status).toBe(501)
      const [card] = await db().select().from(cards)
      expect(card?.reserved).toBe(0)
    })

    it('gives the place back and leaves nothing behind when the rows cannot be written', async () => {
      const { claim } = await setup()
      await env.DB.exec(
        `CREATE TRIGGER fail_offchain BEFORE INSERT ON offchain_attestations BEGIN SELECT RAISE(ABORT, 'no'); END`,
      )
      const res = await claim()
      await env.DB.exec('DROP TRIGGER fail_offchain')
      expect(res.status).toBe(500)
      const [card] = await db().select().from(cards)
      expect(card?.reserved).toBe(0)
      await expect(db().select().from(members)).resolves.toHaveLength(0)
    })
  })

  describe('at the gate', () => {
    it('admits a valid pass, logs it in D1 and writes no Attendance', async () => {
      const { chain, issue, scan } = await setup()
      const issued = await issue()
      const before = chain.attestations.size
      const res = await scan(issued.qr)
      await expect(res.json()).resolves.toMatchObject({
        decision: 'ADMIT',
        entitlement: { holder: ZERO_ADDRESS, level: 0 },
        reason: 'OK',
      })
      expect(chain.attestations.size).toBe(before)
      const log = await db().select().from(entryLog).where(eq(entryLog.uid, issued.uid))
      expect(log).toMatchObject([{ decision: 'ADMIT', path: 'qr', reason: 'OK' }])
    })

    it('answers a read-only preview without logging it', async () => {
      const { app, bindings, issue } = await setup()
      const issued = await issue()
      const res = await app.request(`/v1/verify/${issued.uid}`, {}, bindings)
      await expect(res.json()).resolves.toMatchObject({ decision: 'ADMIT', reason: 'OK' })
      await expect(db().select().from(entryLog)).resolves.toHaveLength(0)
    })

    it('uses a ticket once', async () => {
      const { issue, verdict } = await setup({ category: 'ticket' })
      const issued = await issue()
      await expect(verdict(issued.qr)).resolves.toMatchObject({ decision: 'ADMIT' })
      await expect(verdict(issued.qr)).resolves.toMatchObject({
        decision: 'REJECT',
        reason: 'ALREADY_USED',
      })
    })

    it('rejects a pass after its validity ends', async () => {
      const { issue, setNow, verdict } = await setup({ validityDays: 1 })
      const issued = await issue()
      setNow(NOW + 2 * 86_400)
      await expect(verdict(issued.qr)).resolves.toMatchObject({
        decision: 'REJECT',
        reason: 'EXPIRED',
      })
    })

    it('rejects a row whose data was altered after signing', async () => {
      const { issue, verdict } = await setup()
      const issued = await issue()
      const signed = await signedRow(issued.uid)
      await storeRow(issued.uid, { ...signed, message: { ...signed.message, data: '0x1234' } })
      await expect(verdict(issued.qr)).resolves.toMatchObject({ decision: 'REJECT' })
    })

    it('rejects a pass signed by another key', async () => {
      const { issue, verdict } = await setup()
      const issued = await issue()
      const signed = await signedRow(issued.uid)
      const other = privateKeyToAccount(`0x${'cd'.repeat(32)}`)
      const signature = await other.signTypedData(offchainTypedData(signed.domain, signed.message))
      await storeRow(issued.uid, { ...signed, signature })
      await expect(verdict(issued.qr)).resolves.toMatchObject({
        decision: 'REJECT',
        reason: 'ISSUER_NOT_DELEGATED',
      })
    })

    it('rejects a pass signed under another domain', async () => {
      const { app, bindings, issue } = await setup()
      const issued = await issue()
      const res = await app.request(`/v1/verify/${issued.uid}`, {}, { ...bindings, EAS_VERSION: '1.0.1' })
      await expect(res.json()).resolves.toMatchObject({ decision: 'REJECT', reason: 'BAD_SIGNATURE' })
    })

    it('rejects a valid signature moved onto another venue row', async () => {
      const { issue, verdict } = await setup()
      const issued = await issue()
      await env.DB.prepare(
        `INSERT INTO issuers (id, handle, name, brand_color, operator_address, created_at)
         VALUES ('other', 'other-shop', 'Other', '#000000', '0x00', 1)`,
      ).run()
      await db().update(members).set({ issuerId: 'other' }).where(eq(members.attestationUid, issued.uid))
      await expect(verdict(issued.qr)).resolves.toMatchObject({
        decision: 'REJECT',
        reason: 'WRONG_SCHEMA',
      })
    })
  })

  describe('with the chain unreadable', () => {
    it('admits a membership card as unconfirmed', async () => {
      const { chain, issue, verdict } = await setup()
      const issued = await issue()
      chain.failReads = true
      await expect(verdict(issued.qr)).resolves.toMatchObject({
        decision: 'ADMIT',
        reason: 'OK',
        unconfirmed: true,
      })
    })

    it('leaves the mark off when the chain answered', async () => {
      const { issue, verdict } = await setup()
      const issued = await issue()
      await expect(verdict(issued.qr)).resolves.not.toHaveProperty('unconfirmed')
    })

    it('answers 502 for a ticket and burns no slot', async () => {
      const { chain, issue, scan } = await setup({ category: 'ticket' })
      const issued = await issue()
      chain.failReads = true
      const res = await scan(issued.qr)
      expect(res.status).toBe(502)
      await expect(db().select().from(slots)).resolves.toHaveLength(0)
    })

    it('still rejects a pass revoked through fuda', async () => {
      const { app, bindings, chain, issue, token, verdict } = await setup()
      const issued = await issue()
      await postJson(app, bindings, '/v1/revoke', { uid: issued.uid }, token)
      chain.failReads = true
      await expect(verdict(issued.qr)).resolves.toMatchObject({
        decision: 'REJECT',
        reason: 'REVOKED',
      })
    })
  })

  describe('revoking', () => {
    it('marks D1 and records the revocation on chain', async () => {
      const { app, bindings, chain, issue, token, verdict } = await setup()
      const issued = await issue()
      const res = await postJson(app, bindings, '/v1/revoke', { uid: issued.uid }, token)
      await expect(res.json()).resolves.toStrictEqual({ revoked: true, uid: issued.uid })
      const attester = chain.offchainAttester()
      if (attester === null) {
        throw new Error('fake chain has no offchain attester')
      }
      await expect(chain.offchainRevokedAt(attester, issued.uid)).resolves.not.toBe(0n)
      const row = await db()
        .select()
        .from(offchainAttestations)
        .where(eq(offchainAttestations.uid, issued.uid))
        .get()
      expect(row?.revokeTx).toMatch(/^0x/u)
      await expect(verdict(issued.qr)).resolves.toMatchObject({ reason: 'REVOKED' })
    })

    it('keeps the pass revoked when the transaction fails, and sends it on the next call', async () => {
      const { app, bindings, chain, issue, token, verdict } = await setup()
      const issued = await issue()
      chain.failWrites = true
      const failed = await postJson(app, bindings, '/v1/revoke', { uid: issued.uid }, token)
      expect(failed.status).toBe(200)
      await expect(signedRowStatus(issued.uid)).resolves.toBeNull()
      await expect(verdict(issued.qr)).resolves.toMatchObject({ reason: 'REVOKED' })
      chain.failWrites = false
      await postJson(app, bindings, '/v1/revoke', { uid: issued.uid }, token)
      await expect(signedRowStatus(issued.uid)).resolves.toMatch(/^0x/u)
    })

    it('does not send a second transaction for a pass already revoked on chain', async () => {
      const { app, bindings, chain, issue, token } = await setup()
      const issued = await issue()
      await postJson(app, bindings, '/v1/revoke', { uid: issued.uid }, token)
      const before = chain.txs.length
      const res = await postJson(app, bindings, '/v1/revoke', { uid: issued.uid }, token)
      expect(res.status).toBe(200)
      expect(chain.txs).toHaveLength(before)
    })

    it('rejects a pass revoked directly on chain', async () => {
      const { chain, issue, verdict } = await setup()
      const issued = await issue()
      await chain.revokeOffchain(issued.uid)
      await expect(verdict(issued.qr)).resolves.toMatchObject({ reason: 'REVOKED' })
    })
  })

  describe('passes', () => {
    it('serves the browser pass of a pass with no holder', async () => {
      const { app, bindings, issue } = await setup()
      const issued = await issue()
      const res = await app.request(`/pass/${issued.uid}`, {}, bindings)
      expect(res.status).toBe(200)
    })
  })
})
