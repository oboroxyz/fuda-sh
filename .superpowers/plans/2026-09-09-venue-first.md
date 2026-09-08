# Venue First Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the independent tasks below and review the integrated result.

**Goal:** Register venue and ENS before cards, then polish dash and app and commit the verified result.

**Architecture:** Keep the current issuer/card tables and operator session. Separate venue creation from card creation in the SDK/API, then expose separate venue and card screens using the existing Hono DOM query/controller boundary.

**Tech Stack:** Hono DOM, TanStack Query Core, daisyUI, Tailwind, Cloudflare Workers/D1, valibot, Vite+.

**Spec:** `.superpowers/specs/2026-09-09-venue-first-design.md`

## Global Constraints

- Work on the current `ui` branch, no additional worktree, no copying other repositories.
- ENS claim confirmation precedes new card creation; no ENS configured means a clear unavailable state and no card-creation bypass.
- Preserve multiple cards, existing member issuance, session generation isolation and cache ownership.
- Use daisyUI for standard UI patterns and English/Japanese copy.
- API owns durable enforcement, UI owns clear route/form guidance.
- Controller owns canonical docs and final verification/commits; implementers must not commit shared work.

## Task 1: SDK and API contract

**Files:** `packages/sdk/src/{schemas,types}.ts` and their tests; `apps/api/src/issuers/create.ts`, `apps/api/src/routes/issuers.ts`; affected API tests.

**Produces:** `IssuerCreateRequest` without card, `IssuerCreateResponse = IssuerCardsResponse`, `CardCreateResponse` retaining old single-card response fields. New issuer response always has empty cards and ENS view.

- [ ] Write regression tests: POST issuer without card returns 201, zero stored cards, same issuer visible after session reload; duplicate handle remains 409; creating cards before claim returns 409 `ens_required`, no configured ENS returns 503, confirmed ENS allows two different slugs.
- [ ] Run targeted API and SDK tests to establish the old behavior fails these expectations.
- [ ] Split issuer insertion from card insertion, keeping issuer and session binding in one db.batch. Remove `card` from IssuerCreateBody and the creation response. Gate the card route using the existing ENS view/verified mirror before insertion.
- [ ] Migrate tests that previously relied on atomic first-card creation to explicit venue creation, confirmed ENS fixture and card creation. Preserve their original assertions.
- [ ] Run SDK/API targeted tests, format and lint owned files; report exact results and files.

## Task 2: Dashboard venue onboarding

**Files:** `apps/dash/src/{App,AppView,DashboardShell,CardDesigner,PublishedCard}.tsx`, `router.ts`, `card-designer.ts`, `app-actions.ts`, `api.ts`, `copy.ts`, supporting new venue components/helpers and affected dash tests/styles.

**Consumes:** Task 1 types and endpoint contract exactly as above.

- [ ] Add failing tests for `/venue` operator route, unregistered and unclaimed `/new` redirect, reload of zero-card issuer, venue form without card fields, confirmed ENS unlocks creating cards, card list retains multiple cards.
- [ ] Add dedicated Venue form/page and `/venue` navigation with icon. Separate venue field validation from card field validation. Keep busy/error/session guards.
- [ ] Update API/action result types and App mutations so venue creation replaces operator with zero cards plus ENS state, card creation appends one card, and confirmed claim enables creation immediately without stale reads reverting it.
- [ ] Move venue identity/logo/ENS management from PublishedCard to Venue page. Present card list and first-card empty state with a clear next action.
- [ ] Refine dash hierarchy/spacing and mobile form/actions using daisyUI. Preserve existing modal/Drawer interaction.
- [ ] Run dash tests, format/lint owned files and production build; report exact results and files.

## Task 3: Member app visual refinement (controller)

**Files:** `apps/app/src/Landing.tsx`, `RightsList.tsx`, `CardScreen.tsx`, `styles.css` as justified by inspection; focused tests if behavior changes.

- [ ] Inspect existing member-facing views and styles to identify concrete design defects.
- [ ] Improve hierarchy, readable widths, empty/loading/error state presentation and mobile action layout without changing eligibility, privacy, signing or issuance semantics.
- [ ] Inspect rendered views at desktop/mobile if browser tooling is available. Run app tests and production build.

## Integration and completion

- [ ] Review each task against its contract and tests, then review the complete diff for cross-task inconsistencies.
- [ ] Update `docs/specs/pass-types-and-flows.md`, `docs/specs/ens-naming.md`, and architecture/runbook where the changed setup/contracts require it.
- [ ] Run `pnpm check`, `pnpm test`, and app/dash production builds on final content.
- [ ] Delete completed temporary plan/spec and task artifacts. Inspect `git diff --check` and source identity after doc-only cleanup.
- [ ] Commit completed work and verify clean status. Summarize concrete changes, test evidence, commits and any material limitations for morning review.
