import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  labelhash,
  zeroAddress,
} from 'viem'
import type { Address, Chain, Hex } from 'viem'
import { sepolia } from 'viem/chains'
import { describe, expect, it, vi } from 'vitest'

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
import { createEnsPublicClient, runPreflight } from './preflight.ts'

// Only the pinned hash fixture changes: RPC encoding, viem decoding, addresses,
// and the production hashing/comparison all remain real.
vi.mock(import('../index.ts'), async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    ENS_RUNTIME_CODE_HASHES: {
      DNSAliasResolver: '0x07ad118d6cc8642c86c03827f276d8b791a65e5c99a3845faf186be720a1455d',
      ETHRegistrar: '0x309c67890bde4c575dc23d2cc3b5c3a3d599e312e980e9b61b5bc8f3cd87c8bb',
      ETHRegistry: '0xcde7aac41575d8b30bd84f598371d46d266fadb09c9dcfcdd047fd087ef8763e',
      MockUSDC: '0x124787cd33af4a91148bc5521374b123cb0c5aaa5b0f02ff8d9bf1bb816791b8',
      RootRegistry: '0x48ff38a7839bff5a0a8ec3ebb1de0c376b5886f85817779bd4e7a0f82ed99b46',
      UpgradableUniversalResolverProxy: '0x833657cddc570dd91a5715fcdb759e6dc72e3670b7506790c97b974b3276926d',
      UserRegistryImpl: '0x2da1f83d0ca5cc701e587fa2fcce070884fb67540262ced65d6d52cde467d470',
      VerifiableFactory: '0x0396f7bb2176e50158d8d9c220fcda85fcddb9640fb7a4d108ad15caca50b418',
    },
  } as unknown as typeof original
})

const owner = '0x1111111111111111111111111111111111111111'
const other = '0x2222222222222222222222222222222222222222'
const registry = '0x3333333333333333333333333333333333333333'
const resolver = '0x4444444444444444444444444444444444444444'
const registrar = '0x5555555555555555555555555555555555555555'
const codeByAddress = new Map<Address, Hex>([
  [ENS_HACKATHON_CONTRACTS.DNSAliasResolver, '0x6000'],
  [ENS_HACKATHON_CONTRACTS.ETHRegistrar, '0x6001'],
  [ENS_HACKATHON_CONTRACTS.ETHRegistry, '0x6002'],
  [ENS_HACKATHON_CONTRACTS.MockUSDC, '0x6003'],
  [ENS_HACKATHON_CONTRACTS.RootRegistry, '0x6004'],
  [ENS_HACKATHON_CONTRACTS.UpgradableUniversalResolverProxy, '0x6005'],
  [ENS_HACKATHON_CONTRACTS.UserRegistryImpl, '0x6006'],
  [ENS_HACKATHON_CONTRACTS.VerifiableFactory, '0x6007'],
])
const config = readPublicConfig({ ENS_RPC_URL: 'https://rpc.example' })
const resume = readPublicConfig({
  ENS_PARENT_ADDRESS: owner,
  ENS_REGISTRAR_ADDRESS: registrar,
  ENS_RESOLVER_ADDRESS: resolver,
  ENS_RPC_URL: 'https://rpc.example',
  ENS_USER_REGISTRY_ADDRESS: registry,
})
const abi = [
  ...ERC165_ABI,
  ...ETH_REGISTRAR_ABI,
  ...ETH_REGISTRY_ABI,
  ...FACTORY_ABI,
  ...MOCK_USDC_ABI,
  ...FUDA_RESOLVER_ABI,
  ...FUDA_REGISTRAR_ABI,
]

interface Scenario {
  available?: boolean
  chainId?: string
  code?: Hex
  codeAddress?: Address
  fail?: string
  implementation?: Address
  interfaceAddress?: Address
  interfaceSupported?: boolean
  invalidInterfaceSupported?: boolean
  malformedRead?: string
  owner?: Address
  ownerMismatchAddress?: Address
  rootRegistry?: Address
}

