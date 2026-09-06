import { isAddressEqual, labelhash, parseEventLogs, zeroAddress, zeroHash } from 'viem'
import type { Address, Hash, PublicClient, WalletClient } from 'viem'

import {
  ENS_HACKATHON_CONTRACTS,
  ETH_REGISTRAR_ABI,
  ETH_REGISTRY_ABI,
  MOCK_USDC_ABI,
  USER_REGISTRY_ABI,
} from '../index.ts'
import type { PublicConfig, readParentMutationConfig } from './config.ts'
import { runPreflight } from './preflight.ts'
import { simulateSendAndConfirm } from './transaction.ts'

interface Mutation {
  config: ReturnType<typeof readParentMutationConfig>
  walletClient: Pick<WalletClient, 'writeContract'>
}
export interface ParentContext {
  config: PublicConfig
  loadMutation: () => Mutation
  publicClient: Pick<
    PublicClient,
    | 'chain'
    | 'getChainId'
    | 'getCode'
    | 'readContract'
    | 'getBlock'
    | 'simulateContract'
    | 'waitForTransactionReceipt'
  >
}
interface PublicTransaction {
  hash: Hash
  operation: 'mint' | 'approve' | 'commit' | 'register'
}
const contracts = ENS_HACKATHON_CONTRACTS

const read = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation()
  } catch {
    // Viem errors may contain RPC credentials and makeCommitment's secret argument.
    throw new Error(`${name}: read failed`)
  }
}

const transaction = async <T>(
  name: PublicTransaction['operation'],
  operation: () => Promise<T>,
): Promise<T> => {
  try {
    return await operation()
  } catch {
    // Simulation and wallet errors may embed the secret, key, or signed transaction.
    throw new Error(`${name}: transaction failed`)
  }
}

const prepare = async (context: ParentContext) => {
  const report = await runPreflight(context.publicClient, context.config)
  if (report.parent.state === 'owned') {
    return { owner: report.parent.owner, status: 'already-complete' } as const
  }
  const mutation = context.loadMutation()
  const { parentAccount, parentDuration, commitmentSecret } = mutation.config
  if (
    context.config.parentAddress !== undefined &&
    !isAddressEqual(parentAccount.address, context.config.parentAddress)
  ) {
    throw new Error('ENS_PARENT_ADDRESS: does not match mutation account')
  }
  const registration = {
    duration: parentDuration,
    label: context.config.parentLabel,
    owner: parentAccount.address,
    paymentToken: contracts.MockUSDC,
    referrer: zeroHash,
    resolver: zeroAddress,
    secret: commitmentSecret,
    subregistry: zeroAddress,
  } as const
  const { publicClient } = context
  const commitment = await read(
    'makeCommitment',
    async () =>
      await publicClient.readContract({
        abi: ETH_REGISTRAR_ABI,
        address: contracts.ETHRegistrar,
        args: [
          registration.label,
          registration.owner,
          registration.secret,
          registration.subregistry,
          registration.resolver,
          registration.duration,
          registration.referrer,
        ],
        functionName: 'makeCommitment',
      }),
  )
  const commitmentAt = await read(
    'commitmentAt',
    async () =>
      await publicClient.readContract({
        abi: ETH_REGISTRAR_ABI,
        address: contracts.ETHRegistrar,
        args: [commitment],
        functionName: 'commitmentAt',
      }),
  )
  const { timestamp: now } = await read(
    'getBlock',
    async () => await publicClient.getBlock({ blockTag: 'latest' }),
  )
  const minAge = await read(
    'MIN_COMMITMENT_AGE',
    async () =>
      await publicClient.readContract({
        abi: ETH_REGISTRAR_ABI,
        address: contracts.ETHRegistrar,
        functionName: 'MIN_COMMITMENT_AGE',
      }),
  )
  const maxAge = await read(
    'MAX_COMMITMENT_AGE',
    async () =>
      await publicClient.readContract({
        abi: ETH_REGISTRAR_ABI,
        address: contracts.ETHRegistrar,
        functionName: 'MAX_COMMITMENT_AGE',
      }),
  )
  if (commitmentAt > now) {
    throw new Error('commitment timestamp is in the future')
  }
  return { commitment, commitmentAt, maxAge, minAge, mutation, now, registration, status: 'pending' } as const
}
type Pending = Extract<Awaited<ReturnType<typeof prepare>>, { status: 'pending' }>

