# World ID in fuda

**What fuda does.** A membership, a ticket or an event badge becomes a revocable on-chain record. A venue issues a Right, a standard pass goes to Apple Wallet, Google Wallet or a browser, and a gate checks EAS and admission state before letting someone in.

**Where World ID sits.** After issuance, and never at the gate. On a card whose issuer has turned the integration on, a member who already holds a Right can attach a **Verified Human badge** to it. Claiming stays instant for people who have never heard of World. The gate still decides admission from the chain alone and calls neither World nor anything new. A venue can address a promise to _a person_, with one badge per member, instead of to a bearer token. **EAS proves the right. World ID counts the people.**

Built on **World ID 4.0**, `allow_legacy_proofs: false`. Both sides refuse a 3.0 proof. Otherwise one person could hold a 3.0 nullifier and a 4.0 nullifier for the same action and badge a pass with each.

```mermaid
flowchart LR
    APP["Member app<br/>@worldcoin/idkit-core"]
    WID["World ID app<br/>on the member's phone"]

    subgraph api["api.fuda.sh"]
        CTX["POST /v1/badges/human/context<br/>signs rp_context"]
        SUB["POST /v1/badges/human<br/>verifies, then stores"]
        D1[("D1 · badges<br/>uid · kind · verifier<br/>scope · subject_key")]
        VER["GET/POST /v1/verify<br/>gate verdict"]
    end

    PORTAL["developer.world.org<br/>POST /api/v4/verify/{rp_id}"]
    GATE["Gate screen"]

    APP -->|"1 ask for a context"| CTX
    CTX -->|"2 RP-signed nonce"| APP
    APP -->|"3 hand off, signal = the Right's uid"| WID
    WID -->|"4 proof"| APP
    APP -->|"5 submit"| SUB
    SUB -->|"6 verify server-side"| PORTAL
    SUB --> D1
    VER -.->|"advisory read"| D1
    GATE --> VER
    VER -.-> CHAIN["EAS on Base<br/>the admission decision"]
```

**Step 6 is the point.** fuda never trusts a success that the client reports. The Worker verifies the proof, and only a verified proof reaches D1.

## The two rules the table enforces

| Rule | Constraint | What it stops |
| --- | --- | --- |
| One badge per Right and kind | primary key `(uid, kind)` | a second person badging a pass that already carries one |
| One subject per verifier and scope | unique index `(verifier, scope, subject_key)` | one person badging several passes |

`scope` is `rp_id:action`, and `subject_key` is the nullifier. 4.0 nullifiers are RP-scoped. A repeat verification of the _same_ pass by the _same_ person is not an error. The route answers success with the existing badge, because a member tapping the button twice is the normal case.

## What was built

### 1. The table and its store

[`apps/api/migrations/0015_badges.sql`](../../apps/api/migrations/0015_badges.sql) · [`apps/api/src/badges/store.ts`](../../apps/api/src/badges/store.ts)

`saveBadge` returns `{ ok: true }`, `{ conflict: 'pass' }` or `{ conflict: 'subject' }`. The two conflicts are different rules, and the routes answer them differently. The unique index is the authority. If two simultaneous requests both pass the reads, the loser re-resolves rather than throwing.

There is no evidence column. fuda does not store the proof. It stores only the nullifier, the credential label, and when the verification happened.

### 2. The verifier seam and the World adapter

[`apps/api/src/badges/verifier.ts`](../../apps/api/src/badges/verifier.ts) · [`apps/api/src/badges/providers/world.ts`](../../apps/api/src/badges/providers/world.ts)

`BadgeVerifier` is the whole vendor interface: `configured()`, `context()`, `verify()`. No `@worldcoin/*` import exists outside the adapter, and the routes are named after the claim (`/badges/human`), not the vendor. Replacing the verifier behind a kind is not a client-visible change.

The adapter checks everything it can before spending a round trip:

| Check                                                              | Refusal     |
| ------------------------------------------------------------------ | ----------- |
| A session proof rather than a uniqueness proof                     | `bad_proof` |
| `protocol_version` is not `4.0`                                    | `bad_proof` |
| `environment` is not `production`                                  | `bad_proof` |
| The proof's `action` is not this deployment's                      | `bad_proof` |
| `issuer_schema_id` outside `{1: proof_of_human, 9310: mnc}`        | `bad_proof` |
| A `signal_hash` that is present and does not match the Right's uid | `bad_input` |
| The portal's verify answers anything but `success: true`           | `bad_proof` |

Each refusal names its reason in the log. Without that reason, a badge that never arrives could come from any of three failures: the page lost the answer, World refused to make a proof, or this adapter refused the proof it was given.

### 3. The routes

[`apps/api/src/handlers/badges.ts`](../../apps/api/src/handlers/badges.ts)

`POST /v1/badges/:kind/context` returns the RP-signed context. `POST /v1/badges/:kind` takes `{ uid, payload }`, verifies, and stores. Both are rate-limited, both are `no-store`, and both answer **`501 badges_not_configured`** while the verifier is unconfigured. An unconfigured deployment then looks like the feature does not exist, not like it is broken.

