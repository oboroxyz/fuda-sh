import type { Hex, IssuerView } from '@fuda/sdk'
import { describe, expect, it, vi } from 'vitest'

import { signInWithWallet } from './operator-sign-in.ts'
import type { WalletSignInIo } from './operator-sign-in.ts'
import type { Eip1193Provider } from './wallet.ts'

const ADDRESS: Hex = `0x${'ab'.repeat(20)}`
const NONCE: Hex = `0x${'cd'.repeat(16)}`
const SIGNATURE: Hex = `0x${'ef'.repeat(65)}`
const PROVIDER: Eip1193Provider = { request: async () => await Promise.resolve(null) }
const ISSUER: IssuerView = {
  brandColor: '#6F4320',
  createdAt: 1,
  handle: 'coffee',
  id: 'issuer_1',
  logoUrl: null,
  name: 'Coffee',
  operatorAddress: ADDRESS,
  tagline: '',
}

const io = (overrides: Partial<WalletSignInIo> = {}): WalletSignInIo => ({
  challenge: vi.fn<WalletSignInIo['challenge']>(
    async () =>
      await Promise.resolve({
        body: { message: 'fuda.sh dashboard sign-in', nonce: NONCE },
        ok: true as const,
      }),
  ),
  personalSign: vi.fn<WalletSignInIo['personalSign']>(async () => await Promise.resolve(SIGNATURE)),
  provider: vi.fn<WalletSignInIo['provider']>(async () => await Promise.resolve(PROVIDER)),
  requestAccount: vi.fn<WalletSignInIo['requestAccount']>(async () => await Promise.resolve(ADDRESS)),
  verify: vi.fn<WalletSignInIo['verify']>(
    async () => await Promise.resolve({ body: { issuer: null }, ok: true as const }),
  ),
  ...overrides,
})

const failed = (status: number, network = false) => ({
  error: 'nope',
  network,
  ok: false as const,
  status,
})

describe(signInWithWallet, () => {
  it('signs the minted message and reports that the operator has no venue yet', async () => {
    const deps = io()
    const outcome = await signInWithWallet(deps)
    expect(outcome).toStrictEqual({ hasIssuer: false, ok: true })
    expect(deps.personalSign).toHaveBeenCalledExactlyOnceWith(PROVIDER, ADDRESS, 'fuda.sh dashboard sign-in')
    expect(deps.verify).toHaveBeenCalledExactlyOnceWith({
      address: ADDRESS,
      nonce: NONCE,
      signature: SIGNATURE,
    })
  })

  it('reports a cancelled wallet step without calling the api', async () => {
    const challenge = vi.fn<() => void>()
    const outcome = await signInWithWallet(
      io({
        challenge: challenge as unknown as WalletSignInIo['challenge'],
        requestAccount: async () => {
          await Promise.resolve()
          throw new Error('user cancelled')
        },
      }),
    )
    expect(outcome).toStrictEqual({ failure: 'wallet', ok: false })
    expect(challenge).not.toHaveBeenCalled()
  })

  it('reports a cancelled signature after the nonce was minted', async () => {
    const verify = vi.fn<() => void>()
    const outcome = await signInWithWallet(
      io({
        personalSign: async () => {
          await Promise.resolve()
          throw new Error('user cancelled')
        },
        verify: verify as unknown as WalletSignInIo['verify'],
      }),
    )
    expect(outcome).toStrictEqual({ failure: 'wallet', ok: false })
    expect(verify).not.toHaveBeenCalled()
  })

  it('separates a refused signature from an unreachable or broken api', async () => {
    const rejected = await signInWithWallet(io({ verify: async () => await Promise.resolve(failed(401)) }))
    const offline = await signInWithWallet(
      io({ challenge: async () => await Promise.resolve(failed(0, true)) }),
    )
    const broken = await signInWithWallet(io({ verify: async () => await Promise.resolve(failed(502)) }))
    expect(rejected).toStrictEqual({ failure: 'rejected', ok: false })
    expect(offline).toStrictEqual({ failure: 'network', ok: false })
    expect(broken).toStrictEqual({ failure: 'unavailable', ok: false })
  })

  it('reports a registered venue, which decides where the operator lands', async () => {
    const outcome = await signInWithWallet(
      io({ verify: async () => await Promise.resolve({ body: { issuer: ISSUER }, ok: true as const }) }),
    )
    expect(outcome).toStrictEqual({ hasIssuer: true, ok: true })
  })
})
