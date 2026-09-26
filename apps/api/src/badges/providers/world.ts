// The `/hashing` subpath on purpose: it is pure TypeScript over @noble/hashes,
// while the package root pulls in idkit's wasm bundle, which has no business in
// a Worker. `hashSignal` is the same function World App itself uses to derive
// the `signal_hash` carried in a proof — its wasm and JS implementations were
// compared byte for byte over 0x-prefixed hex, plain strings and invalid hex
// before this adapter was written to depend on their agreement.
import { hashSignal } from '@worldcoin/idkit-core/hashing'
import { signRequest } from '@worldcoin/idkit-server'
import * as v from 'valibot'

import type { Bindings } from '../../env.ts'
import type { BadgeVerifier, VerifiedSubject } from '../verifier.ts'

const VERIFY_BASE = 'https://developer.world.org/api/v4/verify'

const set = (value: string | undefined): value is string => value !== undefined && value !== ''

// The four World bindings, all-or-nothing. Read once here so `configured()`
// and `context()` narrow the same way instead of each re-deriving it — that
// keeps the narrowing real (no assertion needed) across both call sites.
interface WorldConfig {
  appId: string
  rpId: string
  action: string
  signingKeyHex: string
}

const configOf = (env: Bindings): WorldConfig | null => {
  const { WORLD_ACTION, WORLD_APP_ID, WORLD_RP_ID, WORLD_RP_SIGNING_KEY } = env
  if (!set(WORLD_APP_ID) || !set(WORLD_RP_ID) || !set(WORLD_ACTION) || !set(WORLD_RP_SIGNING_KEY)) {
    return null
  }
  return { action: WORLD_ACTION, appId: WORLD_APP_ID, rpId: WORLD_RP_ID, signingKeyHex: WORLD_RP_SIGNING_KEY }
}

// The proof payload as the vendor actually ships it: `IDKitResult` from
// @worldcoin/idkit-core, forwarded verbatim by the client. There is no
// top-level `signal` field anywhere in that type — the signal reaches the
// server only as `responses[].signal_hash`, so that is what this adapter
// checks. Everything else is opaque and goes to the portal as-is.
//
// The payload is read in two stages on purpose. This first one is the envelope:
// only what decides whether the payload is a proof of the kind this deployment
// accepts at all, so each of those refusals is a deliberate one rather than a
// side effect of a field a rejected shape happens to lack.
//
// `session_id` is read here for that reason. The vendor's own discriminator is
// "Check `session_id` to determine if this is a session proof: session_id !==
// undefined → session proof; session_id === undefined → uniqueness proof", and a
// session proof is a well-formed proof of the wrong kind: its nullifier is
// bound to a *randomised* action and "does NOT guarantee uniqueness of a World
// ID" (docs/research/world-id-2026-09-26.md Q3). Accepting one would silently
// destroy the guarantee this badge exists to make, so absence is required —
// `v.unknown()` rather than `v.string()` so that a null or a number is
// "present" too, not a value that slips past a type check.
const ProofEnvelope = v.looseObject({
  environment: v.string(),
  protocol_version: v.string(),
  session_id: v.optional(v.unknown()),
})

// Stage two: the uniqueness proof itself. `action` is a required field on
// `IDKitResultV4` ("Action identifier (required for uniqueness proofs)"),
// unlike 3.0 where it was optional — which is what makes the action check in
// `verify()` possible at all.
//
// `signal_hash` stays optional here, and `verify()` explains why at the point
// where it is compared. `identifier` is not read: the credential is pinned on
// the numeric `issuer_schema_id` below instead.
const UniquenessProof = v.looseObject({
  action: v.string(),
  responses: v.array(
    v.looseObject({
      issuer_schema_id: v.number(),
      nullifier: v.string(),
      signal_hash: v.optional(v.string()),
    }),
  ),
})

