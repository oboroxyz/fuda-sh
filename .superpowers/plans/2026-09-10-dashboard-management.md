# Dashboard management implementation plan

> **For agentic workers:** Execute the API and UI work as separately owned domains using dispatching-parallel-agents. UI routing/forms/state are tightly coupled and stay with the primary agent. Complete targeted reviews and one final review; do not pause for additional approval because the user delegated implementation while away.

**Goal:** Deliver editable Card lists and a venue-scoped Pass dashboard with real aggregates, local commits, screenshots and a checklist.
**Architecture:** Reuse the current Hono/JSX app and Card designer. Add operator-only D1 read/write endpoints, shared SDK contracts and immutable issuance validity. The API task exclusively owns API/SDK; primary owns dash and documentation.
**Tech Stack:** Existing pnpm, Vite+, Hono, Valibot, Drizzle/D1, Tailwind/daisyUI.
**Spec:** `.superpowers/specs/2026-09-10-dashboard-management-design.md`

## Global constraints

Keep current palette/typography, work in `ui`, preserve pre-existing edits, no copying other repositories. No deployment/push. Commit messages English. API owner must not change dash/docs; primary must not change API/SDK while worker active. Use contract names exactly as in spec. No fabricated unique-human/points data. No historical expiry inferred from mutable Card settings. New endpoints no-store and issuer scoped. No private pass data or bearer QR in new list. Schema updates additive. Tests first for new behavior. Full checks once at final content; targeted tests during work. Do not commit from worker; controller groups reviewed files at end to protect existing dirty edits.

## Task 1: Backend management endpoints and aggregates

Files: `packages/sdk/src/{types,schemas,index}.ts`, optional new SDK `issuer-management.ts`; `apps/api/src/db/schema.ts`, new migration in `apps/api/migrations`; `apps/api/src/issue/issue-right.ts`; new `apps/api/src/routes/issuer-management.ts` mounted from issuers; new queries module under issuers; tests under `apps/api/test` and SDK.

- [ ] Write failing API tests with two Issuers, owned/foreign Card, valid/expired/future/revoked/consumed/historical-unknown issued rows, private row, multiple Stamp credits. For now=1000, known single-use validFrom=0 validUntil=1000 is expired; validFrom=1001 is not_yet_valid; consumed default slot means consumed only for usageModel SINGLE_USE. Unknown metadata never increments active.
- [ ] Assert unauthenticated 401, member-session refusal, owner-scoped GET/PUT 404, strict mutation reject slug and issuerId, empty tenant aggregate zero, search/card/status scoping, >200 pagination count, valid independent total/stamp counts. Run to see missing endpoint failures.
- [ ] Implement types/schema and additive migration, issuance metadata write from `IssueRequest`, owner-only edit read/replace, SQL-backed paginated list and aggregates per spec. Reuse existing validity/claim predicates and runtime conventions.
- [ ] Re-run narrow SDK/API tests, typecheck/lint touched files. Report files, commands and outcomes. Provide final API contract changes if any before UI integration.

## Task 2: Shared create/edit form and routing

Files: `apps/dash/src/{router,api,operator-io,App,AppView,CardDesigner,CardStampSettingsPage,card-designer,copy}.ts[x]`, new CardEditPage if it deepens ownership; their tests.

- [ ] Test parsing `/cards/membership/edit/`, legacy ID/stamps and old `new` slug, operator access, card resolution, navigation selection.
- [ ] Test edit hydration preserves slug, category, custom validityDays (e.g. 45), description, lockScreen venue, windows, and read-only slug. Save emits editable body without slug. Simulate deferred load/save and route/session changes; failures retain draft and retry.
- [ ] Add route helpers and exact GET/PUT bindings; implement a route-keyed edit controller and reuse CardDesigner rather than duplicating forms. Extend form props for readonly slug, labels, optional slot for Stamp settings; use the same field rendering/validation.
- [ ] Membership-only optional Stamp settings after basic form, separate save action; hide for Ticket. Text back link `< Back to card` on existing detail; actual href plus correct modified click behavior. Add Edit on detail. Prevent conflicting old/new queries.
- [ ] Run designer/router/page/controller tests and lint, review changes against spec.

## Task 3: Card list, Pass dashboard and navigation

Files: `apps/dash/src/PublishedCard.tsx`, new `IssuerPassesPage.tsx` and supporting state/query/view module, `api.ts`, `App.tsx`, `AppView.tsx`, `DashboardShell.tsx`, `copy.ts`, tests.

- [ ] Test card rows show title, type, issued/active values from aggregates, validity, public URL and Edit link; filter excludes other categories; copy success/error; no card preview/QR in table; empty/no-results state.
- [ ] Test Pass list loads scoped API, renders summary/rows, filters reset page, later requests supersede earlier ones, pagination uses filtered count, loading/error/retry and no rows all visible.
- [ ] Implement compact daisyUI metric panels and table in existing theme. `/cards` top action `+ Add card`, list counts sourced from same API summary/cardStats, lookup failure shown rather than fake zero. Responsive horizontal table containment. Optional public URL copy on Card list. `/passes` navigation with icon and translated label, operator only.
- [ ] Run relevant dash tests/typecheck/lint and compare desktop/mobile actual layout.

## Task 4: Integration, review and handoff

Files: canonical `docs/specs/pass-types-and-flows.md`, `docs/runbook.md` if migration/setup changes; `artifacts/dashboard-management/` screenshots and checklist.

- [ ] Update canonical contracts, lifecycle definitions and UI behavior. Keep private/chain authority boundaries explicit; no duplicate specs.
- [ ] Run `pnpm check`, `pnpm test` and dash build against final content. Resolve baseline formatting and use authorized sandbox escalation for compiler cache/tests if needed. A failed command is not a passed check.
- [ ] Browser exercise main routes in desktop/mobile/light/dark, modified clicks, query/load failures and keyboard navigation. If fixtures needed, use isolated browser request interception and disclose fixture data in screenshot notes; never weaken app auth.
- [ ] Independent scoped code review, fix material findings and rerun relevant checks when content changes. Review artifacts include test evidence and decisions (immutable URL, non-unique user count, historical validity unknown).
- [ ] Stage only relevant reviewed changes, inspect staged diff, commit English message(s). Preserve unrelated dirty files. Remove completed temporary plan/spec and include their deletion in final commit. Report commit IDs, screenshots and verification checklist.
