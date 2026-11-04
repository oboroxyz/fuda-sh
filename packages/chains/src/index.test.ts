import { describe, expect, it } from 'vitest'

import { parseChainConfig } from './index.ts'

describe(parseChainConfig, () => {
  it.each([undefined, '84532'])('selects Base Sepolia for %s', (value) => {
    expect(parseChainConfig(value)).toMatchObject({
      explorerUrl: 'https://sepolia.basescan.org',
      id: 84_532,
      name: 'Base Sepolia',
      publicRpc: 'https://sepolia.base.org',
    })
  })

  it('selects Base mainnet explicitly', () => {
    expect(parseChainConfig('8453')).toMatchObject({
      explorerUrl: 'https://basescan.org',
      id: 8453,
      name: 'Base',
      publicRpc: 'https://mainnet.base.org',
    })
  })

  it.each(['1', '', '8453x', '0x2105', ' 8453', '08453'])('refuses an invalid chain id %s', (value) => {
    expect(() => parseChainConfig(value)).toThrow('Unsupported CHAIN_ID')
  })
})