const ensurePayment = async (context: ParentContext, pending: Pending, transactions: PublicTransaction[]) => {
  const { publicClient } = context
  const { mutation, registration } = pending
  const { parentAccount: account } = mutation.config
  const { walletClient } = mutation
  const [base, premium] = await read(
    'getRegisterPrice',
    async () =>
      await publicClient.readContract({
        abi: ETH_REGISTRAR_ABI,
        address: contracts.ETHRegistrar,
        args: [registration.label, registration.duration, registration.paymentToken],
        functionName: 'getRegisterPrice',
      }),
  )
  const price = base + premium
  const balance = await read(
    'balanceOf',
    async () =>
      await publicClient.readContract({
        abi: MOCK_USDC_ABI,
        address: contracts.MockUSDC,
        args: [account.address],
        functionName: 'balanceOf',
      }),
  )
  const allowance = await read(
    'allowance',
    async () =>
      await publicClient.readContract({
        abi: MOCK_USDC_ABI,
        address: contracts.MockUSDC,
        args: [account.address, contracts.ETHRegistrar],
        functionName: 'allowance',
      }),
  )
  if (balance < price) {
    const amount = price - balance
    const { hash } = await transaction(
      'mint',
      async () =>
        await simulateSendAndConfirm({
          assertReceipt: (receipt) => {
            const valid = parseEventLogs({
              abi: MOCK_USDC_ABI,
              eventName: 'Transfer',
              logs: receipt.logs,
              strict: true,
            }).some(
              (log) =>
                isAddressEqual(log.address, contracts.MockUSDC) &&
                isAddressEqual(log.args.from, zeroAddress) &&
                isAddressEqual(log.args.to, account.address) &&
                log.args.value === amount,
            )
            if (!valid) {
              throw new Error('missing mint Transfer')
            }
          },
          send: async (request) => await walletClient.writeContract(request),
          simulate: async () =>
            await publicClient.simulateContract({
              abi: MOCK_USDC_ABI,
              account,
              address: contracts.MockUSDC,
              args: [account.address, amount],
              functionName: 'mint',
            }),
          wait: async (transactionHash) =>
            await publicClient.waitForTransactionReceipt({ hash: transactionHash }),
        }),
    )
    transactions.push({ hash, operation: 'mint' })
  }
  if (allowance < price) {
    // approve replaces the current allowance, so authorize exactly the total price.
    const { hash } = await transaction(
      'approve',
      async () =>
        await simulateSendAndConfirm({
          assertReceipt: (receipt) => {
            const valid = parseEventLogs({
              abi: MOCK_USDC_ABI,
              eventName: 'Approval',
              logs: receipt.logs,
              strict: true,
            }).some(
              (log) =>
                isAddressEqual(log.address, contracts.MockUSDC) &&
                isAddressEqual(log.args.owner, account.address) &&
                isAddressEqual(log.args.spender, contracts.ETHRegistrar) &&
                log.args.value === price,
            )
            if (!valid) {
              throw new Error('missing token Approval')
            }
          },
          send: async (request) => await walletClient.writeContract(request),
          simulate: async () => {
            const simulation = await publicClient.simulateContract({
              abi: MOCK_USDC_ABI,
              account,
              address: contracts.MockUSDC,
              args: [contracts.ETHRegistrar, price],
              functionName: 'approve',
            })
            if (!simulation.result) {
              throw new Error('token approval returned false')
            }
            return simulation
          },
          wait: async (transactionHash) =>
            await publicClient.waitForTransactionReceipt({ hash: transactionHash }),
        }),
    )
    transactions.push({ hash, operation: 'approve' })
  }
  return { base, premium }
}

export const commitParentName = async (context: ParentContext) => {
  const pending = await prepare(context)
  if (pending.status === 'already-complete') {
    return pending
  }
  const { commitment, commitmentAt, maxAge, minAge, mutation, now, registration } = pending
  if (commitmentAt !== 0n && now - commitmentAt <= maxAge) {
    return {
      commitmentAt: commitmentAt.toString(),
      expiresAt: (commitmentAt + maxAge).toString(),
      owner: registration.owner,
      readyAt: (commitmentAt + minAge).toString(),
      status: 'already-committed',
    } as const
  }
  const transactions: PublicTransaction[] = []
  await ensurePayment(context, pending, transactions)
  const { publicClient } = context
  const { hash } = await transaction(
    'commit',
    async () =>
      await simulateSendAndConfirm({
        assertReceipt: (receipt) => {
          const valid = parseEventLogs({
            abi: ETH_REGISTRAR_ABI,
            eventName: 'CommitmentMade',
            logs: receipt.logs,
            strict: true,
          }).some(
            (log) =>
              isAddressEqual(log.address, contracts.ETHRegistrar) && log.args.commitment === commitment,
          )
          if (!valid) {
            throw new Error('missing CommitmentMade')
          }
        },
        send: async (request) => await mutation.walletClient.writeContract(request),
        simulate: async () =>
          await publicClient.simulateContract({
            abi: ETH_REGISTRAR_ABI,
            account: mutation.config.parentAccount,
            address: contracts.ETHRegistrar,
            args: [commitment],
            functionName: 'commit',
          }),
        wait: async (transactionHash) =>
          await publicClient.waitForTransactionReceipt({ hash: transactionHash }),
      }),
  )
  transactions.push({ hash, operation: 'commit' })
  return { owner: registration.owner, status: 'committed', transactions } as const
}

