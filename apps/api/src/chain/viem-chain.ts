import { parseChainConfig } from '@fuda/chains'
import {
  BaseError,
  createPublicClient,
  createWalletClient,
  ExecutionRevertedError,
  fallback,
  http,
  HttpRequestError,
  isHex,
  parseEventLogs,
  RpcRequestError,
  shouldThrow,
  TimeoutError,
} from 'viem'
import type { Hex, HttpTransportConfig, Transport } from 'viem'
import { nonceManager, privateKeyToAccount } from 'viem/accounts'

import { EAS_ABI, FACTORY_ABI } from '../eas/abi.ts'
import type { Bindings } from '../env.ts'
import { ChainError, NoSignerError } from './client.ts'
import type { AttestParams, ChainClient } from './client.ts'
import { UnknownTransactionOutcomeError } from './unknown-transaction-outcome-error.ts'

const DEFAULT_RPC = parseChainConfig().publicRpc
const RPC_TIMEOUT_MS = 1000

export const createChainTransport = (primary = DEFAULT_RPC, secondary = DEFAULT_RPC): Transport => {
  const options = {
    // viem's timeout ends at response headers. Keep a deadline through body reads.
    onFetchRequest: (request, init) => ({
      ...init,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(RPC_TIMEOUT_MS)]),
    }),
    retryCount: 0,
    timeout: RPC_TIMEOUT_MS,
  } satisfies HttpTransportConfig
  const first = http(primary, options)
  return primary === secondary
    ? first
    : fallback([first, http(secondary, options)], {
        rank: false,
        retryCount: 0,
        shouldThrow: (error) =>
          ('code' in error && error.code === ExecutionRevertedError.code) || shouldThrow(error),
      })
}

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
    if (error instanceof ChainError) {
      throw error
    }
    // viem messages and causes contain the RPC URL, including provider API keys.
    throw new ChainError(error instanceof BaseError ? error.name : 'Chain request failed')
  }
}

// The chain client is also used by read-only Node probes. It needs no D1 or
// Worker bindings beyond the addresses and credentials consumed here.
type ChainBindings = Pick<
  Bindings,
  'BASE_RPC_URL' | 'CHAIN_ID' | 'EAS_ADDRESS' | 'FACTORY_ADDRESS' | 'SIGNER_PRIVATE_KEY'
>

export const createViemChain = (env: ChainBindings, transportOverride?: Transport): ChainClient => {
  const config = parseChainConfig(env.CHAIN_ID)
  const chain = config.viemChain
  const transport =
    transportOverride ?? createChainTransport(env.BASE_RPC_URL ?? config.publicRpc, config.publicRpc)
  const publicClient = createPublicClient({ chain, transport })
  const eas = toHexAddress(env.EAS_ADDRESS)
  const factory = toHexAddress(env.FACTORY_ADDRESS)
  const key = env.SIGNER_PRIVATE_KEY
  // One account with viem's nonce manager: /issue attests and the
  // waitUntil Attendance attest all share this signer concurrently.
  const account = key !== undefined && isHex(key) ? privateKeyToAccount(key, { nonceManager }) : null
  const wallet = account === null ? null : createWalletClient({ account, chain, transport })

  return {
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
          chain,
          functionName: 'attest',
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash }).catch(() => {
          throw new UnknownTransactionOutcomeError(txHash)
        })
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

    chainId: () => config.id,

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

    offchainAttester: () => account?.address ?? null,

    offchainRevokedAt: async (revoker, uid) =>
      await wrap(
        async () =>
          await publicClient.readContract({
            abi: EAS_ABI,
            address: eas,
            args: [revoker, uid],
            functionName: 'getRevokeOffchain',
          }),
      ),

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
          chain,
          functionName: 'revoke',
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        if (receipt.status !== 'success') {
          throw new ChainError('revoke reverted')
        }
        return { txHash }
      })
    },

    revokeOffchain: async (uid) => {
      if (wallet === null || account === null) {
        throw new NoSignerError('SIGNER_PRIVATE_KEY unset')
      }
      return await wrap(async () => {
        const txHash = await wallet.writeContract({
          abi: EAS_ABI,
          account,
          address: eas,
          args: [uid],
          chain,
          functionName: 'revokeOffchain',
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        if (receipt.status !== 'success') {
          throw new ChainError('revokeOffchain reverted')
        }
        return { txHash }
      })
    },

    rootTimestamp: async (root) =>
      await wrap(
        async () =>
          await publicClient.readContract({
            abi: EAS_ABI,
            address: eas,
            args: [root],
            functionName: 'getTimestamp',
          }),
      ),

    signOffchain: async (typed) => {
      if (account === null) {
        throw new NoSignerError('SIGNER_PRIVATE_KEY unset')
      }
      return await account.signTypedData(typed)
    },

    signerAddress: () => account?.address ?? null,

    timestamp: async (root) => {
      if (wallet === null || account === null) {
        throw new NoSignerError('SIGNER_PRIVATE_KEY unset')
      }
      return await wrap(async () => {
        const txHash = await wallet.writeContract({
          abi: EAS_ABI,
          account,
          address: eas,
          args: [root],
          chain,
          functionName: 'timestamp',
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        if (receipt.status !== 'success') {
          throw new ChainError('timestamp reverted')
        }
        return { txHash }
      })
    },

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
        // as BAD_SIGNATURE if both providers fail. This branch is for clients that throw:
        // FakeChain.failReads, or a future viem version or verification mode that stops
        // swallowing — and when it fires it is the fail-closed 502 path. Anything else
        // is a signature that does not verify (malformed bytes, wrong length).
        if (
          error instanceof HttpRequestError ||
          error instanceof TimeoutError ||
          error instanceof RpcRequestError
        ) {
          throw new ChainError(error.name)
        }
        return false
      }
    },
  }
}
