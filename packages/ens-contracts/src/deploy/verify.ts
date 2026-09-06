import { isAddressEqual, namehash, zeroAddress } from 'viem'
import type { Address, PublicClient } from 'viem'

import {
  ENS_HACKATHON_CONTRACTS,
  ENS_REGISTRY_ROLES,
  ERC165_ABI,
  ETH_REGISTRY_ABI,
  FACTORY_ABI,
  FUDA_REGISTRAR_ABI,
  FUDA_RESOLVER_ABI,
  USER_REGISTRY_ABI,
  USER_REGISTRY_ROOT_ROLES,
} from '../index.ts'
import type { PublicConfig } from './config.ts'
import { runPreflight } from './preflight.ts'

export interface TopologyAddresses {
  registrarAddress: Address
  resolverAddress: Address
  userRegistryAddress: Address
}

export interface TopologyVerificationContext {
  config: PublicConfig & { gatewaySigner: Address; parentAddress: Address; voucherSigner: Address }
  publicClient: Pick<PublicClient, 'chain' | 'getChainId' | 'getCode' | 'readContract'>
}

export const PARENT_NODE = namehash('fuda.eth')
export const GATEWAY_URLS = ['https://api.fuda.sh/ens/gateway'] as const
// oxlint-disable-next-line no-bitwise -- the registrar receives only registration and renewal bits.
export const REGISTRAR_ROLES = ENS_REGISTRY_ROLES.REGISTRAR | ENS_REGISTRY_ROLES.RENEW
const contracts = ENS_HACKATHON_CONTRACTS

export const topologyRead = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation()
  } catch {
    // RPC errors may contain endpoint credentials. Public read names are the only diagnostic output.
    throw new Error(`${name}: read failed`)
  }
}

export const requireTopologyAddress = (actual: Address, expected: Address, name: string): void => {
  if (!isAddressEqual(actual, expected)) {
    throw new Error(`${name}: address mismatch`)
  }
}

const requireCode = async (context: TopologyVerificationContext, address: Address, name: string) => {
  if (isAddressEqual(address, zeroAddress)) {
    throw new Error(`${name}: no runtime code`)
  }
  const code = await topologyRead(
    `${name}.getCode`,
    async () => await context.publicClient.getCode({ address }),
  )
  if (code === undefined || code === '0x') {
    throw new Error(`${name}: no runtime code`)
  }
}

export const readRegistryParent = async (context: TopologyVerificationContext, address: Address) =>
  await topologyRead(
    'UserRegistry.getParent',
    async () =>
      await context.publicClient.readContract({
        abi: USER_REGISTRY_ABI,
        address,
        functionName: 'getParent',
      }),
  )

export const requireCanonicalParent = (parent: readonly [Address, string]): void => {
  requireTopologyAddress(parent[0], contracts.ETHRegistry, 'UserRegistry.parent')
  if (parent[1] !== 'fuda') {
    throw new Error('UserRegistry.label: mismatch')
  }
}

export const readRegistryRoles = async (
  context: TopologyVerificationContext,
  address: Address,
  account: Address,
) =>
  await topologyRead(
    'UserRegistry.roles',
    async () =>
      await context.publicClient.readContract({
        abi: USER_REGISTRY_ABI,
        address,
        args: [0n, account],
        functionName: 'roles',
      }),
  )

export const inspectUserRegistry = async (context: TopologyVerificationContext, address: Address) => {
  await requireCode(context, address, 'UserRegistry')
  const implementation = await topologyRead(
    'VerifiableFactory.verifyContract',
    async () =>
      await context.publicClient.readContract({
        abi: FACTORY_ABI,
        address: contracts.VerifiableFactory,
        args: [address],
        functionName: 'verifyContract',
      }),
  )
  requireTopologyAddress(implementation, contracts.UserRegistryImpl, 'UserRegistry.implementation')
  const roles = await readRegistryRoles(context, address, context.config.parentAddress)
  if (roles !== USER_REGISTRY_ROOT_ROLES) {
    throw new Error('UserRegistry.setup roles: mismatch')
  }
  return await readRegistryParent(context, address)
}

export const readResolverRegistrar = async (context: TopologyVerificationContext, address: Address) =>
  await topologyRead(
    'FudaResolver.registrar',
    async () =>
      await context.publicClient.readContract({
        abi: FUDA_RESOLVER_ABI,
        address,
        functionName: 'registrar',
      }),
  )

