import type { MemberSession, OperatorSession } from './auth/session.ts'
import type { ChainClient } from './chain/client.ts'
import type { Db } from './db/client.ts'
import type { AdmitHook } from './verify/admit.ts'

export interface Bindings {
  DB: D1Database
  // Venue logos. Absent until the bucket exists; the upload route then answers
  // 501 media_not_configured and nothing else changes.
  MEDIA_BUCKET?: R2Bucket
  ADMIN_TOKEN?: string
  SIGNER_PRIVATE_KEY?: string
  BASE_RPC_URL?: string
  EAS_ADDRESS: string
  SCHEMA_REGISTRY_ADDRESS: string
  ANNOUNCER_ADDRESS: string
  FACTORY_ADDRESS: string
  EAS_SCHEMAS: string
  ISSUER_ADDRESS: string
  DELEGATION_UID: string
  API_BASE_URL: string
  // The member-facing origin a published card links to: `https://fuda.sh` in
  // production (the apex redirects /@* to app.fuda.sh), the app dev port locally.
  PUBLIC_BASE_URL: string
  // Wallet-platform secrets. Each platform is configured only when every one
  // of its names is set and non-empty; otherwise that pass endpoint answers 501.
  GOOGLE_ISSUER_ID?: string
  GOOGLE_CLASS_ID?: string
  GOOGLE_SA_EMAIL?: string
  GOOGLE_SA_KEY_PEM?: string
  APPLE_PASS_TYPE_ID?: string
  APPLE_TEAM_ID?: string
  APPLE_CERT_PEM?: string
  APPLE_KEY_PEM?: string
  APPLE_WWDR_PEM?: string
  // ENS transport is disabled unless all four names are configured. The two
  // keys are Worker secrets; parent and resolver allowlist are plain bindings.
  ENS_GATEWAY_SECRET?: string
  ENS_GATEWAY_SIGNER_KEY?: string
  ENS_PARENT_NAME?: string
  ENS_RESOLVER_ADDRESSES?: string
  // Issuer subname claim. Every route that signs or confirms a claim answers 503
  // unless all five are configured, matching the gateway's fail-closed rule.
  // The two URLs are secrets because an Alchemy endpoint carries its API key in
  // the path and `wrangler.jsonc` is checked in; the policy id is inert without
  // them. ENS_VOUCHER_KEY signs claim and renew vouchers and is a separate role
  // from every other key (docs/specs/ens-naming.md#issuer-claim-and-renewal).
  ENS_REGISTRAR_ADDRESS?: string
  ENS_GAS_POLICY_ID?: string
  ENS_SEPOLIA_RPC_URL?: string
  ENS_PAYMASTER_UPSTREAM?: string
  ENS_VOUCHER_KEY?: string
}

export interface Variables {
  // The venue a request is acting for, or null for fuda's own admin token.
  // Set by operatorOrAdmin() on the routes that serve both.
  actingIssuer: string | null
  chain: ChainClient
  db: Db
  // unix seconds — injectable for tests
  now: () => number
  // called once per admission; a no-op unless the deployment wires Attendance
  onAdmit: AdmitHook
  // set by operatorAuth(): the signed-in operator behind a session token
  operator: OperatorSession
  // set by memberAuth(): a member wallet session, independent of issuer data
  member: MemberSession
}

export interface AppEnv {
  Bindings: Bindings
  Variables: Variables
}
