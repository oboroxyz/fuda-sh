import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import type { Hex } from 'viem'

import { ChainError, NoSignerError, ZERO_UID } from '../chain/client.ts'
import { members, offchainAttestations } from '../db/schema.ts'
import { findVersion, parseSchemaSets } from '../eas/schemas.ts'
import type { AcceptedVersion } from '../eas/schemas.ts'
import { darkenMemberName } from '../ens/mirror.ts'
import type { AppEnv } from '../env.ts'

// null means "this deployment's EAS_SCHEMAS binding is malformed" — a
// deployment defect, not caller input, so it fails closed with the same
// chain_error /issue and /verify answer.
const acceptedEntitlements = (json: string): AcceptedVersion[] | null => {
  try {
    return parseSchemaSets(json).entitlement
  } catch {
    return null
  }
}

export type RevokeError = 'chain_error' | 'no_signer' | 'not_found'

export type RevokeOutcome = { ok: true } | { ok: false; error: RevokeError }

// docs/specs/attestation-model.md#offchain-rights: D1 first, so the gate rejects at
// once and while the chain is unreachable. The transaction may then fail or be lost
// without undoing that. `revoke_tx` stays NULL and a later call sends it again, and
// the read first keeps a retry from reverting on an already revoked uid.
const revokeOffchainPass = async (c: Context<AppEnv>, uid: Hex): Promise<RevokeOutcome> => {
  const chain = c.get('chain')
  const attester = chain.offchainAttester()
  if (attester === null) {
    return { error: 'no_signer', ok: false }
  }
  const db = c.get('db')
  await db.update(members).set({ status: 'revoked' }).where(eq(members.attestationUid, uid))
  try {
    const revokedAt = await chain.offchainRevokedAt(attester, uid)
    // Already revoked on chain: a retry whose earlier answer was lost, or a revocation
    // made outside fuda. There is no transaction of ours to name, so the zero hash marks it done.
    const sent = revokedAt === 0n ? await chain.revokeOffchain(uid) : { txHash: ZERO_UID }
    await db
      .update(offchainAttestations)
      .set({ revokeTx: sent.txHash })
      .where(eq(offchainAttestations.uid, uid))
  } catch (error) {
    if (!(error instanceof ChainError) && !(error instanceof NoSignerError)) {
      throw error
    }
    // oxlint-disable-next-line no-console -- the gate already rejects this pass; only the public record is behind, and this names which one
    console.error('offchain revocation not sent', { error, uid })
  }
  return { ok: true }
}

// On-chain revoke, then mark the row. The schema passed to EAS.revoke is the
// attestation's own — EAS reverts with InvalidSchema on any other, so revoking
// against the newest accepted version would make every older right unrevocable
// the moment a v2 Entitlement schema is accepted. An unknown uid, a uid that is
// not an accepted Entitlement and a malformed EAS_SCHEMAS binding answer
// chain_error with the row left untouched. A right already revoked on chain
// skips the transaction and finishes the row, so a retry after a lost answer or
// a failed row write ends in the same state.
//
// `issuerId` is the venue asking, or null for fuda's admin token. A venue may
// revoke only what it issued, and an unknown uid reads the same as another
// venue's: it learns nothing about a right that is not theirs.
export const revokePass = async (
  c: Context<AppEnv>,
  uid: Hex,
  issuerId: string | null,
): Promise<RevokeOutcome> => {
  if (issuerId !== null) {
    const owned = await c
      .get('db')
      .select({ uid: members.attestationUid })
      .from(members)
      .where(and(eq(members.attestationUid, uid), eq(members.issuerId, issuerId)))
      .get()
    if (owned === undefined) {
      return { error: 'not_found', ok: false }
    }
  }
  const offchain = await c
    .get('db')
    .select({ uid: offchainAttestations.uid })
    .from(offchainAttestations)
    .where(eq(offchainAttestations.uid, uid))
    .get()
  if (offchain !== undefined) {
    return await revokeOffchainPass(c, uid)
  }
  const chain = c.get('chain')
  if (chain.signerAddress() === null) {
    return { error: 'no_signer', ok: false }
  }
  try {
    const raw = await chain.readAttestation(uid)
    // A missing uid reads back as the zero struct; a non-Entitlement uid (a
    // delegation, say) is not this endpoint's to revoke.
    if (raw.uid === ZERO_UID) {
      return { error: 'chain_error', ok: false }
    }
    const accepted = acceptedEntitlements(c.env.EAS_SCHEMAS)
    if (accepted === null || findVersion(accepted, raw.schema) === null) {
      return { error: 'chain_error', ok: false }
    }
    if (raw.revocationTime === 0n) {
      await chain.revoke(raw.schema, uid)
    }
  } catch (error) {
    if (error instanceof NoSignerError) {
      return { error: 'no_signer', ok: false }
    }
    if (error instanceof ChainError) {
      return { error: 'chain_error', ok: false }
    }
    throw error
  }
  await c.get('db').update(members).set({ status: 'revoked' }).where(eq(members.attestationUid, uid))
  // A name that still resolved after its right was revoked would outlive the
  // thing it names, so it goes dark on the same request.
  await darkenMemberName(c.get('db'), { now: c.get('now')(), rightUid: uid })
  return { ok: true }
}