// The one protocol family this deployment accepts, and the server-side half of
// the choice made once in apps/app/src/badges.ts (`HUMAN_PRESET`). The client
// asks for `proofOfHuman` with `allow_legacy_proofs: false`, so 4.0 is the
// family and 4.0 alone. Accepting 3.0 as well would let one person obtain a
// second, unrelated nullifier for the same action and badge a second pass — the
// vendor says as much on `allow_legacy_proofs` ("you must track both v3 and v4
// nullifiers to prevent double-claims"). The client preset and this constant
// change together or not at all.
const PROTOCOL_VERSION = '4.0'

// The one environment this deployment accepts. idkit-core's own type also
// allows 'staging' and 'sandbox' (its test and demo modes), and every proof
// result carries whichever one produced it. World's own integration guide
// prescribes exactly this check ("Check that the verify response's
// `environment` matches your backend's expected environment (assert
// 'production' for production integrations)"), because `environment:
// 'staging'` is how its own simulator is requested — a staging or sandbox
// proof is not backed by a real Orb verification, so accepting one would make
// the one-human-one-pass claim this feature exists to make meaningless. The
// client sets the matching `environment: 'production'` on its request; see
// `WORLD_ENVIRONMENT` in apps/app/src/badges.ts. The portal now agrees from its
// side too: since 2026-09-25 its production verify endpoint answers 403
// `environment_not_allowed` to a staging or sandbox proof unless the app has
// opened a 24-hour staging window and sends the token it issued
// (docs/research/world-id-2026-09-26.md Q1). This check is the half that does
// not depend on that deployment having shipped.
const WORLD_ENVIRONMENT = 'production'

// Which credential counts as "one verified human", pinned on the number rather
// than on the `identifier` string beside it. `ResponseItemV4.issuer_schema_id`
// is documented as "1=proof_of_human, 9303=passport, 9310=mnc" and
// `SelfieCheckResponseItemV4` fixes it at 11, so the number *is* the
// credential's identity, while `identifier` is a spelling this adapter cannot
// pin — World App reported the Orb credential as both `orb` and
// `proof_of_human` depending on transport. A number cannot be spelled two ways.
//
// 128 is deliberately not in here. The portal's own request schema calls it the
// "faux issuer", accepts it for `proof_of_human` only in staging or sandbox,
// and those credentials are "freely mintable from the simulator"
// (docs/research/world-id-2026-09-26.md Q1) — a credential that would make the
// one-human-one-pass claim meaningless. Everything else (passport, mnc, selfie,
// document) is a different credential with different uniqueness strength, and a
// payload carrying one means the client asked for a preset this feature did not
// ship.
const HUMAN_SCHEMA_ID = 1

// What the badge row records as the credential. Derived from the pinned schema
// id above rather than copied out of the payload: the `identifier` string is
// unvalidated client text, and the schema id already names the credential the
// proof carries.
const HUMAN_CREDENTIAL = 'proof_of_human'

// Both sides of the comparison in one form, so a 0x prefix or an upper-cased
// digit cannot read as a different signal. `hashSignal` returns 0x-prefixed
// lowercase hex, padded to 32 bytes, on both the JS and the wasm side; this
// only guards the payload half, which arrives from a client.
const bareHash = (hash: string): string => hash.replace(/^0x/iu, '').toLowerCase()

const sameHash = (a: string, b: string): boolean => bareHash(a) === bareHash(b)

// The two fields of the portal's verify response this adapter reads, both now
// confirmed against the endpoint's own implementation and the published OpenAPI
// schema (docs/research/world-id-2026-09-26.md Q5): the field is `nullifier`,
// and success is HTTP 200 *plus* `success: true`, while every failure carries
// `success: false` with a `code` and a `detail`. `success` is therefore what is
// required here — an HTTP status alone is not the contract.
const VerifyResponse = v.looseObject({
  nullifier: v.pipe(v.string(), v.minLength(1)),
  success: v.literal(true),
})

// The unique index over (verifier, scope, subject_key) is a string comparison,
// so it is only as good as the form written into it. A nullifier is a 256-bit
// integer rendered as hex, and "different strings may represent the same field
// element, which could result in a compromise of uniqueness" — the protocol's
// own type says so and recommends storing the number
// (docs/research/world-id-2026-09-26.md Q5). D1 has no 78-digit numeric, so one
// canonical string stands in for it: lowercase, `0x`-prefixed, zero-padded to
// 64 hex digits, so `0xdead` and `0x00…dead` cannot both be written as two
// different people. Anything that is not hex inside 256 bits is not a nullifier
// and is refused rather than padded into one.
const NULLIFIER_HEX = /^[\da-f]{1,64}$/u

