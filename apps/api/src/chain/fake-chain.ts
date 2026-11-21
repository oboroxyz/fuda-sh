import { parseChainConfig } from '@fuda/chains'
import { encodeAbiParameters, getAddress, keccak256, verifyMessage as recoverAndCompare } from 'viem'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { encodeDelegationV1 } from '../eas/codecs.ts'
import type { OffchainTypedData } from '../eas/offchain.ts'
import { ChainError, NoSignerError, ZERO_ADDRESS, ZERO_UID } from './client.ts'
import type { AttestParams, ChainClient, RawAttestation, VerifyMessageParams } from './client.ts'
import type { RegistryAgreement } from './erc8432.ts'
import { UnknownTransactionOutcomeError } from './unknown-transaction-outcome-error.ts'

const DEFAULT_SIGNER: Hex = `0x${'f0'.repeat(20)}`

// The fake's on-chain signer is a bare address, which cannot sign. Offchain
// attestations are checked by real recovery, so they get a real throwaway key.
const OFFCHAIN_KEY = privateKeyToAccount(`0x${'ab'.repeat(32)}`)

// The fixed uid `createDevChain` (in `../index.ts`) seeds the fake root
// IssuerDelegation at. Must match `local.vars.DELEGATION_UID` in `targets.jsonc`
// exactly: `FakeChain`'s uid counter (below) starts at a random per-instance
// offset, so without an explicit uid every local dev start would mint a
// different delegation uid than the one pinned in the dev vars, and
// verification would fail with NO_DELEGATION.
export const DEV_DELEGATION_UID: Hex = '0xb10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6'

// Annotated (not cast): a contextually-typed template literal already narrows to Hex.
const lowerHex = (h: Hex): Hex => `0x${h.slice(2).toLowerCase()}`

// viem EIP-55-checksums every address it decodes — readContract struct fields,
// parseEventLogs args, account.address, the factory's getAddress return. The fake
// mirrors that so `att.attester === chain.signerAddress()` behaves identically here
// and on Base Sepolia.
const checksum = (h: Hex): Hex => getAddress(h)

// In-memory EAS + factory used by the workerd integration tests and by
// local dev without a signer. Offline by default; local dev can supply a
// read-only smart-wallet verifier. Uids differ between instances (see `counter`).
export class FakeChain implements ChainClient {
  readonly agreements = new Map<
    string,
    RegistryAgreement & {
      registry: Hex
      id: Hex
      holder: Hex
      expiry: bigint
      revoked: boolean
      frozen: boolean
    }
  >()

  seedAgreement(
    input: RegistryAgreement & {
      registry: Hex
      id: Hex
      holder: Hex
      expiry?: bigint
      revoked?: boolean
      frozen?: boolean
    },
  ): void {
    this.agreements.set(`${input.registry.toLowerCase()}:${input.id.toLowerCase()}`, {
      expiry: 0n,
      frozen: false,
      revoked: false,
      ...input,
    })
  }

  async agreementOf(registry: Hex, id: Hex): Promise<RegistryAgreement> {
    this.checkRegistryRead()
    return await Promise.resolve(
      this.agreements.get(`${registry.toLowerCase()}:${id.toLowerCase()}`) ?? {
        assetId: ZERO_UID,
        creationMode: 0,
        termsId: ZERO_UID,
      },
    )
  }

  async agreementCountOf(registry: Hex, assetId: Hex): Promise<bigint> {
    this.checkRegistryRead()
    return await Promise.resolve(BigInt(this.assetAgreements(registry, assetId).length))
  }

  async isActiveAgreementHolder(registry: Hex, id: Hex, assetId: Hex, holder: Hex): Promise<boolean> {
    this.checkRegistryRead()
    const agreement = this.agreements.get(`${registry.toLowerCase()}:${id.toLowerCase()}`)
    return await Promise.resolve(
      agreement !== undefined &&
        agreement.assetId.toLowerCase() === assetId.toLowerCase() &&
        agreement.holder.toLowerCase() === holder.toLowerCase() &&
        holder.toLowerCase() !== ZERO_ADDRESS &&
        !agreement.revoked &&
        !agreement.frozen &&
        (agreement.expiry === 0n || agreement.expiry > this.now()),
    )
  }

  async activeAgreementsOf(
    registry: Hex,
    assetId: Hex,
    holder: Hex,
    cursor: bigint,
    limit: bigint,
  ): Promise<{ agreementIds: Hex[]; nextCursor: bigint }> {
    this.checkRegistryRead()
    const records = this.assetAgreements(registry, assetId)
    const page = records.slice(Number(cursor), Number(cursor + limit))
    const agreementIds: Hex[] = []
    for (const agreement of page) {
      // oxlint-disable-next-line no-await-in-loop -- the fake resolves immediately and preserves record order
      if (await this.isActiveAgreementHolder(registry, agreement.id, assetId, holder)) {
        agreementIds.push(agreement.id)
      }
    }
    return { agreementIds, nextCursor: BigInt(Math.min(records.length, Number(cursor + limit))) }
  }

