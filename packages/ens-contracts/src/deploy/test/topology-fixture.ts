import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  parseAbi,
  zeroAddress,
  zeroHash,
} from 'viem'
import type { Abi, Account, Address, Hex, TransactionReceipt } from 'viem'
import { expect } from 'vitest'

import {
  ENS_HACKATHON_CHAIN,
  ENS_HACKATHON_CONTRACTS,
  ERC165_ABI,
  ETH_REGISTRAR_ABI,
  ETH_REGISTRY_ABI,
  FACTORY_ABI,
  FUDA_REGISTRAR_ABI,
  FUDA_RESOLVER_ABI,
  MOCK_USDC_ABI,
  USER_REGISTRY_ABI,
} from '../../index.ts'
import { readTopologyMutationConfig } from '../config.ts'
import type { TopologyContext } from '../topology.ts'

export const owner = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf'
export const voucher = '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF'
export const gateway = '0x6813Eb9362372EEF6200f3b1dbC3f819671cBA69'
export const other = '0x9999999999999999999999999999999999999999'
export const addresses = {
  registrarAddress: '0x3333333333333333333333333333333333333333',
  resolverAddress: '0x2222222222222222222222222222222222222222',
  userRegistryAddress: '0x1111111111111111111111111111111111111111',
} as const
export const node = '0xb966af14f29d73e4a56d2b2db08c22ff89b7e594eaf18b02a5bb452aec27e5ff'
export const labelId =
  0x89_1e_4d_c4_f0_72_18_18_d5_55_35_fd_31_14_ba_5c_99_c5_e4_28_90_06_ef_78_7f_0b_22_73_f3_98_3e_b1n
export const salt =
  0x51_a2_7e_c7_00_50_ad_e2_61_6d_46_55_70_44_72_51_17_2f_bd_56_4e_10_62_05_fc_1e_1e_90_11_88_9e_a5n
export const setupRoles = 2n ** 252n + 2n ** 144n + 2n ** 140n + 2n ** 128n + 2n ** 124n + 256n
export const txHash = `0x${'ab'.repeat(32)}` as const
export const privateKey = `0x${'0'.repeat(63)}1`
export const rpcUrl = 'https://rpc.example/secret-credential'
export const operations = [
  'deploy-user-registry',
  'set-parent',
  'deploy-resolver',
  'deploy-registrar',
  'set-resolver-registrar',
  'attach-subregistry',
  'attach-parent-resolver',
  'grant-registrar-roles',
] as const
type Operation = (typeof operations)[number]
type Fields = Record<string, bigint | string | undefined>
type ReadValue = string | bigint | boolean | readonly string[]
export interface Scenario {
  available?: boolean
  autoDiscover?: boolean
  eventFields?: Fields
  fail?: 'simulate' | 'send' | 'wait' | 'reverted' | 'missing' | 'emitter' | 'malformed'
  failOperation?: Operation
  grantResult?: boolean
  noApply?: boolean
  noCode?: Address
  postReads?: Record<string, ReadValue>
  readError?: string
  reads?: Record<string, ReadValue>
  receiptAddress?: Address | null
  resume?: Record<string, string | undefined>
  stage?: number
  wrongChain?: boolean
}
interface Request {
  abi: Abi
  account: Account
  address: Address
  args: readonly unknown[]
  functionName: string
  gas?: bigint
}
interface Creation {
  account: Account
  chain: typeof ENS_HACKATHON_CHAIN
  data: Hex
}
const contracts = ENS_HACKATHON_CONTRACTS
const eventAbi = parseAbi([
  'event ProxyDeployed(address indexed sender,address indexed proxyAddress,uint256 salt,address implementation)',
  'event ParentUpdated(address indexed parent,string label,address indexed sender)',
  'event RegistrarSet(address registrar)',
  // Indexed exactly as the deployed PermissionedRegistry emits them; a fixture that
  // disagrees with the chain makes these tests pass while the deployment fails.
  'event SubregistryUpdated(uint256 indexed tokenId,address indexed subregistry,address indexed sender)',
  'event ResolverUpdated(uint256 indexed tokenId,address indexed resolver,address indexed sender)',
  'event EACRolesChanged(uint256 indexed resource,address indexed account,uint256 oldRoleBitmap,uint256 newRoleBitmap)',
])

