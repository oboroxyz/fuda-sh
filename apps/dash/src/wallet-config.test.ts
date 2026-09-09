import type { BaseAccountOptions } from '@fuda/libs/wallet'
import { describe, expect, it, vi } from 'vitest'

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
