import type { OperatorSession } from './auth/session.ts'
import type { ChainClient } from './chain/client.ts'
import type { Db } from './db/client.ts'
import type { AdmitHook } from './verify/admit.ts'

export interface Bindings {
  DB: D1Database
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
}

export interface Variables {
  chain: ChainClient
  db: Db
  // unix seconds — injectable for tests
  now: () => number
  // called once per admission; a no-op unless the deployment wires Attendance
  onAdmit: AdmitHook
  // set by operatorAuth(): the signed-in operator behind a session token
  operator: OperatorSession
}

export interface AppEnv {
  Bindings: Bindings
  Variables: Variables
}
