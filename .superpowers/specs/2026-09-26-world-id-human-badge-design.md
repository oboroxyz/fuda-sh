# Verified Human badge — World ID on an existing fuda pass

Design date: 2026-09-26. Status: approved design, not yet implemented. Branch: `feat/idkit`.
Event window: ETHGlobal Tokyo 2026, submission deadline 2026-09-27 09:00 JST.

## The trust moment

A fuda pass is a Bearer right: anyone who holds the QR holds the right. That is the
correct default for handing out a membership card in a queue, and it stays the default
here. What it cannot say is **how many of the passes in circulation belong to distinct
people**. One person can claim a card on three phones; the only thing standing in the way
today is a per-IP hourly budget in `apps/api/src/middleware/rate-limit.ts`, which is an
abuse brake, not a uniqueness claim.

This feature adds one thing: a pass can carry a **Verified Human badge**, asserting that a
unique human — counted once for this event — holds it. Issuance is untouched and stays
seconds long; the badge is opt-in and comes after. At the gate the badge is visible in the
verdict, so a venue can treat a badged pass differently from an unbadged one.

## Credential choice and its justification

**Proof of Human (Orb) only.** The claim is uniqueness of a person within one event. It is
not age, not nationality, not a legal name, not a document. Document/NFC and any
identity-bearing credential are deliberately **not** requested: they would collect more
than the claim needs, and fuda would then hold data it has no use for.

What fuda stores from a verification is the **nullifier and nothing else** — no World
identity, no wallet link on World's side, no biometric. The nullifier is scoped to
`app_id + action`, so it does not correlate this badge with the same person's activity in
any other application.

### The preset is chosen empirically, and nullifier stability decides it

The whole uniqueness claim rests on one property: **the same person verifying the same
action twice must produce the same nullifier.** The published documentation does not say
this consistently. `world-id/concepts.md` defines a nullifier as "a unique identifier for a
combination of a user, `app_id`, and `action`", which is the stable behaviour this design
needs. `world-id/4-0-migration.md` states that in 4.0 "nullifiers are one-time-use, and
`session_id` is the stable link across requests", which is not.

Both cannot hold. Resolve it by measurement, not by reading: in the first task, verify
**twice on the same phone with the same action** and compare the two nullifiers.

- Identical → use the 4.0 preset, `allow_legacy_proofs: false`.
- Different → use the legacy Orb preset (`orbLegacy`) whose per-`(app_id, action)`
  nullifier is stable, and keep `allow_legacy_proofs` on only as far as that preset needs.

**Exactly one preset ships.** Accepting both 4.0 and legacy proofs would let one person
produce two different nullifiers and badge two passes, which is precisely the property this
feature claims to provide. If neither preset yields a stable nullifier, the uniqueness
claim is withdrawn and the feature is re-scoped to "this pass was verified by a human"
without the one-per-human guarantee — say so in the submission rather than overstating it.

## Scope

**In scope (the event-period feature):**

1. Backend RP-context signing and World ID v4 proof verification.
2. A badge record binding one human to one pass, enforced by a unique nullifier.
3. An opt-in "verify you are human" action on the member's pass screen.
4. `humanVerified` surfaced in the gate verdict and rendered by `apps/gate`.

**Explicitly out of scope:** changing how passes are issued; requiring World ID to claim a
pass; World ID anywhere on the admission path; new tenant/operator workflows; Private-level
rights; Wallet-pass (Apple/Google) badge rendering.

**Stretch, in this order, only if the four items above are finished and deployed:**

- **S1 — `requiresHuman` cards.** A card can require the badge; an unbadged pass is
  rejected at the gate with a new `HUMAN_REQUIRED` reason. Turns a displayed badge into
  actual access control.
- **S2 — on-chain badge.** A best-effort EAS attestation mirroring
  `apps/api/src/attendance/attendance-hook.ts`, making the badge portable and verifiable
  without fuda.

Neither stretch is a completion condition. If time runs short, they are dropped and the
submission says so.

