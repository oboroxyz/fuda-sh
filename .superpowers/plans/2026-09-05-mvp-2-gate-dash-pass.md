# fuda MVP — Plan 2 of 5: gate, dash, Attendance hook, browser pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Bearer loop demoable end to end — issue in the dashboard, scan at the gate, see the Attendance attestation land, hand out a browser-based pass — spec §14 build-order steps 3–4.

**Architecture:** The api gains two things: the always-on Attendance hook (spec §8), implemented as the `onAdmit` seam Plan 1 left (`AdmitInfo.waitUntil` keeps the attest alive past the response; every failure is swallowed), and the browser-based pass page (`GET /pass/:uid`, hono/jsx rendered inside the api Worker, inline SVG QR, server-rendered live status plus a client refresh). Two new frontends, `apps/gate` and `apps/dash`, are hono/jsx client apps on the Vite+ pipeline (`vp dev` / `vp build`), deployed as static-assets Workers; each keeps its decision logic in pure functions with plain Vitest tests and its DOM in thin components. The QR encoder is shared through `@fuda/sdk`.

**Tech Stack:** Cloudflare Workers (wrangler 4, static assets), Hono 4.13 (`hono/jsx` server-side in the api, `hono/jsx/dom` in the browsers), Vite+ (`vp`), Tailwind v4 (`@tailwindcss/vite`) + daisyUI 5, `uqr` (pure-JS QR encoder), viem, Vitest 4.1.11 (workerd pool for the api, node for sdk/gate/dash).

**Spec:** `.superpowers/specs/2026-09-05-fuda-mvp-design.md` §8, §9 (browser-based pass), §10, §11, §13; canonical `docs/specs/README.md`, `docs/specs/attestation-model.md`, `docs/CONTEXT.md`. Plan 1 handoff: `.superpowers/sdd/handoff-from-plan-1.md`. **The code at HEAD (99cedb3) is the source of truth for Plan 1's interfaces**; read `apps/api/src/app.ts`, `src/index.ts`, `src/env.ts`, `src/verify/admit.ts`, `src/routes/verify.ts`, `src/chain/client.ts`, `src/chain/fake-chain.ts`, `src/eas/codecs.ts`, `src/eas/schemas.ts`, `src/db/schema.ts`, `src/middleware/cors.ts`, `test/fixtures.ts`, `test/env.ts` before starting.

**Plan series** (each plan produces working software on its own):

