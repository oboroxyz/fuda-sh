# Issuer Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make issuer queries and creation writes understandable independently from HTTP routing and self-serve issuance.

**Architecture:** Move existing logic into concrete issuer modules and a dedicated self-serve route. Preserve the issuer/card/session batch and compose the route through the existing issuersRoutes entry point. Avoid generic persistence adapters.

**Tech Stack:** TypeScript, Hono, Drizzle/D1, Valibot, Cloudflare Vitest pool, Vite+, pnpm.

**Spec:** `.superpowers/specs/2026-09-08-issuer-modules-design.md`

## Global Constraints

- Keep all `/v1/issuers` paths, HTTP status/error codes, response fields, middleware scopes, and cache headers unchanged.
- Preserve issuer/card/session `db.batch` atomicity and the current pre-batch logo-upload claim order.
- Preserve issuer-scoped member numbers, claim and validity windows, rate budget 20, and best-effort ENS mirroring.
- Keep public responses free of operatorAddress and admin routes unavailable to operator credentials.
- Keep schema, migrations, dependencies, and lockfiles unchanged.
- Keep every variable-length D1 statement below 100 bound parameters.

---

## Preparation

Read repository instructions, the design, `routes/issuers.ts`, `issuers/views.ts`, `auth/session.ts`, `media/store.ts`, `db/schema.ts`, `test/issuers.test.ts`, `test/logo.test.ts`, and `test/operator-scope.test.ts`. Use the current checkout unless isolation was requested; preserve pre-existing README/package changes. This plan does not authorize deployment, migrations, or implementation by itself. Follow the execution session's Git authorization; do not create a branch automatically on main.

### Task 1: Extract concrete venue queries and creation writes

**Files:**

- Create: `apps/api/src/issuers/queries.ts`
- Create: `apps/api/src/issuers/create.ts`
- Modify: `apps/api/src/routes/issuers.ts`
- Test: `apps/api/test/issuers.test.ts`, `apps/api/test/logo.test.ts`, `apps/api/test/operator-scope.test.ts`

**Interfaces:**

- `VenueRows = { issuer: typeof issuers.$inferSelect; cards: (typeof cards.$inferSelect)[] }`
- `venueOf(db: Db, handle: string): Promise<VenueRows | null>`
- `ownedVenue(db: Db, issuerId: string | null): Promise<VenueRows | null>`
- `insertCard(db: Db, issuerId: string, input: CardRequest, now: number): Promise<typeof cards.$inferSelect | null>`
- `insertIssuerAndCard(db: Db, operator: OperatorSession, input: IssuerCreateRequest, now: number): Promise<{ cardId: string; issuerId: string }>`

- [ ] **Step 1: Run the endpoint characterization suite before moving code.** `pnpm --filter api test --run test/issuers.test.ts test/logo.test.ts test/operator-scope.test.ts`. Baseline observed during diagnosis: 44 tests passed, exit 0, with workerd Broken pipe messages. If tests fail now, investigate before extraction. A behavior-preserving move should start green; do not create an artificial failing assertion solely to satisfy a workflow template.

- [ ] **Step 2: Add a public privacy assertion if the existing test does not already assert it.** In the existing `serves the venue and its cards without the operator address` test, retain actual request setup and ensure the body-level assertion includes:

```ts
expect(body).not.toHaveProperty('operatorAddress')
```

Use the existing parsed response variable or name it `body`. Do not add a new test that duplicates the entire current scenario. Verify the characterization test is green before refactoring.

- [ ] **Step 3: Move queries with explicit data dependencies.** In queries.ts import `eq` from drizzle-orm, `Db` from `../db/client.ts`, and cards/issuers from schema. Move `cardsOf` unchanged, add the `VenueRows` return annotation, and move `venueOf` unchanged except exporting it. Replace Context-dependent `mine` with:

```ts
export const ownedVenue = async (db: Db, issuerId: string | null): Promise<VenueRows | null> => {
  if (issuerId === null) {
    return null
  }
  const issuer = await db.select().from(issuers).where(eq(issuers.id, issuerId)).get()
  return issuer === undefined ? null : await cardsOf(db, issuer)
}
```

Change `/issuers/me` to `await ownedVenue(c.get('db'), c.get('operator').issuerId)`. Keep `ensView` and HTTP shaping in the route. Public venue and self-serve lookups import `venueOf`. Preserve `orderBy(cards.createdAt)` and null when a venue has no cards.

