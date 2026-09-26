# Verified Human badge — World ID on an existing fuda pass

Design date: 2026-09-26. Status: approved design, not yet implemented. Branch: `feat/idkit`. Event window: ETHGlobal Tokyo 2026, submission deadline 2026-09-27 09:00 JST.

## The trust moment

A fuda pass is a Bearer right: anyone who holds the QR holds the right. That is the correct default for handing out a membership card in a queue, and it stays the default here. What it cannot say is **how many of the passes in circulation belong to distinct people**. One person can claim a card on three phones; the only thing standing in the way today is a per-IP hourly budget in `apps/api/src/middleware/rate-limit.ts`, which is an abuse brake, not a uniqueness claim.

This feature adds one thing: a pass can carry a **Verified Human badge**, asserting that a unique human — counted once for this event — holds it. Issuance is untouched and stays seconds long; the badge is opt-in and comes after. At the gate the badge is visible in the verdict, so a venue can treat a badged pass differently from an unbadged one.

## Credential choice and its justification

**Proof of Human (Orb) only.** The claim is uniqueness of a person within one event. It is not age, not nationality, not a legal name, not a document. Document/NFC and any identity-bearing credential are deliberately **not** requested: they would collect more than the claim needs, and fuda would then hold data it has no use for.

What fuda stores from a verification is the **nullifier and nothing else** — no World identity, no wallet link on World's side, no biometric. The nullifier is scoped to `app_id + action`, so it does not correlate this badge with the same person's activity in any other application.

### Amendment, 2026-09-26 — two personhood credentials, not one

**"Proof of Human (Orb) only" above no longer describes what ships.** The adapter accepts **proof of human (`issuer_schema_id` 1) and My Number Card (9310)**, and the client asks for either in one request. The paragraph above is left as written because its reasoning still holds for what is _excluded_; what changed is the reading of where the line falls.

**Why.** The event is in Japan. A developer on World's own support channel verified with My Number Card, and attendees who hold MNC but have never been to an Orb are refused outright by a proof-of-human-only request. That is the demo failing for the people it is for. The original justification rejected "document/NFC and any identity-bearing credential" on the ground that they "would collect more than the claim needs" — but that is a statement about what fuda receives, and fuda receives the same thing either way: a scoped nullifier and nothing else. MNC is used here purely as evidence that a distinct person exists; none of its attributes are requested, none are returned, and fuda learns no identity, no document number and no name. The privacy position is therefore unchanged by this amendment, which is the reason it is allowed at all. Passport (9303) and selfie (11) stay out — passport because nobody has asked for it, selfie because it is a weaker uniqueness claim. Adding passport is one entry in the api's set and one in the client's.

**Why it is safe: the nullifier does not depend on the credential.** This was the condition on the change, because two credentials yielding two nullifiers for one person would let that person badge two passes while `UNIQUE (verifier, scope, subject_key)` stayed satisfied and every test stayed green. Verified in the protocol source, not inferred:

- `crates/proof/src/oprf_query.rs` builds the nullifier query as `oprf_query_digest(inclusion_proof.leaf_index, action, scope)`, where `scope` comes from `proof_request.rp_id`.
- `circom/client_side_proofs/oprf_nullifier.circom` computes `nullifier <== Poseidon2(4)([DS_N, query, oprf_response[0], oprf_response[1]])[1]`.
- `issuer_schema_id` appears in a **different** OPRF module — `CredentialBlindingFactor` — and never in the nullifier query. The credential is checked by `CheckCredentialSignature`, which is not an input to the nullifier.
- `crates/primitives/src/nullifier.rs`: "A nullifier is a unique, one-time identifier derived from (user, rpId, action)". No credential term.

**The guard, added regardless.** A request that accepts either credential can in principle be answered with both at once (`to_protocol()` sends both request items alongside the `any` expression, so `responses` may carry more than one item even though `any` is documented as first-satisfying). When it carries more than one, **every item's nullifier must canonicalise and be identical**, or the proof is refused as `bad_proof` with nothing written. The reasoning is that differing nullifiers are exactly the condition the unique index cannot detect — only one of several subject keys is ever written, so the index stays satisfied and the guarantee fails silently. Failing closed costs one person a badge; failing open costs the claim.

