# ADR 0005: one hybrid resolver serves the claimed and offchain ENS tree

- **Status**: Accepted 2026-09-06.
- **Scope**: resolution routing for issuer and member names below `fuda.eth`.

## Context

Claimed issuer ownership and expiry must be enforced by ENSv2 state, while member records must remain offchain and +Private destinations must keep rotating. ENS selects the deepest configured resolver, so attaching a conventional resolver to a claimed issuer can prevent its descendants from reaching the parent gateway. Expiry and unregister add a second risk: removing the active registry view could expose an older offchain issuer row again.

## Decision

Use one shared `FudaResolver` on `fuda.eth` and every claimed issuer entry. The resolver reads active claimed issuer ownership from the fuda User Registry and uses the signed gateway only for unclaimed names, supported non-address records on active issuers, and member descendants of active issuers. An append-only issuer marker prevents an expired or unregistered claimed namespace from ever falling back to a stale offchain issuer row.

## Rejected alternatives

- **Stock Permissioned Resolver.** It can hold an issuer address onchain, but it does not provide fuda's signed rotating gateway. As the deepest resolver, it would also stop member descendants from reaching the parent wildcard resolver.
- **One resolver per issuer.** It can combine the two paths, but creates a deployment, configuration, and rotation lifecycle for every claim. It also fragments gateway signer and URL changes across many contracts.
- **Parent-only offchain resolution.** It preserves member resolution, but keeps the claimed issuer address and expiry in D1. The onchain claim would be cosmetic rather than authoritative for name resolution.

## Consequences

- Exact claimed issuer lookups and claimed descendants require a User Registry owner read before they can return locally or use the gateway. A registry read failure fails closed instead of becoming an offchain fallback.
- Gateway signer and URL rotation have one shared contract seam for the whole tree.
- Expired or unregistered claimed namespaces deliberately enter a dark state: address records return the selector-specific empty value, other selectors fail locally, and no descendant reaches stale gateway data. A valid re-registration makes the same marked namespace active again.
- The append-only marker records claim history permanently. It stores no member data or destination address, and it does not make ENS part of admission or delegation authority.
