import { afterEach, describe, expect, it, vi } from 'vitest'

describe('browser chain configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it.each([
    { expected: 84_532, value: undefined },
    { expected: 8453, value: '8453' },
  ])('uses $expected for VITE_CHAIN_ID=$value', async ({ value, expected }) => {
    vi.stubEnv('VITE_CHAIN_ID', value)
    vi.resetModules()
    const { CHAIN } = await import('./config.ts')
    expect(CHAIN.id).toBe(expected)
  })

  it('rejects an unknown build chain', async () => {
    vi.stubEnv('VITE_CHAIN_ID', '1')
    vi.resetModules()
    await expect(import('./config.ts')).rejects.toThrow('Unsupported CHAIN_ID')
  })
})
