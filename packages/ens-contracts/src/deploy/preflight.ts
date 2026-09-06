import { createPublicClient, http, isAddressEqual, keccak256, labelhash, zeroAddress } from 'viem'
import type { Address, PublicClient } from 'viem'

import {
  ENS_HACKATHON_CHAIN,
  ENS_HACKATHON_CONTRACTS,
  ENS_RUNTIME_CODE_HASHES,
  ERC165_ABI,
  ETH_REGISTRAR_ABI,
  ETH_REGISTRY_ABI,
  FACTORY_ABI,
  FUDA_REGISTRAR_ABI,
  FUDA_RESOLVER_ABI,
  MOCK_USDC_ABI,
} from '../index.ts'
import { readPublicConfig } from './config.ts'
import type { PublicConfig } from './config.ts'

type EnsPublicClient = Pick<PublicClient, 'chain' | 'getChainId' | 'getCode' | 'readContract'>
type CheckedContract = keyof typeof ENS_RUNTIME_CODE_HASHES

export interface PreflightReport {
  chainId: number
  checkedContracts: CheckedContract[]
  parent: { owner: Address; state: 'available' | 'owned' }
}

export const createEnsPublicClient = (url: string) => {
  const { rpcUrl } = readPublicConfig({ ENS_RPC_URL: url })
  return createPublicClient({ chain: ENS_HACKATHON_CHAIN, transport: http(rpcUrl) })
}

const read = async <T>(context: string, operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation()
  } catch {
    // RPC errors can contain credentials embedded in the URL. Keep errors public.
    throw new Error(`${context}: read failed`)
  }
}

const requireAddress = (actual: Address, expected: Address, context: string): void => {
  if (!isAddressEqual(actual, expected)) {
    throw new Error(`${context}: address mismatch`)
  }
}

const checkRuntime = async (client: EnsPublicClient, name: CheckedContract): Promise<void> => {
  const code = await read(
    `${name}.getCode`,
    async () => await client.getCode({ address: ENS_HACKATHON_CONTRACTS[name] }),
  )
  if (code === undefined || code === '0x') {
    throw new Error(`${name}: no runtime code`)
  }
  if (keccak256(code) !== ENS_RUNTIME_CODE_HASHES[name]) {
    throw new Error(`${name}: runtime code hash mismatch`)
  }
}

const checkInterface = async (
  client: EnsPublicClient,
  name: 'UpgradableUniversalResolverProxy' | 'DNSAliasResolver' | 'UserRegistryImpl',
  interfaceId: '0x01ffc9a7' | '0xffffffff',
  expected: boolean,
): Promise<void> => {
  const supported = await read(
    `${name}.supportsInterface`,
    async () =>
      await client.readContract({
        abi: ERC165_ABI,
        address: ENS_HACKATHON_CONTRACTS[name],
        args: [interfaceId],
        functionName: 'supportsInterface',
      }),
  )
  if (supported !== expected) {
    throw new Error(`${name}.supportsInterface(${interfaceId}): expected ${String(expected)}`)
  }
}

const checkResume = async (client: EnsPublicClient, config: PublicConfig): Promise<void> => {
  if (config.userRegistryAddress !== undefined) {
    const proxy = config.userRegistryAddress
    const implementation = await read(
      'VerifiableFactory.verifyContract',
      async () =>
        await client.readContract({
          abi: FACTORY_ABI,
          address: ENS_HACKATHON_CONTRACTS.VerifiableFactory,
          args: [proxy],
          functionName: 'verifyContract',
        }),
    )
    requireAddress(
      implementation,
      ENS_HACKATHON_CONTRACTS.UserRegistryImpl,
      'VerifiableFactory.verifyContract',
    )
  }
  for (const [name, address, abi] of [
    ['FudaResolver', config.resolverAddress, FUDA_RESOLVER_ABI],
    ['FudaSubnameRegistrar', config.registrarAddress, FUDA_REGISTRAR_ABI],
  ] as const) {
    if (address === undefined) {
      continue
    }
    if (config.parentAddress === undefined) {
      throw new Error(`${name}.owner: ENS_PARENT_ADDRESS required`)
    }
    // oxlint-disable-next-line no-await-in-loop -- each optional owner is verified before continuing.
    const owner = await read(
      `${name}.owner`,
      async () => await client.readContract({ abi, address, functionName: 'owner' }),
    )
    requireAddress(owner, config.parentAddress, `${name}.owner`)
  }
}

const isCheckedContract = (name: string): name is CheckedContract =>
  Object.hasOwn(ENS_RUNTIME_CODE_HASHES, name)

