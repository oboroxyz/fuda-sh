# Member Pass List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/rights` into a member-owned pass list built from connected holder addresses and device memory, without a fuda account.

**Architecture:** Keep device memory in one defensive localStorage module, and keep list aggregation in a separately testable domain module. The Hono JSX screen connects key rails, loads the union, polls only live `/verify/:uid` status every 30 seconds while visible, and preserves manual lookup as a secondary disclosure.

**Tech Stack:** TypeScript, Hono JSX DOM, Vitest, `@fuda/sdk`, `@fuda/ui`, Base Account EIP-1193, viem.

**Spec:** `docs/adr/0004-member-pass-list-from-holder.md`

## Global Constraints

- No server-side session, fuda account, per-member table, API route, or API pass-page change.
- Public Bearer and Signed rights are queried only by individual holder address; +Private stays on `/private` and is never combined with public holders.
- Device memory uses `localStorage` key `fuda.passes.v1`, newest first, deduped case-insensitively by uid, capped at 200 entries, and every storage access is fail-soft.
- A row's live truth comes from `GET /verify/:uid`; refresh it every 30 seconds only while the document is visible.
- Graph queries run in parallel with per-address failure isolation. Any missing or failed index source preserves device-memory rows and shows `index unavailable; showing passes saved on this device`.
- Pass links come from `passUrls(API_BASE_URL, uid)`; always show web, and hide Google or Apple when its endpoint is unavailable (including `501`).
- Keep manual address lookup behind a `Look up another address` disclosure; it remains a supported judge/debug/support path.
- `/rights?uid=<uid>` must survive an apex-to-app redirect, resolve the holder from `GET /verify/:uid`, and remember the pass when the response contains an entitlement.

---

## Design snapshot

Written 2026-09-06 on branch `b1`, after Graph plan Tasks 7–8 landed
(`/rights` in the member app reads the rights subgraph for a typed holder).
Decision record: `docs/adr/0004-member-pass-list-from-holder.md` on `main`.
Delete this file when the change is verified and the durable rules have moved
into `docs/specs/pass-types-and-flows.md` (Passes) and the member-app surface
row.

## Goal

Turn `/rights` from "enter a holder address" into "my passes": the member opens
`app.fuda.sh/rights`, and sees every right they hold, with the pass links for
each, without typing an address and without a fuda account.

## What exists (branch `b1`, verified)

- `apps/app/src/RightsList.tsx`: `RightsList` with a holder input and
  `RightsListView` rendering `GraphRight[]` cards (ACTIVE/REVOKED badge, id,
  issuer, tier, usage model, metaURI). Uses `fetchRightsByHolder` from
  `@fuda/sdk` against `GRAPH_RIGHTS_ENDPOINT` (`VITE_GRAPH_RIGHTS_ENDPOINT`,
  empty → "Rights lookup is not configured").
- `apps/app/src/route.ts`: `'rights'` is an app-only route (`/rights`), never
  rendered on the apex.
- Key rails: `apps/app/src/base-account.ts` (`baseAccountProvider`) and
  `apps/app/src/wallet.ts` (`injectedProvider`, `requestAccount`,
  `personalSign`).
- +Private discovery: `apps/app/src/private-member.ts` and `PrivateScreen.tsx`
  (client-side scan; untouched by this design).
- `@fuda/sdk` `passUrls(baseUrl, uid)` builds the web / Google / Apple links.
- `GET /verify/:uid` is the read-only status preview.

## Design

### 1. Address sources, in order

The list is the union of rights for a set of holder addresses. Sources:

| Source                        | How                                                                                                                             | Covers                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Key rail                      | "Connect passkey" → `requestAccount(baseAccountProvider())`; or injected EOA → `requestAccount(injectedProvider())`               | Signed rights; Bearer rights after activation |
| Device memory                 | `localStorage` key `fuda.passes.v1`: JSON array of `{ uid, holder, addedAt }`; written when a pass is claimed/opened in the app | Unactivated Bearer rights                     |
| Manual entry (kept, demoted)  | The existing input, behind a "look up another address" disclosure                                                               | Debugging, judges, support                    |

No signing for reads. `requestAccount` only yields the address.

