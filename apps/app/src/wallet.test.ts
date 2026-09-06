import { challengeMessage } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'
import { hexToString, verifyMessage } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it, vi } from 'vitest'

import { injectedProvider, personalSign, requestAccount } from './wallet.ts'
import type { Eip1193Provider } from './wallet.ts'

const account = privateKeyToAccount(`0x${'5a'.repeat(32)}`)
const UID: Hex = `0x${'ab'.repeat(32)}`
const NONCE: Hex = `0x${'cd'.repeat(16)}`

const provider = (request: Eip1193Provider['request']): Eip1193Provider => ({ request })

describe(requestAccount, () => {
  it('returns the first account, checksummed', async () => {
    const address = await requestAccount(
      provider(async () => await Promise.resolve([account.address.toLowerCase()])),
    )
    expect(address).toBe(account.address)
  })

  it('asks the provider for eth_requestAccounts', async () => {
    const request = vi.fn<Eip1193Provider['request']>(async () => await Promise.resolve([account.address]))
    await requestAccount(provider(request))
    expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' })
  })

  it('rejects when the wallet returns no usable account', async () => {
    await expect(requestAccount(provider(async () => await Promise.resolve([])))).rejects.toThrow(
      'wallet returned no account',
    )
    await expect(
      requestAccount(provider(async () => await Promise.resolve(['not-an-address']))),
    ).rejects.toThrow('wallet returned no account')
  })
})

describe(personalSign, () => {
  // The wire shape every browser wallet expects: params are
  // [hex-encoded UTF-8 message, address] — the reverse order silently signs the
  // address instead of the challenge.
  it('sends personal_sign with the hex-encoded message first and the address second', async () => {
    const request = vi.fn<Eip1193Provider['request']>(
      async () => await Promise.resolve(`0x${'11'.repeat(65)}`),
    )
    await personalSign(provider(request), account.address, 'fuda-gate:hello')
    const params = request.mock.calls[0]?.[0]
    expect(params).toMatchObject({ method: 'personal_sign' })
    expect(params?.params?.[1]).toBe(account.address)
    expect(hexToString(String(params?.params?.[0]) as Hex)).toBe('fuda-gate:hello')
  })

  it('produces a signature the api can verify over the challenge string', async () => {
    const message = challengeMessage(UID, NONCE)
    // A faithful wallet: decode the hex params[0] and personal-sign that.
    const signature = await personalSign(
      provider(
        async (args) => await account.signMessage({ message: hexToString(String(args.params?.[0]) as Hex) }),
      ),
      account.address,
      message,
    )
    await expect(verifyMessage({ address: account.address, message, signature })).resolves.toBe(true)
  })

  it('rejects a response that is not a hex signature', async () => {
    await expect(
      personalSign(
        provider(async () => await Promise.resolve('nope')),
        account.address,
        'x',
      ),
    ).rejects.toThrow('wallet returned no signature')
  })
})

describe(injectedProvider, () => {
  it('is null when no wallet injected itself', () => {
    expect(injectedProvider()).toBeNull()
  })

  it('returns the injected provider when one is present', () => {
    const injected = provider(async () => await Promise.resolve(null))
    vi.stubGlobal('ethereum', injected)
    expect(injectedProvider()).toBe(injected)
    vi.unstubAllGlobals()
  })
})
