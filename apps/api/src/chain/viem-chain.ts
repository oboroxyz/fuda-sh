import {
  createPublicClient,
  createWalletClient,
  http,
  HttpRequestError,
  isHex,
  parseEventLogs,
  RpcRequestError,
  TimeoutError,
} from 'viem'
import type { Hex, Transport } from 'viem'
import { nonceManager, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

import { ANNOUNCER_ABI, EAS_ABI, FACTORY_ABI } from '../eas/abi.ts'
import type { Bindings } from '../env.ts'
import { ChainError, NoSignerError } from './client.ts'
import type { AttestParams, ChainClient } from './client.ts'

export const DEFAULT_RPC = 'https://sepolia.base.org'

const toHexAddress = (s: string): Hex => {
  if (!isHex(s)) {
    throw new ChainError(`bad address in config: ${s}`)
  }
  return s
}

const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn()
  } catch (error) {
    throw new ChainError(error instanceof Error ? error.message : String(error))
  }
}

// The chain client is also used by read-only Node probes. It needs no D1 or
// Worker bindings beyond the addresses and credentials consumed here.
type ChainBindings = Pick<
  Bindings,
  'ANNOUNCER_ADDRESS' | 'BASE_RPC_URL' | 'EAS_ADDRESS' | 'FACTORY_ADDRESS' | 'SIGNER_PRIVATE_KEY'
>

export const createViemChain = (
  env: ChainBindings,
  transport: Transport = http(env.BASE_RPC_URL ?? DEFAULT_RPC),
): ChainClient => {
  const publicClient = createPublicClient({ chain: baseSepolia, transport })
  const eas = toHexAddress(env.EAS_ADDRESS)
  const factory = toHexAddress(env.FACTORY_ADDRESS)
  const announcer = toHexAddress(env.ANNOUNCER_ADDRESS)
  const key = env.SIGNER_PRIVATE_KEY
  // One account with viem's nonce manager: /issue attests, announces and the
  // waitUntil Attendance attest all share this signer concurrently.
  const account = key !== undefined && isHex(key) ? privateKeyToAccount(key, { nonceManager }) : null
  const wallet = account === null ? null : createWalletClient({ account, chain: baseSepolia, transport })

  return {
    announce: async (p) => {
      if (wallet === null || account === null) {
        throw new NoSignerError('SIGNER_PRIVATE_KEY unset')
      }
      return await wrap(async () => {
        const txHash = await wallet.writeContract({
          abi: ANNOUNCER_ABI,
          account,
          address: announcer,
          args: [1n, p.stealthAddress, p.ephemeralPubKey, p.metadata],
          chain: baseSepolia,
          functionName: 'announce',
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        if (receipt.status !== 'success') {
          throw new ChainError('announce reverted')
        }
        return { txHash }
      })
    },

    attest: async (p: AttestParams) => {
      if (wallet === null || account === null) {
        throw new NoSignerError('SIGNER_PRIVATE_KEY unset')
      }
      return await wrap(async () => {
        const txHash = await wallet.writeContract({
          abi: EAS_ABI,
          account,
          address: eas,
          args: [
            {
              data: {
                data: p.data,
                expirationTime: p.expirationTime,
                recipient: p.recipient,
                refUID: p.refUID,
                revocable: p.revocable,
                value: 0n,
              },
              schema: p.schema,
            },
          ],
          chain: baseSepolia,
          functionName: 'attest',
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        if (receipt.status !== 'success') {
          throw new ChainError('attest reverted')
        }
        const [log] = parseEventLogs({ abi: EAS_ABI, eventName: 'Attested', logs: receipt.logs })
        if (log === undefined) {
          throw new ChainError('no Attested event in receipt')
        }
        return { txHash, uid: log.args.uid }
      })
    },

    blockNumber: async () => await wrap(async () => Number(await publicClient.getBlockNumber())),

    getAddressFromFactory: async (owners, nonce) =>
      await wrap(
        async () =>
          await publicClient.readContract({
            abi: FACTORY_ABI,
            address: factory,
            args: [owners, nonce],
            functionName: 'getAddress',
          }),
      ),

    getAnnouncementLogs: async (fromBlock, toBlock) =>
      await wrap(async () => {
        // `strict` makes viem drop any log it cannot fully decode, so every arg below is
        // present rather than `| undefined`.
        const logs = await publicClient.getContractEvents({
          abi: ANNOUNCER_ABI,
          address: announcer,
          args: { schemeId: 1n },
          eventName: 'Announcement',
          fromBlock: BigInt(fromBlock),
          strict: true,
          toBlock: BigInt(toBlock),
        })
        return logs.map((log) => ({
          blockNumber: Number(log.blockNumber),
          caller: log.args.caller,
          ephemeralPubKey: log.args.ephemeralPubKey,
          logIndex: log.logIndex,
          metadata: log.args.metadata,
          schemeId: Number(log.args.schemeId),
          stealthAddress: log.args.stealthAddress,
          txHash: log.transactionHash,
        }))
      }),

    readAttestation: async (uid) =>
      await wrap(async () => {
        const a = await publicClient.readContract({
          abi: EAS_ABI,
          address: eas,
          args: [uid],
          functionName: 'getAttestation',
        })
        return {
          attester: a.attester,
          data: a.data,
          expirationTime: a.expirationTime,
          recipient: a.recipient,
          refUID: a.refUID,
          revocable: a.revocable,
          revocationTime: a.revocationTime,
          schema: a.schema,
          time: a.time,
          uid: a.uid,
        }
      }),

    revoke: async (schema, uid) => {
      if (wallet === null || account === null) {
        throw new NoSignerError('SIGNER_PRIVATE_KEY unset')
      }
      return await wrap(async () => {
        const txHash = await wallet.writeContract({
          abi: EAS_ABI,
          account,
          address: eas,
          args: [{ data: { uid, value: 0n }, schema }],
          chain: baseSepolia,
          functionName: 'revoke',
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        if (receipt.status !== 'success') {
          throw new ChainError('revoke reverted')
        }
        return { txHash }
      })
    },

    signerAddress: () => account?.address ?? null,

    verifyMessage: async (p) => {
      try {
        return await publicClient.verifyMessage({
          address: p.address,
          message: p.message,
          signature: p.signature,
        })
      } catch (error) {
        // viem 2.56.3's action folds transport failures into the boolean: verifyHash
        // wraps an RPC error from the ERC-6492 deployless call into CallExecutionError,
        // catches it, retries a pure ECDSA recover and returns that (true for a valid
        // EOA signature, otherwise false). So in production an outage currently reads
        // as BAD_SIGNATURE, not 502. This branch is for clients that do throw —
        // FakeChain.failReads, or a future viem version or verification mode that stops
        // swallowing — and when it fires it is the fail-closed 502 path. Anything else
        // is a signature that does not verify (malformed bytes, wrong length).
        if (
          error instanceof HttpRequestError ||
          error instanceof TimeoutError ||
          error instanceof RpcRequestError
        ) {
          throw new ChainError(error.message)
        }
        return false
      }
    },
  }
}