1. api core — done (`/health`, `/issue` Bearer, `/verify/:uid`, `/verify`, `/revoke`, `/members`).
2. **This plan** — Attendance hook, `GET /pass/:uid` (+ 501 stubs for google/apple), `apps/gate`, `apps/dash`.
3. Signed: `/challenge`, `/verify-signed`, member-app signed-gate screen. **First task of Plan 3:** make `consumeSlot` + `logEntry` one D1 batch before `/verify-signed` reuses them (Plan 1 ruling). Note: `members.holder` is stored EIP-55-checksummed — normalize case (viem `getAddress`) before any `WHERE holder = ?` lookup.
4. `packages/stealth` + +Private: `/issue` stealth branch, announce, `/announcements` (mount `rateLimit()`), app derive/discover/enter screens.
5. `packages/pass` Google then Apple (replacing this plan's 501 stubs), deploy topology, canonical docs update (wire constants, the four extra tables, `internal` error code, `API_BASE_URL`/`FACTORY_ADDRESS`/`USE_FAKE_CHAIN` vars, EAS `expirationTime` row + check, `ADMIN_TOKEN` guard, migration story), then delete the spec and these plans.

## Global Constraints

Copied from the spec, the repo instructions and Plan 1's rulings. Every task's requirements include this section.

- **Toolchain:** `./node_modules/.bin/vp check` from the repo root = format + lint + **type-aware type check**; it must be green before every commit. `vp check --no-fmt --no-lint` ignores inline `oxlint-disable` comments, so prefer eliminating a finding over suppressing it. Per-package commands: `vp -C apps/api test` (workerd), `vp -C packages/sdk test`, `vp -C apps/gate test`, `vp -C apps/dash test` (node), `vp -C apps/gate build`, `vp -C apps/dash build`. Root `pnpm test` = `vp run -r test`.
- **Lint (near-full-strict, Ultracite core + anti-slop + vitest, type-aware):** arrow functions only; `describe(fn, …)` for suites named after a function (`vitest/prefer-describe-function-title`); at most five `expect`s per test (`vitest/max-expects`) — split tests; no `(await x).y` (`unicorn/no-await-expression-member`); no TODO/FIXME comments (`no-warning-comments`) — use prose markers such as "Plan 5 replaces this"; object literal keys alphabetized (`sort-keys` autofix); `no-console` needs an inline reason; inline suppressions only as `// oxlint-disable-next-line <rule> -- <why>`. No `any`, no non-null assertions, no unsafe type assertions in `src/` (`// SAFETY:` comment where an invariant licenses one; prefer contextually typed template literals for `Hex`). Test files (`**/*.test.ts`, `**/test/**`) have the fixture latitude configured in the root `vite.config.ts`.
- **File names:** kebab-case; PascalCase allowed for JSX component files (`App.tsx`). `// @jsxImportSource` pragmas are allowed as jsdoc tags.
- **Workerd tests (`apps/api`):** `@cloudflare/vitest-pool-workers@0.22` via the `cloudflareTest()` Vite plugin; migrations applied by `test/setup.ts`; **no per-test storage isolation** — every test file that writes a table truncates it in `beforeEach` (pattern: `test/verify-post.test.ts`). `FakeChain` EIP-55-checksums every address it stores or returns; compare through viem `getAddress`, never against a lowercase literal. To exercise `waitUntil`, pass a 4th argument to `app.request(path, init, env, executionCtx)`.
- **Vocabulary (`docs/CONTEXT.md`):** `level` = what a right *is* (`'bearer' | 'signed' | 'private'`, on-chain `0 | 1 | 2`); `path` = how an entry was made (`'qr' | 'signature'`). Never the word "mode" for either. Bearer holder = **Claimable smart account**. Pass = a presentation of a Right (never "ticket"/"card"). Gate copy: `ADMIT` / `REJECT`; the preview-of-a-Signed-right state reads **"VALID — signature required"**.
- **Wire constants:** QR payload `fuda:v1:<uid>`; uid regex `/^0x[0-9a-fA-F]{64}$/`; `@fuda/sdk` exports `isUid`, `parseQr`, `toQr`, `TIER_LABEL`, `LEVEL_CODE`, `levelFromCode`, `USAGE_MODEL`, response types.
- **Attendance (spec §8):** on every ADMIT, after the verdict is returned, attest `Attendance` (`bytes32 rightUID,address holder,uint64 enteredAt,bytes32 slotId`) with `recipient = holder`, `refUID = uid`, `revocable = true`, `expirationTime = 0`, `slotId = bytes32(0)`, schema = newest accepted Attendance version; write the resulting uid to `entry_log.attendance_uid`; **errors swallowed; the hook never throws synchronously; always on.**
- **Browser-based pass (spec §9):** `GET /pass/:uid` is self-contained HTML (inline SVG QR of `fuda:v1:<uid>`, no external assets), shows tier label, short holder, status, an add-to-home-screen hint; on load calls `GET /verify/:uid` and renders the current state. Depends on no platform secrets, never 501s. Unknown uid → `404 { error: 'not_found' }`. `GET /pass/:uid/google` → `501 { error: 'google_not_configured' }`, `GET /pass/:uid/apple.pkpass` → `501 { error: 'apple_not_configured' }` until Plan 5.
- **Gate (spec §10–§11):** `BarcodeDetector` (`formats: ['qr_code']`) + paste fallback; `0x…64` → `GET /verify/:uid` preview, `fuda:v1:…` → `POST /verify` admission; **three display states**: GREEN ADMIT, RED REJECT (with reason), YELLOW "VALID — signature required" when the preview returns `decision: 'ADMIT'` with `entitlement.level >= 1`; network/5xx → RED with a network-error banner. No auth (open endpoints only).
- **Dash (spec §10):** prompts for the admin token, keeps it in memory only; Members table (`GET /members`: memberId, level, tier, status, uid; private rows show memberId + uid only), per row revoke (`POST /revoke`), pass links (`passUrls`-shaped from `API_BASE_URL`), QR display for every level; Issue screen (level select: Bearer memberId / Signed holder / +Private meta-address + optional memberId; tier + usageModel selects) → `POST /issue` → uid + QR (bearer/signed) or "announced — member discovers it in their app" (private). Signed/+Private submit today and the api answers `400 bad_input` until Plans 3–4 — the UI shows that error verbatim.
- **Hosts / origins:** api CORS (`apps/api/src/middleware/cors.ts`) allows `https://app.fuda.sh`, `https://dash.fuda.sh`, `https://gate.fuda.sh` and any `http://localhost:<port>` / `http://127.0.0.1:<port>`. Pinned dev ports: **gate 5174, dash 5175** (5173 is reserved for `apps/app` in Plan 3); api dev is `http://localhost:8787` (`wrangler dev --env dev`). Frontend api base comes from the Vite env var **`VITE_API_BASE_URL`**, default `http://localhost:8787`.
- **Pinned versions:** `hono@^4.13.5` (already in the lockfile), `uqr@0.1.3`, `tailwindcss@4.3.3`, `@tailwindcss/vite@4.3.3`, `daisyui@5.7.28`, `vitest@4.1.11` (exact, one shared copy). Tailwind v4 + daisyUI are configured in CSS only: `@import "tailwindcss"; @plugin "daisyui";` — no `tailwind.config.js`.
- **Commits:** English, conventional-commit style (`feat(api):`, `feat(gate):`, `feat(dash):`, `feat(sdk):`, `test:`, `chore:`, `docs:`), no attribution lines. **No copying** from other repositories (`AGENTS.md`).

---

## File structure

```
packages/sdk/
  package.json                        + dependency uqr@0.1.3
  src/qr-svg.ts                       qrSvg(text): string — inline SVG from uqr's module matrix
  src/qr-svg.test.ts
  src/index.ts                        + export * from './qr-svg.ts'
apps/api/
  tsconfig.json                       + "jsx": "react-jsx", "jsxImportSource": "hono/jsx"
  src/attendance/attendance-hook.ts   recordAttendance(deps, info), attendanceHook(deps): AdmitHook
  src/attendance/attendance-hook.test.ts
  src/index.ts                        wires attendanceHook into createApp
  src/pass/PassPage.tsx               hono/jsx page component (server-rendered)
  src/pass/pass-view.ts               passView(row, outcome): PassView — pure mapping tested in node-free workerd test
  src/routes/pass.ts                  GET /pass/:uid, /pass/:uid/google (501), /pass/:uid/apple.pkpass (501)
  src/app.ts                          + app.route('/', passRoutes)
  test/attendance.test.ts             integration: ADMIT → Attendance attest → entry_log.attendance_uid
  test/pass.test.ts                   integration: 200 html, 404, 501s, REVOKED rendered
apps/gate/
  package.json, tsconfig.json, vite.config.ts, wrangler.jsonc, index.html
  src/styles.css                      @import "tailwindcss"; @plugin "daisyui";
  src/config.ts                       API_BASE_URL from import.meta.env.VITE_API_BASE_URL
  src/api.ts                          previewUid(uid), admitQr(qr) → ApiResult<VerifyResponse>
  src/verdict.ts                      classifyInput(text), displayState(kind, result) — pure
  src/verdict.test.ts
  src/barcode.ts                      minimal BarcodeDetector typing + detector factory
  src/App.tsx, src/Scanner.tsx, src/Verdict.tsx, src/main.tsx
apps/dash/
  package.json, tsconfig.json, vite.config.ts, wrangler.jsonc, index.html
  src/styles.css
  src/config.ts
  src/api.ts                          adminFetch(token, path, init) + listMembers / issue / revoke
  src/issue-form.ts                   issueBodyFrom(form): IssueBodyInput | null — pure
  src/issue-form.test.ts
  src/members-view.ts                 memberRowView(row, apiBase): MemberRowView — pure (private rows hide holder)
  src/members-view.test.ts
  src/App.tsx, src/TokenGate.tsx, src/MembersTable.tsx, src/IssueForm.tsx, src/QrBlock.tsx, src/main.tsx
README.md                             root: list the three apps and their dev commands
```

---

### Task 1: Attendance hook (spec §8) wired into the api

**Files:**
- Create: `apps/api/src/attendance/attendance-hook.ts`, `apps/api/src/attendance/attendance-hook.test.ts`, `apps/api/test/attendance.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `AdmitHook`, `AdmitInfo` (`src/verify/admit.ts`), `ChainClient` (`src/chain/client.ts`), `Db` + `entryLog` (`src/db/*`), `parseSchemaSets`, `newest`, `SchemaSets` (`src/eas/schemas.ts`), `encodeAttendanceV1` (`src/eas/codecs.ts`), `ZERO_UID`.
- Produces:
  ```ts
  export interface AttendanceDeps { chain: ChainClient; db: Db; sets: SchemaSets }
  export const recordAttendance: (deps: AttendanceDeps, info: AdmitInfo) => Promise<void> // never rejects
  export const attendanceHook: (deps: AttendanceDeps) => AdmitHook                         // never throws
  ```

Decision (spec ambiguity): the hook needs a db handle and the schema sets, which `AdmitInfo` does not carry. `src/index.ts` already builds the app per request from bindings, so the hook closes over `getDb(env)` and `parseSchemaSets(env.EAS_SCHEMAS)` there. A malformed `EAS_SCHEMAS` or an empty Attendance set makes the hook a no-op (logged once) — admission is unaffected, matching "errors swallowed". `FakeChain.attest` needs no change: it accepts any schema and any `refUID`.

- [ ] **Step 1: Write the failing unit test**

```ts
// apps/api/src/attendance/attendance-hook.test.ts
import { env } from 'cloudflare:test'
import { getAddress } from 'viem'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { fakeChain } from '../../test/env.ts'
import { ATT, ENT, DEL, HOLDER, NOW } from '../../test/fixtures.ts'
import { ZERO_UID } from '../chain/client.ts'
import { getDb } from '../db/client.ts'
import { entryLog } from '../db/schema.ts'
import { decodeAttendanceV1 } from '../eas/codecs.ts'
import type { SchemaSets } from '../eas/schemas.ts'
import type { AdmitInfo } from '../verify/admit.ts'
import { attendanceHook, recordAttendance } from './attendance-hook.ts'

const db = () => getDb({ DB: env.DB })
const RIGHT: Hex = `0x${'ab'.repeat(32)}`
const sets: SchemaSets = {
  attendance: [{ uid: ATT, version: 1 }],
  entitlement: [{ uid: ENT, version: 1 }],
  issuerDelegation: [{ uid: DEL, version: 1 }],
}

const seedEntry = async (): Promise<number> => {
  const row = await db()
    .insert(entryLog)
    .values({ at: NOW, decision: 'ADMIT', path: 'qr', reason: 'OK', uid: RIGHT })
    .returning({ id: entryLog.id })
    .get()
  return row.id
}

const infoFor = (entryLogId: number, waitUntil: AdmitInfo['waitUntil']): AdmitInfo => ({
  entryLogId,
  holder: HOLDER,
  now: NOW,
  uid: RIGHT,
  waitUntil,
})

describe(recordAttendance, () => {
  beforeEach(async () => {
    await db().delete(entryLog)
  })

  it('attests Attendance with refUID = the right and writes the uid back', async () => {
    const chain = fakeChain()
    const id = await seedEntry()
    await recordAttendance({ chain, db: db(), sets }, infoFor(id, () => undefined))
    const att = [...chain.attestations.values()].find((a) => a.schema === ATT)
    expect(att).toMatchObject({ recipient: getAddress(HOLDER), refUID: RIGHT, revocable: true })
    expect(decodeAttendanceV1(att?.data ?? '0x')).toStrictEqual({
      enteredAt: BigInt(NOW),
      holder: getAddress(HOLDER),
      rightUID: RIGHT,
      slotId: ZERO_UID,
    })
    const row = await db().select().from(entryLog).get()
    expect(row?.attendanceUid).toBe(att?.uid)
  })

  it('swallows a failed attest and leaves attendance_uid NULL', async () => {
    const chain = fakeChain()
    chain.failWrites = true
    const id = await seedEntry()
    await expect(recordAttendance({ chain, db: db(), sets }, infoFor(id, () => undefined))).resolves.toBeUndefined()
    const row = await db().select().from(entryLog).get()
    expect(row?.attendanceUid).toBeNull()
  })

  it('is a no-op without a signer or without an accepted Attendance version', async () => {
    const id = await seedEntry()
    const noSigner = fakeChain({ signer: null })
    await recordAttendance({ chain: noSigner, db: db(), sets }, infoFor(id, () => undefined))
    const noSet = fakeChain()
    await recordAttendance({ chain: noSet, db: db(), sets: { ...sets, attendance: [] } }, infoFor(id, () => undefined))
    expect(noSigner.attestations.size + noSet.attestations.size).toBe(0)
  })
})

describe(attendanceHook, () => {
  it('hands one promise to waitUntil and never throws', async () => {
    const chain = fakeChain()
    const id = await seedEntry()
    const kept: Promise<unknown>[] = []
    const hook = attendanceHook({ chain, db: db(), sets })
    expect(() => {
      hook(infoFor(id, (p) => kept.push(p)))
    }).not.toThrow()
    expect(kept).toHaveLength(1)
    await Promise.all(kept)
    expect([...chain.attestations.values()].some((a) => a.schema === ATT)).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vp -C apps/api test src/attendance/attendance-hook.test.ts`
Expected: FAIL — cannot resolve `./attendance-hook.ts`.

- [ ] **Step 3: Implement the hook**

```ts
// apps/api/src/attendance/attendance-hook.ts
import { eq } from 'drizzle-orm'

import { ZERO_UID } from '../chain/client.ts'
import type { ChainClient } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { entryLog } from '../db/schema.ts'
import { encodeAttendanceV1 } from '../eas/codecs.ts'
import { newest } from '../eas/schemas.ts'
import type { SchemaSets } from '../eas/schemas.ts'
import type { AdmitHook, AdmitInfo } from '../verify/admit.ts'

export interface AttendanceDeps {
  chain: ChainClient
  db: Db
  sets: SchemaSets
}

// Spec §8: the on-chain entry evidence. Best-effort by construction — a lost
// record is acceptable, a failed admission is not — so every failure is
// swallowed here and this promise never rejects.
export const recordAttendance = async (deps: AttendanceDeps, info: AdmitInfo): Promise<void> => {
  const schema = newest(deps.sets.attendance)
  if (schema === null || deps.chain.signerAddress() === null) {
    return
  }
  try {
    const { uid } = await deps.chain.attest({
      data: encodeAttendanceV1({
        enteredAt: BigInt(info.now),
        holder: info.holder,
        rightUID: info.uid,
        slotId: ZERO_UID,
      }),
      expirationTime: 0n,
      recipient: info.holder,
      refUID: info.uid,
      revocable: true,
      schema: schema.uid,
    })
    await deps.db.update(entryLog).set({ attendanceUid: uid }).where(eq(entryLog.id, info.entryLogId))
  } catch (error) {
    // oxlint-disable-next-line no-console -- best-effort side effect: the log line is the only trace of a lost Attendance record
    console.warn('[fuda-api] Attendance attest failed', error)
  }
}

// The AdmitHook the api wires in production. It only schedules; it cannot throw.
export const attendanceHook =
  (deps: AttendanceDeps): AdmitHook =>
  (info) => {
    info.waitUntil(recordAttendance(deps, info))
  }
```

- [ ] **Step 4: Run the unit test**

Run: `./node_modules/.bin/vp -C apps/api test src/attendance/attendance-hook.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire it in the production entry**

Edit `apps/api/src/index.ts` — replace the default export:

```ts
import { attendanceHook } from './attendance/attendance-hook.ts'
import { getDb } from './db/client.ts'
import { parseSchemaSets } from './eas/schemas.ts'
import type { SchemaSets } from './eas/schemas.ts'

const EMPTY_SETS: SchemaSets = { attendance: [], entitlement: [], issuerDelegation: [] }

// A malformed EAS_SCHEMAS binding must not take the door down: the routes
// already answer 502 for it, and the hook simply has no schema to attest under.
const schemaSetsOf = (env: DevBindings): SchemaSets => {
  try {
    return parseSchemaSets(env.EAS_SCHEMAS)
  } catch {
    return EMPTY_SETS
  }
}

// Production entry. The chain client and the Attendance hook are built per
// request from bindings; only the explicit local-dev opt-in above ever swaps in
// an in-memory chain.
export default {
  fetch: (request: Request, env: DevBindings, ctx: ExecutionContext): Response | Promise<Response> => {
    const chain = buildChain(env)
    const onAdmit = attendanceHook({ chain, db: getDb(env), sets: schemaSetsOf(env) })
    return createApp({ chain, onAdmit }).fetch(request, env, ctx)
  },
}
```

- [ ] **Step 6: Write the failing integration test (through the app, with a real execution context)**

```ts
// apps/api/test/attendance.test.ts
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { attendanceHook } from '../src/attendance/attendance-hook.ts'
import { getDb } from '../src/db/client.ts'
import { entryLog, slots } from '../src/db/schema.ts'
import { parseSchemaSets } from '../src/eas/schemas.ts'
import { appWith, fakeChain } from './env.ts'
import { ATT, configuredEnv, NOW, seedRight, seedRoot } from './fixtures.ts'

const db = () => getDb({ DB: env.DB })

// Hono forwards a 4th `app.request` argument as the ExecutionContext, so the
// route's waitUntil is the real one here and the test can await what it kept.
const executionCtx = (kept: Promise<unknown>[]): ExecutionContext => ({
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: (p) => {
    kept.push(p)
  },
})

describe('Attendance on ADMIT', () => {
  beforeEach(async () => {
    await db().delete(entryLog)
    await db().delete(slots)
  })

  it('attests Attendance after the verdict and backfills entry_log.attendance_uid', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    const bindings = configuredEnv(del)
    const kept: Promise<unknown>[] = []
    const app = appWith({
      chain,
      now: () => NOW,
      onAdmit: attendanceHook({ chain, db: db(), sets: parseSchemaSets(bindings.EAS_SCHEMAS) }),
    })
    const res = await app.request(
      '/verify',
      { body: JSON.stringify({ qr: `fuda:v1:${uid}` }), headers: { 'content-type': 'application/json' }, method: 'POST' },
      bindings,
      executionCtx(kept),
    )
    expect(res.status).toBe(200)
    expect(kept).toHaveLength(1)
    await Promise.all(kept)
    const att = [...chain.attestations.values()].find((a) => a.schema === ATT)
    expect(att?.refUID).toBe(uid)
    const row = await db().select().from(entryLog).get()
    expect(row?.attendanceUid).toBe(att?.uid)
  })

  it('does not attest on a REJECT', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { level: 1 })
    const bindings = configuredEnv(del)
    const kept: Promise<unknown>[] = []
    const app = appWith({
      chain,
      now: () => NOW,
      onAdmit: attendanceHook({ chain, db: db(), sets: parseSchemaSets(bindings.EAS_SCHEMAS) }),
    })
    await app.request(
      '/verify',
      { body: JSON.stringify({ qr: `fuda:v1:${uid}` }), headers: { 'content-type': 'application/json' }, method: 'POST' },
      bindings,
      executionCtx(kept),
    )
    expect(kept).toHaveLength(0)
    expect([...chain.attestations.values()].some((a) => a.schema === ATT)).toBe(false)
  })
})
```

If `ExecutionContext`'s type in the pinned `@cloudflare/workers-types` lacks `props`, drop that field; match the type, not this snippet.

- [ ] **Step 7: Run the whole api suite and the check**

Run: `./node_modules/.bin/vp -C apps/api test` then `./node_modules/.bin/vp check`
Expected: all previous tests + 6 new pass; check green. Also run `./node_modules/.bin/vp -C apps/api test src/index.test.ts` to confirm the entry still builds both chains.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/attendance apps/api/src/index.ts apps/api/test/attendance.test.ts
git commit -m "feat(api): attest Attendance on every ADMIT via the onAdmit hook"
```

---

### Task 2: `qrSvg` in `@fuda/sdk`

**Files:**
- Create: `packages/sdk/src/qr-svg.ts`, `packages/sdk/src/qr-svg.test.ts`
- Modify: `packages/sdk/package.json`, `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `qrSvg(text: string, opts?: { modulePx?: number; quiet?: number }): string` — a complete `<svg …>` string with a `viewBox` in module units, a white background and one black `<path>`; used by the api pass page and the dash.

`uqr@0.1.3` is a pure-JS, dependency-free encoder (no canvas, no Node APIs) that works in workerd and browsers. `encode(text)` returns `{ size: number; data: boolean[][] }`; each `true` is a dark module. The SVG is built by hand from that matrix so the output has no external assets.

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter @fuda/sdk add uqr@0.1.3
```
Commit the lockfile with the task.

- [ ] **Step 2: Write the failing test**

```ts
// packages/sdk/src/qr-svg.test.ts
import { describe, expect, it } from 'vitest'

import { qrSvg } from './qr-svg.ts'

const UID = `0x${'ab'.repeat(32)}`

describe(qrSvg, () => {
  it('returns one self-contained svg with a module-unit viewBox', () => {
    const svg = qrSvg(`fuda:v1:${UID}`)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/u)
    expect(svg).toContain('<path d="M')
    expect(svg).not.toContain('href=')
  })

  it('is deterministic and changes with the payload', () => {
    const a = qrSvg('fuda:v1:0x00')
    expect(qrSvg('fuda:v1:0x00')).toBe(a)
    expect(qrSvg('fuda:v1:0x01')).not.toBe(a)
  })

  it('honours the quiet zone in the viewBox size', () => {
    const noQuiet = qrSvg('x', { quiet: 0 })
    const quiet = qrSvg('x', { quiet: 4 })
    const side = (s: string): number => Number(/viewBox="0 0 (?<w>\d+)/u.exec(s)?.groups?.w ?? '0')
    expect(side(quiet) - side(noQuiet)).toBe(8)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `./node_modules/.bin/vp -C packages/sdk test src/qr-svg.test.ts`
Expected: FAIL — cannot resolve `./qr-svg.ts`.

- [ ] **Step 4: Implement**

```ts
// packages/sdk/src/qr-svg.ts
import { encode } from 'uqr'

export interface QrSvgOptions {
  /** Rendered width/height in px; the viewBox stays in module units. Default 240. */
  modulePx?: number
  /** Quiet-zone modules around the symbol. Default 4 (the QR standard). */
  quiet?: number
}

