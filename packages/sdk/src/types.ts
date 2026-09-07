import type { ErrorCode, Hex, Level, Reason } from './constants.ts'
import type { CardView, IssuerView } from './handles.ts'

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

// Operator sign-in (docs/specs/pass-types-and-flows.md#surfaces): a passkey
// wallet signs the api's message and receives a session token.
export interface SignInChallengeResponse {
  nonce: Hex
  message: string
}
export interface SignInResponse {
  token: string
  issuer: IssuerView | null
}
export interface HandleCheckResponse {
  handle: string
  valid: boolean
  available: boolean
}
export interface IssuerCreateResponse {
  issuer: IssuerView
  card: CardView
  publicUrl: string
}
export type IssuerMeResponse = IssuerCreateResponse | { issuer: null; card: null; publicUrl: null }

// The self-serve Bearer issuance behind /@<handle>: the admin shape plus the
// generated member number the pass shows.
export interface SelfServeIssueResponse {
  uid: Hex
  level: 'bearer'
  holder: Hex
  qr: string
  passUrls: PassUrls
  memberNumber: string
}