const canonicalNullifier = (value: string): string | null => {
  const bare = value.replace(/^0x/iu, '').toLowerCase()
  return NULLIFIER_HEX.test(bare) ? `0x${bare.padStart(64, '0')}` : null
}

export const worldVerifier: BadgeVerifier = {
  configured: (env) => configOf(env) !== null,
  context: async (env) => {
    const config = configOf(env)
    if (config === null) {
      // Implements the contract documented on `BadgeVerifier.context`.
      throw new Error('world verifier: context() called while unconfigured')
    }
    // signRequest()'s output is not shaped like RpContext: sig -> signature,
    // createdAt -> created_at, expiresAt -> expires_at, and rp_id is added
    // here (it never comes from signRequest). See
    // .superpowers/2026-09-26-world-spike-notes.md section 3, and
    // apps/api/scripts/world-spike.ts, which established this mapping.
    // The signing key never leaves this call: it is a Worker secret and
    // never reaches a client, a log, or a response body.
    const signed = signRequest({ action: config.action, signingKeyHex: config.signingKeyHex })
    // signRequest() itself is synchronous; the await is only to satisfy the
    // interface's `Promise<unknown>` contract (the caller always awaits
    // `context()`, matching the pattern a future non-World verifier may need).
    return await Promise.resolve({
      action: config.action,
      app_id: config.appId,
      rp_context: {
        created_at: signed.createdAt,
        expires_at: signed.expiresAt,
        nonce: signed.nonce,
        rp_id: config.rpId,
        signature: signed.sig,
      },
    })
  },
  kind: 'human',
  name: 'world',
  verify: async (env, input) => {
    const config = configOf(env)
    if (config === null) {
      // Implements the contract documented on `BadgeVerifier.verify`.
      throw new Error('world verifier: verify() called while unconfigured')
    }
    // Everything checkable from the payload alone is checked here, before the
    // portal is called at all: a session proof, or a proof of another protocol
    // family, environment, action or credential, or one bound to another Right,
    // is refused without spending a round trip.
    const envelope = v.safeParse(ProofEnvelope, input.payload)
    if (!envelope.success) {
      return { error: 'bad_input' }
    }
    // A session proof, refused deliberately and first: see `ProofEnvelope`.
    if (envelope.output.session_id !== undefined) {
      return { error: 'bad_proof' }
    }
    if (envelope.output.protocol_version !== PROTOCOL_VERSION) {
      return { error: 'bad_proof' }
    }
    if (envelope.output.environment !== WORLD_ENVIRONMENT) {
      return { error: 'bad_proof' }
    }
    const parsedProof = v.safeParse(UniquenessProof, input.payload)
    if (!parsedProof.success) {
      return { error: 'bad_input' }
    }
    const { action, responses } = parsedProof.output
    if (responses.length === 0) {
      return { error: 'bad_input' }
    }
    // The proof was made for *this* deployment's action, not another one. 4.0
    // makes this checkable for the first time — `action` is optional on a 3.0
    // result and required on a 4.0 uniqueness proof — and it is worth checking:
    // the action is half of the nullifier's uniqueness domain, so a proof
    // carrying a different action carries a nullifier from a different domain
    // than the scope this adapter is about to store.
    if (action !== config.action) {
      return { error: 'bad_proof' }
    }
    if (!responses.every((response) => response.issuer_schema_id === HUMAN_SCHEMA_ID)) {
      return { error: 'bad_proof' }
    }
    // The signal binding, and the one place this adapter is deliberately looser
    // than its 3.0 predecessor: a hash that is present must match, and a hash
    // that is absent is not on its own treated as a forgery.
    //
    // Absence is legitimate. `ResponseItemV4.signal_hash` is optional in the
    // vendor's type, genuinely omitted from the JSON when unset (`Option` plus
    // `skip_serializing_if` in the Rust source of truth), and the portal
    // supplies a default for it, so failing closed on absence is stricter than
    // the contract (docs/research/world-id-2026-09-26.md Q6). That research
    // recommends conditioning the check on whether a signal was *requested*,
    // which on this path would mean always requiring one — but idkit's own code
    // shows why that is not safe: the bridge returns no signal hashes, so idkit
    // reattaches them, and its 4.0 branch is
    // `signal_hashes.get(normalized).or_else(get(incoming)).cloned()`, an
    // `Option` with no fallback, where its 3.0 branch ends in
    // `unwrap_or_else(|| cached_signal_hashes.legacy())` and therefore always
    // has one (worldcoin/idkit, rust/core/src/bridge.rs). A 4.0 item whose
    // identifier does not match a cached key arrives with no hash at all, and
    // requiring one would reject a valid proof.
    //
    // What is given up: with no hash, this adapter cannot tell that the human
    // who verified meant this Right rather than another. What still holds the
    // line:
    //   - a hash that *is* present must match, so a captured proof cannot be
    //     re-pointed at a second Right — the replay the signal exists to stop;
    //   - `action` is checked above, so a proof obtained for another action or
    //     another relying party is refused outright;
    //   - the Right must exist and be ADMIT-eligible (routes/badges.ts), so an
    //     arbitrary uid is not a target;
    //   - one nullifier badges one Right, ever, inside (verifier, scope) — the
    //     unique index — and 4.0 refuses a second uniqueness proof of the same
    //     action (`nullifier_replayed`), so nobody holds spare proofs to spray.
    // The countable claim therefore survives an unbound proof: spending one on
    // someone else's Right consumes the only one that person has, so the number
    // of humans and the number of badged passes still move together. What an
    // unbound proof can cost is attribution, not the count.
    const expectedHash = hashSignal(input.uid)
    const bound = (signalHash: string | undefined): boolean =>
      signalHash === undefined || sameHash(signalHash, expectedHash)
    if (!responses.every((response) => bound(response.signal_hash))) {
      return { error: 'bad_input' }
    }
    const res = await fetch(`${VERIFY_BASE}/${config.rpId}`, {
      body: JSON.stringify(input.payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    if (!res.ok) {
      return { error: 'bad_proof' }
    }
    const body: unknown = await res.json()
    // `success: true` is required by this parse, not merely a 2xx: the portal
    // answers 200 to a re-presented nullifier and does not dedupe for anyone,
    // so fuda's own unique index is the only thing enforcing one badge per
    // person (docs/research/world-id-2026-09-26.md Q5).
    const parsed = v.safeParse(VerifyResponse, body)
    if (!parsed.success) {
      return { error: 'bad_proof' }
    }
    const subjectKey = canonicalNullifier(parsed.output.nullifier)
    if (subjectKey === null) {
      return { error: 'bad_proof' }
    }
    return {
      credential: HUMAN_CREDENTIAL,
      expiresAt: null,
      // A 4.0 nullifier is RP-scoped — "derived from (user, rpId, action)", and
      // the vendor's own response type calls it an "RP-scoped nullifier" — so
      // the stored scope is the rp id and the action, which is the domain the
      // key is actually unique within (docs/research/world-id-2026-09-26.md Q3).
      // Deliberately not the app id: that is what a 3.0 Semaphore external
      // nullifier is built from, and recording the wrong one would mean the
      // stored scope does not describe the domain the key is unique in. The
      // `rp_` prefix carried in the value also records which family's domain a
      // row was written under, so a 3.0-scoped `app_…` row and a 4.0-scoped
      // `rp_…` row can never collide or be mistaken for one another. With the
      // action alone, re-registering under an unchanged action would hand the
      // same person a fresh nullifier inside an unchanged scope, and the unique
      // index would stop catching them: one human, two badged passes. This is
      // not retrofittable once rows exist.
      scope: `${config.rpId}:${config.action}`,
      subjectKey,
    } satisfies VerifiedSubject
  },
}
