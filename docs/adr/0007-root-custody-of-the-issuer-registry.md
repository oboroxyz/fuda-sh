# ADR 0007: fuda keeps root custody of the issuer registry

- **Status**: Accepted 2026-09-07.
- **Scope**: which ENSv2 roles the fuda parent owner holds over the User Registry that stores claimed issuer names, and what that lets fuda do.

## Context

Claimed issuer names live in a fuda-deployed ENSv2 User Registry under `fuda.eth`. Someone must hold the registry's root roles: they are what lets the deployment grant `REGISTRAR | RENEW` to `FudaSubnameRegistrar` in the first place, and what would let a future lifecycle principal receive `UNREGISTER`.

`FudaSubnameRegistrar` is deliberately narrow — vouchers, claim, renew, signer rotation, and nothing else — so it cannot answer the question of who repairs a mis-signed claim, who responds to an abusive label, or who upgrades the registry if the ENSv2 preview implementation changes under a pinned deployment.

The claimed-name design also puts issuer wallets in an unusually constrained position: a claim writes the child role bitmap as exactly `0`, so an issuer cannot transfer its own entry or redirect its resolver. Every recovery path therefore has to come from the root.

## Decision

The parent owner — a fuda-held key, separate from the voucher signer, gateway signer, allocation key, and EAS issuer key — is the registry's root principal. It holds `SET_PARENT` and `UPGRADE` directly, and holds the admin bit for `REGISTRAR`, `RENEW`, and `UNREGISTER`.

No principal holds `UNREGISTER` itself. The registrar is not given it, and it is not pre-granted to any operational key.

## Rejected alternatives

- **Renounce the root roles after deployment.** It would make claimed names censorship-resistant against fuda itself, which is the honest end state for a naming layer venues depend on. It also makes an upgrade of a preview-stage ENSv2 registry impossible and leaves no recovery path for an issuer whose entry has a zero child bitmap. Rejected for the current deployment window, not on principle.
- **Grant the registrar `UNREGISTER` too.** One contract would then hold both claim and revocation power over every venue name, and any voucher-signer compromise would become a namespace-wide takedown rather than an unauthorized claim.
- **Put the root behind a multisig or timelock.** Correct for a production naming layer with real venues. It is disproportionate to a single-operator deployment on Sepolia, and a timelock would block the recovery cases that motivate keeping custody at all.

## Consequences

- fuda can take any claimed issuer name dark. `grantRootRoles` assigns `UNREGISTER` to any account, its own included; the unregister call itself is outside the repository's pinned ABI surface, so the remaining steps belong to the deployment. Venue names are not censorship-resistant against fuda, and nothing in the system claims they are.
- The separation that does hold is between roles, not between fuda and the registry. `FudaSubnameRegistrar` cannot revoke, so a compromised voucher signer cannot take names down.
- Every surface must keep treating a name as a destination and the delegation check as the authority, because root custody means a resolving name reflects fuda's continued cooperation as well as the issuer's onchain claim.
- The exact root bitmap is written at deployment and asserted again by the standalone read-only verifier, so a change in root custody — including a future renounce — is detectable rather than silent.
- Renouncing later is a one-way move. It ends the recovery and upgrade paths above, so it belongs with a mainnet deployment and a real venue population, not with the current Sepolia namespace.

## Related

- [ENS naming](../specs/ens-naming.md)
- [ADR 0005](./0005-hybrid-ensv2-resolver.md) — the hybrid resolver this registry answers for