// One <path> of unit squares over a white background; the QR is scanned from
// the contrast, so nothing here depends on fonts, images or external assets.
export const qrSvg = (text: string, opts: QrSvgOptions = {}): string => {
  const quiet = opts.quiet ?? 4
  const px = opts.modulePx ?? 240
  const { data, size } = encode(text)
  const side = size + quiet * 2
  const cells: string[] = []
  for (const [y, row] of data.entries()) {
    for (const [x, dark] of row.entries()) {
      if (dark) {
        cells.push(`M${x + quiet} ${y + quiet}h1v1h-1z`)
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${side}" height="${side}" fill="#fff"/>` +
    `<path d="${cells.join('')}" fill="#000"/>` +
    '</svg>'
  )
}
```

Add `export * from './qr-svg.ts'` to `packages/sdk/src/index.ts`.

- [ ] **Step 5: Run the sdk tests and the check**

Run: `./node_modules/.bin/vp -C packages/sdk test` then `./node_modules/.bin/vp check`
Expected: 12/12 pass; check green.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk pnpm-lock.yaml
git commit -m "feat(sdk): add qrSvg, an inline-SVG QR encoder shared by the pass page and the dash"
```

---

### Task 3: `GET /pass/:uid` browser-based pass + 501 wallet stubs

**Files:**
- Create: `apps/api/src/pass/pass-view.ts`, `apps/api/src/pass/pass-view.test.ts`, `apps/api/src/pass/PassPage.tsx`, `apps/api/src/routes/pass.ts`, `apps/api/test/pass.test.ts`
- Modify: `apps/api/tsconfig.json`, `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `members` table, `verifyUid`/`verifyConfig` via the existing `resolveVerdict` pattern (`src/routes/verify.ts` — extract it if reuse needs an export, see Step 4), `qrSvg`, `toQr`, `TIER_LABEL`, `isUid` (`@fuda/sdk`), `jsonResponse`, `errorResponse`.
- Produces: `passRoutes: Hono<AppEnv>`; `passView(row: PassRow, outcome: PassOutcome): PassView` (pure).

Decisions (spec ambiguities, binding):
- **"Unknown uid"** = no `members` row with that `attestation_uid`. The pass is a presentation of a right fuda issued; a foreign attestation has no pass here. The chain is read for the live status, not for existence.
- **Live status is server-rendered AND client-refreshed.** The page calls `verifyUid` while rendering (so a revoked right shows REVOKED even without JavaScript, and the integration test can assert it), then the inline script re-fetches `GET /verify/:uid` on load and every 30 s. A chain/config failure at render time shows status `UNKNOWN` with a "could not reach the chain" line and still returns 200 (the pass page never 5xxs; the QR is still shown).
- Private rows (`holder = NULL`) never reach this page in the MVP (`/issue` private branch is Plan 4 and returns no `passUrls`), but the view handles `holder: null` by rendering "—".

- [ ] **Step 1: Enable JSX in the api**

`apps/api/tsconfig.json` → add to `compilerOptions`: `"jsx": "react-jsx", "jsxImportSource": "hono/jsx"`. Files that use JSX are `.tsx` and start with `/** @jsxImportSource hono/jsx */` (the root lint config allows that jsdoc tag).

- [ ] **Step 2: Write the failing view test**

```ts
// apps/api/src/pass/pass-view.test.ts
import { describe, expect, it } from 'vitest'

import { passView } from './pass-view.ts'

const UID = `0x${'ab'.repeat(32)}` as const
const HOLDER = '0x1111111111111111111111111111111111111111' as const

describe(passView, () => {
  it('maps an active ADMIT to VALID with tier label and short holder', () => {
    const view = passView(
      { holder: HOLDER, level: 'bearer', tier: 2, uid: UID },
      { decision: 'ADMIT', reason: 'OK' },
    )
    expect(view).toMatchObject({ holderShort: '0x1111…1111', qr: `fuda:v1:${UID}`, status: 'VALID', tier: 'VIP' })
  })

  it('surfaces the REJECT reason as the status', () => {
    const view = passView({ holder: HOLDER, level: 'bearer', tier: 0, uid: UID }, { decision: 'REJECT', reason: 'REVOKED' })
    expect(view.status).toBe('REVOKED')
  })

  it('reports UNKNOWN when the chain could not be read and — for a missing holder', () => {
    const view = passView({ holder: null, level: 'private', tier: 1, uid: UID }, null)
    expect(view).toMatchObject({ holderShort: '—', status: 'UNKNOWN' })
  })
})
```

- [ ] **Step 3: Implement the view**

```ts
// apps/api/src/pass/pass-view.ts
import { TIER_LABEL, toQr } from '@fuda/sdk'
import type { Level, Reason } from '@fuda/sdk'
import type { Hex } from 'viem'

export interface PassRow {
  uid: Hex
  holder: Hex | null
  level: Level
  tier: number
}

// null = the chain could not be read at render time.
export type PassOutcome = { decision: 'ADMIT' | 'REJECT'; reason: Reason } | null

export interface PassView {
  uid: Hex
  qr: string
  tier: string
  level: Level
  holderShort: string
  status: 'VALID' | 'UNKNOWN' | Reason
}

export const shortAddress = (a: Hex): string => `${a.slice(0, 6)}…${a.slice(-4)}`

export const passView = (row: PassRow, outcome: PassOutcome): PassView => ({
  holderShort: row.holder === null ? '—' : shortAddress(row.holder),
  level: row.level,
  qr: toQr(row.uid),
  status: outcome === null ? 'UNKNOWN' : outcome.decision === 'ADMIT' ? 'VALID' : outcome.reason,
  tier: TIER_LABEL[row.tier] ?? `TIER ${row.tier}`,
  uid: row.uid,
})
```

- [ ] **Step 4: Export the verdict resolver from the verify route**

In `apps/api/src/routes/verify.ts`, `resolveVerdict` is module-private. Export it (`export const resolveVerdict = …`) — no behaviour change. It already maps config and chain failures to a `Response`; the pass route only needs to know *that* it failed.

- [ ] **Step 5: Write the page component**

```tsx
/** @jsxImportSource hono/jsx */
// apps/api/src/pass/PassPage.tsx
import { qrSvg } from '@fuda/sdk'
import { html, raw } from 'hono/html'

import type { PassView } from './pass-view.ts'

// Self-contained: inline CSS, inline SVG, one inline script that re-reads the
// live status from GET /verify/:uid. No external assets (spec §9).
const STYLE = `
  :root{color-scheme:light}body{margin:0;font-family:system-ui,sans-serif;background:#141414;color:#fff;display:flex;justify-content:center}
  main{max-width:420px;width:100%;padding:24px;box-sizing:border-box}
  .card{background:#1e1e1e;border-radius:16px;padding:20px;text-align:center}
  .qr{background:#fff;border-radius:12px;padding:12px;display:inline-block}
  .status{font-size:22px;font-weight:700;margin:12px 0}.status[data-ok=true]{color:#22c55e}.status[data-ok=false]{color:#ef4444}.status[data-ok=unknown]{color:#eab308}
  .meta{color:#aaa;font-size:14px;line-height:1.6}.hint{color:#888;font-size:12px;margin-top:16px}code{word-break:break-all}
`

const refreshScript = (uid: string) => `
  const el=document.getElementById('status');
  const paint=(s,ok)=>{el.textContent=s;el.dataset.ok=ok};
  const tick=async()=>{try{const r=await fetch('/verify/${uid}');if(!r.ok){paint('UNKNOWN','unknown');return}
    const j=await r.json();paint(j.decision==='ADMIT'?'VALID':j.reason,j.decision==='ADMIT'?'true':'false')}catch{paint('UNKNOWN','unknown')}};
  tick();setInterval(tick,30000);
`

const okAttr = (status: PassView['status']): string =>
  status === 'VALID' ? 'true' : status === 'UNKNOWN' ? 'unknown' : 'false'

export const PassPage = (view: PassView) => html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="apple-mobile-web-app-capable" content="yes"/><title>fuda pass · ${view.tier}</title><style>${raw(STYLE)}</style></head>
<body><main><div class="card">
  <div class="qr">${raw(qrSvg(view.qr))}</div>
  <div id="status" class="status" data-ok="${okAttr(view.status)}">${view.status}</div>
  <div class="meta">Tier <b>${view.tier}</b> · Member <b>${view.holderShort}</b><br/>Level ${view.level}<br/><code>${view.uid}</code></div>
  <div class="hint">Add this page to your home screen to keep the pass handy. The status re-checks the chain every 30 s.</div>
</div></main><script>${raw(refreshScript(view.uid))}</script></body></html>`
```

If the lint or type check rejects the template-literal approach through `hono/html`, render the same markup as JSX elements with `dangerouslySetInnerHTML={{ __html: qrSvg(view.qr) }}` for the SVG and the script; the content and ids must stay identical (the tests below assert on them).

- [ ] **Step 6: Write the failing integration test**

```ts
// apps/api/test/pass.test.ts
import { env } from 'cloudflare:test'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { members } from '../src/db/schema.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, HOLDER, NOW, seedRight, seedRoot } from './fixtures.ts'

const db = () => getDb({ DB: env.DB })

const insertMember = async (uid: Hex, tier = 2): Promise<void> => {
  await db().insert(members).values({ attestationUid: uid, createdAt: NOW, holder: HOLDER, level: 'bearer', memberId: 'alice', tier })
}

describe('GET /pass/:uid', () => {
  beforeEach(async () => {
    await db().delete(members)
  })

  it('renders a self-contained pass page with the QR and live status', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { tier: 2 })
    await insertMember(uid)
    const res = await appWith({ chain, now: () => NOW }).request(`/pass/${uid}`, {}, configuredEnv(del))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(body).toContain('data-ok="true">VALID<')
    expect(body).toContain('VIP')
  })

  it('shows REVOKED on the pass of a revoked right', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    chain.revokeAt(uid, 5n)
    await insertMember(uid)
    const body = await (await appWith({ chain, now: () => NOW }).request(`/pass/${uid}`, {}, configuredEnv(del))).text()
    expect(body).toContain('data-ok="false">REVOKED<')
  })

  it('still renders (status UNKNOWN) when the chain is down and never 5xxs', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await insertMember(uid)
    chain.failReads = true
    const res = await appWith({ chain, now: () => NOW }).request(`/pass/${uid}`, {}, configuredEnv(del))
    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toContain('data-ok="unknown">UNKNOWN<')
  })

  it('answers 404 not_found for a uid fuda never issued, and 400 bad_uid for junk', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const missing = await app.request(`/pass/0x${'cd'.repeat(32)}`, {}, configuredEnv(del))
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toStrictEqual({ error: 'not_found' })
    const junk = await app.request('/pass/nope', {}, configuredEnv(del))
    expect(junk.status).toBe(400)
  })

  it('answers 501 for the wallet platforms until they are configured', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await insertMember(uid)
    const app = appWith({ chain, now: () => NOW })
    const google = await app.request(`/pass/${uid}/google`, {}, configuredEnv(del))
    const apple = await app.request(`/pass/${uid}/apple.pkpass`, {}, configuredEnv(del))
    expect([google.status, apple.status]).toStrictEqual([501, 501])
    await expect(google.json()).resolves.toStrictEqual({ error: 'google_not_configured' })
    await expect(apple.json()).resolves.toStrictEqual({ error: 'apple_not_configured' })
  })
})
```

(`(await x).text()` is written as two statements if `unicorn/no-await-expression-member` fires — keep the assertions.)

- [ ] **Step 7: Implement the route**

```ts
// apps/api/src/routes/pass.ts
import { isUid } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Hex } from 'viem'

import { members } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse } from '../json.ts'
import { PassPage } from '../pass/PassPage.tsx'
import { passView } from '../pass/pass-view.ts'
import type { PassOutcome } from '../pass/pass-view.ts'
import { resolveVerdict } from './verify.ts'

export const passRoutes = new Hono<AppEnv>()

// The browser-based pass: the all-OS floor (spec §9). Depends on no platform
// secrets and never 5xxs — a chain failure only degrades the status to UNKNOWN.
passRoutes.get('/pass/:uid', async (c) => {
  const uid = c.req.param('uid')
  if (!isUid(uid)) {
    return errorResponse(c, 'bad_uid', 400)
  }
  const row = await c.get('db').select().from(members).where(eq(members.attestationUid, uid)).get()
  if (row === undefined) {
    return errorResponse(c, 'not_found', 404)
  }
  const resolved = await resolveVerdict(c, uid, c.get('now')())
  const outcome: PassOutcome = resolved.ok ? { decision: resolved.out.decision, reason: resolved.out.reason } : null
  // Annotated (not cast): holder is written only from validated Hex values.
  const holder: Hex | null = row.holder === null ? null : `0x${row.holder.slice(2)}`
  return c.html(PassPage(passView({ holder, level: row.level, tier: row.tier, uid }, outcome)))
})

// Plan 5 replaces these two with @fuda/pass builders.
passRoutes.get('/pass/:uid/google', (c) =>
  isUid(c.req.param('uid')) ? errorResponse(c, 'google_not_configured', 501) : errorResponse(c, 'bad_uid', 400),
)
passRoutes.get('/pass/:uid/apple.pkpass', (c) =>
  isUid(c.req.param('uid')) ? errorResponse(c, 'apple_not_configured', 501) : errorResponse(c, 'bad_uid', 400),
)
```

Mount in `apps/api/src/app.ts`: `app.route('/', passRoutes)` after `membersRoutes`.

- [ ] **Step 8: Run tests and check**

Run: `./node_modules/.bin/vp -C apps/api test` then `./node_modules/.bin/vp check`
Expected: all pass (5 new integration + 3 view tests); check green. If `vp check` reports the `.tsx` file as unformatted, run `./node_modules/.bin/vp fmt` and re-check.

- [ ] **Step 9: Commit**

```bash
git add apps/api/tsconfig.json apps/api/src/pass apps/api/src/routes/pass.ts apps/api/src/routes/verify.ts apps/api/src/app.ts apps/api/test/pass.test.ts
git commit -m "feat(api): add the browser-based pass page and 501 stubs for the wallet passes"
```

---

### Task 4: `apps/gate` scaffold on the Vite+ pipeline

**Files:**
- Create: `apps/gate/package.json`, `apps/gate/tsconfig.json`, `apps/gate/vite.config.ts`, `apps/gate/wrangler.jsonc`, `apps/gate/index.html`, `apps/gate/src/styles.css`, `apps/gate/src/config.ts`, `apps/gate/src/main.tsx`, `apps/gate/src/App.tsx`

**Interfaces:**
- Produces: a building, deployable static-assets Worker with a placeholder `App`; `API_BASE_URL` from `src/config.ts`.

Decision (spec §10 allows it): the scanner is promoted to the Vite+ pipeline now rather than plain JS in `public/`, because the repo's strict lint and type-aware rules apply differently to untyped JS and every other surface already builds this way.

- [ ] **Step 1: Package and configs**

```jsonc
// apps/gate/package.json
{
  "name": "gate",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vp dev",
    "build": "vp build",
    "preview": "vp preview",
    "deploy": "vp build && wrangler deploy",
    "test": "vp test"
  },
  "dependencies": {
    "@fuda/sdk": "workspace:*",
    "hono": "^4.13.5"
  },
  "devDependencies": {
    "@tailwindcss/vite": "4.3.3",
    "daisyui": "5.7.28",
    "tailwindcss": "4.3.3",
    "vitest": "4.1.11"
  }
}
```

```json
// apps/gate/tsconfig.json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx/dom",
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

```ts
// apps/gate/vite.config.ts
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite-plus'

// Pinned dev port (api CORS accepts any localhost port; 5173 is reserved for apps/app).
export default defineConfig({
  plugins: [tailwindcss()],
  server: { port: 5174, strictPort: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
```

```jsonc
// apps/gate/wrangler.jsonc
{
  "$schema": "../api/node_modules/wrangler/config-schema.json",
  "name": "fuda-gate",
  "compatibility_date": "2025-09-01",
  // Assets-only Worker: no `main`. gate.fuda.sh is attached as a custom domain at deploy time (Plan 5).
  "assets": { "directory": "./dist", "not_found_handling": "single-page-application" }
}
```

```html
<!-- apps/gate/index.html -->
<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>fuda gate</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```css
/* apps/gate/src/styles.css */
@import "tailwindcss";
@plugin "daisyui";
```

```ts
// apps/gate/src/config.ts
// VITE_API_BASE_URL is baked in at build time; local dev talks to `wrangler dev --env dev`.
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'
```

```tsx
/** @jsxImportSource hono/jsx/dom */
// apps/gate/src/App.tsx
export const App = () => (
  <main class="min-h-screen flex items-center justify-center">
    <h1 class="text-2xl font-bold">fuda gate</h1>
  </main>
)
```

```tsx
/** @jsxImportSource hono/jsx/dom */
// apps/gate/src/main.tsx
import { render } from 'hono/jsx/dom'

import { App } from './App.tsx'

const root = document.getElementById('root')
if (root !== null) {
  render(<App />, root)
}
```

- [ ] **Step 2: Install and verify JSX + Tailwind through the Vite+ build**

```bash
pnpm install
./node_modules/.bin/vp -C apps/gate build
grep -l "hono" apps/gate/dist/assets/*.js && grep -c "daisyui\|--color-" apps/gate/dist/assets/*.css
```
Expected: `dist/index.html` + one JS + one CSS; the JS bundles hono's jsx-dom runtime; the CSS contains daisyUI variables. **If the build emits React-style `jsx` calls instead** (tsconfig `jsxImportSource` not honoured by the Vite 8 transform), add to `vite.config.ts` the transform option Vite 8 documents for JSX (`oxc: { jsx: { runtime: 'automatic', importSource: 'hono/jsx/dom' } }`, or the `esbuild` equivalent if `oxc` is not the key in this version — check `node_modules/vite/dist/node/index.d.ts` for the option name), rebuild, and record which was needed.

- [ ] **Step 3: Verify dev and lint**

```bash
./node_modules/.bin/vp -C apps/gate dev &   # then curl -s http://localhost:5174 | grep root ; kill %1
./node_modules/.bin/vp check
```
Expected: dev serves on 5174; check green (add `apps/*/dist` to the root `.gitignore` if not already ignored).

- [ ] **Step 4: Commit**

```bash
git add apps/gate pnpm-lock.yaml .gitignore
git commit -m "feat(gate): scaffold the scanner app on the Vite+ pipeline"
```

---

### Task 5: `apps/gate` — verdict logic, api client, scanner, three-state display

**Files:**
- Create: `apps/gate/src/verdict.ts`, `apps/gate/src/verdict.test.ts`, `apps/gate/src/api.ts`, `apps/gate/src/barcode.ts`, `apps/gate/src/Scanner.tsx`, `apps/gate/src/Verdict.tsx`
- Modify: `apps/gate/src/App.tsx`

**Interfaces:**
- Consumes: `VerifyResponse`, `isUid`, `parseQr` (`@fuda/sdk`), `API_BASE_URL`.
- Produces (pure, tested):
  ```ts
  export type InputKind = { kind: 'preview'; uid: Hex } | { kind: 'admit'; qr: string } | { kind: 'invalid' }
  export const classifyInput: (text: string) => InputKind
  export type ApiResult = { ok: true; body: VerifyResponse } | { ok: false; error: string; network: boolean }
  export type DisplayState =
    | { tone: 'green'; title: 'ADMIT'; detail: string }
    | { tone: 'yellow'; title: 'VALID — signature required'; detail: string }
    | { tone: 'red'; title: 'REJECT'; detail: string; banner?: 'network' }
  export const displayState: (kind: 'preview' | 'admit', result: ApiResult) => DisplayState
  ```

- [ ] **Step 1: Write the failing verdict tests**

```ts
// apps/gate/src/verdict.test.ts
import { describe, expect, it } from 'vitest'

import { classifyInput, displayState } from './verdict.ts'

const UID = `0x${'ab'.repeat(32)}`
const ent = (level: number) => ({
  holder: `0x${'11'.repeat(20)}`, issuer: `0x${'f0'.repeat(20)}`, level, schemaVersion: 1, tier: 1, usageModel: 1, validFrom: 0, validUntil: 0,
})

describe(classifyInput, () => {
  it('routes a bare uid to preview and a fuda:v1 payload to admit', () => {
    expect(classifyInput(UID)).toStrictEqual({ kind: 'preview', uid: UID })
    expect(classifyInput(`fuda:v1:${UID}`)).toStrictEqual({ kind: 'admit', qr: `fuda:v1:${UID}` })
  })
  it('trims whitespace and rejects anything else', () => {
    expect(classifyInput(`  ${UID}\n`)).toStrictEqual({ kind: 'preview', uid: UID })
    expect(classifyInput('hello')).toStrictEqual({ kind: 'invalid' })
    expect(classifyInput('fuda:v2:0x00')).toStrictEqual({ kind: 'invalid' })
  })
})

describe(displayState, () => {
  it('is GREEN for an admission ADMIT', () => {
    const s = displayState('admit', { body: { decision: 'ADMIT', entitlement: ent(0), reason: 'OK' }, ok: true })
    expect(s).toMatchObject({ title: 'ADMIT', tone: 'green' })
    expect(s.detail).toContain('REGULAR')
  })
  it('is YELLOW for a preview ADMIT of a level >= 1 right, never GREEN', () => {
    const s = displayState('preview', { body: { decision: 'ADMIT', entitlement: ent(1), reason: 'OK' }, ok: true })
    expect(s).toMatchObject({ title: 'VALID — signature required', tone: 'yellow' })
  })
  it('is GREEN for a preview ADMIT of a level 0 right', () => {
    const s = displayState('preview', { body: { decision: 'ADMIT', entitlement: ent(0), reason: 'OK' }, ok: true })
    expect(s.tone).toBe('green')
  })
  it('is RED with the reason for a REJECT', () => {
    const s = displayState('admit', { body: { decision: 'REJECT', reason: 'LEVEL_REQUIRED' }, ok: true })
    expect(s).toMatchObject({ detail: 'LEVEL_REQUIRED', title: 'REJECT', tone: 'red' })
  })
  it('is RED with a network banner when the api is unreachable or 5xx', () => {
    const s = displayState('admit', { error: 'fetch failed', network: true, ok: false })
    expect(s).toMatchObject({ banner: 'network', tone: 'red' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vp -C apps/gate test`
Expected: FAIL — cannot resolve `./verdict.ts`.

- [ ] **Step 3: Implement the pure module**

```ts
// apps/gate/src/verdict.ts
import { isUid, parseQr, TIER_LABEL } from '@fuda/sdk'
import type { Hex, VerifyResponse } from '@fuda/sdk'

export type InputKind = { kind: 'preview'; uid: Hex } | { kind: 'admit'; qr: string } | { kind: 'invalid' }

// A bare uid asks "is this right valid?" (read-only preview); the fuda:v1
// payload asks for admission (spec §10).
export const classifyInput = (text: string): InputKind => {
  const t = text.trim()
  if (isUid(t)) {
    return { kind: 'preview', uid: t }
  }
  return parseQr(t) === null ? { kind: 'invalid' } : { kind: 'admit', qr: t }
}

export type ApiResult = { ok: true; body: VerifyResponse } | { ok: false; error: string; network: boolean }

export type DisplayState =
  | { tone: 'green'; title: 'ADMIT'; detail: string }
  | { tone: 'yellow'; title: 'VALID — signature required'; detail: string }
  | { tone: 'red'; title: 'REJECT'; detail: string; banner?: 'network' }

const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`

const describe = (body: VerifyResponse): string => {
  const e = body.entitlement
  return e === undefined ? '' : `${TIER_LABEL[e.tier] ?? `TIER ${e.tier}`} · ${short(e.holder)}`
}

// Three states, not two (spec §10): a preview ADMIT of a Signed/+Private right
// is valid but may not enter by QR, and staff must not read it as an admit.
export const displayState = (kind: 'preview' | 'admit', result: ApiResult): DisplayState => {
  if (!result.ok) {
    return { banner: result.network ? 'network' : undefined, detail: result.error, title: 'REJECT', tone: 'red' }
  }
  const { body } = result
  if (body.decision === 'REJECT') {
    return { detail: body.reason, title: 'REJECT', tone: 'red' }
  }
  if (kind === 'preview' && (body.entitlement?.level ?? 0) >= 1) {
    return { detail: describe(body), title: 'VALID — signature required', tone: 'yellow' }
  }
  return { detail: describe(body), title: 'ADMIT', tone: 'green' }
}
```

(`describe` shadows nothing in `src/`; if `no-shadow`-style rules complain against the vitest global in this file, rename it `summary`.)

- [ ] **Step 4: Run the tests**

Run: `./node_modules/.bin/vp -C apps/gate test`
Expected: PASS (7 tests).

- [ ] **Step 5: api client and barcode typing**

```ts
// apps/gate/src/api.ts
import type { VerifyResponse } from '@fuda/sdk'

import { API_BASE_URL } from './config.ts'
import type { ApiResult } from './verdict.ts'

// Every 5xx and every transport failure is a network condition for the door:
// the gate fails closed (spec §11) and shows the banner.
const call = async (path: string, init: RequestInit): Promise<ApiResult> => {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, init)
    if (res.status >= 500) {
      return { error: `api ${res.status}`, network: true, ok: false }
    }
    const json: unknown = await res.json()
    if (!res.ok) {
      const error = typeof json === 'object' && json !== null && 'error' in json ? String(json.error) : `api ${res.status}`
      return { error, network: false, ok: false }
    }
    // SAFETY: the api's verify endpoints answer VerifyResponse on every 2xx (spec §3).
    return { body: json as VerifyResponse, ok: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'network error', network: true, ok: false }
  }
}

export const previewUid = (uid: string): Promise<ApiResult> => call(`/verify/${uid}`, { method: 'GET' })

export const admitQr = (qr: string): Promise<ApiResult> =>
  call('/verify', { body: JSON.stringify({ qr }), headers: { 'content-type': 'application/json' }, method: 'POST' })
```

(`typeof` / `as` in `src/` trigger anti-slop rules: keep the `// SAFETY:` comment on the assertion and add `// oxlint-disable-next-line anti-slop/no-runtime-typeof -- narrowing an untyped JSON error body` on the `typeof` line if it fires.)

```ts
// apps/gate/src/barcode.ts
// lib.dom has no BarcodeDetector yet; this is the subset the scanner uses.
export interface DetectedBarcode {
  rawValue: string
}
export interface BarcodeDetectorLike {
  detect: (source: ImageBitmapSource) => Promise<DetectedBarcode[]>
}
interface BarcodeDetectorCtor {
  new (opts: { formats: string[] }): BarcodeDetectorLike
}

// null when the browser has no BarcodeDetector (desktop Firefox, older Safari) — the paste fallback still works.
export const createQrDetector = (): BarcodeDetectorLike | null => {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  return ctor === undefined ? null : new ctor({ formats: ['qr_code'] })
}
```

(The `globalThis as {…}` narrowing needs a `// SAFETY: feature detection of an optional Web API not in lib.dom` comment.)

- [ ] **Step 6: Components**

```tsx
/** @jsxImportSource hono/jsx/dom */
// apps/gate/src/Verdict.tsx
import type { DisplayState } from './verdict.ts'

const TONE = { green: 'bg-success text-success-content', red: 'bg-error text-error-content', yellow: 'bg-warning text-warning-content' } as const

export const Verdict = ({ state, onDone }: { state: DisplayState; onDone: () => void }) => (
  <div class={`fixed inset-0 flex flex-col items-center justify-center gap-4 ${TONE[state.tone]}`} onClick={onDone}>
    {state.tone === 'red' && state.banner === 'network' ? (
      <div class="badge badge-neutral">network error — gate fails closed</div>
    ) : null}
    <div class="text-5xl font-black text-center px-6">{state.title}</div>
    <div class="text-xl text-center px-6">{state.detail}</div>
    <div class="text-sm opacity-70">tap to scan again</div>
  </div>
)
```

```tsx
/** @jsxImportSource hono/jsx/dom */
// apps/gate/src/Scanner.tsx
import { useEffect, useRef, useState } from 'hono/jsx/dom'

import { createQrDetector } from './barcode.ts'

// Camera loop: one detect() per animation frame while the video plays. The
// paste box is always present so a device without BarcodeDetector still works.
export const Scanner = ({ onInput }: { onInput: (text: string) => void }) => {
  const video = useRef<HTMLVideoElement>(null)
  const [camera, setCamera] = useState<'idle' | 'on' | 'unavailable'>('idle')
  const [pasted, setPasted] = useState('')

  useEffect(() => {
    const detector = createQrDetector()
    const el = video.current
    if (detector === null || el === null) {
      setCamera('unavailable')
      return
    }
    let stream: MediaStream | null = null
    let frame = 0
    let stopped = false
    const loop = async () => {
      if (stopped) {
        return
      }
      try {
        const codes = await detector.detect(el)
        const first = codes[0]
        if (first !== undefined) {
          onInput(first.rawValue)
          return
        }
      } catch {
        // a frame that cannot be decoded is not an error
      }
      frame = requestAnimationFrame(() => {
        void loop()
      })
    }
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        stream = s
        el.srcObject = s
        await el.play()
        setCamera('on')
        void loop()
      })
      .catch(() => {
        setCamera('unavailable')
      })
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((t) => {
        t.stop()
      })
    }
  }, [onInput])

  return (
    <div class="flex flex-col gap-4 items-center p-4">
      <video ref={video} class="w-full max-w-md rounded-box bg-base-300" playsinline muted />
      {camera === 'unavailable' ? <div class="badge badge-warning">camera unavailable — paste below</div> : null}
      <form
        class="join w-full max-w-md"
        onSubmit={(e) => {
          e.preventDefault()
          onInput(pasted)
        }}
      >
        <input class="input join-item w-full" placeholder="paste fuda:v1:… or 0x…" value={pasted} onInput={(e) => setPasted((e.target as HTMLInputElement).value)} />
        <button type="submit" class="btn btn-primary join-item">Check</button>
      </form>
    </div>
  )
}
```

```tsx
/** @jsxImportSource hono/jsx/dom */
// apps/gate/src/App.tsx
import { useCallback, useState } from 'hono/jsx/dom'

import { admitQr, previewUid } from './api.ts'
import { Scanner } from './Scanner.tsx'
import { classifyInput, displayState } from './verdict.ts'
import type { DisplayState } from './verdict.ts'
import { Verdict } from './Verdict.tsx'

export const App = () => {
  const [state, setState] = useState<DisplayState | null>(null)
  const [busy, setBusy] = useState(false)

  const onInput = useCallback(
    async (text: string) => {
      if (busy) {
        return
      }
      const input = classifyInput(text)
      if (input.kind === 'invalid') {
        setState({ detail: 'not a fuda pass', title: 'REJECT', tone: 'red' })
        return
      }
      setBusy(true)
      const result = input.kind === 'preview' ? await previewUid(input.uid) : await admitQr(input.qr)
      setState(displayState(input.kind, result))
      setBusy(false)
    },
    [busy],
  )

  return (
    <main class="min-h-screen">
      <header class="navbar bg-base-200"><span class="text-xl font-bold px-2">fuda gate</span></header>
      {state === null ? <Scanner onInput={(t) => void onInput(t)} /> : <Verdict state={state} onDone={() => setState(null)} />}
    </main>
  )
}
```

Event-target narrowing (`e.target as HTMLInputElement`) is an assertion in `src/`: either use `e.currentTarget` typed by hono/jsx's event types, or keep the assertion with a `// SAFETY:` comment. Build and lint decide; behaviour must not change.

- [ ] **Step 7: Build, test, check; try it against the fake-chain api**

```bash
./node_modules/.bin/vp -C apps/gate test && ./node_modules/.bin/vp -C apps/gate build && ./node_modules/.bin/vp check
```
Manual (optional, record in the report): `pnpm --filter api dev` with `USE_FAKE_CHAIN=1` in `apps/api/.dev.vars`, issue a Bearer right via `curl -X POST localhost:8787/issue -H 'content-type: application/json' -d '{"memberId":"alice"}'`, open `http://localhost:5174`, paste the `qr` value → GREEN; paste the bare uid → GREEN; paste a uid issued at level 1 (not possible until Plan 3 — skip) — the YELLOW path is covered by the unit test.

- [ ] **Step 8: Commit**

```bash
git add apps/gate
git commit -m "feat(gate): scan or paste a pass and show the three-state verdict"
```

---

### Task 6: `apps/dash` scaffold

**Files:**
- Create: `apps/dash/package.json`, `apps/dash/tsconfig.json`, `apps/dash/vite.config.ts`, `apps/dash/wrangler.jsonc`, `apps/dash/index.html`, `apps/dash/src/styles.css`, `apps/dash/src/config.ts`, `apps/dash/src/main.tsx`, `apps/dash/src/App.tsx`

Identical to Task 4 with these substitutions: package `name: "dash"`, Worker `name: "fuda-dash"`, title `fuda dash`, dev port **5175**, heading "fuda dash". Copy the exact same `tsconfig.json`, `styles.css`, `config.ts`, `main.tsx` and the transform-option outcome recorded in Task 4 Step 2.

- [ ] **Step 1: Create the files** (as above).
- [ ] **Step 2:** `pnpm install && ./node_modules/.bin/vp -C apps/dash build && ./node_modules/.bin/vp check` — expected: dist produced, check green.
- [ ] **Step 3: Commit**

```bash
git add apps/dash pnpm-lock.yaml
git commit -m "feat(dash): scaffold the operator dashboard on the Vite+ pipeline"
```

---

### Task 7: `apps/dash` — token gate, members table, issue form

**Files:**
- Create: `apps/dash/src/api.ts`, `apps/dash/src/issue-form.ts`, `apps/dash/src/issue-form.test.ts`, `apps/dash/src/members-view.ts`, `apps/dash/src/members-view.test.ts`, `apps/dash/src/TokenGate.tsx`, `apps/dash/src/QrBlock.tsx`, `apps/dash/src/MembersTable.tsx`, `apps/dash/src/IssueForm.tsx`
- Modify: `apps/dash/src/App.tsx`

**Interfaces:**
- Consumes: `MemberRow`, `MembersResponse`, `IssueResponse`, `RevokeResponse`, `ErrorResponse`, `qrSvg`, `toQr`, `TIER_LABEL`, `USAGE_MODEL`, `ADDRESS_RE`, `META_ADDRESS_RE` (`@fuda/sdk`), `API_BASE_URL`.
- Produces (pure, tested):
  ```ts
  export interface IssueForm { level: 'bearer' | 'signed' | 'private'; memberId: string; holder: string; stealthMetaAddress: string; tier: number; usageModel: number }
  export const issueBodyFrom: (f: IssueForm) => Record<string, string | number> | null   // null = form incomplete/invalid
  export interface MemberRowView { uid: Hex; memberId: string; holderShort: string | null; level: Level; tier: string; status: 'active' | 'revoked'; qr: string; passUrls: PassUrls | null }
  export const memberRowView: (row: MemberRow, apiBase: string) => MemberRowView
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/dash/src/issue-form.test.ts
import { describe, expect, it } from 'vitest'

import { issueBodyFrom } from './issue-form.ts'

const base = { holder: '', memberId: '', stealthMetaAddress: '', tier: 1, usageModel: 1 }

describe(issueBodyFrom, () => {
  it('sends only memberId for a Bearer right', () => {
    expect(issueBodyFrom({ ...base, level: 'bearer', memberId: ' alice ' })).toStrictEqual({ memberId: 'alice', tier: 1, usageModel: 1 })
  })
  it('sends only holder for a Signed right and rejects a malformed address', () => {
    const holder = `0x${'11'.repeat(20)}`
    expect(issueBodyFrom({ ...base, holder, level: 'signed' })).toStrictEqual({ holder, tier: 1, usageModel: 1 })
    expect(issueBodyFrom({ ...base, holder: '0x11', level: 'signed' })).toBeNull()
  })
  it('sends the meta-address plus an optional memberId for a +Private right', () => {
    const meta = `0x${'22'.repeat(66)}`
    expect(issueBodyFrom({ ...base, level: 'private', stealthMetaAddress: meta })).toStrictEqual({ stealthMetaAddress: meta, tier: 1, usageModel: 1 })
    expect(issueBodyFrom({ ...base, level: 'private', memberId: 'rep', stealthMetaAddress: meta })).toMatchObject({ memberId: 'rep' })
  })
  it('returns null when the identity field is empty', () => {
    expect(issueBodyFrom({ ...base, level: 'bearer' })).toBeNull()
  })
})
```

```ts
// apps/dash/src/members-view.test.ts
import { describe, expect, it } from 'vitest'

import { memberRowView } from './members-view.ts'

const UID = `0x${'ab'.repeat(32)}` as const
const HOLDER = `0x${'11'.repeat(20)}` as const

describe(memberRowView, () => {
  it('shows a short holder, tier label, QR and pass links for a bearer row', () => {
    const v = memberRowView({ createdAt: 1, holder: HOLDER, level: 'bearer', memberId: 'alice', status: 'active', tier: 2, uid: UID }, 'https://api.fuda.sh')
    expect(v).toMatchObject({ holderShort: '0x1111…1111', qr: `fuda:v1:${UID}`, tier: 'VIP' })
    expect(v.passUrls).toStrictEqual({
      apple: `https://api.fuda.sh/pass/${UID}/apple.pkpass`,
      google: `https://api.fuda.sh/pass/${UID}/google`,
      web: `https://api.fuda.sh/pass/${UID}`,
    })
  })
  it('hides the holder and pass links for a private row but keeps memberId, uid and QR', () => {
    const v = memberRowView({ createdAt: 1, holder: null, level: 'private', memberId: '', status: 'active', tier: 0, uid: UID }, 'https://api.fuda.sh')
    expect(v).toMatchObject({ holderShort: null, passUrls: null, qr: `fuda:v1:${UID}` })
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `./node_modules/.bin/vp -C apps/dash test` — expected: FAIL, modules missing.

- [ ] **Step 3: Implement the pure modules**

```ts
// apps/dash/src/issue-form.ts
import { ADDRESS_RE, META_ADDRESS_RE } from '@fuda/sdk'

export interface IssueForm {
  level: 'bearer' | 'signed' | 'private'
  memberId: string
  holder: string
  stealthMetaAddress: string
  tier: number
  usageModel: number
}

// Mirrors the api's derivation rule (spec §3): exactly one identity key per
// level, so the request can never carry both holder and memberId.
export const issueBodyFrom = (f: IssueForm): Record<string, string | number> | null => {
  const common = { tier: f.tier, usageModel: f.usageModel }
  const memberId = f.memberId.trim()
  if (f.level === 'bearer') {
    return memberId === '' ? null : { memberId, ...common }
  }
  if (f.level === 'signed') {
    const holder = f.holder.trim()
    return ADDRESS_RE.test(holder) ? { holder, ...common } : null
  }
  const stealthMetaAddress = f.stealthMetaAddress.trim()
  if (!META_ADDRESS_RE.test(stealthMetaAddress)) {
    return null
  }
  return memberId === '' ? { stealthMetaAddress, ...common } : { memberId, stealthMetaAddress, ...common }
}
```

```ts
// apps/dash/src/members-view.ts
import { TIER_LABEL, toQr } from '@fuda/sdk'
import type { Hex, Level, MemberRow, PassUrls } from '@fuda/sdk'

export interface MemberRowView {
  uid: Hex
  memberId: string
  holderShort: string | null
  level: Level
  tier: string
  status: 'active' | 'revoked'
  qr: string
  passUrls: PassUrls | null
}

const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`

// The QR is the right's identifier, not its credential: it is safe to show for
// every level because the gate rejects a Signed/+Private QR with LEVEL_REQUIRED.
// Private rows show memberId + uid only — there is no holder to show and no
// pass to hand out (discovery is the member's path, spec §7).
export const memberRowView = (row: MemberRow, apiBase: string): MemberRowView => ({
  holderShort: row.holder === null ? null : short(row.holder),
  level: row.level,
  memberId: row.memberId,
  passUrls:
    row.level === 'private'
      ? null
      : { apple: `${apiBase}/pass/${row.uid}/apple.pkpass`, google: `${apiBase}/pass/${row.uid}/google`, web: `${apiBase}/pass/${row.uid}` },
  qr: toQr(row.uid),
  status: row.status,
  tier: TIER_LABEL[row.tier] ?? `TIER ${row.tier}`,
  uid: row.uid,
})
```

- [ ] **Step 4: Run the tests** — `./node_modules/.bin/vp -C apps/dash test` → 6 pass.

- [ ] **Step 5: api client**

```ts
// apps/dash/src/api.ts
import type { IssueResponse, MembersResponse, RevokeResponse } from '@fuda/sdk'

import { API_BASE_URL } from './config.ts'

export type Result<T> = { ok: true; body: T } | { ok: false; error: string; status: number }

// The admin token lives only in memory for the tab's lifetime (spec §10).
const adminFetch = async <T>(token: string, path: string, init: RequestInit = {}): Promise<Result<T>> => {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
    const json: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      const error = typeof json === 'object' && json !== null && 'error' in json ? String(json.error) : `api ${res.status}`
      return { error, ok: false, status: res.status }
    }
    // SAFETY: each admin endpoint's 2xx body is the typed response the caller names (spec §3).
    return { body: json as T, ok: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'network error', ok: false, status: 0 }
  }
}

