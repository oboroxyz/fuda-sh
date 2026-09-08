# Issuer API module design

Status: proposed for review; behavior-preserving refactor.

## Decision

Extract existing venue queries and creation writes into `src/issuers/`, and give self-serve issuance its own route file. Keep concrete Drizzle DB access; there is only one storage adapter and no reason for a generic repository abstraction.

## Constraints

- Keep all `/v1/issuers` paths, HTTP status/error codes, response fields, middleware scopes, and cache headers unchanged.
- Preserve issuer/card/session `db.batch` atomicity and the current pre-batch logo-upload claim order.
- Preserve issuer-scoped member numbers, claim and validity windows, rate budget 20, and best-effort ENS mirroring.
- Keep public responses free of operatorAddress and admin routes unavailable to operator credentials.
- Keep schema, migrations, dependencies, and lockfiles unchanged.
- Keep every variable-length D1 statement below 100 bound parameters.

## Modules

`issuers/queries.ts`: concrete `VenueRows` type, private `cardsOf`, exported `venueOf(db, handle)` and `ownedVenue(db, issuerId)`. Both return `Promise<VenueRows | null>` and retain oldest-first ordering and null for zero-card venues. `ownedVenue` accepts `string | null`, not Hono Context.

`issuers/create.ts`: private `cardValues`, exported `insertCard(db, issuerId, input, now)` and `insertIssuerAndCard(db, operator, input, now)`. Preserve existing catch behavior during extraction. The first returns the inserted card or null; the second returns `{ cardId, issuerId }`. UUID creation remains internal. `operator` is the existing `OperatorSession`.

`routes/self-serve-issue.ts`: move the current public POST handler, `freshMemberNumber`, `MEMBER_NUMBER_DRAWS`, and `SELF_SERVE_BUDGET` together. Keep `issueContext(c)` and HTTP/error mapping here; a pass-through service accepting Hono Context would not improve the interface.

`routes/issuers.ts`: operator routes, public venue GET, validation and ENS view remain. It composes `selfServeIssueRoutes` after the specific GET routes. `createApp` can keep its existing `issuersRoutes` registration. Search for imports of `SELF_SERVE_BUDGET` and update any consumers.

## Deferred behavior changes

Do not reclassify all caught database exceptions, change logo claim atomicity, redesign member-number reservation, or add automatic retry. These require separate failure evidence and specification review. Do not lose current behavior while improving placement.

## Acceptance

Existing endpoint tests remain the primary test surface. Verify creation/session binding, duplicate names, multiple cards, logo ownership, public privacy, scoped access, claim windows, rate limiting, configured signer errors, ENS mirroring, and API versioning. Domain modules must not import Hono Context. Canonical product behavior is unchanged; no new ADR or rewritten specification is required.