## Architecture

```
claim (unchanged)         badge (new)                    admission (verdict extended)
─────────────────         ───────────                    ────────────────────────────
POST /issuers/:h/:s/issue   POST /world/context          GET /verify/:uid
  → Entitlement (EAS)         → { app_id, action,          → decision/reason (unchanged)
  → Wallet pass                   rp_context }             + humanVerified? { at, credential }
                            IDKit (headless, in-app)
                              → World App (Orb)
                            POST /world/badge
                              { uid, payload }
                              → v4 verify → nullifier
                              → human_badges row
```

`apps/app` renders with **hono/jsx/dom, not React**, so the React `IDKitWidget` is
unusable. The headless core (`@worldcoin/idkit-core`) is the integration point:
`IDKit.request({ app_id, action, rp_context }).preset(orbLegacy({ signal }))`, then the
World App deeplink on a phone, or `connectorURI` rendered as a QR with
`pollUntilCompletion()` on a desktop.

### Data model

New migration `apps/api/migrations/0015_human_badges.sql`:

```sql
CREATE TABLE human_badges (
  uid         TEXT PRIMARY KEY,   -- the Entitlement UID this badge is bound to
  nullifier   TEXT NOT NULL,      -- canonical lowercase hex, as returned by World
  action      TEXT NOT NULL,
  credential  TEXT NOT NULL,      -- 'orb'
  verified_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX human_badges_action_nullifier ON human_badges (action, nullifier);
```

`uid` as the primary key makes one badge per pass; the unique `(action, nullifier)` makes
one badge per human per event. World's documentation suggests storing the nullifier as
`NUMERIC(78, 0)`; SQLite has no such type, so the canonical lowercase hex string is stored
and compared verbatim. The comparison is exact-string on a value we normalise once at the
edge, the same rule `normalizeUid` already follows for UIDs.

### Binding: what stops a stolen proof

- `action` is fixed per event (`badge:ethtokyo2026`), so a nullifier counts a person once.
- `signal` is the **Entitlement UID**, so a proof generated for pass A cannot badge pass B.
  The backend re-asserts this binding after verification rather than trusting the client's
  `uid` field alone. Both sides use the canonical lowercase form from `normalizeUid`: a
  checksummed or upper-cased uid on either side produces a mismatch that reads like a bad
  proof and is expensive to diagnose.
- `rp_context` is signed server-side with `WORLD_RP_SIGNING_KEY` (a Worker secret) and
  carries its own nonce and expiry; the client never mints it.

> **Confirm before coding:** the exact v4 request and response field names — in particular
> how the signal is echoed or must be supplied to
> `POST https://developer.world.org/api/v4/verify/{rp_id}` — come from
> `https://docs.world.org/world-id/idkit/integrate.md` and the Developer Portal verify
> reference, not from memory. The v2 `/api/v2/verify/{app_id}` shape that most existing
> articles show is obsolete and must not be copied.

### Endpoints

`POST /world/context` — no body. Returns `{ app_id, action, rp_context }`. Public and
rate-limited with the existing `rateLimit` middleware.

`POST /world/badge` — body `{ uid, payload }` where `payload` is the IDKit result forwarded
as-is. Steps: normalise `uid`; confirm the right exists and is not revoked by reusing
`verifyUid`; forward the payload to the Developer Portal; assert the signal binds to `uid`;
insert the badge row.

| Outcome | Status | Body |
| --- | --- | --- |
| Verified, badge stored | 200 | `{ humanVerified: { at, credential } }` |
| Same human, same pass, repeated | 200 | identical body — idempotent **only** when the stored nullifier equals the new one |
| Same human, different pass | 409 | `already_badged` |
| Different human, pass already badged | 409 | `pass_already_badged` |
| Signal does not match `uid` | 400 | `bad_input` |
| Proof rejected by World | 400 | `bad_proof` |
| Right unknown or revoked | 404 / 409 | existing codes |
| Feature not configured | 501 | `world_not_configured` |