export const inspectResolver = async (
  context: TopologyVerificationContext,
  address: Address,
  userRegistry: Address,
) => {
  await requireCode(context, address, 'FudaResolver')
  const { publicClient, config } = context
  for (const [functionName, expected] of [
    ['owner', config.parentAddress],
    ['userRegistry', userRegistry],
    ['signer', config.gatewaySigner],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- fail before using the first incorrect deployment pointer.
    const actual = await topologyRead(
      `FudaResolver.${functionName}`,
      async () =>
        await publicClient.readContract({
          abi: FUDA_RESOLVER_ABI,
          address,
          functionName,
        }),
    )
    requireTopologyAddress(actual, expected, `FudaResolver.${functionName}`)
  }
  const parentNode = await topologyRead(
    'FudaResolver.parentNode',
    async () =>
      await publicClient.readContract({
        abi: FUDA_RESOLVER_ABI,
        address,
        functionName: 'parentNode',
      }),
  )
  if (parentNode !== PARENT_NODE) {
    throw new Error('FudaResolver.parentNode: mismatch')
  }
  const urls = await topologyRead(
    'FudaResolver.gatewayUrls',
    async () =>
      await publicClient.readContract({
        abi: FUDA_RESOLVER_ABI,
        address,
        functionName: 'gatewayUrls',
      }),
  )
  if (urls.length !== 1 || urls[0] !== GATEWAY_URLS[0]) {
    throw new Error('FudaResolver.gatewayUrls: mismatch')
  }
  for (const [interfaceId, expected] of [
    ['0x01ffc9a7', true],
    ['0x9061b923', true],
    ['0xffffffff', false],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- each interface is a distinct required capability check.
    const supported = await topologyRead(
      'FudaResolver.supportsInterface',
      async () =>
        await publicClient.readContract({
          abi: ERC165_ABI,
          address,
          args: [interfaceId],
          functionName: 'supportsInterface',
        }),
    )
    if (supported !== expected) {
      throw new Error(`FudaResolver.supportsInterface(${interfaceId}): mismatch`)
    }
  }
  return await readResolverRegistrar(context, address)
}

export const inspectRegistrar = async (
  context: TopologyVerificationContext,
  addresses: TopologyAddresses,
) => {
  const { registrarAddress: address, resolverAddress, userRegistryAddress } = addresses
  await requireCode(context, address, 'FudaSubnameRegistrar')
  const { publicClient, config } = context
  for (const [functionName, expected] of [
    ['owner', config.parentAddress],
    ['userRegistry', userRegistryAddress],
    ['resolver', resolverAddress],
    ['voucherSigner', config.voucherSigner],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- stop on the first invalid registrar dependency or principal.
    const actual = await topologyRead(
      `FudaSubnameRegistrar.${functionName}`,
      async () =>
        await publicClient.readContract({
          abi: FUDA_REGISTRAR_ABI,
          address,
          functionName,
        }),
    )
    requireTopologyAddress(actual, expected, `FudaSubnameRegistrar.${functionName}`)
  }
  const parentNode = await topologyRead(
    'FudaSubnameRegistrar.parentNode',
    async () =>
      await publicClient.readContract({
        abi: FUDA_REGISTRAR_ABI,
        address,
        functionName: 'parentNode',
      }),
  )
  if (parentNode !== PARENT_NODE) {
    throw new Error('FudaSubnameRegistrar.parentNode: mismatch')
  }
}

export const readEthLink = async (
  context: TopologyVerificationContext,
  functionName: 'getSubregistry' | 'getResolver',
) =>
  await topologyRead(
    `ETHRegistry.${functionName}`,
    async () =>
      await context.publicClient.readContract({
        abi: ETH_REGISTRY_ABI,
        address: contracts.ETHRegistry,
        args: ['fuda'],
        functionName,
      }),
  )

export const verifyTopology = async (context: TopologyVerificationContext, addresses: TopologyAddresses) => {
  const { config, publicClient } = context
  const preflight = await runPreflight(publicClient, { ...config, ...addresses })
  if (preflight.parent.state !== 'owned') {
    throw new Error('fuda parent must be owned')
  }
  requireTopologyAddress(preflight.parent.owner, config.parentAddress, 'fuda parent owner')
  requireCanonicalParent(await inspectUserRegistry(context, addresses.userRegistryAddress))
  requireTopologyAddress(
    await readEthLink(context, 'getSubregistry'),
    addresses.userRegistryAddress,
    'ETHRegistry.subregistry',
  )
  requireTopologyAddress(
    await readEthLink(context, 'getResolver'),
    addresses.resolverAddress,
    'ETHRegistry.resolver',
  )
  requireTopologyAddress(
    await inspectResolver(context, addresses.resolverAddress, addresses.userRegistryAddress),
    addresses.registrarAddress,
    'FudaResolver.registrar',
  )
  await inspectRegistrar(context, addresses)
  const registrarRoles = await readRegistryRoles(
    context,
    addresses.userRegistryAddress,
    addresses.registrarAddress,
  )
  if (registrarRoles !== REGISTRAR_ROLES) {
    throw new Error('UserRegistry.registrar roles: mismatch')
  }
  return {
    chainId: preflight.chainId,
    gatewaySigner: config.gatewaySigner,
    gatewayUrls: [...GATEWAY_URLS],
    parentAddress: config.parentAddress,
    parentName: 'fuda.eth',
    parentNode: PARENT_NODE,
    registrarAddress: addresses.registrarAddress,
    registrarRoles: REGISTRAR_ROLES.toString(),
    resolverAddress: addresses.resolverAddress,
    setupRoles: USER_REGISTRY_ROOT_ROLES.toString(),
    status: 'verified',
    userRegistryAddress: addresses.userRegistryAddress,
    voucherSigner: config.voucherSigner,
  } as const
}

export type TopologyReport = Awaited<ReturnType<typeof verifyTopology>>