export const runPreflight = async (
  client: EnsPublicClient,
  config: PublicConfig,
): Promise<PreflightReport> => {
  const chainId = await read('getChainId', async () => await client.getChainId())
  if (chainId !== ENS_HACKATHON_CHAIN.id || client.chain?.id !== ENS_HACKATHON_CHAIN.id) {
    throw new Error('wrong ENS chain')
  }
  const resolver = client.chain.contracts?.ensUniversalResolver?.address
  if (
    resolver === undefined ||
    !isAddressEqual(resolver, ENS_HACKATHON_CONTRACTS.UpgradableUniversalResolverProxy)
  ) {
    throw new Error('dedicated Universal Resolver required')
  }
  const checkedContracts: CheckedContract[] = []
  for (const name of Object.keys(ENS_RUNTIME_CODE_HASHES).filter(isCheckedContract)) {
    // oxlint-disable-next-line no-await-in-loop -- fail at the first untrusted deployment address.
    await checkRuntime(client, name)
    checkedContracts.push(name)
  }
  await checkInterface(client, 'UpgradableUniversalResolverProxy', '0x01ffc9a7', true)
  await checkInterface(client, 'UpgradableUniversalResolverProxy', '0xffffffff', false)
  await checkInterface(client, 'DNSAliasResolver', '0x01ffc9a7', true)
  await checkInterface(client, 'DNSAliasResolver', '0xffffffff', false)
  const available = await read(
    'ETHRegistrar.isAvailable',
    async () =>
      await client.readContract({
        abi: ETH_REGISTRAR_ABI,
        address: ENS_HACKATHON_CONTRACTS.ETHRegistrar,
        args: [config.parentLabel],
        functionName: 'isAvailable',
      }),
  )
  const minAge = await read(
    'ETHRegistrar.MIN_COMMITMENT_AGE',
    async () =>
      await client.readContract({
        abi: ETH_REGISTRAR_ABI,
        address: ENS_HACKATHON_CONTRACTS.ETHRegistrar,
        functionName: 'MIN_COMMITMENT_AGE',
      }),
  )
  const maxAge = await read(
    'ETHRegistrar.MAX_COMMITMENT_AGE',
    async () =>
      await client.readContract({
        abi: ETH_REGISTRAR_ABI,
        address: ENS_HACKATHON_CONTRACTS.ETHRegistrar,
        functionName: 'MAX_COMMITMENT_AGE',
      }),
  )
  if (minAge >= maxAge) {
    throw new Error('ETHRegistrar: invalid commitment ages')
  }
  const owner = await read(
    'ETHRegistry.getOwner',
    async () =>
      await client.readContract({
        abi: ETH_REGISTRY_ABI,
        address: ENS_HACKATHON_CONTRACTS.ETHRegistry,
        args: [BigInt(labelhash(config.parentLabel))],
        functionName: 'getOwner',
      }),
  )
  const ethRegistry = await read(
    'RootRegistry.getSubregistry',
    async () =>
      await client.readContract({
        abi: ETH_REGISTRY_ABI,
        address: ENS_HACKATHON_CONTRACTS.RootRegistry,
        args: ['eth'],
        functionName: 'getSubregistry',
      }),
  )
  requireAddress(ethRegistry, ENS_HACKATHON_CONTRACTS.ETHRegistry, 'RootRegistry.getSubregistry')
  const proxyLogic = await read(
    'VerifiableFactory.proxyLogic',
    async () =>
      await client.readContract({
        abi: FACTORY_ABI,
        address: ENS_HACKATHON_CONTRACTS.VerifiableFactory,
        functionName: 'proxyLogic',
      }),
  )
  if (isAddressEqual(proxyLogic, zeroAddress)) {
    throw new Error('VerifiableFactory.proxyLogic: zero address')
  }
  await checkInterface(client, 'UserRegistryImpl', '0x01ffc9a7', true)
  await read(
    'MockUSDC.balanceOf',
    async () =>
      await client.readContract({
        abi: MOCK_USDC_ABI,
        address: ENS_HACKATHON_CONTRACTS.MockUSDC,
        args: [zeroAddress],
        functionName: 'balanceOf',
      }),
  )
  if (!available && (config.parentAddress === undefined || !isAddressEqual(owner, config.parentAddress))) {
    throw new Error('fuda: unavailable without matching ENS_PARENT_ADDRESS')
  }
  await checkResume(client, config)
  return { chainId, checkedContracts, parent: { owner, state: available ? 'available' : 'owned' } }
}
