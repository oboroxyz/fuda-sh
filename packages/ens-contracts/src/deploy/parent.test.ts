import { encodeAbiParameters, encodeEventTopics, keccak256, labelhash, zeroAddress, zeroHash } from 'viem'
import type { Address, Block, Hex, TransactionReceipt } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import {
  ENS_HACKATHON_CHAIN,
  ENS_HACKATHON_CONTRACTS,
  ETH_REGISTRAR_ABI,
  MOCK_USDC_ABI,
  USER_REGISTRY_ABI,
} from '../index.ts'
import { readParentMutationConfig, readPublicConfig } from './config.ts'
import { commitParentName, revealParentName } from './parent.ts'
import type { ParentContext } from './parent.ts'

// Runtime pinning is tested by preflight.test.ts; these clients still execute real preflight.
vi.mock(import('../index.ts'), async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    ENS_RUNTIME_CODE_HASHES: Object.fromEntries(
      Object.keys(original.ENS_RUNTIME_CODE_HASHES).map((name) => [name, keccak256('0x6000')]),
    ),
  } as unknown as typeof original
})

const contracts = ENS_HACKATHON_CONTRACTS
const owner = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf'
const other = '0x2222222222222222222222222222222222222222'
const key = `0x${'0'.repeat(63)}1`
const secret = `0x${'ab'.repeat(32)}`
const commitment: Hex = `0x${'cd'.repeat(32)}`
const txHash: Hex = `0x${'ef'.repeat(32)}`
const tokenId = 123n
const env = {
  ENS_COMMITMENT_SECRET: secret,
  ENS_PARENT_ADDRESS: owner,
  ENS_PARENT_DURATION: '31536000',
  ENS_PARENT_KEY: key,
  ENS_RPC_URL: 'https://rpc.example/credential',
}
const registrationArgs = [
  'fuda',
  owner,
  secret,
  zeroAddress,
  zeroAddress,
  31_536_000n,
  contracts.MockUSDC,
  zeroHash,
] as const
const eventAbi = [...ETH_REGISTRAR_ABI, ...MOCK_USDC_ABI, ...USER_REGISTRY_ABI]
type Operation = 'mint' | 'approve' | 'commit' | 'register'
type Failure = 'simulate' | 'send' | 'wait' | 'reverted' | 'missing' | 'emitter' | 'fields' | 'malformed'
type EventFields = Record<string, string | bigint | undefined>
interface SimulatedRequest {
  account: { address: Address }
  address: Address
  args: readonly (string | bigint)[]
  functionName: Operation
  gas?: bigint
}
interface Scenario {
  allowance?: bigint
  approvalResult?: boolean
  available?: boolean
  balance?: bigint
  commitmentAt?: bigint
  confirmedNow?: bigint
  fail?: Failure
  failBlock?: 'latest' | 'confirmed'
  failOperation?: Operation
  failPostOwner?: boolean
  failRead?: string
  maxAge?: bigint
  minAge?: bigint
  missingRegistryEvent?: boolean
  noPublicOwner?: boolean
  now?: bigint
  owner?: Address
  postOwner?: Address
  price?: readonly [bigint, bigint]
  registryEmitter?: Address
  registryFields?: EventFields
  registerFields?: EventFields
  secondAvailable?: boolean
  tokenFields?: EventFields
  wrongChain?: boolean
}

const eventLog = (
  eventName: 'Transfer' | 'Approval' | 'CommitmentMade' | 'NameRegistered' | 'LabelRegistered',
  address: Address,
  args: EventFields,
) => {
  const item = eventAbi.find((entry) => entry.type === 'event' && entry.name === eventName)
  if (item === undefined || item.type !== 'event') {
    throw new Error('missing event ABI')
  }
  const inputs = item.inputs.filter((input) => !('indexed' in input))
  return {
    address,
    blockHash: zeroHash,
    blockNumber: 1n,
    data: encodeAbiParameters(
      inputs,
      inputs.map((input) => args[input.name]),
    ),
    logIndex: 0,
    removed: false,
    topics: encodeEventTopics({ abi: eventAbi, args, eventName }) as [Hex, ...Hex[]],
    transactionHash: txHash,
    transactionIndex: 0,
  }
}

