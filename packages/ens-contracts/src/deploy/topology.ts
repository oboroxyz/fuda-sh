import {
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  isAddressEqual,
  keccak256,
  labelhash,
  parseAbiParameters,
  parseEventLogs,
  toHex,
  zeroAddress,
} from 'viem'
import type { Address, Hash, Hex, PublicClient, TransactionReceipt, WalletClient } from 'viem'

import {
  ENS_HACKATHON_CHAIN,
  ENS_HACKATHON_CONTRACTS,
  ETH_REGISTRY_ABI,
  FACTORY_ABI,
  FUDA_RESOLVER_ABI,
  USER_REGISTRY_ABI,
  USER_REGISTRY_ROOT_ROLES,
} from '../index.ts'
import { loadFudaArtifact } from './artifacts.ts'
import type { readTopologyMutationConfig } from './config.ts'
import { runPreflight } from './preflight.ts'
import { simulateSendAndConfirm } from './transaction.ts'
import {
  GATEWAY_URLS,
  inspectRegistrar,
  inspectResolver,
  inspectUserRegistry,
  PARENT_NODE,
  readEthLink,
  readRegistryParent,
  readRegistryRoles,
  readResolverRegistrar,
  REGISTRAR_ROLES,
  requireCanonicalParent,
  requireTopologyAddress,
  topologyRead,
  verifyTopology,
} from './verify.ts'

type Operation =
  | 'deploy-user-registry'
  | 'set-parent'
  | 'deploy-resolver'
  | 'deploy-registrar'
  | 'set-resolver-registrar'
  | 'attach-subregistry'
  | 'attach-parent-resolver'
  | 'grant-registrar-roles'
interface Progress {
  address?: Address
  hash: Hash
  operation: Operation
}
export interface TopologyContext {
  config: ReturnType<typeof readTopologyMutationConfig>
  onProgress?: (progress: Progress) => void
  publicClient: Pick<
    PublicClient,
    | 'chain'
    | 'getChainId'
    | 'getCode'
    | 'readContract'
    | 'call'
    | 'simulateContract'
    | 'waitForTransactionReceipt'
  >
  walletClient: Pick<WalletClient, 'writeContract' | 'sendTransaction'>
}
type ProtocolCall =
  | {
      abi: typeof FACTORY_ABI
      address: Address
      args: readonly [Address, bigint, Hex]
      functionName: 'deployProxy'
    }
  | {
      abi: typeof USER_REGISTRY_ABI
      address: Address
      args: readonly [Address, string]
      functionName: 'setParent'
    }
  | {
      abi: typeof USER_REGISTRY_ABI
      address: Address
      args: readonly [bigint, Address]
      functionName: 'grantRootRoles'
    }
  | {
      abi: typeof FUDA_RESOLVER_ABI
      address: Address
      args: readonly [Address]
      functionName: 'setRegistrar'
    }
  | {
      abi: typeof ETH_REGISTRY_ABI
      address: Address
      args: readonly [bigint, Address]
      functionName: 'setSubregistry' | 'setResolver'
    }

const contracts = ENS_HACKATHON_CONTRACTS
const parentId = BigInt(labelhash('fuda'))

const transaction = async <T>(operation: Operation, execute: () => Promise<T>): Promise<T> => {
  try {
    return await execute()
  } catch {
    // Viem simulation/wallet/receipt errors can include keys, RPC credentials, and signed transactions.
    throw new Error(`${operation}: transaction failed`)
  }
}

const protocolWrite = async (
  context: TopologyContext,
  operation: Operation,
  call: ProtocolCall,
  assertReceipt: (receipt: TransactionReceipt) => Promise<void>,
) =>
  await transaction(
    operation,
    async () =>
      await simulateSendAndConfirm({
        assertReceipt,
        send: async (request) => await context.walletClient.writeContract(request),
        simulate: async () => {
          const simulation = await context.publicClient.simulateContract<
            ProtocolCall['abi'],
            ProtocolCall['functionName'],
            ProtocolCall['args'],
            undefined,
            typeof context.config.parentAccount
          >({
            ...call,
            account: context.config.parentAccount,
          })
          if (operation === 'grant-registrar-roles' && simulation.result !== true) {
            throw new Error('role grant returned false')
          }
          return simulation
        },
        wait: async (hash) => await context.publicClient.waitForTransactionReceipt({ hash }),
      }),
  )

const selectAddress = (supplied: Address | undefined, linked: Address, name: string) => {
  if (supplied !== undefined && !isAddressEqual(linked, zeroAddress)) {
    requireTopologyAddress(linked, supplied, name)
  }
  return supplied ?? (isAddressEqual(linked, zeroAddress) ? undefined : linked)
}

