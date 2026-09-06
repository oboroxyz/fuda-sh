# fuda Graph Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable ERC-5564 Substreams package, compose it with a fuda EAS stream, deploy a Base Sepolia rights subgraph, and move +Private discovery and chain-truth views to that subgraph.

**Architecture:** `erc5564.spkg` and `erc5564-eas-pipeline.spkg` form a disposable push lane for the submission and live demo. The rights subgraph is the self-sufficient product query lane. The completed MVP is merged first; fixture-backed Graph work then proceeds against its concrete interfaces while deployment waits for live configuration and events.

**Tech Stack:** Rust, Substreams, Protocol Buffers, The Graph CLI, AssemblyScript, Matchstick, GraphQL, pnpm, Vitest, Vite/TypeScript, Base Sepolia, EAS, ERC-5564

**Spec:** `/home/yuji/code/github.com/oboroxyz/fuda-sh-poc/public/docs/superpowers/specs/2026-09-04-c1-fuda-graph-integration.md`

## Current status (2026-09-06)

Repository-local implementation and documentation are complete through commit `1bd1d55`. The reviewed local gates pass: 415 workspace tests, 12 Matchstick tests, 13 Graph configuration tests, both locked Cargo suites and release WASM builds, both Substreams package builds, browser builds, Vite+ checks, formatting, and whitespace checks.

Deployment is intentionally pending. Keep this plan active until the remaining live gates have evidence: register the Entitlement and Attendance schemas, configure production schema UIDs/start block, stream the unchanged package on two chains, capture the composed revoke, deploy and smoke-test the rights subgraph, verify both browser views before/after revoke, run the timed demo, and prove product reads continue after stopping Substreams. `app.fuda.sh` and `api.fuda.sh` are not yet deployed.

## Global Constraints

- Use `base-sepolia`, EAS `0x4200000000000000000000000000000000000021`, and Announcer `0x55649E01B5Df198D18D95b5cc5051630cfD45564`.
- Keep ERC-5564 output raw. Viewing-key matching and metadata decoding remain on the member device.
- Emit only `uid`, `attester`, `recipient`, and `schemaUID` from EAS Substreams events. Decode attestations in the subgraph.
- Product reads depend only on the rights subgraph. Do not add a permanent Substreams sink or resident consumer.
- Accept every UID/version in the MVP `EAS_SCHEMAS` sets.
- Treat on-chain `Attendance` and the D1 `entry_log` Entry as different domain objects.
- Use subgraph manifest `specVersion: 1.3.0`.
- Do not advertise the rights subgraph as a composition source. Current Graph documentation requires all source-subgraph entities to be immutable; `Right` and `Delegation` mutate.
- Follow the repository Vite+ configuration and create all implementation from scratch in this repository.

## Dependency gates

The MVP is complete on local `main` at merge commit `50e6cd7`. Task 0 must reconcile it into this worktree before any TypeScript, Graph, app, API, or canonical-documentation work. Tasks 1, 4, and 5 can use the deterministic `env.dev.vars.EAS_SCHEMAS` values in tests, but production generation and deployment must fail while top-level `EAS_SCHEMAS` is empty or `ANNOUNCER_FROM_BLOCK` is `"0"`. Task 6 requires live schema registration, issuance, Attendance, Announcement, and revoke events. Tasks 7–8 integrate with the concrete MVP files named below.

If Task 2 cannot stream a real Base Sepolia announcement by the evening of September 8, stop Task 3 and withdraw the Composable/Standardized claim. Continue Tasks 4–8 because the rights subgraph is independent.

---

### Task 0: Reconcile the completed MVP

**Files:**
- Merge: local `main` (`50e6cd7`) into `worktree/rapid-field-2896`
- Preserve: `.superpowers/plans/2026-09-06-c1-fuda-graph-integration.md`
- Preserve: `packages/substreams/erc5564/**`
- Preserve: `packages/substreams/erc5564-eas-pipeline/**`

**Interfaces:**
- Consumes: completed MVP packages, applications, API, migrations, and canonical documentation
- Produces: one integration worktree containing the MVP and the already-built local Substreams artifacts

