import * as v from 'valibot'

import { ADDRESS_RE, META_ADDRESS_RE, NONCE_RE, QR_RE, SIGNATURE_RE, UID_RE } from './constants.ts'

const uid = v.pipe(v.string(), v.regex(UID_RE))
const address = v.pipe(v.string(), v.regex(ADDRESS_RE))
const unix = v.pipe(v.number(), v.integer(), v.minValue(0))

export const IssueBody = v.object({
  holder: v.optional(address),
  memberId: v.optional(v.pipe(v.string(), v.minLength(1))),
  metaURI: v.optional(v.string(), ''),
  stealthMetaAddress: v.optional(v.pipe(v.string(), v.regex(META_ADDRESS_RE))),
  tier: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3)), 0),
  usageModel: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2)), 1),
  validFrom: v.optional(unix, 0),
  validUntil: v.optional(unix, 0),
})
export type IssueRequest = v.InferOutput<typeof IssueBody>

// Exact rule from spec §3: stealthMetaAddress → private (holder forbidden);
// else holder → signed (memberId forbidden); else memberId → bearer; else null.
export const deriveIssueKind = (b: IssueRequest): 'bearer' | 'signed' | 'private' | null => {
  if (b.stealthMetaAddress !== undefined) {
    return b.holder === undefined ? 'private' : null
  }
  if (b.holder !== undefined) {
    return b.memberId === undefined ? 'signed' : null
  }
  return b.memberId === undefined ? null : 'bearer'
}

export const VerifyBody = v.object({ qr: v.pipe(v.string(), v.regex(QR_RE)) })
export const RevokeBody = v.object({ uid })
export const ChallengeBody = v.object({ uid })
export const VerifySignedBody = v.object({
  nonce: v.pipe(v.string(), v.regex(NONCE_RE)),
  signature: v.pipe(v.string(), v.regex(SIGNATURE_RE)),
  uid,
})

export type VerifyRequest = v.InferOutput<typeof VerifyBody>
export type RevokeRequest = v.InferOutput<typeof RevokeBody>
export type ChallengeRequest = v.InferOutput<typeof ChallengeBody>
export type VerifySignedRequest = v.InferOutput<typeof VerifySignedBody>