### Configuration gate

The feature is live only when `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_ACTION` and
`WORLD_RP_SIGNING_KEY` are all set and non-empty — the same all-or-nothing rule the Wallet
and ENS bindings already use in `apps/api/src/env.ts`. Unset, both routes answer 501, the
member screen does not offer the action, and `humanVerified` is simply absent from every
verdict. Nothing else in the system changes.

### Verdict surface

`VerifyResponse` in `packages/sdk/src/types.ts` gains an optional
`humanVerified?: { at: number; credential: 'orb' }`. `verdictBody` in
`apps/api/src/routes/verify.ts` fills it from a D1 read. That read is **advisory**: if it
throws, the field is omitted and the decision is unchanged, matching how the Attendance
hook is already prevented from affecting an admission.

`apps/gate/src/Verdict.tsx` renders a chip when the field is present.

**walletmate** (the Raspberry Pi scanner and GREEN/RED LED) needs **no code change**: it
calls the same `GET /verify/:uid` and ignores an added response field. Pointing it at the
deployed API is configuration. What it cannot do is show a badge — two LEDs have no way to
say "admitted, and verified human". So walletmate demonstrates the unchanged admission
path, and the badge is read on the `apps/gate` screen beside it. Only stretch **S1** makes
the badge meaningful on the device itself: with a `requiresHuman` card, an unbadged pass
turns the LED red. If walletmate is to carry the demonstration alone, S1 stops being
optional.

## Failure and alternative paths

The prize requires a successful verification plus one meaningful alternative. Three fall
out of this design and all three are demonstrable:

1. **Second pass, same human** — 409 `already_badged`. The pass stays valid and admits; it
   simply carries no badge.
2. **No World App** — the member receives and uses the pass normally. The badge action is
   offered and cannot be completed; nothing is blocked. This is the common case among real
   attendees and is the reason the badge is opt-in rather than a claim condition.
3. **Cancelled in World App** — `pollUntilCompletion` ends without a proof; the screen
   returns to its prior state with no partial record written.

## Testing

Unit tests alongside the code they cover, following the repository's existing layout:

- badge store: duplicate `(action, nullifier)` conflicts; same pass and same human is
  idempotent; distinct humans on distinct passes both succeed;
- signal binding: a payload whose signal is not the requested `uid` is rejected before any
  write;
- config gate: with the bindings unset, both routes answer 501 and `verdictBody` omits the
  field;
- verdict shaping: a verdict with and without a badge, including the case where the D1 read
  throws and the decision must survive unchanged.

Manual, on real devices, before recording: claim a pass on a phone; badge it with an
Orb-verified World App; scan it at the gate and see the badge; attempt the badge on a second
pass and see the rejection; claim and admit a pass on a phone with no World App.

## Submission obligations

The Continuity rules require pre-existing and event-period work to be separated. The
disclosure is:

| Pre-existing (before 2026-09-26) | New in the event window |
| --- | --- |
| Entitlement issuance, EAS schemas, Wallet passes, `/verify` and the gate, Graph/ENS integrations | `/world/context`, `/world/badge`, `human_badges`, the member badge action, `humanVerified` in the verdict and gate |

The prize additionally requires an integration debrief. Record it while building, not
afterwards: time to first successful verification, the friction actually hit (the v2→v4
documentation gap and the React-only widget are already two), the missing capability, and
the single highest-impact improvement.

## Risks

- **Developer Portal setup is on the critical path.** RP registration and the signing key
  must exist before any code can be tested end to end. Do this first.
- **World App is required for every real verification.** Sandbox access runs through
  TestFlight or a private Play track and cannot be assumed available today. The Orb-verified
  phone on hand is the only guaranteed test device, which is why one device must be enough
  to demonstrate every path.
- **v4 is recent.** Field names and package APIs must be read from the current docs at the
  start of each task; a v2-shaped implementation will fail verification in a way that looks
  like a proof error.