**What the Badge row now records.** `credential` was the server constant `'proof_of_human'`; it is now derived from the proof's own `issuer_schema_id` through a server-side map (`1 → proof_of_human`, `9310 → mnc`), never from client text. The data-model sketch below showing `credential TEXT NOT NULL, -- verifier-defined label: 'orb'` should be read as `'proof_of_human' | 'mnc'`. `credential` is not part of `BadgeView`, so no client-visible surface changes.

**Residual limit, stated rather than hidden.** The guarantee counts one verified _identity at the verifier_, which is what it always counted. Orb alone deduplicates one identity per iris, so with proof-of-human as the only accepted credential this residual does not exist: one human cannot hold two Orb identities. Accepting MNC as well introduces it: MNC deduplicates one identity per card, independently of Orb's dedup domain, so nothing read here prevents one person from holding an Orb-only World account and a separate MNC-only one. Those are two authenticator leaves, therefore two nullifiers, arriving in two separate submissions that no server-side check — the guard included — can relate. Accepting two independently-deduplicated credentials **creates** this residual rather than merely widening an existing one, and the residual grows with each additional accepted credential. It is the honest cost of the change.

**Client mechanism.** `.preset()` cannot express "either credential": a preset names exactly one, and `proofOfHuman()` returns `{ type: 'ProofOfHuman' }`, which is not a `ConstraintNode`. The request is therefore `.constraints(any(CredentialRequest('proof_of_human', { signal: uid }), CredentialRequest('mnc', { signal: uid })))`, with `allow_legacy_proofs: false` unchanged. The version gate that picks between the wasm v1 and v2 payload shapes exists only inside World App (`isInWorldApp()`); on the QR/browser hand-off, `.preset()` and `.constraints()` take the identical path with no version check at all. Inside a pre-v2 World App, `.preset(proofOfHuman(...))` was never a working fallback either: it calls `nativePayloadV1FromPreset(preset)`, which rethrows because the wasm v1 payload shape is `verification_level`, a field a 4.0 credential does not have — and because that call went un-awaited by `CardScreen`, the rejection escaped and hung the wait instead of surfacing an error. `.constraints()` excludes the same population `.preset()` already excluded; it just fails better, landing on an error state instead of a silent hang. The only fallback that would actually reach a pre-v2 World App is `orbLegacy()`, a 3.0 proof — which this design forbids, because mixing proof families would give one person two nullifier lineages. Do not add it.

**Copy.** Unchanged, and deliberately so. `Verified Human` / `人間であることを確認済み` name the claim and not the credential or the vendor, and both stay true whichever credential answered. `本人確認` remains out: MNC being Japan's literal identity document makes that distinction more important to preserve, not less — fuda still verifies personhood and not identity.

### The preset is chosen empirically, and nullifier stability decides it

The whole uniqueness claim rests on one property: **the same person verifying the same action twice must produce the same nullifier.** The published documentation does not say this consistently. `world-id/concepts.md` defines a nullifier as "a unique identifier for a combination of a user, `app_id`, and `action`", which is the stable behaviour this design needs. `world-id/4-0-migration.md` states that in 4.0 "nullifiers are one-time-use, and `session_id` is the stable link across requests", which is not.

Both cannot hold. Resolve it by measurement, not by reading: in the first task, verify **twice on the same phone with the same action** and compare the two nullifiers.

- Identical → use the 4.0 preset, `allow_legacy_proofs: false`.
- Different → use the legacy Orb preset (`orbLegacy`) whose per-`(app_id, action)` nullifier is stable, and keep `allow_legacy_proofs` on only as far as that preset needs.

**Exactly one preset ships.** Accepting both 4.0 and legacy proofs would let one person produce two different nullifiers and badge two passes, which is precisely the property this feature claims to provide. If neither preset yields a stable nullifier, the uniqueness claim is withdrawn and the feature is re-scoped to "this pass was verified by a human" without the one-per-human guarantee — say so in the submission rather than overstating it.

## Scope

**In scope (the event-period feature):**

1. Backend RP-context signing and World ID v4 proof verification.
2. A badge record binding one human to one pass, enforced by a unique nullifier.
3. An opt-in "verify you are human" action on the member's pass screen.
4. `humanVerified` surfaced in the gate verdict and rendered by `apps/gate`.
5. The badge rendered on the wallet passes that can carry it (see the scope change below).

