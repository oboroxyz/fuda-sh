import { claimVoucherTypedData, ENS_HACKATHON_CHAIN, FUDA_REGISTRAR_ABI } from '@fuda/ens-contracts'
import { asHex } from '@fuda/sdk'
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  isAddress,
  isAddressEqual,
  isHex,
  keccak256,
  toHex,
} from 'viem'
import type { Address, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { isIssuerHandle } from './names.ts'

// How long a signed voucher stays usable. Long enough for a wallet prompt and a
// sponsored submission, short enough that an abandoned claim does not leave a
// live authorization lying around.
export const VOUCHER_TTL_SECONDS = 15 * 60
// An issuer name is registered for a year. Renewal exists on the registrar and
// keeps the same owner (docs/specs/ens-naming.md#issuer-claim-and-renewal).
export const CLAIM_TERM_SECONDS = 365 * 24 * 60 * 60

export interface ClaimConfig {
  gasPolicyId: string
  parentName: string
  paymasterUpstream: string
  registrar: Address
  rpcUrl: string
  voucherKey: Hex
  voucherSigner: Address
}

interface ClaimEnv {
  ENS_GAS_POLICY_ID?: string
  ENS_PARENT_NAME?: string
  ENS_PAYMASTER_UPSTREAM?: string
  ENS_REGISTRAR_ADDRESS?: string
  ENS_SEPOLIA_RPC_URL?: string
  ENS_VOUCHER_KEY?: string
}

const present = (value: string | undefined): value is string => value !== undefined && value !== ''

// Every claim route is off until the whole set is configured and well-formed. A
// deployment with a malformed registrar address or voucher key must not sign
// half a claim, so this parses both here and returns null rather than a config
// with holes; the routes then answer 503.
export const claimConfigFrom = (env: ClaimEnv): ClaimConfig | null => {
  const {
    ENS_GAS_POLICY_ID: gasPolicyId,
    ENS_PARENT_NAME: parentName,
    ENS_PAYMASTER_UPSTREAM: paymasterUpstream,
    ENS_REGISTRAR_ADDRESS: registrarBinding,
    ENS_SEPOLIA_RPC_URL: rpcUrl,
    ENS_VOUCHER_KEY: voucherBinding,
  } = env
  if (
    !present(gasPolicyId) ||
    !present(parentName) ||
    !present(paymasterUpstream) ||
    !present(registrarBinding) ||
    !present(rpcUrl) ||
    !present(voucherBinding)
  ) {
    return null
  }
  const registrarHex = asHex(registrarBinding, 20)
  const voucherKey = asHex(voucherBinding, 32)
  if (registrarHex === null || voucherKey === null) {
    return null
  }
  const registrar = getAddress(registrarHex)
  let voucherSigner: Address
  try {
    voucherSigner = privateKeyToAccount(voucherKey).address
  } catch {
    return null
  }
  return {
    gasPolicyId,
    parentName,
    paymasterUpstream,
    registrar,
    rpcUrl,
    voucherKey,
    voucherSigner,
  }
}

export const sepoliaClient = (config: ClaimConfig) =>
  createPublicClient({ chain: ENS_HACKATHON_CHAIN, transport: http(config.rpcUrl) })

// The registrar counts vouchers per issuer and rejects any nonce but the next
// one, so a voucher is single-use whoever submits it.
export const readClaimNonce = async (config: ClaimConfig, issuer: Address): Promise<bigint> =>
  await sepoliaClient(config).readContract({
    abi: FUDA_REGISTRAR_ABI,
    address: config.registrar,
    args: [issuer],
    functionName: 'nonces',
  })

export interface SignedVoucher {
  deadline: number
  expiry: number
  issuer: Address
  label: string
  nonce: string
  registrar: Address
  signature: Hex
}

export interface VoucherInput {
  handle: string
  issuer: Address
  nonce: bigint
  now: number
}

// fuda's signature is the entire authorization the registrar checks, so it binds
// the label, the address the name will belong to, and the window in which it may
// be used. The sender is not part of it: a venue owner holds no gas on this
// chain, so the transaction is sponsored or relayed.
export const signClaimVoucher = async (config: ClaimConfig, input: VoucherInput): Promise<SignedVoucher> => {
  if (!isIssuerHandle(input.handle)) {
    throw new Error('invalid issuer handle')
  }
  const deadline = input.now + VOUCHER_TTL_SECONDS
  const expiry = input.now + CLAIM_TERM_SECONDS
  const signature = await privateKeyToAccount(config.voucherKey).signTypedData(
    claimVoucherTypedData({
      deadline: BigInt(deadline),
      expiry: BigInt(expiry),
      issuer: input.issuer,
      labelHash: keccak256(toHex(input.handle)),
      nonce: input.nonce,
      registrar: config.registrar,
    }),
  )
  return {
    deadline,
    expiry,
    issuer: input.issuer,
    label: input.handle,
    nonce: input.nonce.toString(),
    registrar: config.registrar,
    signature,
  }
}

interface ReceiptLog {
  address: string
  data: string
  topics: readonly string[]
}

export interface ClaimExpectation {
  handle: string
  issuer: Address
  registrar: Address
}

// A claim is recorded only when the chain says so. The receipt must carry the
// configured registrar's own `IssuerClaimed` for this exact label and issuer;
// anything else — another contract, another venue's name, a claim that landed on
// a different address — leaves the row pending rather than recording a claim
// that did not happen.
export const claimedEvent = (
  logs: readonly ReceiptLog[],
  expected: ClaimExpectation,
): { expiry: number; tokenId: bigint } | null => {
  const labelHash = keccak256(toHex(expected.handle))
  for (const log of logs) {
    if (!isAddress(log.address) || !isAddressEqual(log.address, expected.registrar)) {
      continue
    }
    const topics = log.topics.filter((topic) => isHex(topic))
    if (!isHex(log.data) || topics.length !== log.topics.length || topics.length === 0) {
      continue
    }
    try {
      const decoded = decodeEventLog({
        abi: FUDA_REGISTRAR_ABI,
        data: log.data,
        topics: [topics[0], ...topics.slice(1)],
      })
      if (
        decoded.eventName === 'IssuerClaimed' &&
        decoded.args.labelHash === labelHash &&
        isAddressEqual(decoded.args.issuer, expected.issuer)
      ) {
        return { expiry: Number(decoded.args.expiry), tokenId: decoded.args.tokenId }
      }
    } catch {
      // A receipt carries every log the transaction produced, including ones this
      // ABI knows nothing about. An undecodable log is not this claim.
      continue
    }
  }
  return null
}

export const confirmedClaim = (logs: readonly ReceiptLog[], expected: ClaimExpectation): boolean =>
  claimedEvent(logs, expected) !== null