const parentIsSet = (parent: readonly [Address, string]) => {
  if (isAddressEqual(parent[0], zeroAddress) && parent[1] === '') {
    return false
  }
  requireCanonicalParent(parent)
  return true
}

const pendingRoles = (roles: bigint): boolean => {
  if (roles === 0n) {
    return true
  }
  if (roles !== REGISTRAR_ROLES) {
    throw new Error('UserRegistry.registrar roles: conflicting partial state')
  }
  return false
}

const prepare = async (context: TopologyContext) => {
  const { config, publicClient } = context
  const report = await runPreflight(publicClient, config)
  if (report.parent.state !== 'owned') {
    throw new Error('fuda parent must be owned before topology deployment')
  }
  requireTopologyAddress(report.parent.owner, config.parentAddress, 'fuda parent owner')
  requireTopologyAddress(config.parentAccount.address, config.parentAddress, 'deployment sender')
  const userRegistryAddress = selectAddress(
    config.userRegistryAddress,
    await readEthLink(context, 'getSubregistry'),
    'ETHRegistry.subregistry',
  )
  const resolverAddress = selectAddress(
    config.resolverAddress,
    await readEthLink(context, 'getResolver'),
    'ETHRegistry.resolver',
  )
  if (userRegistryAddress === undefined) {
    if (resolverAddress !== undefined || config.registrarAddress !== undefined) {
      throw new Error('resume requires User Registry address')
    }
    return { registrarAddress: undefined, resolverAddress: undefined, userRegistryAddress: undefined }
  }
  parentIsSet(await inspectUserRegistry(context, userRegistryAddress))
  if (resolverAddress === undefined) {
    if (config.registrarAddress !== undefined) {
      throw new Error('resume requires resolver address')
    }
    return { registrarAddress: undefined, resolverAddress: undefined, userRegistryAddress }
  }
  const registrarAddress = selectAddress(
    config.registrarAddress,
    await inspectResolver(context, resolverAddress, userRegistryAddress),
    'FudaResolver.registrar',
  )
  if (registrarAddress !== undefined) {
    await inspectRegistrar(context, { registrarAddress, resolverAddress, userRegistryAddress })
    pendingRoles(await readRegistryRoles(context, userRegistryAddress, registrarAddress))
  }
  return { registrarAddress, resolverAddress, userRegistryAddress }
}

const deployRegistry = async (context: TopologyContext, progress: (event: Progress) => void) => {
  const salt = keccak256(
    encodeAbiParameters(parseAbiParameters('bytes32 kind,bytes32 node,uint256 version'), [
      keccak256(toHex('UserRegistry')),
      PARENT_NODE,
      0n,
    ]),
  )
  const initializer = encodeFunctionData({
    abi: USER_REGISTRY_ABI,
    args: [context.config.parentAddress, USER_REGISTRY_ROOT_ROLES],
    functionName: 'initialize',
  })
  let address: Address | undefined
  await protocolWrite(
    context,
    'deploy-user-registry',
    {
      abi: FACTORY_ABI,
      address: contracts.VerifiableFactory,
      args: [contracts.UserRegistryImpl, BigInt(salt), initializer],
      functionName: 'deployProxy',
    },
    async (receipt) => {
      const events = parseEventLogs({
        abi: FACTORY_ABI,
        eventName: 'ProxyDeployed',
        logs: receipt.logs,
        strict: true,
      }).filter((event) => isAddressEqual(event.address, contracts.VerifiableFactory))
      const [event] = events
      if (
        events.length !== 1 ||
        event === undefined ||
        !isAddressEqual(event.args.sender, context.config.parentAddress) ||
        event.args.salt !== BigInt(salt) ||
        !isAddressEqual(event.args.implementation, contracts.UserRegistryImpl) ||
        isAddressEqual(event.args.proxyAddress, zeroAddress)
      ) {
        throw new Error('invalid ProxyDeployed')
      }
      // Preserve the mined address even if a subsequent verification read fails; resume revalidates it.
      progress({
        address: event.args.proxyAddress,
        hash: receipt.transactionHash,
        operation: 'deploy-user-registry',
      })
      const parent = await inspectUserRegistry(context, event.args.proxyAddress)
      if (parentIsSet(parent)) {
        throw new Error('new User Registry already has a parent')
      }
      address = event.args.proxyAddress
    },
  )
  if (address === undefined) {
    throw new Error('missing confirmed User Registry address')
  }
  return address
}

