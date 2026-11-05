import type { Chain, Hex } from 'viem'
import { base, baseSepolia } from 'viem/chains'

interface ChainConfig {
  id: number
  name: string
  viemChain: Chain
  publicRpc: string
  explorerUrl: string
  easAddress: Hex
  schemaRegistryAddress: Hex
}

const SUPPORTED_CHAINS = {
  [base.id]: {
    easAddress: '0x4200000000000000000000000000000000000021',
    explorerUrl: base.blockExplorers.default.url,
    id: base.id,
    name: base.name,
    publicRpc: base.rpcUrls.default.http[0],
    schemaRegistryAddress: '0x4200000000000000000000000000000000000020',
    viemChain: base,
  },
  [baseSepolia.id]: {
    easAddress: '0x4200000000000000000000000000000000000021',
    explorerUrl: baseSepolia.blockExplorers.default.url,
    id: baseSepolia.id,
    name: baseSepolia.name,
    publicRpc: baseSepolia.rpcUrls.default.http[0],
    schemaRegistryAddress: '0x4200000000000000000000000000000000000020',
    viemChain: baseSepolia,
  },
} satisfies Record<number, ChainConfig>

export const parseChainConfig = (chainId?: string): ChainConfig => {
  if (chainId === undefined) {
    return SUPPORTED_CHAINS[baseSepolia.id]
  }
  for (const chain of Object.values(SUPPORTED_CHAINS)) {
    if (chainId === String(chain.id)) {
      return chain
    }
  }
  throw new Error('Unsupported CHAIN_ID. Expected 8453 (Base) or 84532 (Base Sepolia).')
}