const fixture = (scenario: Scenario = {}) => {
  const calls: string[] = []
  const writes: { args: readonly unknown[]; functionName: Operation }[] = []
  let mutationLoaded = false
  let availableReads = 0
  let registered = false
  let simulated: SimulatedRequest | undefined
  let operation: Operation = 'commit'
  let operationArgs: readonly (string | bigint)[] = []
  const config = readPublicConfig(scenario.noPublicOwner === true ? { ENS_RPC_URL: env.ENS_RPC_URL } : env)
  const fail = (stage: Failure) => {
    if (scenario.failOperation === operation && scenario.fail === stage) {
      throw new Error(`${secret} ${key} ${env.ENS_RPC_URL} raw-signed-transaction`)
    }
  }
  const logForOperation = () => {
    switch (operation) {
      case 'mint': {
        return eventLog('Transfer', contracts.MockUSDC, {
          from: zeroAddress,
          to: owner,
          value: operationArgs[1],
          ...scenario.tokenFields,
        })
      }
      case 'approve': {
        return eventLog('Approval', contracts.MockUSDC, {
          owner,
          spender: contracts.ETHRegistrar,
          value: operationArgs[1],
          ...scenario.tokenFields,
        })
      }
      case 'commit': {
        return eventLog('CommitmentMade', contracts.ETHRegistrar, { commitment })
      }
      case 'register': {
        return eventLog('NameRegistered', contracts.ETHRegistrar, {
          base: 100n,
          duration: 31_536_000n,
          label: 'fuda',
          owner,
          paymentToken: contracts.MockUSDC,
          premium: 20n,
          referrer: zeroHash,
          resolver: zeroAddress,
          subregistry: zeroAddress,
          tokenId,
          ...scenario.registerFields,
        })
      }
      default: {
        throw new Error('unexpected operation')
      }
    }
  }
  const receipt = (): TransactionReceipt => {
    let log = logForOperation()
    const bad = scenario.failOperation === operation
    if (bad && scenario.fail === 'emitter') {
      log = { ...log, address: other }
    }
    if (bad && scenario.fail === 'malformed') {
      log = { ...log, data: '0x' }
    }
    if (bad && scenario.fail === 'fields') {
      log = { ...log, data: `0x${'00'.repeat(32)}` }
    }
    const logs = bad && scenario.fail === 'missing' ? [] : [log]
    if (operation === 'register' && scenario.missingRegistryEvent !== true) {
      logs.push(
        eventLog('LabelRegistered', scenario.registryEmitter ?? contracts.ETHRegistry, {
          expiry: (scenario.confirmedNow ?? scenario.now ?? 1000n) + 31_536_000n,
          label: 'fuda',
          labelHash: labelhash('fuda'),
          owner,
          sender: contracts.ETHRegistrar,
          tokenId,
          ...scenario.registryFields,
        }),
      )
    }
    return {
      blockHash: zeroHash,
      blockNumber: 1n,
      contractAddress: null,
      cumulativeGasUsed: 21_000n,
      effectiveGasPrice: 1n,
      from: owner,
      gasUsed: 21_000n,
      logs,
      logsBloom: `0x${'00'.repeat(256)}`,
      status: bad && scenario.fail === 'reverted' ? 'reverted' : 'success',
      to: operation === 'mint' || operation === 'approve' ? contracts.MockUSDC : contracts.ETHRegistrar,
      transactionHash: txHash,
      transactionIndex: 0,
      type: 'eip1559',
    }
  }
  const publicClient = {
    chain: ENS_HACKATHON_CHAIN,
    getBlock: async (request: { blockNumber?: bigint; blockTag?: string }) => {
      calls.push('block')
      expect(request).toStrictEqual(registered ? { blockNumber: 1n } : { blockTag: 'latest' })
      if (scenario.failBlock === (registered ? 'confirmed' : 'latest')) {
        throw new Error(`${secret} ${env.ENS_RPC_URL}`)
      }
      const block: Block = {
        baseFeePerGas: 1n,
        blobGasUsed: 0n,
        difficulty: 0n,
        excessBlobGas: 0n,
        extraData: '0x',
        gasLimit: 30_000_000n,
        gasUsed: 21_000n,
        hash: zeroHash,
        logsBloom: `0x${'00'.repeat(256)}`,
        miner: zeroAddress,
        mixHash: zeroHash,
        nonce: '0x0000000000000000',
        number: 1n,
        parentHash: zeroHash,
        receiptsRoot: zeroHash,
        sealFields: [],
        sha3Uncles: zeroHash,
        size: 1000n,
        stateRoot: zeroHash,
        timestamp: registered ? (scenario.confirmedNow ?? scenario.now ?? 1000n) : (scenario.now ?? 1000n),
        totalDifficulty: 0n,
        transactions: [],
        transactionsRoot: zeroHash,
        uncles: [],
      }
      return await Promise.resolve(block)
    },
    getChainId: async () => {
      calls.push('chain')
      return await Promise.resolve(scenario.wrongChain === true ? 1 : ENS_HACKATHON_CHAIN.id)
    },
    getCode: async () => {
      calls.push('code')
      return await Promise.resolve('0x6000')
    },
    // The generic viem client surface is cast only at this controlled test boundary.
    // oxlint-disable-next-line complexity -- the fake dispatches the complete preflight and parent read protocol.
    readContract: async ({
      address,
      args,
      functionName,
    }: {
      address: Address
      args?: readonly unknown[]
      functionName: string
    }) => {
      calls.push(functionName)
      if (functionName === scenario.failRead) {
        throw new Error(`${secret} ${env.ENS_RPC_URL}`)
      }
      await Promise.resolve()
      switch (functionName) {
        case 'supportsInterface': {
          return args?.[0] === '0x01ffc9a7'
        }
        case 'isAvailable': {
          expect(address).toBe(contracts.ETHRegistrar)
          expect(args).toStrictEqual(['fuda'])
          availableReads += 1
          return availableReads > 1
            ? (scenario.secondAvailable ?? scenario.available ?? true)
            : (scenario.available ?? true)
        }
        case 'MIN_COMMITMENT_AGE': {
          return scenario.minAge ?? 60n
        }
        case 'MAX_COMMITMENT_AGE': {
          return scenario.maxAge ?? 86_400n
        }
        case 'getOwner': {
          expect(address).toBe(contracts.ETHRegistry)
          expect(args).toStrictEqual([BigInt(labelhash('fuda'))])
          if (registered && scenario.failPostOwner === true) {
            throw new Error(`${secret} ${env.ENS_RPC_URL}`)
          }
          return registered ? (scenario.postOwner ?? owner) : (scenario.owner ?? zeroAddress)
        }
        case 'getSubregistry': {
          return contracts.ETHRegistry
        }
        case 'proxyLogic': {
          return other
        }
        case 'balanceOf': {
          expect(address).toBe(contracts.MockUSDC)
          expect(args).toStrictEqual([mutationLoaded ? owner : zeroAddress])
          return mutationLoaded ? (scenario.balance ?? 30n) : 0n
        }
        case 'allowance': {
          expect(address).toBe(contracts.MockUSDC)
          expect(args).toStrictEqual([owner, contracts.ETHRegistrar])
          return scenario.allowance ?? 40n
        }
        case 'makeCommitment': {
          expect(address).toBe(contracts.ETHRegistrar)
          expect(args).toStrictEqual(['fuda', owner, secret, zeroAddress, zeroAddress, 31_536_000n, zeroHash])
          return commitment
        }
        case 'commitmentAt': {
          expect(address).toBe(contracts.ETHRegistrar)
          expect(args).toStrictEqual([commitment])
          return scenario.commitmentAt ?? 0n
        }
        case 'getRegisterPrice': {
          expect(address).toBe(contracts.ETHRegistrar)
          expect(args).toStrictEqual(['fuda', 31_536_000n, contracts.MockUSDC])
          return scenario.price ?? [100n, 20n]
        }
        default: {
          throw new Error(`unexpected read ${functionName}`)
        }
      }
    },
    simulateContract: async (request: SimulatedRequest) => {
      operation = request.functionName
      operationArgs = request.args
      calls.push(`simulate:${operation}`)
      expect(request.account.address).toBe(owner)
      expect(request.address).toBe(
        operation === 'mint' || operation === 'approve' ? contracts.MockUSDC : contracts.ETHRegistrar,
      )
      fail('simulate')
      simulated = { ...request, gas: 123_456n }
      await Promise.resolve()
      const results = {
        approve: scenario.approvalResult ?? true,
        commit: undefined,
        mint: undefined,
        register: tokenId,
      }
      return {
        request: simulated,
        result: results[operation],
      }
    },
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      calls.push(`wait:${operation}`)
      expect(hash).toBe(txHash)
      fail('wait')
      if (operation === 'register') {
        registered = true
      }
      return await Promise.resolve(receipt())
    },
  } as unknown as ParentContext['publicClient']
  const context: ParentContext = {
    config,
    loadMutation: () => {
      calls.push('load')
      mutationLoaded = true
      return {
        config: readParentMutationConfig(env),
        walletClient: {
          writeContract: async (request: { args: readonly unknown[]; functionName: Operation }) => {
            calls.push(`send:${operation}`)
            expect(request).toBe(simulated)
            fail('send')
            writes.push({ args: request.args, functionName: request.functionName })
            return await Promise.resolve(txHash)
          },
        } as unknown as ReturnType<ParentContext['loadMutation']>['walletClient'],
      }
    },
    publicClient,
  }
  return { calls, context, writes }
}

