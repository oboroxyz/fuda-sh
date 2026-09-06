# C2 ENS Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the persisted, validated, resolver-independent ENS naming foundation without touching B1-owned Issuer onboarding or issuance flows.

**Architecture:** A focused `apps/api/src/ens/` module owns canonical labels, names, persistence types, and resolution lookup. A forward-only D1 migration adds the ENS mirror tables. HTTP CCIP-Read, ENSv2 contracts, and B1 lifecycle wiring remain outside this phase behind the lookup service boundary.

**Tech Stack:** TypeScript 7, Cloudflare Workers/D1, Drizzle ORM, Valibot, viem address types, Vitest/Vite+

**Spec:** `.superpowers/specs/2026-09-06-c2-ens-foundation-design.md`

## Global Constraints

- Use `issuer` in code, columns, and technical prose; `venue` is UI copy only.
- A name is never authority and never enters the Gate admission path.
- Do not modify B1-owned Issuer onboarding, issuance, revocation, delegation, member-number generation, or UI flows.
- Do not pin ENSv2 beta deployment addresses or unstable resolver ABIs in this phase.
- Follow strict TDD: every production behavior starts with a focused failing test observed failing for the intended reason.
- D1 statements introduced later must stay below the 100-bound-parameter limit.

---

### Task 1: Canonical ENS Labels and Names

**Files:**
- Create: `apps/api/src/ens/names.ts`
- Create: `apps/api/src/ens/names.test.ts`

**Interfaces:**
- Produces: `normalizeParentName(raw: string): string`
- Produces: `isIssuerHandle(raw: string): boolean`
- Produces: `isMemberNumber(raw: string): boolean`
- Produces: `issuerEnsName(handle: string, parentName: string): string`
- Produces: `memberEnsName(memberNumber: string, issuerHandle: string, parentName: string): string`
- Produces: `parseFudaEnsName(name: string, parentName: string): { kind: 'issuer'; issuerHandle: string } | { kind: 'member'; issuerHandle: string; memberNumber: string } | null`

- [ ] **Step 1: Write failing name-model tests**

  Add table-driven tests with literal expected values for valid Handles, reserved
  Handles (`www`, `api`, `dash`, `gate`, `app`, `admin`, `fuda`), leading/trailing
  hyphens, 64-character labels, valid and corrupted member numbers, case/trailing-dot
  normalization, exact issuer/member FQDN construction, foreign parents, and invalid
  label depths. Each test names the production branch it catches.