export const listMembers = (token: string) => adminFetch<MembersResponse>(token, '/members')
export const issueRight = (token: string, body: Record<string, string | number>) =>
  adminFetch<IssueResponse>(token, '/issue', { body: JSON.stringify(body), method: 'POST' })
export const revokeRight = (token: string, uid: string) =>
  adminFetch<RevokeResponse>(token, '/revoke', { body: JSON.stringify({ uid }), method: 'POST' })
```

- [ ] **Step 6: Components**

```tsx
/** @jsxImportSource hono/jsx/dom */
// apps/dash/src/TokenGate.tsx
import { useState } from 'hono/jsx/dom'

export const TokenGate = ({ onToken }: { onToken: (t: string) => void }) => {
  const [value, setValue] = useState('')
  return (
    <form
      class="card bg-base-200 max-w-md mx-auto mt-16 p-6 gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        onToken(value.trim())
      }}
    >
      <h1 class="text-xl font-bold">fuda dash</h1>
      <p class="text-sm opacity-70">Enter the admin token. It is kept in memory only. Leave empty for a local api without ADMIN_TOKEN.</p>
      <input class="input w-full" type="password" placeholder="ADMIN_TOKEN" value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} />
      <button class="btn btn-primary" type="submit">Continue</button>
    </form>
  )
}
```

```tsx
/** @jsxImportSource hono/jsx/dom */
// apps/dash/src/QrBlock.tsx
import { qrSvg } from '@fuda/sdk'