describe('parent commit and reveal', () => {
  it.each([commitParentName, revealParentName])(
    'returns already-complete without loading secrets for %s',
    async (run) => {
      const { calls, context, writes } = fixture({ available: false, owner })
      context.loadMutation = () => {
        throw new Error('must not read secrets')
      }
      await expect(run(context)).resolves.toStrictEqual({ owner, status: 'already-complete' })
      expect(calls[0]).toBe('chain')
      expect(calls).not.toContain('load')
      expect(writes).toStrictEqual([])
    },
  )

  it.each([commitParentName, revealParentName])(
    'rejects another owner before loading secrets for %s',
    async (run) => {
      const { calls, context, writes } = fixture({ available: false, owner: other })
      await expect(run(context)).rejects.toThrow('unavailable')
      expect(calls).not.toContain('load')
      expect(writes).toStrictEqual([])
    },
  )

  it.each([commitParentName, revealParentName])(
    'requires public owner for an unavailable name in %s',
    async (run) => {
      const { calls, context } = fixture({ available: false, noPublicOwner: true, owner })
      await expect(run(context)).rejects.toThrow('ENS_PARENT_ADDRESS')
      expect(calls).not.toContain('load')
    },
  )

  it.each([commitParentName, revealParentName])(
    'finishes preflight before loading mutation configuration in %s',
    async (run) => {
      const { calls, context } = fixture({ wrongChain: true })
      await expect(run(context)).rejects.toThrow('chain')
      expect(calls).toStrictEqual(['chain'])
    },
  )

  it('mints the balance delta, approves the exact total, then confirms commit without disclosing secrets', async () => {
    const { calls, context, writes } = fixture()
    const result = await commitParentName(context)
    expect(writes).toStrictEqual([
      { args: [owner, 90n], functionName: 'mint' },
      { args: [contracts.ETHRegistrar, 120n], functionName: 'approve' },
      { args: [commitment], functionName: 'commit' },
    ])
    expect(calls.slice(calls.indexOf('load'))).toStrictEqual([
      'load',
      'makeCommitment',
      'commitmentAt',
      'block',
      'MIN_COMMITMENT_AGE',
      'MAX_COMMITMENT_AGE',
      'getRegisterPrice',
      'balanceOf',
      'allowance',
      'simulate:mint',
      'send:mint',
      'wait:mint',
      'simulate:approve',
      'send:approve',
      'wait:approve',
      'simulate:commit',
      'send:commit',
      'wait:commit',
    ])
    expect(result).toMatchObject({
      owner,
      status: 'committed',
      transactions: [
        { hash: txHash, operation: 'mint' },
        { hash: txHash, operation: 'approve' },
        { hash: txHash, operation: 'commit' },
      ],
    })
    const json = JSON.stringify(result)
    for (const sensitive of [secret, key, 'credential', 'raw-signed-transaction']) {
      expect(json).not.toContain(sensitive)
    }
  })

  it.each([
    { allowance: 120n, balance: 120n, operations: ['commit'] },
    { allowance: 121n, balance: 121n, operations: ['commit'] },
    { allowance: 0n, balance: 120n, operations: ['approve', 'commit'] },
    { allowance: 120n, balance: 0n, operations: ['mint', 'commit'] },
  ])('only fills payment shortfalls: %s', async ({ allowance, balance, operations }) => {
    const { context, writes } = fixture({ allowance, balance })
    await commitParentName(context)
    expect(writes.map((write) => write.functionName)).toStrictEqual(operations)
  })

  it.each([0n, 59n, 60n, 86_400n])('does not duplicate an existing commitment with age %s', async (age) => {
    const { calls, context, writes } = fixture({ commitmentAt: 100_000n - age, now: 100_000n })
    await expect(commitParentName(context)).resolves.toMatchObject({ status: 'already-committed' })
    expect(calls).not.toContain('getRegisterPrice')
    expect(writes).toStrictEqual([])
  })

  it('replaces an expired commitment', async () => {
    const { context, writes } = fixture({ allowance: 120n, balance: 120n, commitmentAt: 1n, now: 86_402n })
    await expect(commitParentName(context)).resolves.toMatchObject({ status: 'committed' })
    expect(writes).toStrictEqual([{ args: [commitment], functionName: 'commit' }])
  })

  it('returns only public string timestamps for an existing commitment', async () => {
    const { context } = fixture({ commitmentAt: 900n })
    await expect(commitParentName(context)).resolves.toStrictEqual({
      commitmentAt: '900',
      expiresAt: '87300',
      owner,
      readyAt: '960',
      status: 'already-committed',
    })
  })

  it.each([commitParentName, revealParentName])(
    'rejects future commitment timestamps for %s',
    async (run) => {
      const { context, writes } = fixture({ commitmentAt: 1001n })
      await expect(run(context)).rejects.toThrow('future')
      expect(writes).toStrictEqual([])
    },
  )

  it.each([
    { at: 0n, now: 1000n, reason: 'missing' },
    { at: 941n, now: 1000n, reason: '1s too young' },
    { at: 1n, now: 86_402n, reason: 'expired' },
  ])('rejects invalid reveal age before simulation: %s', async ({ at, now, reason }) => {
    const { calls, context, writes } = fixture({ commitmentAt: at, now })
    await expect(revealParentName(context)).rejects.toThrow(reason)
    expect(calls.some((call) => call.startsWith('simulate:'))).toBe(false)
    expect(writes).toStrictEqual([])
  })

  it.each([60n, 86_400n])('accepts the inclusive reveal age boundary %s', async (age) => {
    const { context, writes } = fixture({
      allowance: 120n,
      balance: 120n,
      commitmentAt: 100_000n - age,
      now: 100_000n,
    })
    await expect(revealParentName(context)).resolves.toMatchObject({ owner, status: 'registered' })
    expect(writes).toStrictEqual([{ args: registrationArgs, functionName: 'register' }])
  })

  it('refreshes availability and price before reveal payment, then checks the confirmed owner', async () => {
    const { calls, context, writes } = fixture({ commitmentAt: 900n })
    const result = await revealParentName(context)
    expect(writes).toStrictEqual([
      { args: [owner, 90n], functionName: 'mint' },
      { args: [contracts.ETHRegistrar, 120n], functionName: 'approve' },
      { args: registrationArgs, functionName: 'register' },
    ])
    expect(calls.slice(calls.indexOf('load'))).toStrictEqual([
      'load',
      'makeCommitment',
      'commitmentAt',
      'block',
      'MIN_COMMITMENT_AGE',
      'MAX_COMMITMENT_AGE',
      'isAvailable',
      'getRegisterPrice',
      'balanceOf',
      'allowance',
      'simulate:mint',
      'send:mint',
      'wait:mint',
      'simulate:approve',
      'send:approve',
      'wait:approve',
      'simulate:register',
      'send:register',
      'wait:register',
      'block',
      'getOwner',
    ])
    expect(result).toMatchObject({ owner, status: 'registered' })
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it('derives registry expiry from a later confirmed block instead of the preflight block', async () => {
    const { context } = fixture({ commitmentAt: 900n, confirmedNow: 1005n, now: 1000n })
    await expect(revealParentName(context)).resolves.toMatchObject({ owner, status: 'registered' })
  })

  it('uses a higher current price for reveal shortfalls', async () => {
    const { context, writes } = fixture({
      allowance: 120n,
      balance: 120n,
      commitmentAt: 900n,
      price: [150n, 30n],
      registerFields: { base: 150n, premium: 30n },
    })
    await revealParentName(context)
    expect(writes.slice(0, 2)).toStrictEqual([
      { args: [owner, 60n], functionName: 'mint' },
      { args: [contracts.ETHRegistrar, 180n], functionName: 'approve' },
    ])
  })

  it('stops if the name becomes unavailable before reveal', async () => {
    const { calls, context, writes } = fixture({ commitmentAt: 900n, secondAvailable: false })
    await expect(revealParentName(context)).rejects.toThrow('unavailable')
    expect(calls).not.toContain('getRegisterPrice')
    expect(writes).toStrictEqual([])
  })

  it('does not report registration when the confirmed registry owner differs', async () => {
    const { context } = fixture({ commitmentAt: 900n, postOwner: other })
    await expect(revealParentName(context)).rejects.toThrow('owner')
  })

  it('does not report registration when the final owner read fails', async () => {
    const { context } = fixture({ commitmentAt: 900n, failPostOwner: true })
    await expect(revealParentName(context)).rejects.toMatchObject({ message: 'getOwner: read failed' })
  })

  it('redacts a latest block read failure before sending', async () => {
    const { context, writes } = fixture({ failBlock: 'latest' })
    await expect(commitParentName(context)).rejects.toMatchObject({ message: 'getBlock: read failed' })
    expect(writes).toStrictEqual([])
  })

  it('does not report registration if its confirmed block cannot be read', async () => {
    const { context } = fixture({ commitmentAt: 900n, failBlock: 'confirmed' })
    await expect(revealParentName(context)).rejects.toMatchObject({ message: 'register: transaction failed' })
  })

  it('does not send an approval whose simulation returns false', async () => {
    const { calls, context, writes } = fixture({ approvalResult: false })
    await expect(commitParentName(context)).rejects.toMatchObject({ message: 'approve: transaction failed' })
    expect(calls.at(-1)).toBe('simulate:approve')
    expect(writes).toStrictEqual([{ args: [owner, 90n], functionName: 'mint' }])
  })

  it.each([{ from: other }, { to: other }, { value: 89n }])(
    'validates mint fields %s',
    async (tokenFields) => {
      const { context, writes } = fixture({ tokenFields })
      await expect(commitParentName(context)).rejects.toMatchObject({ message: 'mint: transaction failed' })
      expect(writes).toStrictEqual([{ args: [owner, 90n], functionName: 'mint' }])
    },
  )

  it.each([{ owner: other }, { spender: other }, { value: 119n }])(
    'validates approval fields %s',
    async (tokenFields) => {
      const { context, writes } = fixture({ balance: 120n, tokenFields })
      await expect(commitParentName(context)).rejects.toMatchObject({
        message: 'approve: transaction failed',
      })
      expect(writes).toStrictEqual([{ args: [contracts.ETHRegistrar, 120n], functionName: 'approve' }])
    },
  )

  it.each([commitParentName, revealParentName])(
    'rejects a loaded account that differs from public configuration for %s',
    async (run) => {
      const { calls, context, writes } = fixture()
      context.config.parentAddress = other
      await expect(run(context)).rejects.toThrow('ENS_PARENT_ADDRESS')
      expect(calls.at(-1)).toBe('load')
      expect(writes).toStrictEqual([])
    },
  )

  it('does not accept a registry expiry that differs from the confirmed block plus duration', async () => {
    const { context } = fixture({ commitmentAt: 900n, registryFields: { expiry: 31_536_999n } })
    await expect(revealParentName(context)).rejects.toMatchObject({ message: 'register: transaction failed' })
  })

  it.each(['makeCommitment', 'commitmentAt', 'getRegisterPrice', 'allowance'])(
    'redacts provider read failures in %s',
    async (failRead) => {
      const { context, writes } = fixture({ failRead })
      await expect(commitParentName(context)).rejects.toThrow(`${failRead}: read failed`)
      expect(writes).toStrictEqual([])
    },
  )

  it.each(
    (['mint', 'approve', 'commit', 'register'] as const).flatMap((failOperation) =>
      (['simulate', 'send', 'wait', 'reverted', 'missing', 'emitter', 'fields', 'malformed'] as const).map(
        (fail) => ({ fail, failOperation }),
      ),
    ),
  )('stops at $failOperation $fail and redacts the error', async ({ fail, failOperation }) => {
    const { calls, context, writes } = fixture({
      commitmentAt: failOperation === 'register' ? 900n : 0n,
      fail,
      failOperation,
    })
    const run = failOperation === 'register' ? revealParentName : commitParentName
    await expect(run(context)).rejects.toMatchObject({ message: `${failOperation}: transaction failed` })
    const preceding = {
      approve: ['mint'],
      commit: ['mint', 'approve'],
      mint: [],
      register: ['mint', 'approve'],
    }
    const stages = {
      emitter: ['simulate', 'send', 'wait'],
      fields: ['simulate', 'send', 'wait'],
      malformed: ['simulate', 'send', 'wait'],
      missing: ['simulate', 'send', 'wait'],
      reverted: ['simulate', 'send', 'wait'],
      send: ['simulate', 'send'],
      simulate: ['simulate'],
      wait: ['simulate', 'send', 'wait'],
    }
    const expectedCalls = [
      ...preceding[failOperation].flatMap((name) => [`simulate:${name}`, `send:${name}`, `wait:${name}`]),
      ...stages[fail].map((stage) => `${stage}:${failOperation}`),
    ]
    expect(calls.filter((call) => call.includes(':'))).toStrictEqual(expectedCalls)
    const sent = fail === 'simulate' || fail === 'send' ? [] : [failOperation]
    expect(writes.map((write) => write.functionName)).toStrictEqual([...preceding[failOperation], ...sent])
  })

  it.each([
    { missingRegistryEvent: true },
    { registryEmitter: other },
    { registryFields: { owner: other } },
    { registryFields: { label: 'wrong' } },
    { registryFields: { labelHash: zeroHash } },
    { registryFields: { sender: other } },
    { registryFields: { tokenId: 124n } },
  ] satisfies Scenario[])('requires the matching ETH Registry event: %s', async (scenario) => {
    const { context } = fixture({ ...scenario, commitmentAt: 900n })
    await expect(revealParentName(context)).rejects.toThrow('register: transaction failed')
  })

  it.each([
    { owner: other },
    { label: 'wrong' },
    { tokenId: 124n },
    { subregistry: other },
    { resolver: other },
    { duration: 1n },
    { paymentToken: other },
    { referrer: commitment },
    { base: 99n },
    { premium: 19n },
  ])('validates all NameRegistered fields: %s', async (registerFields) => {
    const { context } = fixture({ commitmentAt: 900n, registerFields })
    await expect(revealParentName(context)).rejects.toThrow('register: transaction failed')
  })
})