- [ ] **Step 2: Verify the tests fail for missing behavior**

  Run: `pnpm --filter api exec vitest run src/ens/names.test.ts`

  Expected: FAIL because `src/ens/names.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure name model**

  Use the Handle expression `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/`, maximum 63
  characters, and the exact denylist above. Implement Luhn-mod-28 validation over
  `23456789acdefghjkmnpqrtuvwxy`; do not generate member numbers. Normalize only
  the parent/name casing and terminal dot—never silently repair labels.

- [ ] **Step 4: Verify focused and package tests**

  Run: `pnpm --filter api exec vitest run src/ens/names.test.ts`

  Expected: PASS.

  Run: `pnpm --filter api test`

  Expected: all API tests PASS.

- [ ] **Step 5: Commit the name model**

  ```bash
  git add apps/api/src/ens/names.ts apps/api/src/ens/names.test.ts
  git commit -m "feat(api): add canonical ENS name model"
  ```

### Task 2: ENS Mirror Persistence

**Files:**
- Create: `apps/api/src/ens/schema.ts`
- Create: `apps/api/migrations/0002_ens_foundation.sql`
- Create: `apps/api/src/ens/schema.test.ts`
- Modify: `apps/api/test/db.test.ts`

**Interfaces:**
- Produces: Drizzle tables `ensNames` and `stealthResolutions`
- Produces: types `EnsNameRow`, `NewEnsNameRow`, `StealthResolutionRow`, and `NewStealthResolutionRow`

- [ ] **Step 1: Write failing migrated-schema tests**

  Test the real migrated D1 database. Insert one valid Issuer row, one stable member
  row, and one +Private member row through Drizzle and read their values back. Assert
  rejection of duplicate names, an Issuer row carrying `right_uid`, a member row
  without `right_uid`, a +Private row with `target_address`, a +Private row without
  `stealth_meta_address`, and a stable row without `target_address`. Assert duplicate
  `(ens_name_id, nonce_counter)` and duplicate `stealth_address` rejection. Update the
  existing table inventory expectation to include `ens_names` and
  `stealth_resolutions`.

- [ ] **Step 2: Verify schema tests fail before the migration exists**

  Run: `pnpm --filter api exec vitest run src/ens/schema.test.ts test/db.test.ts`

  Expected: FAIL with missing `ens_names` / `stealth_resolutions` tables.

- [ ] **Step 3: Add the forward-only migration and Drizzle definitions**

  Add the columns and checks from the design. Use `issuer_handle` everywhere. Add
  indexes on `issuer_handle`, `right_uid`, `status`, and `ens_name_id`; add a foreign
  key from `stealth_resolutions.ens_name_id` to `ens_names.id` with `ON DELETE CASCADE`.
  Keep these definitions in `src/ens/schema.ts` so the concurrently edited base schema
  has no new production-code conflict.

- [ ] **Step 4: Verify persistence and the API regression suite**

  Run: `pnpm --filter api exec vitest run src/ens/schema.test.ts test/db.test.ts`

  Expected: PASS.

  Run: `pnpm --filter api test`

  Expected: all API tests PASS.

- [ ] **Step 5: Commit the persistence model**

  ```bash
  git add apps/api/migrations/0002_ens_foundation.sql apps/api/src/ens/schema.ts apps/api/src/ens/schema.test.ts apps/api/test/db.test.ts
  git commit -m "feat(api): add ENS naming mirror tables"
  ```

### Task 3: Resolver-Independent Lookup Service

**Files:**
- Create: `apps/api/src/ens/lookup.ts`
- Create: `apps/api/src/ens/lookup.test.ts`

**Interfaces:**
- Consumes: `parseFudaEnsName()` and the `ensNames` Drizzle table
- Produces: `type EnsLookupResult = { type: 'address'; address: Address } | { type: 'stealth'; ensNameId: number; stealthMetaAddress: Hex }`
- Produces: `lookupEnsName(db: Db, input: { name: string; parentName: string; now: number }): Promise<EnsLookupResult | null>`

- [ ] **Step 1: Write failing real-D1 lookup tests**

  Seed literal rows and assert: an active unexpired stable name returns its address;
  an active +Private row returns the stealth instruction without deriving or writing
  anything; `failed` and `unregistered` rows return null; an expired row returns null;
  the expiry instant itself remains visible (`now <= expiry`); unknown and foreign
  names return null; a claimed member row remains visible for the future claimed-Issuer
  wildcard resolver path.

- [ ] **Step 2: Verify lookup tests fail for missing service**

  Run: `pnpm --filter api exec vitest run src/ens/lookup.test.ts`

  Expected: FAIL because `lookupEnsName` does not exist.

- [ ] **Step 3: Implement one indexed lookup and explicit result variants**

  Parse the name first, query its canonical full name once, filter status to
  `offchain | claimed`, and apply the inclusive expiry bound. Validate stored address
  and hex values at the boundary with viem helpers; malformed persisted data must
  return null rather than escape into a resolver response. Do not add Hono routes or
  derive a stealth address.

- [ ] **Step 4: Verify focused and regression tests**

  Run: `pnpm --filter api exec vitest run src/ens/lookup.test.ts`

  Expected: PASS.

  Run: `pnpm --filter api test`

  Expected: all API tests PASS.

- [ ] **Step 5: Commit the lookup boundary**

  ```bash
  git add apps/api/src/ens/lookup.ts apps/api/src/ens/lookup.test.ts
  git commit -m "feat(api): add ENS lookup service"
  ```

### Task 4: Canonical Documentation and Full Verification

**Files:**
- Modify: `docs/specs/ens-naming.md`
- Modify: `docs/runbook.md`
- Delete: `.superpowers/specs/2026-09-06-c2-ens-foundation-design.md`
- Delete: `.superpowers/plans/2026-09-06-c2-ens-foundation.md`

**Interfaces:**
- Consumes: verified behavior from Tasks 1–3
- Produces: canonical documentation that distinguishes shipped foundation behavior from deferred public ENS resolution

- [ ] **Step 1: Correct canonical current-state wording**

  Update `docs/specs/ens-naming.md` so it does not claim that public ENS resolution is
  already deployed. Describe the implemented mirror/name/lookup boundary as current
  behavior and list B1 lifecycle wiring, CCIP-Read transport, +Private nonce allocation,
  onchain claim, and DNS aliasing as planned behavior. Preserve all durable privacy and
  authority invariants. Add a runbook note that no ENS secrets or deployment addresses
  are required until the adapter phase.

- [ ] **Step 2: Run the complete verification suite**

  Run: `pnpm test`

  Expected: all workspace tests PASS.

  Run: `pnpm check`

  Expected: typecheck, lint, and formatting checks PASS with no warnings.

  Run: `git diff --check`

  Expected: no output and exit code 0.

- [ ] **Step 3: Remove completed temporary artifacts**

  Delete this design and plan after their behavior is captured in canonical docs, per
  `.agents/rules/superpowers-policy.md`.

- [ ] **Step 4: Commit documentation and artifact lifecycle changes**

  ```bash
  git add docs/specs/ens-naming.md docs/runbook.md .superpowers/specs/2026-09-06-c2-ens-foundation-design.md .superpowers/plans/2026-09-06-c2-ens-foundation.md
  git commit -m "docs: describe ENS foundation boundary"
  ```
