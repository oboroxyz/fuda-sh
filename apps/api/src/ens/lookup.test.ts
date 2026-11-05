import { env } from 'cloudflare:test'
import { getAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client.ts'
import { accounts, issuers } from '../db/schema.ts'
import { lookupEnsName } from './lookup.ts'
import { ensNames } from './schema.ts'

const OWNER = `0x${'11'.repeat(20)}`
const TARGET = `0x${'22'.repeat(20)}`

// A registered venue, as `POST /issuers` stores it: the operator address
// lower-cased, and unique to the venue.
const registerVenue = async (handle: string): Promise<string> => {
  const operatorAddress = `0x${crypto.randomUUID().replaceAll('-', '').padEnd(40, 'ab')}`
  await getDb({ DB: env.DB }).insert(issuers).values({
    brandColor: '#000000',
    createdAt: 1,
    handle,
    id: crypto.randomUUID(),
    name: handle,
    operatorAddress,
  })
  return operatorAddress
}

const insertIssuerName = async (
  handle: string,
  overrides: Partial<typeof ensNames.$inferInsert> = {},
): Promise<void> => {
  const db = getDb({ DB: env.DB })
  await db.insert(ensNames).values({
    createdAt: 1,
    issuerHandle: handle,
    kind: 'issuer',
    name: `${handle}.fuda.eth`,
    ownerAddress: OWNER,
    status: 'offchain',
    targetAddress: TARGET,
    updatedAt: 1,
    ...overrides,
  })
}

describe('ENS lookup', () => {
  it('returns the stable target of an active offchain Issuer name', async () => {
    await insertIssuerName('bakery')

    await expect(
      lookupEnsName(getDb({ DB: env.DB }), {
        name: 'BAKERY.FUDA.ETH.',
        now: 10,
        parentName: 'fuda.eth',
      }),
    ).resolves.toStrictEqual({ address: TARGET, expiresAt: null })
  })

  it.each([
    ['failed', 'gallery'],
    ['unregistered', 'office'],
  ] as const)('hides a %s name', async (status, handle) => {
    await insertIssuerName(handle, { status })
    await expect(
      lookupEnsName(getDb({ DB: env.DB }), {
        name: `${handle}.fuda.eth`,
        now: 10,
        parentName: 'fuda.eth',
      }),
    ).resolves.toBeNull()
  })

  it("answers a never-claimed venue's name with its operator wallet", async () => {
    const operator = await registerVenue('noodles')

    await expect(
      lookupEnsName(getDb({ DB: env.DB }), { name: 'noodles.fuda.eth', now: 10, parentName: 'fuda.eth' }),
    ).resolves.toStrictEqual({ address: getAddress(operator), expiresAt: null })
  })

  it.each(['voucher_issued', 'failed'] as const)(
    'keeps answering a venue name offchain while its claim is %s',
    async (status) => {
      const handle = `pending-${status.replace('_', '-')}`
      const operator = await registerVenue(handle)
      await insertIssuerName(handle, { status })

      await expect(
        lookupEnsName(getDb({ DB: env.DB }), { name: `${handle}.fuda.eth`, now: 10, parentName: 'fuda.eth' }),
      ).resolves.toStrictEqual({ address: getAddress(operator), expiresAt: null })
    },
  )

  it.each(['claimed', 'unregistered'] as const)(
    'never falls back to the operator wallet once a %s name has lapsed',
    async (status) => {
      await registerVenue(`lapsed-${status}`)
      await insertIssuerName(`lapsed-${status}`, { expiry: 9, status })

      await expect(
        lookupEnsName(getDb({ DB: env.DB }), {
          name: `lapsed-${status}.fuda.eth`,
          now: 10,
          parentName: 'fuda.eth',
        }),
      ).resolves.toBeNull()
    },
  )

  it('resolves nothing for a venue an account owns, since it has no wallet', async () => {
    const database = getDb({ DB: env.DB })
    const accountId = crypto.randomUUID()
    await database.insert(accounts).values({ createdAt: 1, id: accountId, userHandle: accountId })
    await database.insert(issuers).values({
      brandColor: '#000000',
      createdAt: 1,
      handle: 'passkey-only',
      id: crypto.randomUUID(),
      name: 'Passkey only',
      ownerAccountId: accountId,
    })

    await expect(
      lookupEnsName(database, { name: 'passkey-only.fuda.eth', now: 10, parentName: 'fuda.eth' }),
    ).resolves.toBeNull()
  })

  it('hides an expired name but includes its exact expiry instant', async () => {
    await insertIssuerName('expired', { expiry: 9 })
    await insertIssuerName('boundary', { expiry: 10 })
    const db = getDb({ DB: env.DB })

    await expect(
      lookupEnsName(db, { name: 'expired.fuda.eth', now: 10, parentName: 'fuda.eth' }),
    ).resolves.toBeNull()
    await expect(
      lookupEnsName(db, { name: 'boundary.fuda.eth', now: 10, parentName: 'fuda.eth' }),
    ).resolves.toStrictEqual({ address: TARGET, expiresAt: 10 })
  })

  it.each(['unknown.fuda.eth', 'bakery.other.eth', 'too.deep.bakery.fuda.eth'])(
    'returns null for an unknown, foreign, or unsupported name %s',
    async (name) => {
      await expect(
        lookupEnsName(getDb({ DB: env.DB }), { name, now: 10, parentName: 'fuda.eth' }),
      ).resolves.toBeNull()
    },
  )

  it('keeps a claimed member name visible through the future Issuer wildcard resolver', async () => {
    const db = getDb({ DB: env.DB })
    await db.insert(ensNames).values({
      createdAt: 1,
      issuerHandle: 'club',
      kind: 'member',
      level: 'signed',
      name: '3456789acdefq.club.fuda.eth',
      ownerAddress: OWNER,
      rightUid: `0x${'55'.repeat(32)}`,
      status: 'claimed',
      targetAddress: TARGET,
      updatedAt: 1,
    })

    await expect(
      lookupEnsName(db, {
        name: '3456789acdefq.club.fuda.eth',
        now: 10,
        parentName: 'fuda.eth',
      }),
    ).resolves.toStrictEqual({ address: TARGET, expiresAt: null })
  })

  it('does not expose a malformed persisted address', async () => {
    await insertIssuerName('malformed', { targetAddress: 'not-an-address' })

    await expect(
      lookupEnsName(getDb({ DB: env.DB }), {
        name: 'malformed.fuda.eth',
        now: 10,
        parentName: 'fuda.eth',
      }),
    ).resolves.toBeNull()
  })
})
