import { verifyMessage } from 'viem'
import { describe, expect, it } from 'vitest'

import {
  mergeEntries,
  newMemberSecret,
  newPassSalt,
  openEntries,
  passKeyFrom,
  sealEntries,
  unwrapSecret,
  wrapSecret,
} from './member-secret.ts'
import type { VaultEntry } from './member-secret.ts'

const prf = (fill: number): Uint8Array<ArrayBuffer> => new Uint8Array(32).fill(fill)

const entry = (fill: string, cardTitle = 'Staff badge'): VaultEntry => ({
  cardTitle,
  salt: newPassSalt(),
  uid: `0x${fill.repeat(64)}`,
  venue: 'coffee',
})

describe('wrapping the member secret', () => {
  it('gives the secret back to the passkey that wrapped it', async () => {
    const secret = newMemberSecret()
    const copy = await wrapSecret(secret, prf(1))
    await expect(unwrapSecret(copy, prf(1))).resolves.toStrictEqual(secret)
  })

  it('opens for no other PRF output, and not after tampering', async () => {
    const copy = await wrapSecret(newMemberSecret(), prf(1))
    await expect(unwrapSecret(copy, prf(2))).resolves.toBeNull()
    const flipped = `${copy.ciphertext.startsWith('A') ? 'B' : 'A'}${copy.ciphertext.slice(1)}`
    await expect(unwrapSecret({ ...copy, ciphertext: flipped }, prf(1))).resolves.toBeNull()
  })

  it('lets a second passkey hold the same secret, in a different ciphertext', async () => {
    const secret = newMemberSecret()
    const first = await wrapSecret(secret, prf(1))
    const second = await wrapSecret(secret, prf(2))
    expect(second.ciphertext).not.toBe(first.ciphertext)
    await expect(unwrapSecret(second, prf(2))).resolves.toStrictEqual(secret)
  })

  it('never reuses an iv', async () => {
    const secret = newMemberSecret()
    const [a, b] = await Promise.all([wrapSecret(secret, prf(1)), wrapSecret(secret, prf(1))])
    expect(a.iv).not.toBe(b.iv)
  })
})

describe('deriving a pass key', () => {
  it('is the same key from the same secret and salt, so a new device gets it back', async () => {
    const secret = newMemberSecret()
    const salt = newPassSalt()
    const [a, b] = await Promise.all([passKeyFrom(secret, salt), passKeyFrom(secret, salt)])
    expect(a.address).toBe(b.address)
  })

  it('is a different key for every pass, and for every member', async () => {
    const secret = newMemberSecret()
    const salt = newPassSalt()
    const [same, otherPass, otherMember] = await Promise.all([
      passKeyFrom(secret, salt),
      passKeyFrom(secret, newPassSalt()),
      passKeyFrom(newMemberSecret(), salt),
    ])
    expect(new Set([same.address, otherPass.address, otherMember.address]).size).toBe(3)
  })

  it('signs a gate message that recovers to its address', async () => {
    const key = await passKeyFrom(newMemberSecret(), newPassSalt())
    const message = 'fuda-gate:0xab:0xcd'
    await expect(
      verifyMessage({ address: key.address, message, signature: await key.signMessage({ message }) }),
    ).resolves.toBe(true)
  })
})

describe('the vault', () => {
  it('opens with the secret that sealed it', async () => {
    const secret = newMemberSecret()
    const entries = [entry('a'), entry('b')]
    await expect(openEntries(await sealEntries(entries, secret), secret)).resolves.toStrictEqual(entries)
  })

  it('opens with no other secret, and holds nothing readable', async () => {
    const entries = [entry('a', 'A very private card')]
    const sealed = await sealEntries(entries, newMemberSecret())
    await expect(openEntries(sealed, newMemberSecret())).resolves.toBeNull()
    expect(atob(sealed.ciphertext.replaceAll('-', '+').replaceAll('_', '/'))).not.toContain('private')
  })

  it('refuses a sealed value of the wrong shape', async () => {
    const secret = newMemberSecret()
    const sealed = await sealEntries([{ ...entry('a'), uid: '0x1234' }], secret)
    await expect(openEntries(sealed, secret)).resolves.toBeNull()
  })

  it('keeps what is there and adds only what is new when merging', () => {
    const first = entry('a')
    const second = entry('b')
    expect(mergeEntries([first], [first, second])).toStrictEqual([first, second])
  })
})
