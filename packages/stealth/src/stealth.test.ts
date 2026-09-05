import { verifyMessage } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import { deriveMemberSecret, deriveStealthKeys } from './derive.ts'
import { buildAnnouncementMetadata } from './metadata.ts'
import type { AnnouncementRow } from './stealth.ts'
import {
  checkAnnouncement,
  generateStealthAddress,
  isMetaAddress,
  matchAnnouncements,
  recoverStealthPrivateKey,
  tweakFromShared,
} from './stealth.ts'

const keys = deriveStealthKeys(deriveMemberSecret(new Uint8Array(32).fill(1)))
const other = deriveStealthKeys(deriveMemberSecret(new Uint8Array(32).fill(2)))
const UID = `0x${'ab'.repeat(32)}` as const

describe(generateStealthAddress, () => {
  it('produces a fresh address per ephemeral key', () => {
    const a = generateStealthAddress(keys.metaAddress)
    const b = generateStealthAddress(keys.metaAddress)
    expect(a.stealthAddress).not.toBe(b.stealthAddress)
    expect(a.ephemeralPublicKey).toMatch(/^0x0[23][0-9a-f]{64}$/u)
    expect(a.viewTag).toBeGreaterThanOrEqual(0)
    expect(a.viewTag).toBeLessThanOrEqual(255)
  })

  it('is deterministic for a given ephemeral private key', () => {
    const eph = new Uint8Array(32).fill(9)
    expect(generateStealthAddress(keys.metaAddress, eph)).toStrictEqual(
      generateStealthAddress(keys.metaAddress, eph),
    )
  })

  it('rejects a malformed meta-address', () => {
    expect(() => generateStealthAddress('0x1234')).toThrow(/malformed meta-address/u)
  })

  // A 132-hex string is not automatically two public keys. These are refused here,
  // on the same message prefix, rather than deep inside noble at ECDH time.
  it('rejects a well-shaped meta-address whose halves are not curve points', () => {
    const good = keys.spendPub.slice(2)
    // x = 2**256 - 1, which is larger than the field prime: no such point exists.
    const offCurve = `02${'ff'.repeat(32)}`
    expect(() => generateStealthAddress(`0x${offCurve}${good}`)).toThrow(/malformed meta-address/u)
    expect(() => generateStealthAddress(`0x${good}${offCurve}`)).toThrow(/malformed meta-address/u)
  })

  it('rejects a meta-address half with a non-compressed prefix byte', () => {
    const good = keys.spendPub.slice(2)
    const body = keys.viewPub.slice(4)
    expect(() => generateStealthAddress(`0x${good}04${body}`)).toThrow(/malformed meta-address/u)
    expect(() => generateStealthAddress(`0x${good}05${body}`)).toThrow(/malformed meta-address/u)
  })
})

describe(isMetaAddress, () => {
  it('accepts a derived meta-address and rejects the shape and curve failures', () => {
    expect(isMetaAddress(keys.metaAddress)).toBe(true)
    expect(isMetaAddress('0x1234')).toBe(false)
    expect(isMetaAddress(`0x02${'ff'.repeat(32)}${keys.spendPub.slice(2)}`)).toBe(false)
  })
})

describe(tweakFromShared, () => {
  it('refuses a shared secret that is zero modulo the curve order', () => {
    expect(() => tweakFromShared(new Uint8Array(32))).toThrow(/degenerate/u)
  })

  it('accepts a normal shared secret', () => {
    expect(tweakFromShared(new Uint8Array(32).fill(3))).toBeGreaterThan(0n)
  })
})

describe(recoverStealthPrivateKey, () => {
  // The proof of the whole scheme: the recovered key controls the announced address.
  it('recovers a key that controls the stealth address', async () => {
    const { ephemeralPublicKey, stealthAddress } = generateStealthAddress(keys.metaAddress)
    const key = recoverStealthPrivateKey(keys, ephemeralPublicKey)
    const account = privateKeyToAccount(key)
    expect(account.address).toBe(stealthAddress)
    const signature = await account.signMessage({ message: 'fuda-gate:x:y' })
    await expect(
      verifyMessage({ address: stealthAddress, message: 'fuda-gate:x:y', signature }),
    ).resolves.toBe(true)
  })

  it('recovers a different, non-controlling key for another member', () => {
    const { ephemeralPublicKey, stealthAddress } = generateStealthAddress(keys.metaAddress)
    const wrong = privateKeyToAccount(recoverStealthPrivateKey(other, ephemeralPublicKey))
    expect(wrong.address).not.toBe(stealthAddress)
  })
})

describe(checkAnnouncement, () => {
  it('matches an announcement made to this member and skips a view-tag mismatch', () => {
    const g = generateStealthAddress(keys.metaAddress)
    const row = {
      ephemeralPubKey: g.ephemeralPublicKey,
      metadata: buildAnnouncementMetadata(g.viewTag, UID),
      stealthAddress: g.stealthAddress,
    }
    expect(checkAnnouncement(keys, row)).toBe(true)
    expect(checkAnnouncement(other, row)).toBe(false)
    const wrongTag = { ...row, metadata: buildAnnouncementMetadata((g.viewTag + 1) % 256, UID) }
    expect(checkAnnouncement(keys, wrongTag)).toBe(false)
  })
})

describe(matchAnnouncements, () => {
  it('returns the discovered passes with a controlling key, ignoring the rest', () => {
    const mine = generateStealthAddress(keys.metaAddress)
    const theirs = generateStealthAddress(other.metaAddress)
    const rows: AnnouncementRow[] = [
      {
        ephemeralPubKey: theirs.ephemeralPublicKey,
        metadata: buildAnnouncementMetadata(theirs.viewTag, `0x${'cd'.repeat(32)}`),
        stealthAddress: theirs.stealthAddress,
      },
      {
        ephemeralPubKey: mine.ephemeralPublicKey,
        metadata: buildAnnouncementMetadata(mine.viewTag, UID),
        stealthAddress: mine.stealthAddress,
      },
      {
        ephemeralPubKey: mine.ephemeralPublicKey,
        metadata: '0xdead',
        stealthAddress: mine.stealthAddress,
      },
    ]
    const found = matchAnnouncements(keys, rows)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ stealthAddress: mine.stealthAddress, uid: UID })
    expect(privateKeyToAccount(found[0]?.stealthPrivateKey ?? '0x').address).toBe(mine.stealthAddress)
  })
})