export const QrBlock = ({ qr }: { qr: string }) => (
  <div class="flex flex-col items-center gap-2">
    <div class="bg-white p-2 rounded-box" dangerouslySetInnerHTML={{ __html: qrSvg(qr, { modulePx: 160 }) }} />
    <code class="text-xs break-all">{qr}</code>
  </div>
)
```

```tsx
/** @jsxImportSource hono/jsx/dom */
// apps/dash/src/MembersTable.tsx
import { useState } from 'hono/jsx/dom'

import type { MemberRowView } from './members-view.ts'
import { QrBlock } from './QrBlock.tsx'

export const MembersTable = ({ rows, onRevoke }: { rows: MemberRowView[]; onRevoke: (uid: string) => void }) => {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <table class="table table-zebra">
      <thead>
        <tr><th>member</th><th>level</th><th>tier</th><th>status</th><th>uid</th><th>pass</th><th /></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <>
            <tr key={r.uid}>
              <td>{r.memberId === '' ? <span class="opacity-50">—</span> : r.memberId}{r.holderShort === null ? null : <div class="text-xs opacity-60">{r.holderShort}</div>}</td>
              <td><span class="badge">{r.level}</span></td>
              <td>{r.tier}</td>
              <td><span class={`badge ${r.status === 'active' ? 'badge-success' : 'badge-error'}`}>{r.status}</span></td>
              <td><code class="text-xs">{`${r.uid.slice(0, 10)}…`}</code></td>
              <td>
                {r.passUrls === null ? <span class="opacity-50">—</span> : (
                  <span class="flex gap-2 text-xs">
                    <a class="link" href={r.passUrls.web} target="_blank" rel="noreferrer">web</a>
                    <a class="link" href={r.passUrls.google} target="_blank" rel="noreferrer">google</a>
                    <a class="link" href={r.passUrls.apple} target="_blank" rel="noreferrer">apple</a>
                  </span>
                )}
              </td>
              <td class="flex gap-2">
                <button class="btn btn-xs" onClick={() => setOpen(open === r.uid ? null : r.uid)}>QR</button>
                <button class="btn btn-xs btn-error" disabled={r.status === 'revoked'} onClick={() => onRevoke(r.uid)}>Revoke</button>
              </td>
            </tr>
            {open === r.uid ? <tr><td colspan={7}><QrBlock qr={r.qr} /></td></tr> : null}
          </>
        ))}
      </tbody>
    </table>
  )
}
```

```tsx
/** @jsxImportSource hono/jsx/dom */
// apps/dash/src/IssueForm.tsx
import { TIER_LABEL } from '@fuda/sdk'
import type { IssueResponse } from '@fuda/sdk'
import { useState } from 'hono/jsx/dom'

