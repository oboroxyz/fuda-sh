import type { BaseAccountOptions } from '@fuda/libs/wallet'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { createProvider } = vi.hoisted(() => ({
  createProvider: vi.fn<(options: BaseAccountOptions) => Promise<{ request: () => Promise<null> }>>(
    async () => await Promise.resolve({ request: async () => await Promise.resolve(null) }),
  ),
}))

vi.mock(import('@fuda/libs/wallet'), async (importOriginal) => ({
  ...(await importOriginal()),
  baseAccountProvider: createProvider,
}))

const { baseAccountProvider } = await import('./wallet.ts')

describe('dashboard wallet configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('selects Base mainnet while retaining the ENS chain and sponsor', async () => {
    vi.stubEnv('VITE_CHAIN_ID', '8453')
    vi.resetModules()
    const configured = await import('./wallet.ts')
    await configured.baseAccountProvider('https://paymaster.test')
    expect(createProvider).toHaveBeenLastCalledWith({
      appChainIds: [8453, 11_155_111],
      paymasterUrls: { 11_155_111: 'https://paymaster.test' },
    })
  })

  it('rejects an unsupported chain from the build var', async () => {
    vi.stubEnv('VITE_CHAIN_ID', '1')
    vi.resetModules()
    await expect(import('./wallet.ts')).rejects.toThrow('Unsupported CHAIN_ID')
  })

  it('retains both chains and sponsors only ENS when configured', async () => {
    await baseAccountProvider('https://paymaster.test')
    expect(createProvider).toHaveBeenLastCalledWith({
      appChainIds: [84_532, 11_155_111],
      paymasterUrls: { 11_155_111: 'https://paymaster.test' },
    })
    await baseAccountProvider()
    expect(createProvider).toHaveBeenLastCalledWith({ appChainIds: [84_532, 11_155_111] })
  })
})
