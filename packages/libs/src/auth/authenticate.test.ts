import type { Hex } from '@fuda/sdk'
import { describe, expect, it, vi } from 'vitest'

import type { Eip1193Provider } from '../wallet/index.ts'
import { authenticateWallet as signInWithPasskey } from './index.ts'
import type { WalletSignInIo } from './index.ts'

type SignInIo = WalletSignInIo<{ issuer: null; token: string }>

const ADDRESS: Hex = `0x${'ab'.repeat(20)}`
const NONCE: Hex = `0x${'cd'.repeat(16)}`
const SIGNATURE: Hex = `0x${'ef'.repeat(65)}`
const PROVIDER: Eip1193Provider = { request: async () => await Promise.resolve(null) }

const io = (overrides: Partial<SignInIo> = {}): SignInIo => ({
  challenge: vi.fn<SignInIo['challenge']>(
    async () =>
      await Promise.resolve({
        body: { message: 'fuda.sh dashboard sign-in', nonce: NONCE },
        ok: true as const,
      }),
  ),
  personalSign: vi.fn<SignInIo['personalSign']>(async () => await Promise.resolve(SIGNATURE)),
  provider: vi.fn<SignInIo['provider']>(async () => await Promise.resolve(PROVIDER)),
  requestAccount: vi.fn<SignInIo['requestAccount']>(async () => await Promise.resolve(ADDRESS)),
  verify: vi.fn<SignInIo['verify']>(
    async () => await Promise.resolve({ body: { issuer: null, token: 'session-token' }, ok: true as const }),
  ),
  ...overrides,
})

const failed = (status: number, network = false) => ({
  error: 'nope',
  network,
  ok: false as const,
  status,
})

describe(signInWithPasskey, () => {
  it('signs the minted message and returns the session token with the venue card', async () => {
    const deps = io()
    const outcome = await signInWithPasskey(deps)
    expect(outcome).toStrictEqual({ ok: true, session: { issuer: null, token: 'session-token' } })
    expect(deps.personalSign).toHaveBeenCalledExactlyOnceWith(PROVIDER, ADDRESS, 'fuda.sh dashboard sign-in')
    expect(deps.verify).toHaveBeenCalledExactlyOnceWith({
      address: ADDRESS,
      nonce: NONCE,
      signature: SIGNATURE,
    })
  })

  it('reports a cancelled wallet step without calling the api', async () => {
    const challenge = vi.fn<() => void>()
    const outcome = await signInWithPasskey(
      io({
        challenge: challenge as unknown as SignInIo['challenge'],
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
    const outcome = await signInWithPasskey(
      io({
        personalSign: async () => {
          await Promise.resolve()
          throw new Error('user cancelled')
        },
        verify: verify as unknown as SignInIo['verify'],
      }),
    )
    expect(outcome).toStrictEqual({ failure: 'wallet', ok: false })
    expect(verify).not.toHaveBeenCalled()
  })

  it('separates a refused signature from an unreachable or broken api', async () => {
    const rejected = await signInWithPasskey(io({ verify: async () => await Promise.resolve(failed(401)) }))
    const offline = await signInWithPasskey(
      io({ challenge: async () => await Promise.resolve(failed(0, true)) }),
    )
    const broken = await signInWithPasskey(io({ verify: async () => await Promise.resolve(failed(502)) }))
    expect(rejected).toStrictEqual({ failure: 'rejected', ok: false })
    expect(offline).toStrictEqual({ failure: 'network', ok: false })
    expect(broken).toStrictEqual({ failure: 'unavailable', ok: false })
  })

  it('does not open a wallet for an already canceled attempt', async () => {
    const controller = new AbortController()
    controller.abort()
    const deps = io()
    await expect(signInWithPasskey(deps, controller.signal)).resolves.toStrictEqual({
      failure: 'wallet',
      ok: false,
    })
    expect(deps.provider).not.toHaveBeenCalled()
  })

  it('does not mint a challenge after an abandoned account request resolves', async () => {
    const controller = new AbortController()
    const deps = io({
      requestAccount: async () => {
        controller.abort()
        return await Promise.resolve(ADDRESS)
      },
    })
    await expect(signInWithPasskey(deps, controller.signal)).resolves.toStrictEqual({
      failure: 'wallet',
      ok: false,
    })
    expect(deps.challenge).not.toHaveBeenCalled()
  })

  it('does not prompt for a signature after cancellation during the challenge request', async () => {
    const controller = new AbortController()
    const deps = io({
      challenge: async () => {
        controller.abort()
        return await Promise.resolve({ body: { message: 'Sign in', nonce: NONCE }, ok: true })
      },
    })
    await expect(signInWithPasskey(deps, controller.signal)).resolves.toStrictEqual({
      failure: 'wallet',
      ok: false,
    })
    expect(deps.personalSign).not.toHaveBeenCalled()
  })

  it('does not verify a signature from an abandoned attempt', async () => {
    const controller = new AbortController()
    const deps = io({
      personalSign: async () => {
        controller.abort()
        return await Promise.resolve(SIGNATURE)
      },
    })
    await expect(signInWithPasskey(deps, controller.signal)).resolves.toStrictEqual({
      failure: 'wallet',
      ok: false,
    })
    expect(deps.verify).not.toHaveBeenCalled()
  })
})