type EventName = (typeof eventAbi)[number]['name']
const eventLog = (eventName: EventName, address: Address, fields: Fields) => {
  const event = eventAbi.find((item) => item.type === 'event' && item.name === eventName)
  if (event === undefined || event.type !== 'event') {
    throw new Error('unknown test event')
  }
  const inputs = event.inputs.filter((input) => !('indexed' in input && input.indexed))
  return {
    address,
    blockHash: zeroHash,
    blockNumber: 1n,
    data: encodeAbiParameters(
      inputs,
      inputs.map((input) => fields[input.name]),
    ),
    logIndex: 0,
    removed: false,
    topics: encodeEventTopics({ abi: eventAbi, args: fields, eventName }) as [Hex, ...Hex[]],
    transactionHash: txHash,
    transactionIndex: 0,
  }
}

export const topologyFixture = (scenario: Scenario = {}) => {
  let stage = scenario.stage ?? 8
  let active: Operation = 'deploy-user-registry'
  let simulated: Request | Creation | undefined
  let chainReads = 0
  const calls: string[] = []
  const actions: string[] = []
  const writes: { operation: Operation; request: Request | Creation }[] = []
  const progress: unknown[] = []
  const config = readTopologyMutationConfig({
    ENS_GATEWAY_SIGNER_KEY: `0x${'0'.repeat(63)}3`,
    ENS_PARENT_KEY: privateKey,
    ENS_REGISTRAR_ADDRESS:
      scenario.autoDiscover !== true && stage >= 4 ? addresses.registrarAddress : undefined,
    ENS_RESOLVER_ADDRESS:
      scenario.autoDiscover !== true && stage >= 3 ? addresses.resolverAddress : undefined,
    ENS_RPC_URL: rpcUrl,
    ENS_USER_REGISTRY_ADDRESS:
      scenario.autoDiscover !== true && stage >= 1 ? addresses.userRegistryAddress : undefined,
    ENS_VOUCHER_KEY: `0x${'0'.repeat(63)}2`,
    ...scenario.resume,
  })
  const fail = (phase: Scenario['fail']) => {
    if (scenario.failOperation === active && scenario.fail === phase) {
      throw new Error(`${privateKey} ${rpcUrl} raw-signed-transaction`)
    }
  }
  const readValue = (key: string, value: unknown) => {
    calls.push(`read:${key}`)
    if (scenario.readError === key) {
      throw new Error(`${rpcUrl} ${privateKey}`)
    }
    if (stage > (scenario.stage ?? 8) && Object.hasOwn(scenario.postReads ?? {}, key)) {
      return scenario.postReads?.[key]
    }
    return Object.hasOwn(scenario.reads ?? {}, key) ? scenario.reads?.[key] : value
  }
  const readContract = async (request: {
    abi: Abi
    address: Address
    args?: readonly unknown[]
    functionName: string
  }) => {
    const { abi, address, functionName: name } = request
    const args = request.args ?? []
    // Round-trip every call through the real ABI boundary. Unknown reads fail closed below.
    const data = encodeFunctionData({ abi, args, functionName: name })
    const decoded = decodeFunctionData({ abi, data })
    expect(decoded.functionName).toBe(name)
    expect(decoded.args ?? []).toStrictEqual(args)
    // oxlint-disable-next-line complexity -- the fake dispatches the entire preflight and topology read protocol.
    const valueFor = () => {
      if (name === 'supportsInterface') {
        expect(abi).toStrictEqual(ERC165_ABI)
        expect(args).toHaveLength(1)
        const target = address === addresses.resolverAddress ? 'resolver' : address
        expect([
          addresses.resolverAddress,
          contracts.UserRegistryImpl,
          contracts.DNSAliasResolver,
          contracts.UpgradableUniversalResolverProxy,
        ]).toContain(address)
        return readValue(`${target}.supportsInterface:${String(args[0])}`, args[0] !== '0xffffffff')
      }
      if (address === contracts.VerifiableFactory) {
        expect(abi).toStrictEqual(FACTORY_ABI)
        if (name === 'proxyLogic') {
          expect(args).toStrictEqual([])
          return readValue('factory.proxyLogic', other)
        }
        expect(name).toBe('verifyContract')
        expect(args).toStrictEqual([addresses.userRegistryAddress])
        return readValue('factory.verifyContract', contracts.UserRegistryImpl)
      }
      if (address === contracts.ETHRegistrar) {
        expect(abi).toStrictEqual(ETH_REGISTRAR_ABI)
        if (name === 'isAvailable') {
          expect(args).toStrictEqual(['fuda'])
          return readValue('eth.available', scenario.available ?? false)
        }
        expect(args).toStrictEqual([])
        expect(['MIN_COMMITMENT_AGE', 'MAX_COMMITMENT_AGE']).toContain(name)
        return name === 'MIN_COMMITMENT_AGE' ? 60n : 86_400n
      }
      if (address === contracts.MockUSDC) {
        expect(abi).toStrictEqual(MOCK_USDC_ABI)
        expect(name).toBe('balanceOf')
        expect(args).toStrictEqual([zeroAddress])
        return 0n
      }
      if (address === contracts.RootRegistry) {
        expect(abi).toStrictEqual(ETH_REGISTRY_ABI)
        expect(name).toBe('getSubregistry')
        expect(args).toStrictEqual(['eth'])
        return contracts.ETHRegistry
      }
      if (address === contracts.ETHRegistry) {
        expect(abi).toStrictEqual(ETH_REGISTRY_ABI)
        expect(args).toStrictEqual(name === 'getOwner' || name === 'getTokenId' ? [labelId] : ['fuda'])
        switch (name) {
          case 'getOwner': {
            return readValue('eth.owner', owner)
          }
          case 'getTokenId': {
            return readValue('eth.tokenId', 123n)
          }
          case 'getSubregistry': {
            return readValue('eth.subregistry', stage >= 6 ? addresses.userRegistryAddress : zeroAddress)
          }
          case 'getResolver': {
            return readValue('eth.resolver', stage >= 7 ? addresses.resolverAddress : zeroAddress)
          }
          default: {
            throw new Error(`unexpected ETH read: ${name}`)
          }
        }
      }
      if (address === addresses.userRegistryAddress) {
        expect(abi).toStrictEqual(USER_REGISTRY_ABI)
        if (name === 'getParent') {
          expect(args).toStrictEqual([])
          return readValue(
            'registry.parent',
            stage >= 2 ? [contracts.ETHRegistry, 'fuda'] : [zeroAddress, ''],
          )
        }
        expect(name).toBe('roles')
        expect(args[0]).toBe(0n)
        expect(args).toHaveLength(2)
        expect([owner, addresses.registrarAddress]).toContain(args[1])
        return args[1] === owner
          ? readValue('registry.ownerRoles', setupRoles)
          : readValue('registry.registrarRoles', stage >= 8 ? 65_537n : 0n)
      }
      if (address === addresses.resolverAddress) {
        expect(abi).toStrictEqual(FUDA_RESOLVER_ABI)
        expect(args).toStrictEqual([])
        const values = {
          gatewayUrls: ['https://api.fuda.sh/ens/gateway'],
          owner,
          parentNode: node,
          registrar: stage >= 5 ? addresses.registrarAddress : zeroAddress,
          signer: gateway,
          userRegistry: addresses.userRegistryAddress,
        }
        if (!Object.hasOwn(values, name)) {
          throw new Error(`unexpected resolver read: ${name}`)
        }
        return readValue(`resolver.${name}`, values[name as keyof typeof values])
      }
      if (address === addresses.registrarAddress) {
        expect(abi).toStrictEqual(FUDA_REGISTRAR_ABI)
        expect(args).toStrictEqual([])
        const values = {
          owner,
          parentNode: node,
          resolver: addresses.resolverAddress,
          userRegistry: addresses.userRegistryAddress,
          voucherSigner: voucher,
        }
        if (!Object.hasOwn(values, name)) {
          throw new Error(`unexpected registrar read: ${name}`)
        }
        return readValue(`registrar.${name}`, values[name as keyof typeof values])
      }
      throw new Error(`unexpected read destination: ${address}`)
    }
    const result = encodeFunctionResult({ abi, functionName: name, result: valueFor() })
    return await Promise.resolve(decodeFunctionResult({ abi, data: result, functionName: name }))
  }
  const methodOperations = {
    deployProxy: 'deploy-user-registry',
    grantRootRoles: 'grant-registrar-roles',
    setParent: 'set-parent',
    setRegistrar: 'set-resolver-registrar',
    setResolver: 'attach-parent-resolver',
    setSubregistry: 'attach-subregistry',
  } as const satisfies Record<string, Operation>
  const expectedRequests = {
    deployProxy: {
      abi: FACTORY_ABI,
      address: contracts.VerifiableFactory,
      args: [
        contracts.UserRegistryImpl,
        salt,
        encodeFunctionData({
          abi: USER_REGISTRY_ABI,
          args: [[{ account: owner, roleBitmap: setupRoles }]],
          functionName: 'initialize',
        }),
      ],
    },
    grantRootRoles: {
      abi: USER_REGISTRY_ABI,
      address: addresses.userRegistryAddress,
      args: [65_537n, addresses.registrarAddress],
    },
    setParent: {
      abi: USER_REGISTRY_ABI,
      address: addresses.userRegistryAddress,
      args: [contracts.ETHRegistry, 'fuda'],
    },
    setRegistrar: {
      abi: FUDA_RESOLVER_ABI,
      address: addresses.resolverAddress,
      args: [addresses.registrarAddress],
    },
    setResolver: {
      abi: ETH_REGISTRY_ABI,
      address: contracts.ETHRegistry,
      args: [labelId, addresses.resolverAddress],
    },
    setSubregistry: {
      abi: ETH_REGISTRY_ABI,
      address: contracts.ETHRegistry,
      args: [labelId, addresses.userRegistryAddress],
    },
  }
  const send = async (request: Request | Creation) => {
    expect(request).toBe(simulated)
    expect(request.account.address).toBe(owner)
    expect(calls.at(-1)).toBe(`simulate:${active}`)
    calls.push(`send:${active}`)
    fail('send')
    writes.push({ operation: active, request })
    actions.push(active)
    return await Promise.resolve(txHash)
  }
  // oxlint-disable-next-line complexity -- one realistic receipt assembler covers the six event writes and two direct creations.
  const receipt = (): TransactionReceipt => {
    const events = {
      'attach-parent-resolver': [
        'ResolverUpdated',
        contracts.ETHRegistry,
        { resolver: addresses.resolverAddress, sender: owner, tokenId: 123n },
      ],
      'attach-subregistry': [
        'SubregistryUpdated',
        contracts.ETHRegistry,
        { sender: owner, subregistry: addresses.userRegistryAddress, tokenId: 123n },
      ],
      'deploy-user-registry': [
        'ProxyDeployed',
        contracts.VerifiableFactory,
        {
          implementation: contracts.UserRegistryImpl,
          proxyAddress: addresses.userRegistryAddress,
          salt,
          sender: owner,
        },
      ],
      'grant-registrar-roles': [
        'EACRolesChanged',
        addresses.userRegistryAddress,
        { account: addresses.registrarAddress, newRoleBitmap: 65_537n, oldRoleBitmap: 0n, resource: 0n },
      ],
      'set-parent': [
        'ParentUpdated',
        addresses.userRegistryAddress,
        { label: 'fuda', parent: contracts.ETHRegistry, sender: owner },
      ],
      'set-resolver-registrar': [
        'RegistrarSet',
        addresses.resolverAddress,
        { registrar: addresses.registrarAddress },
      ],
    } satisfies Partial<Record<Operation, [EventName, Address, Fields]>>
    const event = active === 'deploy-resolver' || active === 'deploy-registrar' ? undefined : events[active]
    const bad = scenario.failOperation === active
    const fields = { ...event?.[2] }
    if (bad) {
      Object.assign(fields, scenario.eventFields)
    }
    const logs = event === undefined ? [] : [eventLog(event[0], event[1], fields)]
    if (bad && scenario.fail === 'emitter' && logs[0] !== undefined) {
      logs[0].address = other
    }
    if (bad && scenario.fail === 'malformed' && logs[0] !== undefined) {
      // An event whose fields are all indexed carries no data, so emptying `data`
      // would corrupt nothing and the assertion under test would never run. Corrupt
      // the last topic instead, which is the equivalent damage for that shape.
      if (logs[0].data === '0x') {
        logs[0].topics[logs[0].topics.length - 1] = zeroHash
      } else {
        logs[0].data = '0x'
      }
    }
    const direct = active === 'deploy-resolver' || active === 'deploy-registrar'
    let contractAddress: Address | null = null
    if (direct) {
      contractAddress = active === 'deploy-resolver' ? addresses.resolverAddress : addresses.registrarAddress
      if (bad && scenario.receiptAddress !== undefined) {
        contractAddress = scenario.receiptAddress
      }
    }
    return {
      blockHash: zeroHash,
      blockNumber: 1n,
      contractAddress,
      cumulativeGasUsed: 21_000n,
      effectiveGasPrice: 1n,
      from: owner,
      gasUsed: 21_000n,
      logs: bad && scenario.fail === 'missing' ? [] : logs,
      logsBloom: `0x${'00'.repeat(256)}`,
      status: bad && scenario.fail === 'reverted' ? 'reverted' : 'success',
      to: direct ? null : (event?.[1] ?? null),
      transactionHash: txHash,
      transactionIndex: 0,
      type: 'eip1559',
    }
  }
  const publicClient = {
    call: async (request: Creation) => {
      active = stage < 3 ? 'deploy-resolver' : 'deploy-registrar'
      expect(request.account.address).toBe(owner)
      expect(request).not.toHaveProperty('to')
      expect(request.data.length).toBeGreaterThan(100)
      calls.push(`simulate:${active}`)
      fail('simulate')
      simulated = request
      return await Promise.resolve({ data: '0x6000' })
    },
    chain: ENS_HACKATHON_CHAIN,
    getChainId: async () => {
      actions.push(chainReads === 0 ? 'preflight' : 'verify')
      chainReads += 1
      calls.push('chain')
      return await Promise.resolve(scenario.wrongChain === true ? 1 : 11_155_111)
    },
    getCode: async ({ address }: { address: Address }) => {
      calls.push(`code:${address}`)
      const known =
        Object.values(contracts).some((contract) => contract === address) ||
        (address === addresses.userRegistryAddress && stage >= 1) ||
        (address === addresses.resolverAddress && stage >= 3) ||
        (address === addresses.registrarAddress && stage >= 4)
      return await Promise.resolve(known && scenario.noCode !== address ? '0x6000' : '0x')
    },
    readContract,
    simulateContract: async (request: Request) => {
      active = methodOperations[request.functionName as keyof typeof methodOperations]
      const expected = expectedRequests[request.functionName as keyof typeof expectedRequests]
      expect(expected).toBeDefined()
      expect(request.address).toBe(expected?.address)
      expect(request.args).toStrictEqual(expected?.args)
      expect(request.abi).toStrictEqual(expected?.abi)
      expect(request.account.address).toBe(owner)
      if (active === 'attach-subregistry' || active === 'attach-parent-resolver') {
        expect(calls.at(-1)).toBe('read:eth.tokenId')
      }
      calls.push(`simulate:${active}`)
      fail('simulate')
      simulated = { ...request, gas: 76_543n }
      const result = request.functionName === 'deployProxy' ? other : (scenario.grantResult ?? true)
      return await Promise.resolve({ request: simulated, result })
    },
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      expect(hash).toBe(txHash)
      calls.push(`wait:${active}`)
      fail('wait')
      if (scenario.noApply !== true) {
        stage = Math.max(stage, operations.indexOf(active) + 1)
      }
      return await Promise.resolve(receipt())
    },
  }
  // The fake implements all requested viem method shapes; generic overloads are narrowed at this test boundary.
  const context = {
    config,
    onProgress: (event: unknown) => {
      progress.push(event)
      calls.push('progress')
    },
    publicClient,
    walletClient: { sendTransaction: send, writeContract: send },
  } as unknown as TopologyContext
  return { actions, calls, context, progress, writes }
}