### 2. Data flow

```text
addresses = dedupe(keyRailAddress?, ...deviceMemory.holders, manual?)
rights    = for each address → fetchRightsByHolder(GRAPH_RIGHTS_ENDPOINT, address)   // parallel, per-address error isolation
rows      = rights ∪ deviceMemory rows whose uid is not in rights                    // memory wins when the subgraph lags or is unset
each row  → status from GET /verify/:uid (re-read every 30 s while visible, like the pass page)
each row  → passUrls(API_BASE_URL, uid) links; hide Google/Apple links that answer 501 (same rule as the pass page)
```

- If `GRAPH_RIGHTS_ENDPOINT` is empty or the query fails, the list still
  renders device-memory rows from `GET /verify/:uid` alone, with a banner
  "index unavailable; showing passes saved on this device".
- Never combine a public holder and a stealth address in one request.
  `/private` keeps its own screen and its own fetches. A "Private rights" link
  on `/rights` navigates; it does not merge queries.

### 3. Device memory writes

- On `/issue` success paths that the member app can see (self-serve claim in
  P3a; the pass page's "open in app" link), append `{ uid, holder }`.
- On opening `/rights?uid=0x…` (a link from the browser pass), resolve the
  holder via `GET /verify/:uid` and append.
- Cap at 200 entries; newest first; dedupe by uid. Wrap every storage access
  in try/catch and treat a throwing storage as empty (private mode).

### 4. Screen

- Header: "Your passes". Buttons: "Connect passkey" (Base Account), "Use
  wallet" (injected, shown only when present), "Private rights →".
- Cards: existing `RightsListView` card + live status badge from `/verify` +
  three pass links + "Saved on this device" tag for memory-only rows.
- Empty state explains the two ways a pass gets here (claim on this device, or
  connect the key that owns it) and that activation makes it follow the key.
- Apex origin: unchanged, `/rights` redirects to `APP_ORIGIN` like `/signed`.

### 5. Out of scope here

- Activation itself (B1 P5). This design only consumes its result.
- Any api change. If P3a wants the api to return `passUrls` in more places,
  that is P3a's change.
- Sorting or grouping by issuer beyond "newest first".

## Tests (write first)

- `rights-list.test.tsx`: address union and dedupe; per-address failure does
  not blank the list; memory-only rows render with the tag; Graph endpoint
  unset → memory rows still render with the banner; a revoked row shows
  REVOKED from `/verify` even if the subgraph still says active.
- `pass-memory.test.ts`: append/dedupe/cap; throwing storage → empty; malformed
  JSON → empty.
- `route.test.ts`: `/rights?uid=` stays app-only; apex redirects.
- Existing Task 8 tests keep passing (manual entry retained).

## Docs on completion

- `docs/specs/pass-types-and-flows.md`: Passes → add "Member pass list" (the
  five rules from ADR 0004, present tense); Surfaces → `app.fuda.sh` row adds
  `/rights`.
- `docs/architecture.md` component table: member app responsibility line.
- Then delete this file.

---

### Task 1: Defensive device pass memory

**Files:**

- Create: `apps/app/src/pass-memory.ts`
- Create: `apps/app/src/pass-memory.test.ts`

**Interfaces:**

- Produces: `PASS_MEMORY_KEY = 'fuda.passes.v1'`.
- Produces: `PassMemoryEntry = { uid: Hex; holder: Hex; addedAt: number }`.
- Produces: `PassMemoryStorage` with `getItem(key: string): string | null` and `setItem(key: string, value: string): void`.
- Produces: `readPassMemory(storage?: PassMemoryStorage): PassMemoryEntry[]`.
- Produces: `rememberPass(pass: { uid: Hex; holder: Hex }, storage?: PassMemoryStorage, addedAt?: number): PassMemoryEntry[]`.

```ts
export const PASS_MEMORY_KEY = 'fuda.passes.v1'
export interface PassMemoryEntry {
  uid: Hex
  holder: Hex
  addedAt: number
}
export interface PassMemoryStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}
export declare const readPassMemory: (storage?: PassMemoryStorage) => PassMemoryEntry[]
export declare const rememberPass: (
  pass: Pick<PassMemoryEntry, 'uid' | 'holder'>,
  storage?: PassMemoryStorage,
  addedAt?: number,
) => PassMemoryEntry[]
```

- [ ] **Step 1: Write failing validation and storage tests**

  Add literal fixtures proving that a valid stored array is read newest-first, malformed JSON and malformed entries return `[]`, and a getter that throws before `localStorage` can be obtained also returns `[]`. The production break each test catches is accepting corrupt attacker-controlled storage or leaking a browser `SecurityError`.

- [ ] **Step 2: Run the focused test and verify RED**

  Run `pnpm --filter app test -- src/pass-memory.test.ts`. Expected: failure because `pass-memory.ts` and its exports do not exist.

- [ ] **Step 3: Implement fail-soft reading**

  Validate the entire decoded value as an array of exact `{ uid, holder, addedAt }` records. Accept only normalized 32-byte uids, 20-byte holders, and finite non-negative timestamps. Catch property access, `getItem`, JSON parsing, and validation failures and return `[]`.

- [ ] **Step 4: Write failing append, dedupe, and cap tests**

  Prove that remembering a pass prepends it, replaces an older same-uid entry regardless of hex case, keeps the new holder and timestamp, limits the stored JSON to 200 records, and returns `[]` when `setItem` throws. Expected values must be literal or independently constructed test fixtures.

- [ ] **Step 5: Run the focused test and verify RED**

  Run `pnpm --filter app test -- src/pass-memory.test.ts`. Expected: the read tests pass and append behavior fails because `rememberPass` is not implemented.

- [ ] **Step 6: Implement append/dedupe/cap and verify GREEN**

  Build `[newEntry, ...readPassMemory(storage).filter(...)]`, slice to 200, write once, and return the written list. Wrap the whole operation so a blocked read or write is treated as empty and never escapes.

- [ ] **Step 7: Verify and commit**

  Run `pnpm --filter app test -- src/pass-memory.test.ts`, `pnpm lint`, and `pnpm typecheck`. Commit `feat(app): remember passes on the device`.

### Task 2: Aggregate holders into the live member pass list

**Files:**

- Create: `apps/app/src/member-pass-list.ts`
- Modify: `apps/app/src/api.ts`
- Modify: `apps/app/src/api.test.ts`
- Modify: `apps/app/src/RightsList.tsx`
- Modify: `apps/app/src/rights-list.test.tsx`
- Modify: `apps/app/src/App.tsx`
- Modify: `apps/app/src/route.ts`
- Modify: `apps/app/src/route.test.ts`
- Modify: `docs/specs/pass-types-and-flows.md`
- Modify: `docs/architecture.md`

**Interfaces:**

- Consumes: Task 1's `readPassMemory` and `rememberPass` interfaces.
- Produces: `verifyUid(uid: Hex): Promise<Result<VerifyResponse>>` in `apps/app/src/api.ts`, using `GET /verify/:uid`.
- Produces: a domain row containing one uid, optional Graph metadata, optional device-memory metadata, the latest `VerifyResponse` (or unavailable state), and `passUrls(API_BASE_URL, uid)`.
- Produces: a loader that accepts connected/manual addresses plus memory entries, dedupes addresses and rows case-insensitively, uses `Promise.allSettled` for holder queries, and returns `{ rows, indexUnavailable }` without merging +Private discovery.
- Produces: a status refresher that re-reads only `/verify/:uid` for existing rows; the component schedules it at 30,000 ms and skips ticks while `document.visibilityState !== 'visible'`.

```ts
export interface MemberPassRow {
  uid: Hex
  graph: GraphRight | null
  memory: PassMemoryEntry | null
  preview: VerifyResponse | null
  passes: PassUrls
  googleHref: string | null
  appleHref: string | null
}
export interface MemberPassListInput {
  addresses: readonly Hex[]
  memory: readonly PassMemoryEntry[]
  graphConfigured: boolean
}
export interface MemberPassListIo {
  fetchRights: (holder: Hex) => Promise<GraphRight[]>
  verify: (uid: Hex) => Promise<Result<VerifyResponse>>
  googleHref: (url: string) => Promise<string | null>
  appleAvailable: (url: string) => Promise<boolean>
}
export interface MemberPassListResult {
  rows: MemberPassRow[]
  indexUnavailable: boolean
}
export declare const loadMemberPassList: (
  input: MemberPassListInput,
  io: MemberPassListIo,
) => Promise<MemberPassListResult>
export declare const refreshPassStatuses: (
  rows: readonly MemberPassRow[],
  verify: MemberPassListIo['verify'],
) => Promise<MemberPassRow[]>
```

- [ ] **Step 1: Write the failing API and aggregation tests**

  In `api.test.ts`, prove `verifyUid(UID)` calls `http://localhost:8787/verify/<UID>` with a bodyless GET. In `rights-list.test.tsx`, use injected IO functions (not module mocks) to prove: address union and case-insensitive dedupe; parallel per-address failure retains successful Graph and memory-only rows; an unset endpoint never calls Graph and raises the exact banner flag; a Graph-active row whose verify response is `{ decision: 'REJECT', reason: 'REVOKED', entitlement: ... }` renders `REVOKED`; and a memory-only row renders `Saved on this device`.

- [ ] **Step 2: Run focused tests and verify RED**

  Run `pnpm --filter app test -- src/api.test.ts src/rights-list.test.tsx`. Expected: failures for the missing verify client, aggregator, member-list row shape, and new rendered states.

- [ ] **Step 3: Implement the API client and pure aggregation domain**

  Query every unique holder concurrently, retain fulfilled results when siblings reject, union unique Graph uids with missing memory uids, verify every row independently, and retain a row with unavailable live status when one preview fails. Prefer live entitlement fields over stale Graph fields for visible holder/issuer/tier/usage data. Preserve memory `addedAt` ordering first and stable Graph order for rows that have no device timestamp; the subgraph exposes no creation timestamp, so do not invent one.

- [ ] **Step 4: Write failing pass-link availability and status-refresh tests**

  Prove web is always present; Google uses the returned `saveUrl` only on a successful JSON response; Apple uses its generated URL only after a successful `HEAD` probe; `501`, other non-2xx, malformed response, and transport failures hide the respective platform link. Prove status refresh changes a stale ACTIVE row to REVOKED without re-querying Graph.

- [ ] **Step 5: Implement pass links and status refresh, then verify GREEN**

  Keep probes injectable in domain tests. Use `passUrls(API_BASE_URL, uid)` once per row. The browser implementation may fetch Google with `GET` and probe Apple with `HEAD`; it must not throw into the screen.

- [ ] **Step 6: Write failing screen, key-rail, memory-query, and route tests**

  Prove the rendered screen says `Your passes`, has `Connect passkey`, conditionally has `Use wallet`, links `Private rights →` to `/private`, keeps `Look up another address` inside a disclosure, and explains both empty-state discovery paths. Prove successful `requestAccount` from Base Account or injected EOA adds that address to the next union without signing. Prove an app-origin `/rights?uid=<UID>` loads the uid preview and remembers its entitlement holder. Prove an apex `/rights?uid=<UID>` redirects to `APP_ORIGIN` while preserving `?uid=<UID>`.

- [ ] **Step 7: Implement the Hono JSX screen and query preservation**

  Lazily import `base-account.ts` only after the passkey button is pressed. Read injected availability once per render. Initialize from device memory and the query uid, reload rows when an address is added, catch every async rail/list failure into visible copy, and clean up the 30-second interval in the effect teardown. Render existing metadata safely, use the live badge as authority, tag only rows absent from Graph, and keep the manual form under `<details>`.

- [ ] **Step 8: Verify app behavior and update canonical documentation**

  Run `pnpm --filter app test`, `pnpm lint`, `pnpm typecheck`, and `pnpm format:check`. Update `docs/specs/pass-types-and-flows.md` with the five present-tense ADR member-list rules and revise the `app.fuda.sh` surface row. Update the member-app responsibility in `docs/architecture.md`; do not copy task sequencing into canonical docs.

- [ ] **Step 9: Commit**

  Commit `feat(app): show the member pass list` with implementation, tests, and canonical docs. Keep this temporary plan until the controller's final review passes; the controller deletes it only then.
