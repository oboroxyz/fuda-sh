import { describe, expect, it } from 'vitest'

import { deriveMemberSecret, deriveStealthKeys } from './derive.ts'

const ENTROPY = new Uint8Array(32).fill(7)

describe(deriveMemberSecret, () => {
  it('is deterministic and 32 bytes', () => {
    const a = deriveMemberSecret(ENTROPY)
    const b = deriveMemberSecret(new Uint8Array(32).fill(7))
    expect(a).toHaveLength(32)
    expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'))
  })

  it('changes with the entropy', () => {
    const a = deriveMemberSecret(ENTROPY)
    const b = deriveMemberSecret(new Uint8Array(32).fill(8))
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'))
  })
})

describe(deriveStealthKeys, () => {
  it('yields two distinct 33-byte compressed public keys and a 66-byte meta-address', () => {
    const keys = deriveStealthKeys(deriveMemberSecret(ENTROPY))
    expect(keys.spendPub).toMatch(/^0x0[23][0-9a-f]{64}$/u)
    expect(keys.viewPub).toMatch(/^0x0[23][0-9a-f]{64}$/u)
    expect(keys.spendPub).not.toBe(keys.viewPub)
    expect(keys.metaAddress).toBe(`${keys.spendPub}${keys.viewPub.slice(2)}`)
    expect(keys.metaAddress).toHaveLength(2 + 132)
  })

  // Pinned from the first run of this suite: the same passkey + the same eval
  // input must reproduce the same meta-address on every device, forever. If
  // this value ever changes, a derivation constant changed — that is a breaking
  // change for every +Private member, not a test to update.
  it('pins the meta-address for a fixed entropy', () => {
    const keys = deriveStealthKeys(deriveMemberSecret(ENTROPY))
    expect(keys.metaAddress).toBe(
      '0x02a523ff2af0b4b582a6a964a6bd03addf5f0ae07b92145128c442c24cb7a981e00337b5d598e0280e9442ba81e826826d3dc672626d4904855c38a3c4c804b312cf',
    )
  })
})
