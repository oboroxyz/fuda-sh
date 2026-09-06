import type * as BaseAccount from '@base-org/account'
import { describe, expect, it, vi } from 'vitest'

import type { Eip1193Provider } from './wallet.ts'

const request = vi.fn<Eip1193Provider['request']>(async () => await Promise.resolve(null))
const getProvider = vi.fn<() => Eip1193Provider>(() => ({ request }))
const createBaseAccountSDK = vi.fn<
  (params: { appChainIds: number[]; appName: string }) => { getProvider: typeof getProvider }
>(() => ({ getProvider }))

// SAFETY: the mock stands in for the whole module; only `createBaseAccountSDK`
// is exercised by `base-account.ts`, so the other exports are never touched.
vi.mock(
  import('@base-org/account'),
  () => ({ createBaseAccountSDK }) as unknown as Partial<typeof BaseAccount>,
)

const { baseAccountProvider } = await import('./base-account.ts')

describe(baseAccountProvider, () => {
  it('builds the SDK for Base Sepolia and forwards request to its provider', async () => {
    const provider = baseAccountProvider()
    expect(createBaseAccountSDK).toHaveBeenCalledWith({ appChainIds: [84_532], appName: 'fuda' })
    expect(getProvider).toHaveBeenCalledWith()
    await provider.request({ method: 'eth_requestAccounts' })
    expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' })
  })
})