- [x] Record `git status --short`, then merge local `main` with a merge commit; do not squash or copy files from another repository.
- [x] Resolve only genuine overlaps, preserving the MVP as the current implementation and this plan as a temporary artifact.
- [x] Run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm check`, and `pnpm format:check`; expect success before Graph changes.
- [x] Run both Cargo test suites, release WASM builds, and package builds; expect success.
- [x] Commit the reconciliation only if Git did not already create the merge commit.

### Task 1: Pin the Graph toolchain and MVP configuration boundary

**Files:**
- Modify: `package.json`
- Create: `packages/substreams/README.md`
- Create: `packages/subgraphs/rights/package.json`
- Create: `packages/subgraphs/rights/pnpm-lock.yaml`
- Create: `packages/subgraphs/rights/config/base-sepolia.json`
- Create: `packages/subgraphs/rights/scripts/read-mvp-config.mjs`
- Create: `packages/subgraphs/rights/scripts/read-mvp-config.test.ts`

**Interfaces:**
- Consumes: `apps/api/wrangler.jsonc` values `EAS_SCHEMAS` and `ANNOUNCER_FROM_BLOCK`
- Produces: `readMvpGraphConfig(path, options?): MvpGraphConfig`

- [x] Write failing tests that preserve all three MVP keys (`entitlement`, `issuerDelegation`, `attendance`) and multiple accepted versions, normalize UIDs to lowercase, and reject missing/empty sets, malformed UIDs, duplicate UIDs or versions, and non-positive start blocks. Test both top-level production vars and an explicitly selected Wrangler environment without importing API implementation code.
- [x] Run `pnpm exec vitest run packages/subgraphs/rights/scripts/read-mvp-config.test.ts`; expect module-not-found failure.
- [x] Implement:

  ```ts
  interface SchemaVersion { uid: `0x${string}`; version: number }
  interface MvpGraphConfig {
    schemas: {
      entitlement: SchemaVersion[];
      issuerDelegation: SchemaVersion[];
      attendance: SchemaVersion[];
    };
    announcerFromBlock: number;
  }
  export function readMvpGraphConfig(
    path: string,
    options?: { environment?: string },
  ): MvpGraphConfig;
  ```

- [x] Add root `graph:prepare`, `graph:codegen`, `graph:test`, and `graph:build` scripts delegating to the independently installed `packages/subgraphs/rights`; pin Graph CLI, Graph TS, and Matchstick in its `package.json` and update its `pnpm-lock.yaml` through pnpm.
- [x] Run the focused test and `pnpm check`; expect success.
- [x] Commit with `chore(graph): add graph toolchain and MVP config boundary`.

### Task 2: Build and live-gate the reusable ERC-5564 package

**Files:**
- Create: `packages/substreams/erc5564/Cargo.toml`
- Create: `packages/substreams/erc5564/Cargo.lock`
- Create: `packages/substreams/erc5564/build.rs`
- Create: `packages/substreams/erc5564/proto/erc5564.proto`
- Create: `packages/substreams/erc5564/substreams.yaml`
- Create: `packages/substreams/erc5564/src/abi/announcer.json`
- Create: `packages/substreams/erc5564/src/lib.rs`
- Create: `packages/substreams/erc5564/tests/map_announcements.rs`
- Create: `packages/substreams/erc5564/README.md`

**Interfaces:**
- Consumes: `sf.ethereum.type.v2.Block` and `announcer_address`
- Produces: `map_announcements` → `fuda.erc5564.v1.Announcements`

- [x] Define `Announcement` with the full 32-byte big-endian `uint256` `scheme_id`, stealth address, caller, ephemeral key, metadata, transaction hash, log index, block number, and timestamp; wrap it in repeated `Announcements`.
- [x] Write fixtures for canonical-address filtering, parameter override, exact byte preservation, multiple logs, and reverted calls.
- [x] Run `cargo test --manifest-path packages/substreams/erc5564/Cargo.toml`; observe failure before the mapping exists.
- [x] Implement raw `Announcement(uint256,address,address,bytes,bytes)` extraction. Reject malformed address parameters and do not interpret metadata.
- [x] Run tests, release WASM build, and `substreams pack packages/substreams/erc5564/substreams.yaml`; expect `fuda-erc5564-v0.1.0.spkg`.
- [ ] Export the The Graph Market JWT as `SUBSTREAMS_API_TOKEN`, use the Base Sepolia endpoint shown by Market, and stream from the MVP start block. If empty, issue one +Private right and rerun from its receipt block.
- [ ] Run the unchanged package on a second Firehose-supported EVM chain with Announcer activity. Record an unchanged `sha256sum`.
- [ ] Commit with `feat(graph): extract ERC-5564 announcements with Substreams`.

### Task 3: Compose ERC-5564 and EAS streams

**Files:**
- Create: `packages/substreams/erc5564-eas-pipeline/Cargo.toml`
- Create: `packages/substreams/erc5564-eas-pipeline/Cargo.lock`
- Create: `packages/substreams/erc5564-eas-pipeline/build.rs`
- Create: `packages/substreams/erc5564-eas-pipeline/proto/fuda.proto`
- Create: `packages/substreams/erc5564-eas-pipeline/substreams.yaml`
- Create: `packages/substreams/erc5564-eas-pipeline/src/abi/eas.json`
- Create: `packages/substreams/erc5564-eas-pipeline/src/lib.rs`
- Create: `packages/substreams/erc5564-eas-pipeline/tests/map_eas_events.rs`
- Create: `packages/substreams/erc5564-eas-pipeline/tests/compose.rs`
- Create: `packages/substreams/erc5564-eas-pipeline/README.md`

**Interfaces:**
- Consumes: imported `map_announcements`, Ethereum blocks, and `eas_address`
- Produces: `map_eas_events` and combined `fuda_events`

- [x] Define `EasEvent` with kind, uid, attester, recipient, schema UID, transaction/log identity, block number, and timestamp. Define `FudaEvents` as repeated announcements plus repeated EAS events.
- [x] Write fixtures for Attested, Revoked, a lookalike event from another contract, and composition without transforming either input.
- [x] Run tests; observe failure before modules exist.
- [x] Import Task 2's package and merge its output with local EAS output. Do not filter schemas, decode data, or call RPC.
- [x] Run tests, release WASM build, and pack.
- [ ] Stream `fuda_events`, revoke a live right through the MVP dashboard/API, and verify the same UID appears promptly.
- [ ] Commit with `feat(graph): compose ERC-5564 and EAS Substreams modules`.

### Task 4: Generate a deterministic rights subgraph

**Files:**
- Create: `packages/subgraphs/rights/schema.graphql`
- Create: `packages/subgraphs/rights/subgraph.template.yaml`
- Create: `packages/subgraphs/rights/networks.json`
- Create: `packages/subgraphs/rights/abis/EAS.json`
- Create: `packages/subgraphs/rights/abis/Announcer.json`
- Create: `packages/subgraphs/rights/scripts/prepare.mjs`
- Create: `packages/subgraphs/rights/scripts/prepare.test.ts`
- Create: `packages/subgraphs/rights/src/schema-uids.ts`
- Create: `packages/subgraphs/rights/subgraph.yaml`

**Interfaces:**
- Consumes: Task 1 config reader, MVP schema shapes, and subgraph-owned contract ABIs
- Produces: generated manifest/constants and `Right`, `Delegation`, `Attendance`, `Announcement`

- [x] Write generation tests proving multiple versions survive, addresses/start blocks enter the manifest, and absent live configuration fails rather than inserting fixtures.
- [x] Define mutable Right with the exact MVP canonical Entitlement fields (including `serial`, `metaURI`, and schema version), issuer-delegation relation, revocation, block metadata, and derived attendances. Define mutable Delegation, immutable Attendance with `slotId`, and immutable raw Announcement with transaction/log identity and timestamp.
- [x] Run the generation test; expect failure before `prepare.mjs` exists.
- [x] Generate AssemblyScript UID/version maps and `subgraph.yaml` only from top-level production vars in `apps/api/wrangler.jsonc`. Keep fixture generation inside tests and never commit fixture UIDs as a deployable manifest.
- [ ] Before production values exist, run `pnpm graph:prepare`; expect an explicit configuration failure. After live schema registration and start-block configuration, run `pnpm graph:prepare && pnpm graph:codegen && pnpm graph:build`; expect success.
- [ ] Commit with `feat(graph): define the fuda rights subgraph`.

### Task 5: Index EAS entities and revocations

**Files:**
- Create: `packages/subgraphs/rights/src/eas.ts`
- Create: `packages/subgraphs/rights/src/codecs.ts`
- Create: `packages/subgraphs/rights/tests/eas.test.ts`
- Modify: `packages/subgraphs/rights/subgraph.template.yaml`

**Interfaces:**
- Consumes: generated `try_getAttestation(uid)` and UID/version maps keyed by `issuerDelegation`
- Produces: populated entities and revocation transitions

- [x] Write Matchstick tests for accepted versions, unknown-schema ignore, call revert, both relations, both mutable-entity revokes, and unknown-entity revoke.
- [x] Run the focused test; expect failure before handlers exist.
- [x] Use a subgraph-owned EAS JSON ABI containing both official `Attested` and `Revoked` events plus `getAttestation`; the MVP TypeScript `EAS_ABI` is not the Graph codegen input.
- [x] Implement `entitlementVersion`, `issuerDelegationVersion`, `attendanceVersion`, `handleAttested`, and `handleRevoked`.
- [x] Match the schema before one `try_getAttestation` call. Decode by version and upcast. Link Right by `refUID`; link Attendance by decoded `rightUID`.
- [x] Ignore malformed data and holder/recipient mismatches. Save the event time as `revokedAt` for known entities.
- [x] Run focused tests and Graph build; expect success.
- [ ] Commit with `feat(graph): index fuda rights and attendance attestations`.

### Task 6: Index announcements and verify live data

**Files:**
- Create: `packages/subgraphs/rights/src/announcer.ts`
- Create: `packages/subgraphs/rights/tests/announcer.test.ts`
- Create: `packages/subgraphs/rights/queries/smoke.graphql`
- Create: `packages/subgraphs/rights/README.md`

**Interfaces:**
- Consumes: generated Announcement binding
- Produces: immutable raw Announcement entities and a deployed endpoint

- [x] Test both known and unknown schemes, exact field preservation, and multiple logs in one transaction.
- [x] Implement ID `transactionHash.concatI32(logIndex)` with no view-tag or caller filtering.
- [x] Run `pnpm graph:test && pnpm graph:build && pnpm check`; expect success.
- [ ] After production MVP configuration is populated, emit live issue, Attendance, Announcement, and revoke events; deploy to Studio and run the smoke query.
- [ ] Compare UIDs, holders, metadata, relations, and revocation state with receipts. Require real Right, Delegation, Attendance, and Announcement entities.
- [ ] Commit with `feat(graph): index announcements and document subgraph deployment`.

### Task 7: Replace the D1 announcement cache

**Files:**
- Create: `packages/sdk/src/graph.ts`
- Create: `packages/sdk/src/graph.test.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/package.json`
- Modify: `apps/app/src/config.ts`
- Modify: `apps/app/src/vite-env.d.ts`
- Modify: `apps/app/src/api.ts`
- Modify: `apps/app/src/api.test.ts`
- Modify: `apps/app/src/PrivateScreen.tsx`
- Create: `apps/app/src/private-screen.test.tsx`
- Delete: `apps/api/src/routes/announcements.ts`
- Delete: `apps/api/src/announcements/sync.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/db/schema.ts`
- Delete: `apps/api/test/announcements.test.ts`
- Create: `apps/api/migrations/0001_drop_announcement_cache.sql`
- Modify: `apps/api/wrangler.jsonc`
- Modify: `docs/specs/pass-types-and-flows.md`

**Interfaces:**
- Consumes: `GRAPH_RIGHTS_ENDPOINT` and paginated announcements
- Produces: `fetchAnnouncements(endpoint, fromBlock, signal)`; removes `GET /announcements`

- [x] Test bigint-safe parsing, stable ordering, pagination, GraphQL/network errors, abort, integration with the existing `discover` function, and the API returning 404 for the removed route.
- [x] Fetch pages of 1,000 with a stable `(blockNumber, id)` cursor and pass raw candidates to the existing dynamically imported `discover` function; remove `announcements`, `pageAnnouncements`, `PAGE_ROWS`, and `MAX_PAGES` from `apps/app/src/api.ts`.
- [x] Keep API secrets out of browser bundles. Use Studio for the event demo and document the post-event public gateway or same-origin proxy decision.
- [ ] Remove the API route/cache/sync code, `AppDeps` announcement overrides, and `ANNOUNCER_FROM_BLOCK` binding. Add migration `0001_drop_announcement_cache.sql` dropping `announcements` and `sync_state`; retain `rate_limits`, the admin middleware, and all issue behavior.
- [x] Run `pnpm test && pnpm check && pnpm format:check`; expect success and no server-side matching.
- [ ] Commit with `feat(graph): discover private rights through the subgraph`.

### Task 8: Add card and chain-truth views

**Files:**
- Modify: `packages/sdk/src/graph.ts`
- Modify: `packages/sdk/src/graph.test.ts`
- Create: `apps/app/src/RightsList.tsx`
- Create: `apps/app/src/rights-list.test.tsx`
- Create: `apps/dash/src/chain-truth.ts`
- Create: `apps/dash/src/chain-truth.test.ts`
- Create: `apps/dash/src/ChainTruth.tsx`
- Create: `apps/dash/src/chain-truth-view.test.tsx`
- Modify: `apps/app/src/App.tsx`
- Modify: `apps/app/src/route.ts`
- Modify: `apps/app/src/route.test.ts`
- Modify: `apps/dash/src/App.tsx`
- Modify: `apps/dash/src/config.ts`
- Modify: `apps/dash/src/vite-env.d.ts`
- Modify: `docs/specs/pass-types-and-flows.md`
- Modify: `docs/specs/attestation-model.md`

**Interfaces:**
- Consumes: rights by holder, attendances by right, delegations by issuer
- Produces: typed query functions and two UI views

- [x] Add an app-only rights-list route alongside the existing `landing`, `signed`, and `private` decisions; do not render it on the apex origin.
- [x] Test address normalization, multiple/revoked/empty/error results, app cards, and dash chain-truth rendering without a D1 member row. Keep the existing Members view and admin-token flow intact.
- [x] Implement runtime-validated responses and explicit loading, empty, and error states.
- [x] Keep D1 member data and chain truth visibly separate. Never persist a private stealth holder to D1.
- [ ] Run all tests/checks and manually verify both views before and after revoke.
- [x] Commit with `feat(graph): show chain-truth rights and attendance views`.

### Task 9: Finalize evidence and canonical documentation

**Files:**
- Create: `docs/graph-demo.md`
- Create: `docs/adr/0003-graph-push-query-lanes.md`
- Modify: `README.md`
- Modify: `docs/runbook.md`
- Modify: `docs/specs/README.md`
- Modify: `docs/specs/attestation-model.md`
- Modify: `docs/specs/pass-types-and-flows.md`
- Delete: `.superpowers/plans/2026-09-06-c1-fuda-graph-integration.md`

- [ ] Time a 2–4 minute demo: identical package checksum on two chains, composed live revoke, rights query, and next gate scan turning red.
- [ ] Stop Substreams and prove discovery, card list, dash views, and revoke queries still work.
- [x] Run both Cargo suites, Graph tests/build, workspace tests/check/format, and `git diff --check`; require zero failures.
- [x] Update canonical specs with current behavior only. Record the push/query split, no-sink decision, and rejected composition-source claim in the ADR.
- [ ] Delete this completed temporary plan in the final implementation commit.