const setParent = async (context: TopologyContext, address: Address, progress: (event: Progress) => void) => {
  if (parentIsSet(await readRegistryParent(context, address))) {
    return
  }
  const { hash } = await protocolWrite(
    context,
    'set-parent',
    {
      abi: USER_REGISTRY_ABI,
      address,
      args: [contracts.ETHRegistry, 'fuda'],
      functionName: 'setParent',
    },
    async (receipt) => {
      const valid = parseEventLogs({
        abi: USER_REGISTRY_ABI,
        eventName: 'ParentUpdated',
        logs: receipt.logs,
        strict: true,
      }).some(
        (event) =>
          isAddressEqual(event.address, address) &&
          isAddressEqual(event.args.parent, contracts.ETHRegistry) &&
          event.args.label === 'fuda' &&
          isAddressEqual(event.args.sender, context.config.parentAddress),
      )
      if (!valid) {
        throw new Error('invalid ParentUpdated')
      }
      requireCanonicalParent(await readRegistryParent(context, address))
    },
  )
  progress({ hash, operation: 'set-parent' })
}

const creationAddress = (receipt: TransactionReceipt): Address => {
  const address = receipt.contractAddress
  if (address === undefined || address === null || isAddressEqual(address, zeroAddress)) {
    throw new Error('missing contractAddress')
  }
  return address
}

const createFudaContract = async (
  context: TopologyContext,
  deployment: {
    args: readonly [Address, Hex, Address, readonly string[]] | readonly [Address, Address, Address, Hex]
    name: 'FudaResolver' | 'FudaSubnameRegistrar'
    operation: 'deploy-resolver' | 'deploy-registrar'
  },
  assertDeployment: (address: Address) => Promise<void>,
  progress: (event: Progress) => void,
) => {
  const artifact = await loadFudaArtifact(deployment.name)
  const request = {
    account: context.config.parentAccount,
    chain: ENS_HACKATHON_CHAIN,
    data: encodeDeployData({ ...artifact, args: deployment.args }),
  }
  const { receipt } = await transaction(
    deployment.operation,
    async () =>
      await simulateSendAndConfirm({
        assertReceipt: async (confirmed) => {
          const address = creationAddress(confirmed)
          progress({ address, hash: confirmed.transactionHash, operation: deployment.operation })
          await assertDeployment(address)
        },
        send: async (simulatedRequest) => await context.walletClient.sendTransaction(simulatedRequest),
        simulate: async () => {
          await context.publicClient.call(request)
          return { request, result: undefined }
        },
        wait: async (transactionHash) =>
          await context.publicClient.waitForTransactionReceipt({ hash: transactionHash }),
      }),
  )
  const address = creationAddress(receipt)
  return address
}

const setResolverRegistrar = async (
  context: TopologyContext,
  address: Address,
  registrar: Address,
  progress: (event: Progress) => void,
) => {
  const current = await readResolverRegistrar(context, address)
  if (!isAddressEqual(current, zeroAddress)) {
    requireTopologyAddress(current, registrar, 'FudaResolver.registrar')
    return
  }
  const { hash } = await protocolWrite(
    context,
    'set-resolver-registrar',
    {
      abi: FUDA_RESOLVER_ABI,
      address,
      args: [registrar],
      functionName: 'setRegistrar',
    },
    async (receipt) => {
      const valid = parseEventLogs({
        abi: FUDA_RESOLVER_ABI,
        eventName: 'RegistrarSet',
        logs: receipt.logs,
        strict: true,
      }).some(
        (event) => isAddressEqual(event.address, address) && isAddressEqual(event.args.registrar, registrar),
      )
      if (!valid) {
        throw new Error('invalid RegistrarSet')
      }
      requireTopologyAddress(
        await readResolverRegistrar(context, address),
        registrar,
        'FudaResolver.registrar',
      )
    },
  )
  progress({ hash, operation: 'set-resolver-registrar' })
}

