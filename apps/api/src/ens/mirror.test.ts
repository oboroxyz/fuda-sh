import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import type { Hex } from 'viem'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client.ts'
import { darkenMemberName, mirrorIssuerName, mirrorMemberName } from './mirror.ts'
import { ensNames } from './schema.ts'

const HOLDER: Hex = `0x${'22'.repeat(20)}`
const OWNER: Hex = `0x${'33'.repeat(20)}`
const META_ADDRESS: Hex = `0x${'44'.repeat(66)}`
const UID: Hex = `0x${'ab'.repeat(32)}`
const MEMBER = 'qj2yxphepdrka'
const PARENT = 'fuda.eth'

const db = () => getDb({ DB: env.DB })

const rowFor = async (name: string) => await db().select().from(ensNames).where(eq(ensNames.name, name)).get()

const TX_HASH: Hex = `0x${'cd'.repeat(32)}`
const UNKNOWN_UID: Hex = `0x${'ee'.repeat(32)}`

describe(mirrorMemberName, () => {
  it('writes an offchain member name under the issuer handle', async () => {
    await mirrorMemberName(db(), {
      holder: HOLDER,
      issuerHandle: 'bakery',
      level: 'bearer',
      memberNumber: MEMBER,
      now: 10,
      parentName: PARENT,
      rightUid: UID,
      stealthMetaAddress: null,
    })

    const row = await rowFor(`${MEMBER}.bakery.${PARENT}`)
    expect(row).toMatchObject({ kind: 'member', level: 'bearer', status: 'offchain', targetAddress: HOLDER })
    expect(row?.rightUid).toBe(UID)
  })

  it('stores a private right by meta-address and leaves the target empty', async () => {
    await mirrorMemberName(db(), {
      holder: null,
      issuerHandle: 'club',
      level: 'private',
      memberNumber: MEMBER,
      now: 10,
      parentName: PARENT,
      rightUid: UID,
      stealthMetaAddress: META_ADDRESS,
    })

    const row = await rowFor(`${MEMBER}.club.${PARENT}`)
    expect(row?.stealthMetaAddress).toBe(META_ADDRESS)
    expect(row?.targetAddress).toBeNull()
  })

  it('refuses a member id that is not a member number', async () => {
    await mirrorMemberName(db(), {
      holder: HOLDER,
      issuerHandle: 'bakery',
      level: 'bearer',
      memberNumber: 'gold-tier-7',
      now: 10,
      parentName: PARENT,
      rightUid: UID,
      stealthMetaAddress: null,
    })

    await expect(rowFor(`gold-tier-7.bakery.${PARENT}`)).resolves.toBeUndefined()
  })

  it('never lets a mirror failure escape to the caller', async () => {
    const write = async () => {
      await mirrorMemberName(db(), {
        holder: HOLDER,
        issuerHandle: 'bakery',
        level: 'bearer',
        memberNumber: MEMBER,
        now: 10,
        parentName: PARENT,
        rightUid: UID,
        stealthMetaAddress: null,
      })
    }

    await write()
    await expect(write()).resolves.toBeUndefined()
  })
})

describe(mirrorIssuerName, () => {
  it('records a pending claim and then its confirmation', async () => {
    const name = `bakery.${PARENT}`
    await mirrorIssuerName(db(), {
      handle: 'bakery',
      now: 10,
      owner: OWNER,
      parentName: PARENT,
      status: 'voucher_issued',
    })
    await expect(rowFor(name)).resolves.toMatchObject({ ownerAddress: OWNER, status: 'voucher_issued' })

    await mirrorIssuerName(db(), {
      claimTxHash: TX_HASH,
      expiry: 2000,
      handle: 'bakery',
      now: 20,
      owner: OWNER,
      parentName: PARENT,
      status: 'claimed',
    })
    await expect(rowFor(name)).resolves.toMatchObject({ expiry: 2000, status: 'claimed' })
  })

  it('does not let a late voucher write downgrade a confirmed claim', async () => {
    const name = `bakery.${PARENT}`
    await mirrorIssuerName(db(), {
      claimTxHash: TX_HASH,
      expiry: 2000,
      handle: 'bakery',
      now: 20,
      owner: OWNER,
      parentName: PARENT,
      status: 'claimed',
    })

    await mirrorIssuerName(db(), {
      handle: 'bakery',
      now: 30,
      owner: OWNER,
      parentName: PARENT,
      status: 'voucher_issued',
    })

    await expect(rowFor(name)).resolves.toMatchObject({
      claimTxHash: TX_HASH,
      expiry: 2000,
      status: 'claimed',
      updatedAt: 20,
    })
  })
})

describe(darkenMemberName, () => {
  it('unregisters the name of a revoked right so lookup stops answering', async () => {
    await mirrorMemberName(db(), {
      holder: HOLDER,
      issuerHandle: 'bakery',
      level: 'bearer',
      memberNumber: MEMBER,
      now: 10,
      parentName: PARENT,
      rightUid: UID,
      stealthMetaAddress: null,
    })

    await darkenMemberName(db(), { now: 30, rightUid: UID })

    await expect(rowFor(`${MEMBER}.bakery.${PARENT}`)).resolves.toMatchObject({ status: 'unregistered' })
  })

  it('is silent about a right that was never mirrored', async () => {
    await expect(darkenMemberName(db(), { now: 30, rightUid: UNKNOWN_UID })).resolves.toBeUndefined()
  })
})
