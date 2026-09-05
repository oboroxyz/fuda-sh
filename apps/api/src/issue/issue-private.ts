import type { IssueRequest, IssueResponse } from '@fuda/sdk'
import { buildAnnouncementMetadata, generateStealthAddress } from '@fuda/stealth'
import type { Hex } from 'viem'

import { ChainError } from '../chain/client.ts'
import { attestEntitlement, insertMemberRow } from './issue-right.ts'
import type { IssueContext } from './issue-right.ts'

// +Private (spec §3, §7): the right goes to a one-time stealth address derived
// from the member's meta-address, then the ERC-5564 announcement lets the member
// discover it client-side. Both chain writes are synchronous and share the
// signer; the member row is written only after both landed. The stealth address
// is never stored (holder NULL) and never returned — discovery is the member's path.
export const issuePrivate = async (
  ctx: IssueContext,
  body: IssueRequest & { stealthMetaAddress: string },
): Promise<IssueResponse> => {
  // The route already refused everything isMetaAddress rejects, so the template
  // literal narrows to Hex (annotated, not cast).
  const metaAddress: Hex = `0x${body.stealthMetaAddress.slice(2)}`
  const { ephemeralPublicKey, stealthAddress, viewTag } = generateStealthAddress(metaAddress)
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
    // oxlint-disable-next-line no-console -- the uid is the only handle on an attested-but-unannounced right
    console.error('announce failed after attest', { error, uid })
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