- [ ] **Step 4: Move writes by symbol without altering side effects.** Move `cardValues`, `insertCard`, and `insertIssuerAndCard` from issuers.ts (currently lines 167–234) into create.ts. Use the exact interfaces above. Replace `c.get('db')`, `c.get('operator')`, and `c.get('now')()` with their parameters; keep UUID allocation internal. Import `attachIssuer`, `claimLogoUpload`, cards/issuers, Db, OperatorSession, CardRequest, IssuerCreateRequest. Preserve the 16 card field mappings, nulls, catch-to-null logic, and the single existing three-statement `db.batch`.

At the route call sites use:

```ts
await insertIssuerAndCard(db, operator, parsed.output, c.get('now')())
const card = await insertCard(db, issuerId, parsed.output, c.get('now')())
```

These are separate call sites in the two existing handlers. Keep the handlers' validation, ownership prechecks, catches, response shaping, and status codes. Do not absorb broad error reclassification into this move.

- [ ] **Step 5: Run the same endpoint tests and inspect transaction preservation.** Expected: 44 baseline tests still pass (plus any nonduplicative assertions). Inspect `db.batch` and confirm `claimLogoUpload` still occurs before it. Use `rg -n 'Context|Hono' apps/api/src/issuers/queries.ts apps/api/src/issuers/create.ts`; expected no matches.

- [ ] **Step 6: Record the extraction under authorized Git workflow.** Commit only task files with `refactor(api): extract issuer queries and creation writes`.

### Task 2: Isolate the self-serve route while preserving route composition

**Files:**

- Create: `apps/api/src/routes/self-serve-issue.ts`
- Modify: `apps/api/src/routes/issuers.ts`
- Test: `apps/api/test/issuers.test.ts`, `apps/api/test/ens-gateway.test.ts`, `apps/api/test/versioning.test.ts`

**Interfaces:**

- Consumes: `venueOf(db, handle)` from Task 1, existing `issueContext(c)`, `issueBearer`, `mirrorMemberName`.
- Produces: `selfServeIssueRoutes: Hono<AppEnv>` and `SELF_SERVE_BUDGET = 20` in the new route file.
- Retains: `issuersRoutes` as the entry point imported by `createApp`.

- [ ] **Step 1: Record the existing self-serve contract from tests.** The same endpoint suite covers generated numbers, card binding, ticket SINGLE_USE, validity windows, no-signer/config failures, and rate limits. Read ENS gateway tests for the member-name mirror and versioning tests for `/v1` mounting. Run `pnpm --filter api test --run test/ens-gateway.test.ts test/versioning.test.ts` before the move; expected pass.

- [ ] **Step 2: Move the public issue flow as one unit.** Move `SELF_SERVE_BUDGET`, `MEMBER_NUMBER_DRAWS`, `freshMemberNumber`, and the complete `/issuers/:handle/:slug/issue` POST handler into self-serve-issue.ts. Change only its receiver to `selfServeIssueRoutes` and fix imports. Keep claim-window check before signer/config checks, preserve rate-limit middleware and no-store, keep the three-draw query and original member-number scope, and preserve ENS await/error behavior.

Compose it at the end of issuers.ts, after the existing public GET registration:

```ts
import { selfServeIssueRoutes } from './self-serve-issue.ts'

issuersRoutes.route('/', selfServeIssueRoutes)
```

The import belongs with other imports; the route call belongs after registrations. Use `rg -n 'SELF_SERVE_BUDGET|issuersRoutes' apps/api` to find direct imports and update constant consumers if any. Keep createApp unchanged. Remove the moved code and now-unused imports from issuers.ts.

- [ ] **Step 3: Verify route behavior and final content.** Run `pnpm --filter api test --run test/issuers.test.ts test/operator-scope.test.ts test/logo.test.ts test/ens-gateway.test.ts test/versioning.test.ts`. Expected all pass. Then run root `pnpm check` and `pnpm test` once against final source content and `git diff --check`. Record workerd warnings separately from assertion results.

- [ ] **Step 4: Review and record.** Verify no public path/status/payload or schema change. No canonical spec change is expected; if an actual discrepancy is discovered, record it and resolve the scope before changing behavior. Under authorized Git workflow, commit `refactor(api): isolate self-serve issuer route`.

## Completion

- [ ] Remove this plan and its issuer design after successful implementation and verification. Do not delete other active plans.
- [ ] Report test commands/results and preservation of transaction/middleware behavior. Reuse full checks while source content remains unchanged; inspect artifact-only deletion with `git diff --check`.