  private assetAgreements(registry: Hex, assetId: Hex) {
    return [...this.agreements.values()].filter(
      (agreement) =>
        agreement.registry.toLowerCase() === registry.toLowerCase() &&
        agreement.assetId.toLowerCase() === assetId.toLowerCase(),
    )
  }

  private checkRegistryRead(): void {
    if (this.failReads) {
      throw new ChainError('rpc down')
    }
  }

  readonly attestations = new Map<Hex, RawAttestation>()
  readonly txs: Hex[] = []
  failReads = false
  failWrites = false
  unknownAttestOutcome = false
  readonly offchainRevocations = new Map<string, bigint>()
  readonly rootTimestamps = new Map<string, bigint>()
  // oxlint-disable-next-line class-methods-use-this -- injectable clock; tests replace this field wholesale
  now: () => bigint = () => BigInt(Math.floor(Date.now() / 1000))
  private readonly signer: Hex | null
  private readonly offchainAccount: ReturnType<typeof privateKeyToAccount>
  private readonly verifyOnChain: ChainClient['verifyMessage'] | undefined
  // Local dev keeps its D1 file across restarts while every isolate
  // starts a fresh FakeChain, so a counter from zero re-mints uids that are
  // already `members.attestation_uid` primary keys. A random per-instance start
  // keeps uids deterministic within one instance and distinct across restarts.
  private counter = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
  // Same restart problem as `counter`, but for tx hashes: a counter from zero
  // would re-mint hashes an earlier run already used. A random per-instance start
  // keeps tx hashes deterministic within one instance and distinct across restarts.
  private txCounter = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0

  constructor(
    opts: {
      signer?: Hex | null
      offchainKey?: Hex
      verifyMessage?: ChainClient['verifyMessage']
    } = {},
  ) {
    const signer = opts.signer === undefined ? DEFAULT_SIGNER : opts.signer
    this.signer = signer === null ? null : checksum(signer)
    this.offchainAccount =
      opts.offchainKey === undefined ? OFFCHAIN_KEY : privateKeyToAccount(opts.offchainKey)
    this.verifyOnChain = opts.verifyMessage
  }

  signerAddress(): Hex | null {
    return this.signer
  }

  // oxlint-disable-next-line class-methods-use-this -- part of the ChainClient port
  chainId(): number {
    return parseChainConfig().id
  }

  offchainAttester(): Hex | null {
    return this.signer === null ? null : this.offchainAccount.address
  }

  async signOffchain(typed: OffchainTypedData): Promise<Hex> {
    if (this.signer === null) {
      throw new NoSignerError('no signer configured')
    }
    return await this.offchainAccount.signTypedData(typed)
  }

  async offchainRevokedAt(revoker: Hex, uid: Hex): Promise<bigint> {
    if (this.failReads) {
      throw new ChainError('rpc down')
    }
    return await Promise.resolve(
      this.offchainRevocations.get(`${revoker.toLowerCase()}:${lowerHex(uid)}`) ?? 0n,
    )
  }

  async rootTimestamp(root: Hex): Promise<bigint> {
    if (this.failReads) {
      throw new ChainError('rpc down')
    }
    return await Promise.resolve(this.rootTimestamps.get(lowerHex(root)) ?? 0n)
  }

  async timestamp(root: Hex): Promise<{ txHash: Hex }> {
    if (this.signer === null) {
      throw new NoSignerError('no signer configured')
    }
    if (this.failWrites || this.rootTimestamps.has(lowerHex(root))) {
      throw new ChainError('timestamp reverted')
    }
    this.rootTimestamps.set(lowerHex(root), this.now())
    return await Promise.resolve({ txHash: this.nextTx() })
  }

  async revokeOffchain(uid: Hex): Promise<{ txHash: Hex }> {
    if (this.signer === null) {
      throw new NoSignerError('no signer configured')
    }
    const key = `${this.offchainAccount.address.toLowerCase()}:${lowerHex(uid)}`
    if (this.failWrites || this.offchainRevocations.has(key)) {
      throw new ChainError('revokeOffchain reverted')
    }
    this.offchainRevocations.set(key, this.now())
    return await Promise.resolve({ txHash: this.nextTx() })
  }