export const revealParentName = async (context: ParentContext) => {
  const pending = await prepare(context)
  if (pending.status === 'already-complete') {
    return pending
  }
  const { commitmentAt, maxAge, minAge, mutation, now, registration } = pending
  if (commitmentAt === 0n) {
    throw new Error('commitment missing; submit a commit first')
  }
  const age = now - commitmentAt
  if (age < minAge) {
    throw new Error(`commitment is ${minAge - age}s too young`)
  }
  if (age > maxAge) {
    throw new Error('commitment expired; submit a new commit')
  }
  const { publicClient } = context
  const available = await read(
    'isAvailable',
    async () =>
      await publicClient.readContract({
        abi: ETH_REGISTRAR_ABI,
        address: contracts.ETHRegistrar,
        args: [registration.label],
        functionName: 'isAvailable',
      }),
  )
  if (!available) {
    throw new Error('fuda: unavailable before reveal')
  }
  const transactions: PublicTransaction[] = []
  const price = await ensurePayment(context, pending, transactions)
  let simulatedTokenId: bigint | undefined
  const { hash } = await transaction(
    'register',
    async () =>
      await simulateSendAndConfirm({
        assertReceipt: async (receipt) => {
          const nameRegistered = parseEventLogs({
            abi: ETH_REGISTRAR_ABI,
            eventName: 'NameRegistered',
            logs: receipt.logs,
            strict: true,
          }).some(
            (log) =>
              isAddressEqual(log.address, contracts.ETHRegistrar) &&
              log.args.tokenId === simulatedTokenId &&
              log.args.label === registration.label &&
              isAddressEqual(log.args.owner, registration.owner) &&
              isAddressEqual(log.args.subregistry, registration.subregistry) &&
              isAddressEqual(log.args.resolver, registration.resolver) &&
              log.args.duration === registration.duration &&
              isAddressEqual(log.args.paymentToken, registration.paymentToken) &&
              log.args.referrer === registration.referrer &&
              log.args.base === price.base &&
              log.args.premium === price.premium,
          )
          const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber })
          const labelRegistered = parseEventLogs({
            abi: USER_REGISTRY_ABI,
            eventName: 'LabelRegistered',
            logs: receipt.logs,
            strict: true,
          }).some(
            (log) =>
              isAddressEqual(log.address, contracts.ETHRegistry) &&
              log.args.tokenId === simulatedTokenId &&
              log.args.labelHash === labelhash(registration.label) &&
              log.args.label === registration.label &&
              log.args.expiry === block.timestamp + registration.duration &&
              isAddressEqual(log.args.owner, registration.owner) &&
              isAddressEqual(log.args.sender, contracts.ETHRegistrar),
          )
          if (!nameRegistered || !labelRegistered) {
            throw new Error('missing registration events')
          }
        },
        send: async (request) => await mutation.walletClient.writeContract(request),
        simulate: async () => {
          const simulation = await publicClient.simulateContract({
            abi: ETH_REGISTRAR_ABI,
            account: mutation.config.parentAccount,
            address: contracts.ETHRegistrar,
            args: [
              registration.label,
              registration.owner,
              registration.secret,
              registration.subregistry,
              registration.resolver,
              registration.duration,
              registration.paymentToken,
              registration.referrer,
            ],
            functionName: 'register',
          })
          simulatedTokenId = simulation.result
          return simulation
        },
        wait: async (transactionHash) =>
          await publicClient.waitForTransactionReceipt({ hash: transactionHash }),
      }),
  )
  const owner: Address = await read(
    'getOwner',
    async () =>
      await publicClient.readContract({
        abi: ETH_REGISTRY_ABI,
        address: contracts.ETHRegistry,
        args: [BigInt(labelhash(registration.label))],
        functionName: 'getOwner',
      }),
  )
  if (!isAddressEqual(owner, registration.owner)) {
    throw new Error('fuda: confirmed owner mismatch')
  }
  transactions.push({ hash, operation: 'register' })
  return { owner, status: 'registered', transactions } as const
}
