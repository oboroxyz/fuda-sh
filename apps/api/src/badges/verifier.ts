import type { BadgeKind, Hex } from '@fuda/sdk'

import type { Bindings } from '../env.ts'
import { worldVerifier } from './providers/world.ts'

// What a verifier tells fuda about the person behind a proof. `subjectKey` must
// already be scoped to (verifier, scope): fuda never stores an identifier that
// could correlate someone across contexts.
export interface VerifiedSubject {
  subjectKey: string
  credential: string
  scope: string
  expiresAt: number | null
}

export interface BadgeVerifier {
  kind: BadgeKind
  name: string
  configured: (env: Bindings) => boolean
  // `context()` and `verify()` throw unless `configured(env)` returned true.
  // A caller must check `configured()` first and answer 501 on a config gap
  // rather than calling through — a missing binding is not a user-facing
  // error and must never surface as a 500.
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the RP context shape is vendor-specific and lives only inside the one adapter that builds it; callers forward it opaquely
  context: (env: Bindings) => Promise<unknown>
  verify: (
    env: Bindings,
    input: { uid: Hex; payload: unknown },
  ) => Promise<VerifiedSubject | { error: 'bad_proof' | 'bad_input' }>
}

// One kind, one verifier. A registry is not needed until a second kind exists.
export const verifierFor = (kind: string): BadgeVerifier | null =>
  kind === worldVerifier.kind ? worldVerifier : null