import { issueBodyFrom } from './issue-form.ts'
import type { IssueForm as Form } from './issue-form.ts'
import { QrBlock } from './QrBlock.tsx'

const USAGE = [['0', 'SINGLE_USE'], ['1', 'MULTI_USE'], ['2', 'METERED']] as const

export const IssueForm = ({ onIssue }: { onIssue: (body: Record<string, string | number>) => Promise<IssueResponse | string> }) => {
  const [form, setForm] = useState<Form>({ holder: '', level: 'bearer', memberId: '', stealthMetaAddress: '', tier: 1, usageModel: 1 })
  const [result, setResult] = useState<IssueResponse | string | null>(null)
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch })
  const value = (e: Event): string => (e.target as HTMLInputElement | HTMLSelectElement).value
  const body = issueBodyFrom(form)
  return (
    <form
      class="card bg-base-200 p-6 gap-3 max-w-xl"
      onSubmit={async (e) => {
        e.preventDefault()
        if (body !== null) {
          setResult(await onIssue(body))
        }
      }}
    >
      <h2 class="text-lg font-bold">Issue a right</h2>
      <select class="select" value={form.level} onChange={(e) => set({ level: value(e) as Form['level'] })}>
        <option value="bearer">Bearer — wallet pass, no app</option>
        <option value="signed">Signed — member wallet signs at the gate</option>
        <option value="private">+Private — stealth address from a meta-address</option>
      </select>
      {form.level === 'bearer' ? <input class="input" placeholder="memberId (e.g. alice)" value={form.memberId} onInput={(e) => set({ memberId: value(e) })} /> : null}
      {form.level === 'signed' ? <input class="input font-mono" placeholder="holder 0x…40" value={form.holder} onInput={(e) => set({ holder: value(e) })} /> : null}
      {form.level === 'private' ? (
        <>
          <input class="input font-mono" placeholder="stealth meta-address 0x…132 hex" value={form.stealthMetaAddress} onInput={(e) => set({ stealthMetaAddress: value(e) })} />
          <input class="input" placeholder="memberId (optional representative id)" value={form.memberId} onInput={(e) => set({ memberId: value(e) })} />
        </>
      ) : null}
      <div class="flex gap-3">
        <select class="select" value={String(form.tier)} onChange={(e) => set({ tier: Number(value(e)) })}>
          {TIER_LABEL.map((label, i) => <option value={String(i)}>{label}</option>)}
        </select>
        <select class="select" value={String(form.usageModel)} onChange={(e) => set({ usageModel: Number(value(e)) })}>
          {USAGE.map(([v, label]) => <option value={v}>{label}</option>)}
        </select>
      </div>
      <button class="btn btn-primary" type="submit" disabled={body === null}>Issue</button>
      {result === null ? null : typeof result === 'string' ? (
        <div class="alert alert-error">{result}</div>
      ) : result.level === 'private' ? (
        <div class="alert alert-success">announced — member discovers it in their app · tx {result.announceTx.slice(0, 10)}…</div>
      ) : (
        <div class="flex flex-col gap-2 items-start">
          <div class="alert alert-success">issued {result.level} · holder {result.holder}</div>
          <QrBlock qr={result.qr} />
          <a class="link text-sm" href={result.passUrls.web} target="_blank" rel="noreferrer">open browser-based pass</a>
        </div>
      )}
    </form>
  )
}
```

The Signed and +Private options submit today; the api answers `400 bad_input` until Plans 3–4 land, and the form shows that error verbatim — say so in a one-line `<p class="text-xs opacity-60">` under the level select.

```tsx
/** @jsxImportSource hono/jsx/dom */
// apps/dash/src/App.tsx
import type { IssueResponse } from '@fuda/sdk'
import { useCallback, useEffect, useState } from 'hono/jsx/dom'

