import { createPublicClient, createWalletClient, http, isHex, parseEventLogs } from 'viem'
import type { Hex } from 'viem'
import { nonceManager, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

import { EAS_ABI, FACTORY_ABI } from '../eas/abi.ts'
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

export const createViemChain = (env: Bindings): ChainClient => {
  const transport = http(env.BASE_RPC_URL ?? DEFAULT_RPC)
  const publicClient = createPublicClient({ chain: baseSepolia, transport })
  const eas = toHexAddress(env.EAS_ADDRESS)
  const factory = toHexAddress(env.FACTORY_ADDRESS)
  const key = env.SIGNER_PRIVATE_KEY
  // One account with viem's nonce manager: /issue attests, announces (Plan 4) and
  // waitUntil Attendance attests (Plan 2) share this signer concurrently.
  const account = key !== undefined && isHex(key) ? privateKeyToAccount(key, { nonceManager }) : null
  const wallet = account === null ? null : createWalletClient({ account, chain: baseSepolia, transport })

  return {
    attest: (p: AttestParams) => {
      if (wallet === null || account === null) {
        return Promise.reject(new NoSignerError('SIGNER_PRIVATE_KEY unset'))
      }
      return wrap(async () => {
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

    getAddressFromFactory: (owners, nonce) =>
      wrap(() =>
        publicClient.readContract({
          abi: FACTORY_ABI,
          address: factory,
          args: [owners, nonce],
          functionName: 'getAddress',
        }),
      ),

    readAttestation: (uid) =>
      wrap(async () => {
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

    revoke: (schema, uid) => {
      if (wallet === null || account === null) {
        return Promise.reject(new NoSignerError('SIGNER_PRIVATE_KEY unset'))
      }
      return wrap(async () => {
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
  }
}
