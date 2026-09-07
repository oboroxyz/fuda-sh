# ADR 0006: one deployment per chain, with no state carried between them

- **Status**: Accepted 2026-09-07. The Sepolia deployment is live; the mainnet
  environment exists in `apps/api/wrangler.jsonc` as `env.production` and is
  deployed at the release cutover.
- **Scope**: how many deployed environments fuda has, what each owns, and what
  happens to member data when the product moves from testnet to mainnet.

## Context

fuda is live on Base Sepolia on the apex hostnames. At release it moves to Base
mainnet, and the Sepolia deployment stays as an internal environment on branch
`develop`. Two deployments will therefore run at once, and a decision was
needed about whether they share storage and what becomes of the rights already
issued on Sepolia.

Sharing looks cheaper: one D1, one R2, one set of secrets. It is also how the
repository started, with `env.dev` naming the same database and bucket as the
top-level block.

## Decision

Each chain gets its own deployment, and the deployments share nothing.

Every environment owns its own D1 database, R2 bucket, Worker secrets, and EAS
schema and delegation UIDs. Nothing is migrated at the cutover: production
starts with an empty database and an empty bucket, and every member re-claims
their card.

The local environment is a third, undeployed one, named `local` rather than
`dev` so it cannot be mistaken for the deployed `develop`.

## Consequences

An EAS schema UID is derived per chain, and a Sepolia Entitlement is not
readable on mainnet. Carrying the D1 rows across would leave every row pointing
at an attestation the mainnet gate cannot verify, so those members would hold
passes that answer `NOT_FOUND` at the door. Starting empty is not a cost of
this decision; it is the only correct outcome, and it is what makes the cutover
a deploy rather than a migration.

Separate storage also removes a class of accident that shared storage invites:
a `--remote` session, or a deploy of the wrong environment, cannot read or
overwrite a production venue's members or logo.

The price is repetition. Wrangler's named environments inherit neither `vars`
nor bindings, so every value is written out per environment, and a change to
one must be made in each. The chain setup in the runbook is likewise performed
once per environment. That repetition is visible and checkable in one file,
which is preferred to a shared resource whose contents depend on which Worker
last wrote to it.

R2 buckets and D1 databases cannot be renamed, so the names are chosen once:
`fuda-media-dev` and `fuda-beta` for develop, `fuda-media` and `fuda` for
production. A bucket name never leaves `wrangler.jsonc` — the public URL is
`/assets/:handle/logo/:variant` and D1 stores only a relative `logos/<uuid>`
prefix — so a later change costs an object copy and one edited line.

## Related

- [Architecture overview](../architecture.md#environments) — the table
- [Runbook](../runbook.md) — the per-environment setup and the cutover order