  // Seeds an active root IssuerDelegation attested by the fake signer; returns its uid.
  // `uid` lets callers (e.g. the local dev bootstrap) pin a fixed uid instead of
  // taking one from the random per-instance counter — see `DEV_DELEGATION_UID`.
  seedRootDelegation(delegationSchema: Hex, uid?: Hex): Hex {
    if (this.signer === null) {
      throw new NoSignerError('cannot seed without a signer')
    }
    return this.seed({
      attester: this.signer,
      data: encodeDelegationV1({ active: true, issuer: this.signer, name: 'fuda root (fake)' }),
      expirationTime: 0n,
      recipient: this.signer,
      refUID: ZERO_UID,
      revocable: true,
      revocationTime: 0n,
      schema: delegationSchema,
      time: this.now(),
      uid,
    })
  }

  seed(att: Omit<RawAttestation, 'uid'> & { uid?: Hex }): Hex {
    const uid = att.uid === undefined ? this.nextUid() : lowerHex(att.uid)
    this.attestations.set(uid, {
      ...att,
      attester: checksum(att.attester),
      recipient: checksum(att.recipient),
      uid,
    })
    return uid
  }

  revokeAt(uid: Hex, time: bigint): void {
    const key = lowerHex(uid)
    const a = this.attestations.get(key)
    if (a !== undefined) {
      this.attestations.set(key, { ...a, revocationTime: time })
    }
  }

  // oxlint-disable-next-line eslint/require-await -- ChainClient's interface is async; this fake resolves synchronously
  async readAttestation(uid: Hex): Promise<RawAttestation> {
    if (this.failReads) {
      throw new ChainError('rpc down')
    }
    return (
      this.attestations.get(lowerHex(uid)) ?? {
        attester: ZERO_ADDRESS,
        data: '0x',
        expirationTime: 0n,
        recipient: ZERO_ADDRESS,
        refUID: ZERO_UID,
        revocable: false,
        revocationTime: 0n,
        schema: ZERO_UID,
        time: 0n,
        uid: ZERO_UID,
      }
    )
  }

  // oxlint-disable-next-line class-methods-use-this, eslint/require-await -- stateless CREATE2 stand-in; interface is async
  async getAddressFromFactory(owners: Hex[], nonce: bigint): Promise<Hex> {
    const h = keccak256(encodeAbiParameters([{ type: 'bytes[]' }, { type: 'uint256' }], [owners, nonce]))
    return checksum(`0x${h.slice(-40)}`)
  }

  // oxlint-disable-next-line eslint/require-await -- ChainClient's interface is async; this fake resolves synchronously
  async attest(p: AttestParams): Promise<{ uid: Hex; txHash: Hex }> {
    if (this.signer === null) {
      throw new NoSignerError('SIGNER_PRIVATE_KEY unset')
    }
    if (this.failWrites) {
      throw new ChainError('tx failed')
    }
    const uid = this.nextUid()
    this.attestations.set(uid, {
      attester: this.signer,
      data: p.data,
      expirationTime: p.expirationTime,
      recipient: checksum(p.recipient),
      refUID: p.refUID,
      revocable: p.revocable,
      revocationTime: 0n,
      schema: p.schema,
      time: this.now(),
      uid,
    })
    const txHash = this.nextTx()
    if (this.unknownAttestOutcome) {
      throw new UnknownTransactionOutcomeError(txHash)
    }
    return { txHash, uid }
  }

  // oxlint-disable-next-line eslint/require-await -- ChainClient's interface is async; this fake resolves synchronously
  async revoke(schema: Hex, uid: Hex): Promise<{ txHash: Hex }> {
    if (this.signer === null) {
      throw new NoSignerError('SIGNER_PRIVATE_KEY unset')
    }
    const a = this.attestations.get(lowerHex(uid))
    if (this.failWrites || a === undefined || a.schema !== schema || a.revocationTime !== 0n) {
      throw new ChainError('revert')
    }
    this.attestations.set(a.uid, { ...a, revocationTime: this.now() })
    return { txHash: this.nextTx() }
  }

  // The pure ECDSA path (no RPC): every test key is an EOA. A malformed
  // signature is "not the holder's", not an error.
  async verifyMessage(p: VerifyMessageParams): Promise<boolean> {
    if (this.failReads) {
      throw new ChainError('rpc down')
    }
    const validEoa = await recoverAndCompare(p).catch(() => false)
    if (validEoa) {
      return true
    }
    return (await this.verifyOnChain?.(p)) ?? false
  }

  private nextUid(): Hex {
    this.counter += 1
    return keccak256(`0x${this.counter.toString(16).padStart(64, '0')}`)
  }

  private nextTx(): Hex {
    this.txCounter += 1
    const tx = keccak256(`0x${'ff'.repeat(16)}${this.txCounter.toString(16).padStart(32, '0')}`)
    this.txs.push(tx)
    return tx
  }
}
