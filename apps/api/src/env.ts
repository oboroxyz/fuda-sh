import type { ChainClient } from './chain/client.ts'
import type { Db } from './db/client.ts'

export interface Bindings {
  DB: D1Database
  ADMIN_TOKEN?: string
  SIGNER_PRIVATE_KEY?: string
  BASE_RPC_URL?: string
  EAS_ADDRESS: string
  SCHEMA_REGISTRY_ADDRESS: string
  ANNOUNCER_ADDRESS: string
  ANNOUNCER_FROM_BLOCK: string
  FACTORY_ADDRESS: string
  EAS_SCHEMAS: string
  ISSUER_ADDRESS: string
  DELEGATION_UID: string
  API_BASE_URL: string
}

export interface Variables {
  chain: ChainClient
  db: Db
  // unix seconds — injectable for tests
  now: () => number
}

export interface AppEnv {
  Bindings: Bindings
  Variables: Variables
}
