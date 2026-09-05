# ADR 0001: EAS-native target architecture, adopted after the MVP

- **Status**: Accepted 2026-09-06. Implementation deferred until the MVP ships.
- **Scope**: the durable decisions behind the post-MVP architecture. The
  working design lives on the `worktree-eas-native-architecture` branch as a
  temporary Superpowers spec; this ADR records only what will still be true
  when that spec is deleted.

## Context

The MVP treats EAS as a signed public record and puts every judgment in the
gate and in D1: the fuda signer attests every right, the gate alone checks
issuer delegation, fuda is the sole owner of every unclaimed holder account,
and +Private rights publish their visit history through on-chain Attendance.
README promises "decentralized at the core, on rails only for UX"; the MVP
approximates that promise with rails, and the approximation becomes false the
day fuda is unavailable.

## Decisions

1. **On-chain footprint follows the verification level.** Public-holder
   rights (Bearer, Signed) keep full on-chain records, including Attendance.
   Private rights (+Private, Proved) leave no per-visit record: the gate
   hands the member an offchain receipt and timestamps a daily Merkle root.
   The MVP adopts the Attendance half of this rule immediately.
2. **Proved is a third verification level and coexists with +Private.** A
   zero-knowledge membership proof against an issuer-attested group root,
   offered as the `private (group)` template (U4). The stealth-address
   +Private templates stay; deprecating them for access is a later, separate
   decision. Stealth addresses remain the value-destination rail.
3. **Membership groups are EAS attestations, not a separate contract.** The
   issuer attests roots with the added and removed leaves in the data, so the
   tree is reconstructable from chain and the member's Merkle path needs no
   fuda server.
4. **`level` stays on the Entitlement schema.** It is the issuer's
   presentation requirement and must be third-party enforceable. A Proved
   right has no Entitlement; its level is marked by record type.
5. **Delegation is validated, never required.** Resolvers reject an invalid
   delegation but accept a right with none as self-issued. Gates decide
   between "fuda network" and "allowlist" trust. fuda is needed to join its
   trust network, not to issue.
6. **Issuer hot keys are delegated on EAS, not made wallet owners.** A
   `KeyDelegation` attestation grants ISSUE / ATTEND / REVOKE roles to a key
   the issuer can revoke at any time.
7. **Lineage uses `serial`.** The MVP's reserved field carries the
   predecessor UID; no additional field is introduced.
8. **fuda leaves the core in four places**: a claim module lets a member
   activate a holder account without fuda; the identity secret is exportable
   so a passkey bound to `fuda.sh` is not the only key; delegation is
   optional (decision 5); the name gateway is a stateless function of chain
   data.
9. **Private member numbers are derived, not issued**:
   `encode28(H(secret, issuer))` plus the standard check character, so they
   are recomputable without fuda and differ per issuer.

## Consequences

- Schema changes that alter UIDs (resolvers, native `expirationTime`,
  non-revocable Attendance, `label`) are bundled into one v2 cut behind the
  accepted-version-set seam; v1 rights keep verifying.
- Private-right revocation acquires a lag equal to the issuer's root-rotation
  grace window; first entry waits for the next rotation. Both are stated to
  issuers choosing U4.
- New engineering domains enter the repository: Solidity resolvers behind
  proxies, a modular account with a custom validator, and in-browser proving.
- The monitoring agent considered during design is not built.