import { issueRight, listMembers, revokeRight } from './api.ts'
import { API_BASE_URL } from './config.ts'
import { IssueForm } from './IssueForm.tsx'
import { memberRowView } from './members-view.ts'
import type { MemberRowView } from './members-view.ts'
import { MembersTable } from './MembersTable.tsx'
import { TokenGate } from './TokenGate.tsx'

export const App = () => {
  const [token, setToken] = useState<string | null>(null)
  const [rows, setRows] = useState<MemberRowView[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async (t: string) => {
    const res = await listMembers(t)
    if (res.ok) {
      setRows(res.body.members.map((m) => memberRowView(m, API_BASE_URL)))
      setError(null)
    } else {
      setError(res.status === 401 ? 'unauthorized — check the admin token' : res.error)
    }
  }, [])

  useEffect(() => {
    if (token !== null) {
      void reload(token)
    }
  }, [token, reload])

  if (token === null) {
    return <TokenGate onToken={setToken} />
  }
  const onIssue = async (body: Record<string, string | number>): Promise<IssueResponse | string> => {
    const res = await issueRight(token, body)
    if (res.ok) {
      await reload(token)
      return res.body
    }
    return res.error
  }
  const onRevoke = async (uid: string) => {
    const res = await revokeRight(token, uid)
    setError(res.ok ? null : res.error)
    await reload(token)
  }
  return (
    <main class="p-6 flex flex-col gap-6">
      <header class="navbar bg-base-200 rounded-box"><span class="text-xl font-bold px-2">fuda dash</span><span class="text-xs opacity-60 px-2">{API_BASE_URL}</span></header>
      {error === null ? null : <div class="alert alert-error">{error}</div>}
      <IssueForm onIssue={onIssue} />
      <section class="card bg-base-200 p-4">
        <h2 class="text-lg font-bold mb-2">Members</h2>
        <MembersTable rows={rows} onRevoke={(uid) => void onRevoke(uid)} />
      </section>
    </main>
  )
}
```

- [ ] **Step 7: Build, test, check; exercise against the fake-chain api**

```bash
./node_modules/.bin/vp -C apps/dash test && ./node_modules/.bin/vp -C apps/dash build && ./node_modules/.bin/vp check
```
Manual (record in the report): api dev with `USE_FAKE_CHAIN=1`, open `http://localhost:5175`, empty token → members list loads (`x-auth-mode: open`), issue Bearer `alice` → QR + web-pass link opens `GET /pass/:uid` showing VALID; revoke → row turns `revoked`, the pass page shows REVOKED on refresh; the gate (5174) scanning the same QR → RED REVOKED.

