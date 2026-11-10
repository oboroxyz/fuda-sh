import { asHex } from '@fuda/sdk'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Hex } from 'viem'

import { ChainError, NoSignerError, ZERO_UID } from '../chain/client.ts'
import type { ChainClient } from '../chain/client.ts'
import { bindChunks } from '../db/bind-chunks.ts'
import type { Db } from '../db/client.ts'
import { members, offchainAttestations, offchainRoots } from '../db/schema.ts'
import { merkleRoot } from '../eas/merkle.ts'

// One root per run; a larger backlog drains over the following runs.
const MAX_PASSES_PER_ROOT = 1000
// D1 allows 100 bound parameters per statement, and one here goes to the root.
const UIDS_PER_UPDATE = 99
const MAX_REVOCATIONS_PER_RUN = 20

// These columns are written only from viem's 32-byte hashes, so anything else is a
// damaged row and worth failing loudly over.
const toUid = (stored: string): Hex => {
  const uid = asHex(stored, 32)
  if (uid === null) {
    throw new Error(`not a 32-byte hash in the offchain tables: ${stored}`)
  }
  return uid
}

// Reads first so a retry never reverts on an already revoked uid. When the chain
// already shows the revocation there is no transaction of ours to name, so the zero
// hash marks it done. Throws ChainError / NoSignerError when it could not be sent.
// EAS records the current sender, including for retired-key passes. D1 remains
// authoritative because the new key cannot write the original signer's record.
export const sendOffchainRevocation = async (db: Db, chain: ChainClient, attester: Hex, uid: Hex) => {
  const revokedAt = await chain.offchainRevokedAt(attester, uid)
  const sent = revokedAt === 0n ? await chain.revokeOffchain(uid) : { txHash: ZERO_UID }
  await db
    .update(offchainAttestations)
    .set({ revokeTx: sent.txHash })
    .where(eq(offchainAttestations.uid, uid))
}

// docs/specs/attestation-model.md#offchain-rights. Stops at the first failure, because
// the next would almost certainly fail the same way and the next run tries again.
export const retryOffchainRevocations = async (db: Db, chain: ChainClient): Promise<number> => {
  const attester = chain.offchainAttester()
  if (attester === null) {
    return 0
  }
  const pending = await db
    .select({ uid: offchainAttestations.uid })
    .from(offchainAttestations)
    .innerJoin(members, eq(members.attestationUid, offchainAttestations.uid))
    .where(and(eq(members.status, 'revoked'), isNull(offchainAttestations.revokeTx)))
    .limit(MAX_REVOCATIONS_PER_RUN)
  let sent = 0
  for (const { uid } of pending) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- one signer, one nonce: these go one at a time on purpose
      await sendOffchainRevocation(db, chain, attester, toUid(uid))
      sent += 1
    } catch (error) {
      if (!(error instanceof ChainError) && !(error instanceof NoSignerError)) {
        throw error
      }
      // oxlint-disable-next-line no-console -- the gate already rejects this pass; only the public record is behind
      console.error('offchain revocation retry failed', { error, uid })
      break
    }
  }
  return sent
}

// Anyone can timestamp a root first, and EAS then reverts ours, so a failed send
// counts as success when the chain shows the root anyway.
const anchorRoot = async (db: Db, chain: ChainClient, root: Hex): Promise<void> => {
  let txHash: Hex | null = null
  let anchoredAt = await chain.rootTimestamp(root)
  if (anchoredAt === 0n) {
    try {
      ;({ txHash } = await chain.timestamp(root))
    } catch (error) {
      if (!(error instanceof ChainError)) {
        throw error
      }
    }
    anchoredAt = await chain.rootTimestamp(root)
    if (anchoredAt === 0n) {
      throw new ChainError(`root ${root} was not timestamped`)
    }
  }
  await db
    .update(offchainRoots)
    .set({ anchoredAt: Number(anchoredAt), txHash })
    .where(eq(offchainRoots.root, root))
}

// Written and tied to its passes in one batch before anything is sent, so a failed
// send retries this same root rather than a different set of passes.
const createRoot = async (db: Db, now: number): Promise<Hex | null> => {
  const rows = await db
    .select({ uid: offchainAttestations.uid })
    .from(offchainAttestations)
    .where(isNull(offchainAttestations.root))
    .orderBy(offchainAttestations.createdAt)
    .limit(MAX_PASSES_PER_ROOT)
  const uids = rows.map((row) => toUid(row.uid))
  if (uids.length === 0) {
    return null
  }
  const root = merkleRoot(uids)
  const [firstChunk, ...restChunks] = bindChunks(uids, UIDS_PER_UPDATE).map((part) =>
    db
      .update(offchainAttestations)
      .set({ root })
      .where(and(inArray(offchainAttestations.uid, part), isNull(offchainAttestations.root))),
  )
  if (firstChunk === undefined) {
    return null
  }
  await db.batch([
    db.insert(offchainRoots).values({ createdAt: now, passCount: uids.length, root }),
    firstChunk,
    ...restChunks,
  ])
  return root
}

// docs/specs/attestation-model.md#offchain-rights. Finishes any root an earlier run
// could not send, then groups the passes that have none. Never an admission condition:
// a failure here leaves every pass valid, and the next run tries again.
export const anchorOffchainRoots = async (db: Db, chain: ChainClient, now: number): Promise<void> => {
  if (chain.offchainAttester() === null) {
    return
  }
  try {
    const unsent = await db
      .select({ root: offchainRoots.root })
      .from(offchainRoots)
      .where(isNull(offchainRoots.anchoredAt))
      .orderBy(offchainRoots.createdAt)
    for (const { root } of unsent) {
      // oxlint-disable-next-line no-await-in-loop -- one signer, one nonce: these go one at a time on purpose
      await anchorRoot(db, chain, toUid(root))
    }
    const created = await createRoot(db, now)
    if (created !== null) {
      await anchorRoot(db, chain, created)
    }
  } catch (error) {
    if (!(error instanceof ChainError) && !(error instanceof NoSignerError)) {
      throw error
    }
    // oxlint-disable-next-line no-console -- no pass depends on this; the log is how a stuck signer or an empty balance shows up
    console.error('offchain root not anchored', { error })
  }
}
