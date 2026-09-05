import { encodeAbiParameters, keccak256 } from 'viem'
import type { Hex } from 'viem'

import { ChainError, NoSignerError, ZERO_ADDRESS, ZERO_UID } from './client.ts'
import type { AttestParams, ChainClient, RawAttestation } from './client.ts'

const DEFAULT_SIGNER: Hex = `0x${'f0'.repeat(20)}`

const lowerHex = (h: Hex): Hex =>
  // SAFETY: lowercasing a 0x-prefixed hex string keeps it a 0x-prefixed hex string.
  h.toLowerCase() as Hex

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
    this.signer = opts.signer === undefined ? DEFAULT_SIGNER : opts.signer
  }

  signerAddress(): Hex | null {
    return this.signer
  }

  seed(att: Omit<RawAttestation, 'uid'> & { uid?: Hex }): Hex {
    const uid = att.uid === undefined ? this.nextUid() : lowerHex(att.uid)
    this.attestations.set(uid, { ...att, uid })
    return uid
  }

  revokeAt(uid: Hex, time: bigint): void {
    const key = lowerHex(uid)
    const a = this.attestations.get(key)
    if (a !== undefined) {
      this.attestations.set(key, { ...a, revocationTime: time })
    }
  }

  readAttestation(uid: Hex): Promise<RawAttestation> {
    if (this.failReads) {
      return Promise.reject(new ChainError('rpc down'))
    }
    return Promise.resolve(
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
      },
    )
  }

  // oxlint-disable-next-line class-methods-use-this -- ChainClient method; the fake's CREATE2 stand-in is stateless
  getAddressFromFactory(owners: Hex[], nonce: bigint): Promise<Hex> {
    const h = keccak256(encodeAbiParameters([{ type: 'bytes[]' }, { type: 'uint256' }], [owners, nonce]))
    return Promise.resolve<Hex>(`0x${h.slice(-40)}`)
  }

  attest(p: AttestParams): Promise<{ uid: Hex; txHash: Hex }> {
    if (this.signer === null) {
      return Promise.reject(new NoSignerError('SIGNER_PRIVATE_KEY unset'))
    }
    if (this.failWrites) {
      return Promise.reject(new ChainError('tx failed'))
    }
    const uid = this.nextUid()
    this.attestations.set(uid, {
      attester: this.signer,
      data: p.data,
      expirationTime: p.expirationTime,
      recipient: p.recipient,
      refUID: p.refUID,
      revocable: p.revocable,
      revocationTime: 0n,
      schema: p.schema,
      time: this.now(),
      uid,
    })
    const txHash = this.nextTx()
    return Promise.resolve({ txHash, uid })
  }

  revoke(schema: Hex, uid: Hex): Promise<{ txHash: Hex }> {
    if (this.signer === null) {
      return Promise.reject(new NoSignerError('SIGNER_PRIVATE_KEY unset'))
    }
    const a = this.attestations.get(lowerHex(uid))
    if (this.failWrites || a === undefined || a.schema !== schema || a.revocationTime !== 0n) {
      return Promise.reject(new ChainError('revert'))
    }
    this.attestations.set(a.uid, { ...a, revocationTime: this.now() })
    return Promise.resolve({ txHash: this.nextTx() })
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