const boolean = (value: boolean) => encodeAbiParameters([{ type: 'bool' }], [value])
const address = (value: Address) => encodeAbiParameters([{ type: 'address' }], [value])
const uint = (value: bigint) => encodeAbiParameters([{ type: 'uint256' }], [value])

const preflightReadNames = [
  'supportsInterface',
  'isAvailable',
  'MIN_COMMITMENT_AGE',
  'MAX_COMMITMENT_AGE',
  'getOwner',
  'getSubregistry',
  'proxyLogic',
  'balanceOf',
  'verifyContract',
  'owner',
] as const
type PreflightReadName = (typeof preflightReadNames)[number]

const isPreflightReadName = (value: string): value is PreflightReadName =>
  preflightReadNames.some((name) => name === value)

const fakeClient = (scenario: Scenario = {}, chain: Chain = ENS_HACKATHON_CHAIN) => {
  const calls: string[] = []
  const client = createPublicClient({
    chain,
    transport: custom(
      {
        // oxlint-disable-next-line complexity -- one fake RPC dispatcher models the complete read-only protocol boundary.
        async request({ method, params }: { method: string; params?: unknown }) {
          calls.push(method)
          if (method === 'eth_chainId') {
            if (scenario.fail === method) {
              throw new Error('offline')
            }
            return await Promise.resolve(scenario.chainId ?? '0xaa36a7')
          }
          if (method === 'eth_getCode') {
            const [codeAddress] = params as [Address, string]
            if (scenario.fail === `${codeAddress}:getCode`) {
              throw new Error('offline')
            }
            return await Promise.resolve(
              codeAddress === scenario.codeAddress ? scenario.code : codeByAddress.get(codeAddress),
            )
          }
          if (method !== 'eth_call') {
            throw new Error(`unexpected RPC method ${method}`)
          }
          const [{ to, data }] = params as [{ data: Hex; to: Address }, string]
          const { args, functionName } = decodeFunctionData({ abi, data })
          calls.push(`${to}:${functionName}`)
          if (scenario.fail === `${to}:${functionName}`) {
            throw new Error('execution reverted')
          }
          if (scenario.malformedRead === `${to}:${functionName}`) {
            return '0x'
          }
          if (!isPreflightReadName(functionName)) {
            throw new Error(`unexpected ABI read ${functionName}`)
          }
          switch (functionName) {
            case 'supportsInterface': {
              if (args[0] !== '0x01ffc9a7' && args[0] !== '0xffffffff') {
                throw new Error('wrong interface argument')
              }
              if (args[0] === '0xffffffff') {
                return boolean(
                  to === scenario.interfaceAddress ? (scenario.invalidInterfaceSupported ?? false) : false,
                )
              }
              return boolean(to === scenario.interfaceAddress ? (scenario.interfaceSupported ?? true) : true)
            }
            case 'isAvailable': {
              if (args[0] !== 'fuda') {
                throw new Error('wrong parent label')
              }
              return boolean(scenario.available ?? true)
            }
            case 'MIN_COMMITMENT_AGE': {
              return uint(60n)
            }
            case 'MAX_COMMITMENT_AGE': {
              return uint(86_400n)
            }
            case 'getOwner': {
              if (args[0] !== BigInt(labelhash('fuda'))) {
                throw new Error('wrong token id')
              }
              return address(scenario.owner ?? zeroAddress)
            }
            case 'getSubregistry': {
              if (to !== ENS_HACKATHON_CONTRACTS.RootRegistry || args[0] !== 'eth') {
                throw new Error('wrong root read')
              }
              return address(scenario.rootRegistry ?? ENS_HACKATHON_CONTRACTS.ETHRegistry)
            }
            case 'proxyLogic': {
              return address(other)
            }
            case 'balanceOf': {
              if (args[0] !== zeroAddress) {
                throw new Error('wrong balance account')
              }
              return uint(0n)
            }
            case 'verifyContract': {
              if (args[0] !== registry) {
                throw new Error('wrong proxy')
              }
              return address(scenario.implementation ?? ENS_HACKATHON_CONTRACTS.UserRegistryImpl)
            }
            case 'owner': {
              return address(to === scenario.ownerMismatchAddress ? other : owner)
            }
          }
        },
      },
      { retryCount: 0 },
    ),
  })
  return { calls, client }
}