- [ ] **Step 8: Commit**

```bash
git add apps/dash
git commit -m "feat(dash): issue, list and revoke rights behind an in-memory admin token"
```

---

### Task 8: Root wiring and docs touch-ups

**Files:**
- Modify: `README.md` (root), `apps/api/README.md`

- [ ] **Step 1: Root README** — replace the placeholder body with the workspace map and the dev loop:

```md
# fuda

Membership rights as on-chain attestations, verified at a physical gate.

| Surface | Path | Dev |
| --- | --- | --- |
| api | `apps/api` | `pnpm --filter api dev` (http://localhost:8787, `--env dev`; set `USE_FAKE_CHAIN=1` in `apps/api/.dev.vars` to run without a signer) |
| gate scanner | `apps/gate` | `pnpm --filter gate dev` (http://localhost:5174) |
| operator dash | `apps/dash` | `pnpm --filter dash dev` (http://localhost:5175) |
| shared contract | `packages/sdk` | types, validators, `qrSvg` |

Frontends read the api origin from `VITE_API_BASE_URL` (default `http://localhost:8787`).

## Setup

```sh
pnpm install --frozen-lockfile
pnpm check      # format + lint + type check (vp check)
pnpm test       # every package's tests (workerd for the api)
```
```

- [ ] **Step 2: api README** — add a short "Attendance" paragraph (always on; needs a signer; failures are logged, never fail an admission) and a "Browser-based pass" line (`GET /pass/:uid`, `404 not_found` for a uid fuda never issued, `/google` and `/apple.pkpass` answer 501 until Plan 5).

- [ ] **Step 3: Verify and commit**

```bash
./node_modules/.bin/vp check && pnpm test
git add README.md apps/api/README.md
git commit -m "docs: describe the gate, dash and pass surfaces and their dev loop"
```

---

## Self-review (done while writing; re-run before execution)

**Spec coverage:**

| Spec item | Task |
| --- | --- |
| §8 Attendance on every ADMIT via `waitUntil`, `refUID = uid`, write-back, errors swallowed, always on | 1 |
| §8 announcements (+Private) | Plan 4 |
| §9 browser-based pass: self-contained, inline SVG QR, tier/holder/status, add-to-home hint, live status from `/verify/:uid`, no secrets, never 501s | 2, 3 |
| §9 Google / Apple passes | Plan 5 (501 stubs here, Task 3) |
| §3 `GET /pass/:uid` 404 not_found; `/google`, `/apple.pkpass` 501 codes | 3 |
| §10 gate: BarcodeDetector + paste, preview vs admit routing, GREEN/RED/YELLOW | 4, 5 |
| §11 gate network loss → RED + banner; revoked → RED REVOKED; second SINGLE_USE scan → RED ALREADY_USED (api already; UI shows reason) | 5 |
| §10 dash: token in memory, members table (private rows memberId + uid), revoke, pass links, QR for every level, issue form incl. Signed/+Private fields | 6, 7 |
| §13 hosts/CORS/dev ports, static-assets Workers, `vp build && wrangler deploy` | 4, 6 |
| §14 step 3 (gate + dash + Bearer Attendance hook) and step 4 (web pass) | 1–7 |

**Type consistency:** `AdmitInfo`/`AdmitHook` from `src/verify/admit.ts` (Task 1) match HEAD; `resolveVerdict` is exported in Task 3 and consumed only there; `qrSvg` (Task 2) is used by Tasks 3 and 7; `DisplayState`/`ApiResult` (Task 5) are internal to gate; `MemberRowView` and `IssueForm` (Task 7) are internal to dash; `PassUrls`, `MemberRow`, `IssueResponse`, `VerifyResponse` come from `@fuda/sdk` unchanged.

**Resolved ambiguities:** hook dependencies (db, schema sets) are closed over in `src/index.ts` per request; "unknown uid" for the pass = no `members` row; pass status is server-rendered and client-refreshed, and a chain failure degrades to `UNKNOWN` with 200; `apps/gate` promoted to the Vite+ pipeline; dev ports 5174/5175 and `VITE_API_BASE_URL`; `uqr@0.1.3` rendered by hand to one `<path>`; Signed/+Private issue forms exist now and surface the api's `400 bad_input` until Plans 3–4; the `apps/gate`/`apps/dash` Workers are assets-only (no `main`).
