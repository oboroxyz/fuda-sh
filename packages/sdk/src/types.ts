import type { ErrorCode, Hex, Level, Reason } from './constants.ts'

export interface ErrorResponse {
  error: ErrorCode
}

export interface PassUrls {
  web: string
  google: string
  apple: string
}

export type IssueResponse =
  | { uid: Hex; level: 'bearer' | 'signed'; holder: Hex; qr: string; passUrls: PassUrls }
  | { uid: Hex; level: 'private'; announced: true; announceTx: Hex }

export interface EntitlementView {
  holder: Hex
  issuer: Hex
  usageModel: number
  tier: number
  level: number
  validFrom: number
  validUntil: number
  schemaVersion: number
}
export interface DelegationView {
  issuer: Hex
  active: boolean
  name: string
}

export interface VerifyResponse {
  decision: 'ADMIT' | 'REJECT'
  reason: Reason
  entitlement?: EntitlementView
  delegation?: DelegationView
}

export interface ChallengeResponse {
  challenge: string
  nonce: Hex
}

// Every /verify-signed verdict is 200 in this one shape (docs/specs/pass-types-and-flows.md#gate-protocol): no entitlement
// or delegation view, `stage` marks the two early stops, `holder` appears once the
// attestation was decoded.
export interface VerifySignedResponse {
  decision: 'ADMIT' | 'REJECT'
  reason: Reason
  path: 'signature'
  holder?: Hex
  stage?: 'entitlement' | 'challenge'
}

export interface MemberRow {
  uid: Hex
  memberId: string
  holder: Hex | null
  level: Level
  tier: number
  status: 'active' | 'revoked'
  createdAt: number
}
export interface MembersResponse {
  members: MemberRow[]
}
export interface RevokeResponse {
  revoked: true
  uid: Hex
}