const attachEthLink = async (
  context: TopologyContext,
  address: Address,
  kind: 'subregistry' | 'resolver',
  progress: (event: Progress) => void,
) => {
  const readName = kind === 'subregistry' ? 'getSubregistry' : 'getResolver'
  const current = await readEthLink(context, readName)
  if (!isAddressEqual(current, zeroAddress)) {
    requireTopologyAddress(current, address, `ETHRegistry.${kind}`)
    return
  }
  const tokenId = await topologyRead(
    'ETHRegistry.getTokenId',
    async () =>
      await context.publicClient.readContract({
        abi: ETH_REGISTRY_ABI,
        address: contracts.ETHRegistry,
        args: [parentId],
        functionName: 'getTokenId',
      }),
  )
  const operation = kind === 'subregistry' ? 'attach-subregistry' : 'attach-parent-resolver'
  const { hash } = await protocolWrite(
    context,
    operation,
    {
      abi: ETH_REGISTRY_ABI,
      address: contracts.ETHRegistry,
      args: [parentId, address],
      functionName: kind === 'subregistry' ? 'setSubregistry' : 'setResolver',
    },
    async (receipt) => {
      const events = parseEventLogs({ abi: ETH_REGISTRY_ABI, logs: receipt.logs, strict: true })
      const valid = events.some((event) => {
        if (
          !isAddressEqual(event.address, contracts.ETHRegistry) ||
          event.args.tokenId !== tokenId ||
          !isAddressEqual(event.args.sender, context.config.parentAddress)
        ) {
          return false
        }
        return kind === 'subregistry'
          ? event.eventName === 'SubregistryUpdated' && isAddressEqual(event.args.subregistry, address)
          : event.eventName === 'ResolverUpdated' && isAddressEqual(event.args.resolver, address)
      })
      if (!valid) {
        throw new Error('invalid ETH Registry link event')
      }
      requireTopologyAddress(await readEthLink(context, readName), address, `ETHRegistry.${kind}`)
    },
  )
  progress({ hash, operation })
}

const grantRoles = async (
  context: TopologyContext,
  address: Address,
  registrar: Address,
  progress: (event: Progress) => void,
) => {
  if (!pendingRoles(await readRegistryRoles(context, address, registrar))) {
    return
  }
  const { hash } = await protocolWrite(
    context,
    'grant-registrar-roles',
    {
      abi: USER_REGISTRY_ABI,
      address,
      args: [REGISTRAR_ROLES, registrar],
      functionName: 'grantRootRoles',
    },
    async (receipt) => {
      const valid = parseEventLogs({
        abi: USER_REGISTRY_ABI,
        eventName: 'EACRolesChanged',
        logs: receipt.logs,
        strict: true,
      }).some(
        (event) =>
          isAddressEqual(event.address, address) &&
          event.args.resource === 0n &&
          isAddressEqual(event.args.account, registrar) &&
          event.args.oldRoleBitmap === 0n &&
          event.args.newRoleBitmap === REGISTRAR_ROLES,
      )
      if (!valid) {
        throw new Error('invalid EACRolesChanged')
      }
      if ((await readRegistryRoles(context, address, registrar)) !== REGISTRAR_ROLES) {
        throw new Error('registrar roles mismatch')
      }
    },
  )
  progress({ hash, operation: 'grant-registrar-roles' })
}

export const deployTopology = async (context: TopologyContext) => {
  const supplied = await prepare(context)
  let changed = false
  const progress = (event: Progress) => {
    changed = true
    context.onProgress?.(event)
  }
  const userRegistryAddress = supplied.userRegistryAddress ?? (await deployRegistry(context, progress))
  await setParent(context, userRegistryAddress, progress)
  const resolverAddress =
    supplied.resolverAddress ??
    (await createFudaContract(
      context,
      {
        args: [userRegistryAddress, PARENT_NODE, context.config.gatewaySigner, GATEWAY_URLS],
        name: 'FudaResolver',
        operation: 'deploy-resolver',
      },
      async (address) => {
        requireTopologyAddress(
          await inspectResolver(context, address, userRegistryAddress),
          zeroAddress,
          'new FudaResolver.registrar',
        )
      },
      progress,
    ))
  const registrarAddress =
    supplied.registrarAddress ??
    (await createFudaContract(
      context,
      {
        args: [userRegistryAddress, resolverAddress, context.config.voucherSigner, PARENT_NODE],
        name: 'FudaSubnameRegistrar',
        operation: 'deploy-registrar',
      },
      async (address) => {
        await inspectRegistrar(context, { registrarAddress: address, resolverAddress, userRegistryAddress })
      },
      progress,
    ))
  await setResolverRegistrar(context, resolverAddress, registrarAddress, progress)
  await attachEthLink(context, userRegistryAddress, 'subregistry', progress)
  await attachEthLink(context, resolverAddress, 'resolver', progress)
  await grantRoles(context, userRegistryAddress, registrarAddress, progress)
  const report = await verifyTopology(context, { registrarAddress, resolverAddress, userRegistryAddress })
  return { ...report, status: changed ? 'complete' : 'already-complete' } as const
}