The route refuses a badge for a Right that would not be admitted. It resolves the verdict first and answers `404` unless the verdict is `ADMIT`. A badge on a revoked Right would be a record nobody can use.

### 4. Badges in the gate verdict

[`apps/api/src/handlers/verify.ts`](../../apps/api/src/handlers/verify.ts)

`badgesFor` catches a failed read and returns an empty list. An empty list means **no `badges` key at all**, so a Right without a badge keeps the exact response shape it had before badges existed. The read is advisory in the same way the Attendance hook is. It can never turn a scan into a failure, and a missing table looks like a healthy verdict. Confirm the table by SQL, never by a verdict.

`VerifyResponse.badges` is an array from its first version, and each entry names its `verifier`. A second kind is not a breaking change.

### 5. The member's action

[`apps/app/src/badges.ts`](../../apps/app/src/badges.ts) · [`apps/app/src/venue/CardScreen.tsx`](../../apps/app/src/venue/CardScreen.tsx)

The Preact app uses headless `@worldcoin/idkit-core` and never imports the React widget. The request asks for `any(proof_of_human, mnc)`. A deployment in Japan serves many members who hold a My Number Card credential and have never been to an Orb, and the nullifier does not depend on which credential produced it.

The app renders the hand-off URI as a link and a QR rather than assigning it to `location.href`. `pollUntilCompletion()` resolves only while the page is alive, and navigating away loses a verification the member has already completed. A failure shows the vendor's own code under the button, because a silent button looks the same as a broken one.

### 6. The gate chip

[`apps/gate/src/verdict.ts`](../../apps/gate/src/verdict.ts) · [`apps/gate/src/Verdict.tsx`](../../apps/gate/src/Verdict.tsx)

The verdict names the verifier and when it verified, as `verified human · world` with the time, rather than showing a bare checkmark. The chip renders on a REJECT too. A badge outlives the Right it is attached to, so a revoked badged pass shows both. Naming the verifier is what keeps that reading honest.

### 7. The badge on a saved pass

[`packages/pass/src/google.ts`](../../packages/pass/src/google.ts) · [`packages/pass/src/apple/pass-json.ts`](../../packages/pass/src/apple/pass-json.ts) · [`apps/api/src/pass/notify.ts`](../../apps/api/src/pass/notify.ts)

Both wallet passes carry the badge as a snapshot taken when the pass is built. An installed Apple pass updates through the [Wallet web service](../specs/pass-types-and-flows.md#apple-wallet-updates) where that is configured. Elsewhere the member re-adds the pass to update it. The serial number is the Right's uid, so a re-add replaces the old pass. After a badge is stored, fuda patches a saved Google object best-effort, never in a way that can fail the badge.

## Configuration

**Per card, off by default.** A member sees the action only on a card whose issuer turned World ID on under the card's Integrations in the dashboard (`PUT /issuers/me/cards/:cardId/integrations { badges: ['human'] }`). The submit route refuses a Right under a card that has not turned it on, before the proof is spent. See [Card integrations](../specs/pass-types-and-flows.md#card-integrations).

**Per deployment.** Four values, all or nothing: `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_ACTION`, `WORLD_RP_SIGNING_KEY`. While any one is unset, `/badges/:kind` answers `501` and no verdict carries a badge. All four are Wrangler secrets rather than split between secrets and `vars`. That leaves one place to look, and a name defined in both silently resolves to the secret. See [the runbook](../runbook.md#3-secrets).

## Measured behaviour worth knowing

Three things cost real time on 2026-09-26 and 2026-09-27 and are not in the vendor's documentation.

**The verify endpoint's edge refuses a request with no `User-Agent`.** Cloudflare Workers' `fetch` sends none. The endpoint then answers `403 Forbidden` with an nginx HTML body, not a JSON error code, so none of the documented errors describes it. A direct measurement shows the difference: the identical POST answers `400 validation_error` with a user agent and `403` without one. The adapter now sends its own `User-Agent`.

**A failed attempt still spends the person's proof for that action.** The identity is consumed when the proof is generated, whatever happens downstream. Every retry afterwards answers `nullifier_replayed`. There is no reset, and `max_verifications` is a v3 action field absent from v4. The only way forward is a new action. A new action changes `scope`, so old badge rows no longer collide with new ones. When you test, plan for the cost: one broken attempt costs that tester their identity for that action.

**Verification needs the World ID app, which is not World App.** The hand-off opens the World ID app. A phone with only World App lands on a store page. Tell members which app before they queue.

## Privacy

The badge records that _a_ verified human holds this Right, scoped to this deployment's action. It never records who. `subject_key` is the nullifier, and a nullifier derives from `(person, rp_id, action)`. It identifies nobody outside this scope, and fuda holds nothing that links it to a person. fuda discards the proof itself after verification and publishes nothing about the badge on chain.