describe('read-only ENS namespace preflight', () => {
  it('binds created clients to the dedicated resolver and explicit URL', () => {
    const client = createEnsPublicClient('https://rpc.example')
    expect(client.chain.contracts.ensUniversalResolver.address).toBe(
      '0xd26f2040d083af1cd2962ba303f4bea0c4faf142',
    )
    expect(client.transport.url).toBe('https://rpc.example')
    expect(() => createEnsPublicClient('')).toThrow('ENS_RPC_URL')
  })

  it('reports an available parent, probes every critical ABI, and sends no transactions', async () => {
    const { client, calls } = fakeClient()
    const report = await runPreflight(client, config)
    expect(report).toMatchObject({
      chainId: 11_155_111,
      checkedContracts: Object.keys(ENS_RUNTIME_CODE_HASHES),
      parent: { owner: zeroAddress, state: 'available' },
    })
    expect(calls.filter((call) => call.startsWith('eth_'))).toStrictEqual([
      'eth_chainId',
      ...Array.from({ length: 8 }, () => 'eth_getCode'),
      ...Array.from({ length: 12 }, () => 'eth_call'),
    ])
    expect(JSON.stringify(report)).not.toMatch(/secret|privateKey|parentAccount|rpcUrl/iu)
  })

  it('accepts an unavailable parent owned by the expected public address', async () => {
    const { client } = fakeClient({ available: false, owner })
    await expect(
      runPreflight(
        client,
        readPublicConfig({ ENS_PARENT_ADDRESS: owner, ENS_RPC_URL: 'https://rpc.example' }),
      ),
    ).resolves.toMatchObject({ parent: { owner, state: 'owned' } })
  })

  it.each([{}, { ENS_PARENT_ADDRESS: other }])(
    'rejects an unavailable parent without a matching configured owner: %j',
    async (env) => {
      const { client } = fakeClient({ available: false, owner })
      await expect(
        runPreflight(client, readPublicConfig({ ...env, ENS_RPC_URL: 'https://rpc.example' })),
      ).rejects.toThrow('fuda: unavailable')
    },
  )

  it('rejects the wrong chain before contract reads', async () => {
    const { client, calls } = fakeClient({ chainId: '0x1' })
    await expect(runPreflight(client, config)).rejects.toThrow('wrong ENS chain')
    expect(calls).toStrictEqual(['eth_chainId'])
  })

  it('rejects normal Sepolia resolver configuration', async () => {
    const { client } = fakeClient({}, sepolia)
    await expect(runPreflight(client, config)).rejects.toThrow('dedicated Universal Resolver')
  })

  it.each(Object.keys(ENS_RUNTIME_CODE_HASHES) as (keyof typeof ENS_RUNTIME_CODE_HASHES)[])(
    'rejects absent and changed runtime at %s',
    async (name) => {
      for (const code of [undefined, '0x', '0xdead'] as const) {
        const { client } = fakeClient({ code, codeAddress: ENS_HACKATHON_CONTRACTS[name] })
        // oxlint-disable-next-line no-await-in-loop -- each independently mutated runtime must fail before the next scenario.
        await expect(runPreflight(client, config)).rejects.toThrow(
          `${name}: ${code === '0xdead' ? 'runtime code hash mismatch' : 'no runtime code'}`,
        )
      }
    },
  )

  it('rejects a mixed registry address family', async () => {
    const { client } = fakeClient({ rootRegistry: other })
    await expect(runPreflight(client, config)).rejects.toThrow('RootRegistry.getSubregistry')
  })

  it.each(['UpgradableUniversalResolverProxy', 'DNSAliasResolver', 'UserRegistryImpl'] as const)(
    'rejects false ERC-165 support at %s',
    async (name) => {
      const { client } = fakeClient({
        interfaceAddress: ENS_HACKATHON_CONTRACTS[name],
        interfaceSupported: false,
      })
      await expect(runPreflight(client, config)).rejects.toThrow('supportsInterface')
    },
  )

  it.each(['UpgradableUniversalResolverProxy', 'DNSAliasResolver'] as const)(
    'rejects %s claiming support for the invalid interface',
    async (name) => {
      const { client } = fakeClient({
        interfaceAddress: ENS_HACKATHON_CONTRACTS[name],
        invalidInterfaceSupported: true,
      })
      await expect(runPreflight(client, config)).rejects.toThrow('supportsInterface')
    },
  )

  it('contextualizes a malformed ABI response decoded by viem', async () => {
    const { client } = fakeClient({ malformedRead: `${ENS_HACKATHON_CONTRACTS.ETHRegistrar}:isAvailable` })
    await expect(runPreflight(client, config)).rejects.toThrow('ETHRegistrar.isAvailable: read failed')
  })

  it.each([
    ['UpgradableUniversalResolverProxy', 'supportsInterface'],
    ['DNSAliasResolver', 'supportsInterface'],
    ['ETHRegistrar', 'isAvailable'],
    ['ETHRegistrar', 'MIN_COMMITMENT_AGE'],
    ['ETHRegistrar', 'MAX_COMMITMENT_AGE'],
    ['ETHRegistry', 'getOwner'],
    ['RootRegistry', 'getSubregistry'],
    ['VerifiableFactory', 'proxyLogic'],
    ['UserRegistryImpl', 'supportsInterface'],
    ['MockUSDC', 'balanceOf'],
  ] as const)('contextualizes %s.%s read errors', async (name, functionName) => {
    const { client } = fakeClient({ fail: `${ENS_HACKATHON_CONTRACTS[name]}:${functionName}` })
    await expect(runPreflight(client, config)).rejects.toThrow(`${name}.${functionName}`)
  })

  it('contextualizes chain and code RPC errors', async () => {
    await expect(runPreflight(fakeClient({ fail: 'eth_chainId' }).client, config)).rejects.toThrow(
      'getChainId',
    )
    await expect(
      runPreflight(
        fakeClient({ fail: `${ENS_HACKATHON_CONTRACTS.DNSAliasResolver}:getCode` }).client,
        config,
      ),
    ).rejects.toThrow('DNSAliasResolver.getCode')
  })

  it('verifies a supplied registry proxy and deployed contract owners', async () => {
    await expect(runPreflight(fakeClient().client, resume)).resolves.toMatchObject({
      parent: { state: 'available' },
    })
    await expect(runPreflight(fakeClient({ implementation: other }).client, resume)).rejects.toThrow(
      'VerifiableFactory.verifyContract',
    )
    await expect(runPreflight(fakeClient({ ownerMismatchAddress: resolver }).client, resume)).rejects.toThrow(
      'FudaResolver.owner',
    )
  })

  it('rejects a registrar-only owner mismatch after the resolver owner passes', async () => {
    await expect(
      runPreflight(fakeClient({ ownerMismatchAddress: registrar }).client, resume),
    ).rejects.toThrow('FudaSubnameRegistrar.owner')
  })

  it.each([
    ['ENS_RESOLVER_ADDRESS', resolver],
    ['ENS_REGISTRAR_ADDRESS', registrar],
  ])('requires the public expected owner for %s', async (key, value) => {
    await expect(
      runPreflight(
        fakeClient().client,
        readPublicConfig({ [key]: value, ENS_RPC_URL: 'https://rpc.example' }),
      ),
    ).rejects.toThrow('ENS_PARENT_ADDRESS')
  })

  it.each([
    ['VerifiableFactory', ENS_HACKATHON_CONTRACTS.VerifiableFactory, 'verifyContract'],
    ['FudaResolver', resolver, 'owner'],
    ['FudaSubnameRegistrar', registrar, 'owner'],
  ])('contextualizes optional %s read errors', async (name, contractAddress, functionName) => {
    await expect(
      runPreflight(fakeClient({ fail: `${contractAddress}:${functionName}` }).client, resume),
    ).rejects.toThrow(`${name}.${functionName}`)
  })
})
