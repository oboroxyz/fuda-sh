import { encodeAbiParameters, getAddress, keccak256 } from 'viem'
import type { Hex } from 'viem'

import { encodeDelegationV1 } from '../eas/codecs.ts'
import { ChainError, NoSignerError, ZERO_ADDRESS, ZERO_UID } from './client.ts'
import type { AttestParams, ChainClient, RawAttestation } from './client.ts'

const DEFAULT_SIGNER: Hex = `0x${'f0'.repeat(20)}`

// Annotated (not cast): a contextually-typed template literal already narrows to Hex.
const lowerHex = (h: Hex): Hex => `0x${h.slice(2).toLowerCase()}`

// viem EIP-55-checksums every address it decodes — readContract struct fields,
// parseEventLogs args, account.address, the factory's getAddress return. The fake
// mirrors that so `att.attester === chain.signerAddress()` behaves identically here
// and on Base Sepolia.
const checksum = (h: Hex): Hex => getAddress(h)

// In-memory EAS + factory used by the workerd integration tests and by
// `wrangler dev` without a signer. Deterministic, no network.
export class FakeChain implements ChainClient {
  readonly attestations = new Map<Hex, RawAttestation>()
  readonly txs: Hex[] = []
  failReads = false
  failWrites = false
  // oxlint-disable-next-line class-methods-use-this -- injectable clock; tests replace this field wholesale
  now: () => bigint = () => BigInt(Math.floor(Date.now() / 1000))
  private readonly signer: Hex | null
  private counter = 0

  constructor(opts: { signer?: Hex | null } = {}) {
    const signer = opts.signer === undefined ? DEFAULT_SIGNER : opts.signer
    this.signer = signer === null ? null : checksum(signer)
  }

  signerAddress(): Hex | null {
    return this.signer
  }

  // Seeds an active root IssuerDelegation attested by the fake signer; returns its uid.
  seedRootDelegation(delegationSchema: Hex): Hex {
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

  private nextUid(): Hex {
    this.counter += 1
    return keccak256(`0x${this.counter.toString(16).padStart(64, '0')}`)
  }

  private nextTx(): Hex {
    const tx = keccak256(`0x${'ff'.repeat(16)}${(this.txs.length + 1).toString(16).padStart(32, '0')}`)
    this.txs.push(tx)
    return tx
  }
}
