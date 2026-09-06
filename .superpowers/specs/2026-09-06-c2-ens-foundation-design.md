# C2 ENS Foundation Design

## Scope

This phase builds the parts of C2 that do not depend on the B1 issuer onboarding
or issuer-signed issuance work currently being implemented in another worktree.
It uses **Issuer** in specifications, schemas, columns, and code. **Venue** remains
member- and operator-facing copy only, as defined in `docs/CONTEXT.md`.

The deliverable is an internal ENS naming foundation, not a public resolution
endpoint. It consists of persisted naming state, strict name construction and
validation, and a resolver-independent lookup service. B1 integration will later
create and retire rows from confirmed issuer delegations and confirmed Right
evidence.

## Boundaries

The foundation owns three units:

1. **Name model** — constructs canonical issuer and member names beneath the
   configured parent, rejects labels outside the existing Handle/member-number
   rules, and parses only names within that parent.
2. **Naming mirror** — Drizzle definitions and a D1 migration for `ens_names`
   and `stealth_resolutions`. `ens_names` stores operational resolution and claim
   state. `stealth_resolutions` stores deterministic +Private derivation outputs
   for later use/announcement tracking.
3. **Resolution service** — reads active offchain rows by canonical name and
   returns either a stable EVM address or an explicit instruction to derive a new
   +Private destination. It has no Hono, CCIP-Read, ENSv2-contract, or viem
   transport dependency.

The service does not infer authority from a name. Callers must separately verify
the Issuer delegation or Right.

## Persisted model

`ens_names` uses Issuer terminology:

- `id`: integer primary key
- `issuer_handle`: the permanent Handle
- `name`: canonical fully qualified name, unique
- `kind`: `issuer` or `member`
- `owner_address`: ENS-side manager/owner mirror
- `target_address`: stable resolution target; null for +Private
- `expiry`: unix seconds; null means the row itself has no bound
- `voucher_issued_at`, `claim_tx_hash`, `unregister_tx_hash`: later V2/V3 state
- `right_uid`, `level`, `stealth_meta_address`: member-name evidence; null for
  Issuer names
- `status`: `offchain`, `voucher_issued`, `claimed`, `failed`, or `unregistered`
- `created_at`, `updated_at`

Database checks enforce valid enum values and kind-specific shape: Issuer rows
cannot carry Right fields; member rows require a Right UID and level; +Private
member rows require a stealth meta-address and no stable target; other resolvable
rows require a stable target.

`stealth_resolutions` records an `ens_name_id`, monotonically increasing
`nonce_counter`, derived stealth address, ephemeral public key, view tag,
`resolved_at`, optional `used_at`, and optional expiry. The pair
`(ens_name_id, nonce_counter)` and each stealth address are unique.

## Name rules

- Parent names are normalized to lowercase without a trailing dot and must be
  exactly two DNS/ENS labels for this deployment (`fuda.eth` in production).
- Issuer Handles use the canonical Handle rule: lowercase `[a-z0-9-]`, 1–63
  characters, no leading/trailing hyphen, and the reserved-label denylist.
- Member labels use the canonical 13-character member-number alphabet and must
  carry a valid Luhn-mod-28 check character.
- Name parsing is exact: `<issuer>.<parent>` or
  `<member-number>.<issuer>.<parent>`. Unknown depths and foreign suffixes do not
  resolve.

## Resolution behavior

Only `offchain` and `claimed` rows within their unexpired lifetime are visible.
Stable rows return `{ type: 'address', address }`. +Private rows return
`{ type: 'stealth', ensNameId, stealthMetaAddress }`; the future CCIP adapter will
atomically allocate a nonce, derive and record an address, then sign the response.
Missing, expired, failed, or unregistered rows return `null`.

Claimed names remain readable from this foundation because member labels beneath
a claimed Issuer still use the same gateway. Resolver precedence and whether the
gateway was actually consulted are concerns of the future ENSv2 adapter.

## Deferred integration

This phase deliberately does not:

- add or modify issuer onboarding, issuance, revocation, or delegation routes;
- add `issuer_handle` or member-number fields to the B1-owned member/issuer model;
- expose CCIP-Read HTTP routes or sign EIP-3668 responses;
- pin ENSv2 beta addresses or contract ABIs;
- deploy the UserRegistry, resolver, or SubnameRegistrar;
- implement vouchers, claims, unregister transactions, the DNS alias, or UI.

Those tasks begin after B1 lands and after a specific `contracts-v2` commit and
Sepolia deployment manifest are pinned.

## Verification

Tests cover label boundaries and check characters, exact parent/depth parsing,
database constraints and uniqueness, status/expiry filtering, stable-address
resolution, and the +Private derivation instruction. The full API tests, typecheck,
lint, and formatting checks must remain green.
