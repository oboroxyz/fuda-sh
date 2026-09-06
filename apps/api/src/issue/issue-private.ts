import type { IssueRequest, IssueResponse } from '@fuda/sdk'
import { buildAnnouncementMetadata, generateStealthAddress } from '@fuda/stealth-address'
import type { Hex } from 'viem'

import { ChainError } from '../chain/client.ts'
import { attestEntitlement, insertMemberRow } from './issue-right.ts'
import type { IssueContext } from './issue-right.ts'

// A truncated message is a triage hint, not a payload: enough to tell a revert
// from a timeout, short enough that an RPC error echoing call data cannot smuggle
// the stealth address through.
const LOG_MESSAGE_CHARS = 120

// +Private (docs/specs/attestation-model.md#api-payloads-that-touch-attestations): the right goes to a one-time stealth address derived
// from the member's meta-address, then the ERC-5564 announcement lets the member
// discover it client-side. Both chain writes are synchronous and share the
// signer; the member row is written only after both landed. The stealth address
// is never stored (holder NULL) and never returned — discovery is the member's path.
export const issuePrivate = async (
  ctx: IssueContext,
  // The route narrowed the string with `asMetaAddress`, so this is already Hex.
  body: IssueRequest & { stealthMetaAddress: Hex },
): Promise<IssueResponse> => {
  const { ephemeralPublicKey, stealthAddress, viewTag } = generateStealthAddress(body.stealthMetaAddress)
  const { uid } = await attestEntitlement(ctx, { body, holder: stealthAddress, level: 'private' })
  let announceTx: Hex
  try {
    const { txHash } = await ctx.chain.announce({
      ephemeralPubKey: ephemeralPublicKey,
      metadata: buildAnnouncementMetadata(viewTag, uid),
      stealthAddress,
    })
    announceTx = txHash
  } catch (error) {
    // The right is on chain but no announcement points at it, so the member can
    // never discover it. Nothing is persisted; the operator retries and revokes
    // this undiscoverable duplicate from the dash.
    //
    // Never the raw error: viem embeds the failing call's arguments (the stealth
    // address among them) in its message and in nested properties, and the
    // stealth address is exactly what must not reach a log sink. Only the error's
    // name and a truncated message survive, next to the uid.
    // oxlint-disable-next-line no-console -- the uid is the only handle on an attested-but-unannounced right
    console.error('announce failed after attest', {
      message: error instanceof Error ? error.message.slice(0, LOG_MESSAGE_CHARS) : 'non-error thrown',
      name: error instanceof Error ? error.name : 'unknown',
      uid,
    })
    throw error instanceof ChainError ? error : new ChainError(`announce failed for attestation ${uid}`)
  }
  await insertMemberRow(ctx, {
    holder: null,
    level: 'private',
    memberId: body.memberId ?? '',
    tier: body.tier,
    uid,
  })
  return { announceTx, announced: true, level: 'private', uid }
}