**Explicitly out of scope:** changing how passes are issued; requiring World ID to claim a pass; World ID anywhere on the admission path; new tenant/operator workflows; Private-level rights; pushing an update to an already-installed Apple pass.

**Scope change — wallet-pass badge rendering.** Item 5 began as an explicit exclusion here, on the reading that a wallet pass is a snapshot taken when the pass is saved and a badge arrives afterwards, so no wallet could ever show one. The user asked for it directly mid-build, and it is in scope from that point.

The original reading was wrong for two of the three surfaces. A Google generic object is a live server-side record, so a saved pass can be patched once a badge is saved. And both the Google save link and the Apple `.pkpass` are generated per request, so a pass added _after_ a badge carries the badge from the start — the same way an enabled Stamp count already travels into both. What survives as an exclusion is the part the original line was really about, and it is now stated as such: updating a pass already installed on a device needs a `webServiceURL` and APNs, which this repo does not have, so an Apple pass installed before the badge shows it only when the member adds it again (a re-add replaces the installed pass in place, since the serial number is the Right's uid).

Neither invariant moves. The rendering carries only the fact of the badge — never the subject key, the scope, the credential, or the verifier's name — so privacy is unchanged; and a pass is not a decision surface, so a wallet that fails to render or fails to update still cannot change an admission decision.

**Stretch, in this order, only if the four items above are finished and deployed:**

- **S1 — `requiresHuman` cards.** A card can require the badge; an unbadged pass is rejected at the gate with a new `HUMAN_REQUIRED` reason. Turns a displayed badge into actual access control.
- **S2 — on-chain badge.** A best-effort EAS attestation mirroring `apps/api/src/attendance/attendance-hook.ts`, making the badge portable and verifiable without fuda: `bytes32 rightUID, address holder, string kind, string verifier, uint64 verifiedAt`, `refUID` = the Right. The `subject_key` is **never** published on chain — it is fuda's dedupe key, not evidence anyone else needs.

Neither stretch is a completion condition. If time runs short, they are dropped and the submission says so.

## Architecture

```
claim (unchanged)         badge (new)                    admission (verdict extended)
─────────────────         ───────────                    ────────────────────────────
POST /issuers/:h/:s/issue   POST /badges/human/context   GET /verify/:uid
  → Entitlement (EAS)         → { app_id, action,          → decision/reason (unchanged)
  → Wallet pass                   rp_context }             + badges? [ { kind, verifier,
                            IDKit (headless, in-app)                     at, expiresAt } ]
                              → World App (Orb)
                            POST /badges/human
                              { uid, payload }
                              → v4 verify → subject key
                              → badges row
```

`apps/app` renders with **hono/jsx/dom, not React**, so the React `IDKitWidget` is unusable. The headless core (`@worldcoin/idkit-core`) is the integration point: `IDKit.request({ app_id, action, rp_context }).preset(orbLegacy({ signal }))`, then the World App deeplink on a phone, or `connectorURI` rendered as a QR with `pollUntilCompletion()` on a desktop.

### Data model

New migration `apps/api/migrations/0015_badges.sql`:

```sql
CREATE TABLE badges (
  uid         TEXT NOT NULL,      -- the Right this badge is attached to
  kind        TEXT NOT NULL,      -- what is claimed: 'human'
  verifier    TEXT NOT NULL,      -- who attested it: 'world'
  scope       TEXT NOT NULL,      -- the uniqueness domain: 'ethtokyo2026'
  subject_key TEXT NOT NULL,      -- opaque pseudonym within (verifier, scope)
  credential  TEXT NOT NULL,      -- verifier-defined label: 'orb'
  verified_at INTEGER NOT NULL,
  expires_at  INTEGER,            -- null = no expiry
  PRIMARY KEY (uid, kind)
);
CREATE UNIQUE INDEX badges_subject ON badges (verifier, scope, subject_key);
```

The table is deliberately not `human_badges`, and the column is not `nullifier`. Two things are separated because they vary independently: **what is claimed** (`kind`) and **who attested it** (`verifier`). A gate cares about the claim; the verifier is provenance. World's nullifier is one instance of `subject_key`, whose contract is "an opaque value identifying a subject **within one `(verifier, scope)` pair and nowhere else**".

The two constraints carry two different rules. `(uid, kind)` allows one badge of a kind per Right while leaving room for other kinds (`age_over_20`, `member_of_x`) on the same Right. `(verifier, scope, subject_key)` is the one-per-human rule: the same subject cannot badge a second Right inside the same scope.

World's documentation suggests storing its nullifier as `NUMERIC(78, 0)`; SQLite has no such type, so the canonical lowercase hex string is stored and compared verbatim — an exact-string comparison on a value normalised once at the edge, the rule `normalizeUid` already follows.

### The rule that keeps fuda pseudonymous as verifiers are added

**Only ever store a `subject_key` that is already scoped so it cannot correlate a person across contexts.** World's nullifier satisfies this by construction: it is derived from `app_id + action`. A verifier that returns a globally stable identifier instead — a document number, an email address, a wallet address — must have it **hashed together with the scope before storage**, and the raw value must never be written. This holds the privacy line regardless of which verifier is added later, and it is the implementation-level counterpart of the criticism fuda makes of platforms that identify their members to verify them.

### Verifier seam

One interface in `apps/api/src/badges/`, one file per verifier under `badges/providers/`:

```ts
export interface BadgeVerifier {
  kind: BadgeKind // 'human'
  name: string // 'world'
  configured: (env: Bindings) => boolean
  verify: (input: VerifyInput) => Promise<VerifiedSubject> // { subjectKey, credential, expiresAt }
}
```

`providers/world.ts` is the only implementation. This mirrors the `WalletConnector` seam the repository already uses for wallet rails: a named interface, one adapter, no registry.

**Not generalised now** (add on demand, not in advance): a verifier registry table, per-issuer verifier configuration, a free-form JSON evidence column (a collection point for data nobody asked for), composition rules across verifiers, and any revocation protocol beyond `expires_at`.

### Naming

`docs/CONTEXT.md` already owns two adjacent terms. **Stamp** is a Venue's loyalty count and is unrelated. **Qualification** is the external fact that makes a Member eligible for a Right, read _before_ issuance. A **Badge** is the new term: a verified fact about the Member holding a Right, attached to the Right _after_ issuance and naming the Verifier that attested it. Add it to the glossary with the change.

### Binding: what stops a stolen proof

- `action` is fixed per event (`badge:ethtokyo2026`), so a nullifier counts a person once.
- `signal` is the **Entitlement UID**, so a proof generated for pass A cannot badge pass B. The backend re-asserts this binding after verification rather than trusting the client's `uid` field alone. Both sides use the canonical lowercase form from `normalizeUid`: a checksummed or upper-cased uid on either side produces a mismatch that reads like a bad proof and is expensive to diagnose.
- `rp_context` is signed server-side with `WORLD_RP_SIGNING_KEY` (a Worker secret) and carries its own nonce and expiry; the client never mints it.

> **Confirm before coding:** the exact v4 request and response field names — in particular how the signal is echoed or must be supplied to `POST https://developer.world.org/api/v4/verify/{rp_id}` — come from `https://docs.world.org/world-id/idkit/integrate.md` and the Developer Portal verify reference, not from memory. The v2 `/api/v2/verify/{app_id}` shape that most existing articles show is obsolete and must not be copied.

### Endpoints

The routes name the **claim**, not the vendor, so replacing the verifier behind a kind is not a client-visible change.

`POST /badges/human/context` — no body. Returns `{ app_id, action, rp_context }`. Public and rate-limited with the existing `rateLimit` middleware.

`POST /badges/human` — body `{ uid, payload }` where `payload` is the IDKit result forwarded as-is. Steps: normalise `uid`; confirm the right exists and is not revoked by reusing `verifyUid`; forward the payload to the Developer Portal; assert the signal binds to `uid`; insert the badge row.

| Outcome | Status | Body |
| --- | --- | --- |
| Verified, badge stored | 200 | `{ badge: { kind, verifier, at, expiresAt } }` |
| Same human, same pass, repeated | 200 | identical body — idempotent **only** when the stored `subject_key` equals the new one |
| Same human, different pass | 409 | `already_badged` |
| Different human, pass already badged | 409 | `pass_already_badged` |
| Signal does not match `uid` | 400 | `bad_input` |
| Proof rejected by World | 400 | `bad_proof` |
| Right unknown or revoked | 404 / 409 | existing codes |
| Feature not configured | 501 | `badges_not_configured` |

### Configuration gate

The feature is live only when `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_ACTION` and `WORLD_RP_SIGNING_KEY` are all set and non-empty — the same all-or-nothing rule the Wallet and ENS bindings already use in `apps/api/src/env.ts`. Unset, `configured()` is false, both routes answer 501, the member screen does not offer the action, and `badges` is simply absent from every verdict. Nothing else in the system changes.

### Verdict surface

`VerifyResponse` in `packages/sdk/src/types.ts` gains an optional `badges?: Array<{ kind: BadgeKind; verifier: string; at: number; expiresAt?: number }>`. It is an array from the first version on purpose: this type is public, is read by `apps/gate`, the walletmate daemon and any third-party verifier, and a `humanVerified` field would become a breaking change the moment a second kind exists. `verdictBody` in `apps/api/src/routes/verify.ts` fills it from a D1 read. That read is **advisory**: if it throws, the field is omitted and the decision is unchanged, matching how the Attendance hook is already prevented from affecting an admission.

`apps/gate/src/Verdict.tsx` renders a chip when the field is present.

**walletmate** (the Raspberry Pi scanner and GREEN/RED LED) needs **no code change**: it calls the same `GET /verify/:uid` and ignores an added response field. Pointing it at the deployed API is configuration. What it cannot do is show a badge — two LEDs have no way to say "admitted, and verified human". So walletmate demonstrates the unchanged admission path, and the badge is read on the `apps/gate` screen beside it. Only stretch **S1** makes the badge meaningful on the device itself: with a `requiresHuman` card, an unbadged pass turns the LED red. If walletmate is to carry the demonstration alone, S1 stops being optional.

## Failure and alternative paths

The prize requires a successful verification plus one meaningful alternative. Three fall out of this design and all three are demonstrable:

1. **Second pass, same human** — 409 `already_badged`. The pass stays valid and admits; it simply carries no badge.
2. **No World App** — the member receives and uses the pass normally. The badge action is offered and cannot be completed; nothing is blocked. This is the common case among real attendees and is the reason the badge is opt-in rather than a claim condition.
3. **Cancelled in World App** — `pollUntilCompletion` ends without a proof; the screen returns to its prior state with no partial record written.

## Testing

Unit tests alongside the code they cover, following the repository's existing layout:

- badge store: duplicate `(verifier, scope, subject_key)` conflicts; same pass and same subject is idempotent; distinct subjects on distinct passes both succeed; a second _kind_ on one Right is allowed;
- signal binding: a payload whose signal is not the requested `uid` is rejected before any write;
- config gate: with the bindings unset, both routes answer 501 and `verdictBody` omits `badges`;
- verdict shaping: a verdict with and without a badge, including the case where the D1 read throws and the decision must survive unchanged.

Manual, on real devices, before recording: claim a pass on a phone; badge it with an Orb-verified World App; scan it at the gate and see the badge; attempt the badge on a second pass and see the rejection; claim and admit a pass on a phone with no World App.

## Submission obligations

The Continuity rules require pre-existing and event-period work to be separated. The disclosure is:

| Pre-existing (before 2026-09-26) | New in the event window |
| --- | --- |
| Entitlement issuance, EAS schemas, Wallet passes, `/verify` and the gate, Graph/ENS integrations | `/badges/human/context`, `/badges/human`, the `badges` table and verifier seam, the member badge action, `badges` in the verdict and gate |

The prize additionally requires an integration debrief. Record it while building, not afterwards: time to first successful verification, the friction actually hit (the v2→v4 documentation gap and the React-only widget are already two), the missing capability, and the single highest-impact improvement.

## Risks

- **Developer Portal setup is on the critical path.** RP registration and the signing key must exist before any code can be tested end to end. Do this first.
- **World App is required for every real verification.** Sandbox access runs through TestFlight or a private Play track and cannot be assumed available today. The Orb-verified phone on hand is the only guaranteed test device, which is why one device must be enough to demonstrate every path.
- **v4 is recent.** Field names and package APIs must be read from the current docs at the start of each task; a v2-shaped implementation will fail verification in a way that looks like a proof error.
