import type * as BaseAccount from '@base-org/account'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('uses Base mainnet when selected by the build var', async () => {
    vi.stubEnv('VITE_CHAIN_ID', '8453')
    vi.resetModules()
    const configured = await import('./base-account.ts')
    await configured.baseAccountProvider()
    expect(createBaseAccountSDK).toHaveBeenLastCalledWith({ appChainIds: [8453], appName: 'fuda' })
  })

  it('builds the SDK for Base Sepolia and forwards request to its provider', async () => {
    const provider = await baseAccountProvider()
    expect(createBaseAccountSDK).toHaveBeenCalledWith({ appChainIds: [84_532], appName: 'fuda' })
    expect(getProvider).toHaveBeenCalledWith()
    await provider.request({ method: 'eth_requestAccounts' })
    expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' })
  })
})
