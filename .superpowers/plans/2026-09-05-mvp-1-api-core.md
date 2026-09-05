# fuda MVP — Plan 1 of 5: api core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the pnpm workspace, `packages/sdk`, and `apps/api` far enough that a Bearer right can be issued, verified by QR, revoked, and listed — spec §14 build-order steps 1–2 ("First ADMIT on chain").

**Architecture:** One Hono Worker (`apps/api`) with D1 through Drizzle. All chain access goes through a `ChainClient` interface injected per request; production binds a viem implementation, workerd integration tests bind an in-memory `FakeChain`, so CI needs no funded signer and no live RPC. EAS schemas are decoded through a per-version codec that upcasts to one canonical type (the accepted-version-set seam). Shared wire types, constants and valibot validators live in `packages/sdk` so later frontends import the same contract.

**Tech Stack:** Cloudflare Workers (wrangler 4), Hono, Drizzle ORM + D1, viem, valibot, Vitest via `@cloudflare/vitest-pool-workers`, Vite+ (`vp`) for check/test.

**Spec:** `.superpowers/specs/2026-09-05-fuda-mvp-design.md` (temporary), with `docs/specs/attestation-model.md` and `docs/CONTEXT.md` as canonical. Read §1–§4, §6, §11–§14 of the spec before starting.

**Plan series** (each plan produces working software on its own):

1. **This plan** — workspace, sdk, api core: `/health`, `/issue` (Bearer), `/verify/:uid`, `/verify`, `/revoke`, `/members`.
2. Gate scanner app + operator dash + Bearer Attendance hook + browser-based pass `GET /pass/:uid`.
3. Signed: `/challenge`, `/verify-signed`, member-app signed-gate screen, Signed Attendance hook.
4. `packages/stealth` + +Private: `/issue` stealth branch, announce, `/announcements` (rate-limited), app derive/discover/enter screens.
5. `packages/pass` Google then Apple, deploy topology, canonical docs update (move wire constants and the `rate_limits` / `challenges` / `announcements` / `sync_state` tables into `docs/specs/`), then delete the spec and these plans.

## Global Constraints

Copied from the spec and repo instructions. Every task's requirements include this section.

- **Toolchain:** `vp check` (format + lint) must pass before every commit: run `./node_modules/.bin/vp check` from the repo root. Tests run with `./node_modules/.bin/vp -C apps/api test` (see Task 1 for the fallback). Root scripts: `pnpm lint`, `pnpm format`, `pnpm check`, `pnpm test`.
- **Lint is near-full-strict** (Ultracite core + anti-slop + vitest). No `any`, no non-null assertions, no unsafe type assertions in `src/`. Test files under `**/*.test.ts` and `**/test/**` get the fixture latitude already configured in `vite.config.ts`. Suppress only inline with a reason, e.g. the sequential-await loop over D1:
  ```ts
  // oxlint-disable-next-line no-await-in-loop -- D1 chunks are applied in order; parallel writes would reorder the cursor
  await db.insert(syncState).values(row)
  ```
- **File names:** kebab-case everywhere (`verify-uid.ts`, not `verifyUid.ts`).
- **Frontend framework (Plans 2–4):** hono/jsx with Vite+ (`vp dev` / `vp build`) + Tailwind v4 + daisyUI. Not used in this plan; stated so Plan 1 picks nothing that conflicts.
- **Vocabulary (`docs/CONTEXT.md`):** `level` = what a right *is* (`'bearer' | 'signed' | 'private'`, on-chain `uint8 level` `0 | 1 | 2`); `path` = how an entry was made (`'qr' | 'signature'`). Never mix them. The word "mode" is not used for either (the `x-auth-mode` header is unrelated). The Bearer holder is a **Claimable smart account** in comments and docs ("counterfactual" describes only the address).
- **Chain fixtures (Base Sepolia), verbatim:**
  - EAS `0x4200000000000000000000000000000000000021`
  - SchemaRegistry `0x4200000000000000000000000000000000000020`
  - ERC-5564 Announcer `0x55649E01B5Df198D18D95b5cc5051630cfD45564` (Plan 4)
  - Coinbase Smart Wallet factory `0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a`
  - RPC: `BASE_RPC_URL` secret, fallback `https://sepolia.base.org`
- **Schema strings, verbatim:**
  - Entitlement: `address holder,address issuer,uint8 usageModel,uint8 tier,uint8 level,bytes32 serial,uint64 validFrom,uint64 validUntil,string metaURI`
  - IssuerDelegation: `address issuer,bool active,string name`
  - Attendance: `bytes32 rightUID,address holder,uint64 enteredAt,bytes32 slotId`
  - All registered with `resolver = 0x0`, `revocable = true`; UID = `keccak256(encodePacked(['string','address','bool'], [schema, resolver, revocable]))`.
- **Enums:** `usageModel` `0 = SINGLE_USE, 1 = MULTI_USE, 2 = METERED` (> 2 → `UNKNOWN_USAGE_MODEL`); `tier` `0 = FREE, 1 = REGULAR, 2 = VIP, 3 = FOUNDER`; `level` `0 = bearer, 1 = signed, 2 = private`.
- **Wire constants:** QR payload `fuda:v1:<uid>`; uid regex `/^0x[0-9a-fA-F]{64}$/`; QR regex `/^fuda:v1:(0x[0-9a-fA-F]{64})$/`.
- **Reason codes (§6, in this order):** `NOT_FOUND`, `WRONG_SCHEMA`, `REVOKED`, `UNKNOWN_USAGE_MODEL`, `NOT_YET_VALID`, `EXPIRED`, `NO_DELEGATION` / `ISSUER_NOT_DELEGATED` / `DELEGATION_UNAVAILABLE` / `DELEGATION_CONFIG_MISSING`, `LEVEL_REQUIRED`, `ALREADY_USED`, `BAD_CHALLENGE`, `BAD_SIGNATURE`, and `OK`. All chain errors fail **closed**.
- **Error codes (HTTP):** `400 bad_input`, `400 bad_uid`, `400 bad_qr`, `400 bad_meta_address`, `400 client_ip_required`, `401 unauthorized`, `404 not_found`, `429 rate_limited`, `501 no_signer`, `502 chain_error`, `502 rpc_unavailable`. Body is always `{ "error": "<code>" }`.
- **Headers:** admin auth `Authorization: Bearer <ADMIN_TOKEN>`; `x-auth-mode: open` on every response when `ADMIN_TOKEN` is unset; client IP from `CF-Connecting-IP`.
- **Rate budget:** 120 requests / hour / IP, fixed window `floor(now / 3600) * 3600`, D1 table `rate_limits`. In the MVP it is applied to `GET /announcements` only (Plan 4). This plan builds and tests the middleware but mounts it on no production route.
- **Issuance is synchronous:** `/issue` waits for the receipt. `serial = bytes32(0)`. `issuer` field = the fuda signer address. `refUID = DELEGATION_UID`. `recipient = holder`, `revocable = true`, `expirationTime = 0`.
- **Bearer holder:** `nonce = BigInt(keccak256(toBytes(memberId)))`, `owners = [pad(ISSUER_ADDRESS, { size: 32 })]`, `holder = factory.getAddress(owners, nonce)` via `eth_call`.
- **Logging rule:** every decision-shaped response from `POST /verify` (and `POST /verify-signed` in Plan 3) is appended to `entry_log`; `4xx` input errors are not; `GET /verify/:uid` is never logged and never consumes.
- **Commits:** English, conventional-commit style (`feat:`, `test:`, `chore:`, `docs:`), no attribution lines.
- **No copying** from other repositories, per `AGENTS.md`.

---

## File structure

```
package.json                      add "test" script → vp run -r test
vite.config.ts                    unchanged (root lint/fmt); no root `test` block
pnpm-workspace.yaml               unchanged (apps/*, packages/*)
packages/sdk/
  package.json                    "@fuda/sdk", exports "./src/index.ts"
  tsconfig.json                   extends ../../tsconfig.json
  vite.config.ts                  test.include for unit tests (plain Vitest, node)
  src/index.ts                    re-exports
  src/constants.ts                regexes, QR prefix, enums, reason + error code unions
  src/schemas.ts                  valibot schemas for request bodies
  src/types.ts                    response shapes (IssueResponse, VerifyResponse, MemberRow …)
  src/constants.test.ts, src/schemas.test.ts
apps/api/
  package.json                    "api" — hono, drizzle-orm, viem, valibot, @fuda/sdk; dev: wrangler, drizzle-kit, @cloudflare/vitest-pool-workers, @cloudflare/workers-types
  tsconfig.json                   extends root; types ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]
  wrangler.jsonc                  name "fuda-api", D1 binding DB, vars, migrations_dir
  vite.config.ts                  defineWorkersConfig (pool workers + D1 migrations in tests)
  drizzle.config.ts               schema → migrations dir (for future diffs)
  migrations/0000_init.sql        spec §2 DDL verbatim
  src/index.ts                    Worker entry: createApp() with the viem chain
  src/app.ts                      createApp(deps) — Hono app, middleware, routes
  src/env.ts                      Bindings + Variables types, config parsing (EAS_SCHEMAS)
  src/json.ts                     bigint-safe JSON helpers
  src/db/schema.ts                Drizzle tables (7)
  src/db/client.ts                drizzle(env.DB)
  src/middleware/admin-auth.ts
  src/middleware/rate-limit.ts
  src/middleware/cors.ts
  src/eas/schemas.ts              schema strings + UID computation + accepted-version set lookup
  src/eas/codecs.ts               encode/decode Entitlement v1, IssuerDelegation v1, Attendance v1 + canonical upcast
  src/eas/abi.ts                  minimal ABIs (EAS, SchemaRegistry, Coinbase factory)
  src/chain/client.ts             ChainClient interface + RawAttestation type
  src/chain/viem-chain.ts         production implementation
  src/chain/fake-chain.ts         in-memory implementation (tests and signer-less local dev)
  src/chain/holder.ts             Claimable smart-account address for a Bearer memberId
  src/verify/verify-uid.ts        §6 ordering + delegation check
  src/routes/health.ts, issue.ts, verify.ts, revoke.ts, members.ts
  scripts/register-schemas.ts     one-time schema registration (tsx)
  scripts/smoke-live.ts           manual Base Sepolia smoke (not CI)
  test/setup.ts                   applies D1 migrations before tests
  test/env.ts                     test bindings helper + FakeChain factory
  test/*.test.ts                  integration tests in workerd
```

---

### Task 1: Workspace wiring, `apps/api` skeleton, `GET /health`, workerd test runner

**Files:**
- Modify: `package.json` (root: add `test` script)
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/wrangler.jsonc`, `apps/api/vite.config.ts`
- Create: `apps/api/src/index.ts`, `apps/api/src/app.ts`, `apps/api/src/env.ts`, `apps/api/src/routes/health.ts`
- Create: `apps/api/migrations/.gitkeep` (replaced in Task 4), `apps/api/test/setup.ts`, `apps/api/test/env.ts`
- Test: `apps/api/test/health.test.ts`

**Interfaces:**
- Produces: `createApp(deps: AppDeps): Hono<AppEnv>` from `src/app.ts`; `AppEnv = { Bindings: Bindings; Variables: Variables }` from `src/env.ts`; `testEnv()` and `appWith(chain)` helpers from `test/env.ts` (chain typed `ChainClient` from Task 7 — until Task 7 exists, `AppDeps.chain` is `unknown` and unused).

- [ ] **Step 1: Add packages**

Run from the repo root:

```bash
mkdir -p apps/api/src/routes apps/api/test apps/api/migrations
pnpm --filter ./apps/api add hono drizzle-orm viem valibot 2>/dev/null || true
```

The `--filter` add fails until `apps/api/package.json` exists, so write it first:

```json
{
  "name": "api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vp test",
    "migrate:local": "wrangler d1 migrations apply fuda --local",
    "migrate:remote": "wrangler d1 migrations apply fuda --remote",
    "register-schemas": "tsx scripts/register-schemas.ts",
    "smoke:live": "tsx scripts/smoke-live.ts"
  },
  "dependencies": {
    "@fuda/sdk": "workspace:*",
    "drizzle-orm": "^0.44.0",
    "hono": "^4.9.0",
    "valibot": "^1.1.0",
    "viem": "^2.37.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.12.0",
    "@cloudflare/workers-types": "^4.20250905.0",
    "drizzle-kit": "^0.31.0"
  }
}
```

Then `pnpm install` (from the root). If pnpm reports a version that does not exist, drop the caret range to the latest published version it lists and re-run; record the resolved versions in the commit message body. `@fuda/sdk` resolves once Task 2 creates it — for this task create the placeholder `packages/sdk/package.json` shown at the top of Task 2 now (name + exports only) so `pnpm install` links.

- [ ] **Step 2: tsconfig + wrangler config**

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]
  },
  "include": ["src", "test", "scripts", "vite.config.ts", "drizzle.config.ts"]
}
```

`apps/api/wrangler.jsonc` (values for `vars` are placeholders until the one-time setup in §13; `EAS_SCHEMAS` is JSON in a string):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "fuda-api",
  "main": "src/index.ts",
  "compatibility_date": "2025-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    { "binding": "DB", "database_name": "fuda", "database_id": "REPLACE_AFTER_wrangler_d1_create", "migrations_dir": "migrations" }
  ],
  "vars": {
    "EAS_ADDRESS": "0x4200000000000000000000000000000000000021",
    "SCHEMA_REGISTRY_ADDRESS": "0x4200000000000000000000000000000000000020",
    "ANNOUNCER_ADDRESS": "0x55649E01B5Df198D18D95b5cc5051630cfD45564",
    "ANNOUNCER_FROM_BLOCK": "0",
    "FACTORY_ADDRESS": "0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a",
    "EAS_SCHEMAS": "{\"entitlement\":[],\"issuerDelegation\":[],\"attendance\":[]}",
    "ISSUER_ADDRESS": "0x0000000000000000000000000000000000000000",
    "DELEGATION_UID": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "API_BASE_URL": "https://api.fuda.sh"
  }
}
```

`API_BASE_URL` is not in the spec's vars list; it is needed to build the absolute `passUrls` (§3) and defaults to the production host. Secrets (`SIGNER_PRIVATE_KEY`, `ADMIN_TOKEN`, `BASE_RPC_URL`) go in `.dev.vars` locally (gitignored) and `wrangler secret put` in prod.

- [ ] **Step 3: env types**

`apps/api/src/env.ts`:

```ts
import type { ChainClient } from './chain/client.ts'
import type { Db } from './db/client.ts'

export type Bindings = {
  DB: D1Database
  ADMIN_TOKEN?: string
  SIGNER_PRIVATE_KEY?: string
  BASE_RPC_URL?: string
  EAS_ADDRESS: string
  SCHEMA_REGISTRY_ADDRESS: string
  ANNOUNCER_ADDRESS: string
  ANNOUNCER_FROM_BLOCK: string
  FACTORY_ADDRESS: string
  EAS_SCHEMAS: string
  ISSUER_ADDRESS: string
  DELEGATION_UID: string
  API_BASE_URL: string
}

export type Variables = {
  chain: ChainClient
  db: Db
  now: () => number // unix seconds — injectable for tests
}

export type AppEnv = { Bindings: Bindings; Variables: Variables }
```

Until Tasks 4 and 7 create `db/client.ts` and `chain/client.ts`, add temporary stubs so the import resolves:

`apps/api/src/chain/client.ts` (temporary — Task 7 replaces it):

```ts
export type ChainClient = Record<string, never>
```

`apps/api/src/db/client.ts` (temporary — Task 4 replaces it):

```ts
export type Db = Record<string, never>
```

- [ ] **Step 4: app factory + health route + worker entry**

`apps/api/src/routes/health.ts`:

```ts
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'

export const health = new Hono<AppEnv>().get('/health', (c) => c.json({ ok: true }))
```

`apps/api/src/app.ts`:

```ts
import { Hono } from 'hono'
import type { AppEnv, Variables } from './env.ts'
import { health } from './routes/health.ts'

export type AppDeps = {
  chain: Variables['chain']
  now?: () => number
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('chain', deps.chain)
    c.set('now', deps.now ?? (() => Math.floor(Date.now() / 1000)))
    await next()
  })
  app.route('/', health)
  return app
}
```

`apps/api/src/index.ts`:

```ts
import { createApp } from './app.ts'
import type { Bindings } from './env.ts'

// Production entry. The chain client is built per request from bindings in
// Task 7; until then the app runs with an empty chain object.
export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const app = createApp({ chain: {} })
    return Promise.resolve(app.fetch(request, env, ctx))
  },
}
```

- [ ] **Step 5: vitest pool-workers config + test helpers**

`apps/api/vite.config.ts`:

```ts
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config'
import path from 'node:path'

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'))
  return {
    test: {
      include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
      setupFiles: ['./test/setup.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  }
})
```

`apps/api/test/setup.ts`:

```ts
import { applyD1Migrations, env } from 'cloudflare:test'

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database
    TEST_MIGRATIONS: D1Migration[]
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
```

`apps/api/test/env.ts`:

```ts
import { env } from 'cloudflare:test'
import { createApp, type AppDeps } from '../src/app.ts'
import type { Bindings } from '../src/env.ts'

export function testEnv(overrides: Partial<Bindings> = {}): Bindings {
  return { ...(env as unknown as Bindings), ...overrides }
}

export function appWith(deps: AppDeps) {
  return createApp(deps)
}
```

`apps/api/test/health.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { appWith, testEnv } from './env.ts'

describe('GET /health', () => {
  it('answers { ok: true }', async () => {
    const app = appWith({ chain: {} })
    const res = await app.request('/health', {}, testEnv())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
```

Create `apps/api/migrations/0000_init.sql` now with only a comment line (`-- replaced in Task 4`) so `readD1Migrations` finds the directory.

- [ ] **Step 6: Run the test through Vite+ and verify workerd is the pool**

Run: `./node_modules/.bin/vp -C apps/api test`
Expected: 1 passing test, and the reporter header names the pool (`@cloudflare/vitest-pool-workers`) or the worker name `fuda-api`.

**Fallback if `vp test` does not run the pool** (the Vitest bundled by vite-plus is 4.x; `@cloudflare/vitest-pool-workers` may lag): pin a compatible `vitest` in `apps/api/devDependencies` (the version its peer range asks for), rename `apps/api/vite.config.ts` to `apps/api/vitest.config.ts`, change the package script to `"test": "vitest run"`, and run tests with `pnpm --filter api test` (also reachable as `./node_modules/.bin/vpr -C apps/api test`). Record which path was taken in the commit body; every later "Run tests" step in this plan means "run whichever of the two commands Task 1 settled on".

- [ ] **Step 7: Root `test` script**

Add to root `package.json` scripts: `"test": "vp run -r test"`. Run `pnpm test` from the root and confirm it runs the api tests.

- [ ] **Step 8: Check and commit**

Run: `./node_modules/.bin/vp check`
Expected: pass (fix any lint findings; do not turn rules off).

```bash
git add package.json pnpm-lock.yaml apps/api packages/sdk/package.json
git commit -m "feat(api): scaffold Hono worker with GET /health and workerd test runner"
```

---

### Task 2: `packages/sdk` — constants, enums, valibot request schemas

**Files:**
- Create: `packages/sdk/package.json`, `packages/sdk/tsconfig.json`, `packages/sdk/vite.config.ts`
- Create: `packages/sdk/src/index.ts`, `packages/sdk/src/constants.ts`, `packages/sdk/src/schemas.ts`, `packages/sdk/src/types.ts`
- Test: `packages/sdk/src/constants.test.ts`, `packages/sdk/src/schemas.test.ts`

**Interfaces:**
- Produces (all re-exported from `@fuda/sdk`):
  - `UID_RE`, `QR_RE`, `QR_PREFIX = 'fuda:v1:'`, `toQr(uid): string`, `parseQr(qr): Hex | null`, `isUid(s): s is Hex`
  - `Level = 'bearer' | 'signed' | 'private'`, `LEVEL_CODE: Record<Level, 0|1|2>`, `levelFromCode(n): Level | null`
  - `UsageModel` (0|1|2), `Tier` (0|1|2|3), `EntryPath = 'qr' | 'signature'`
  - `Reason` union, `ErrorCode` union
  - `IssueBody`, `VerifyBody`, `ChallengeBody`, `VerifySignedBody`, `RevokeBody` valibot schemas + inferred types
  - `IssueRequest['kind']` discriminator: `deriveIssueKind(body): 'bearer' | 'signed' | 'private' | null`
  - Response types: `IssueResponse`, `VerifyResponse`, `MemberRow`, `MembersResponse`, `RevokeResponse`, `ErrorResponse`

- [ ] **Step 1: Package files**

`packages/sdk/package.json`:

```json
{
  "name": "@fuda/sdk",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vp test" },
  "dependencies": { "valibot": "^1.1.0" }
}
```

`packages/sdk/tsconfig.json`:

```json
{ "extends": "../../tsconfig.json", "include": ["src", "vite.config.ts"] }
```

`packages/sdk/vite.config.ts`:

```ts
import { defineConfig } from 'vite-plus'

export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })
```

Run `pnpm install` from the root.

- [ ] **Step 2: Failing tests for constants**

`packages/sdk/src/constants.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isUid, LEVEL_CODE, levelFromCode, parseQr, QR_RE, toQr, UID_RE } from './constants.ts'

const uid = `0x${'ab'.repeat(32)}`

describe('wire constants', () => {
  it('uid regex accepts 0x + 64 hex only', () => {
    expect(UID_RE.test(uid)).toBe(true)
    expect(UID_RE.test(uid.slice(0, -1))).toBe(false)
    expect(isUid('0x')).toBe(false)
  })
  it('QR round-trips through fuda:v1:', () => {
    expect(toQr(uid)).toBe(`fuda:v1:${uid}`)
    expect(parseQr(`fuda:v1:${uid}`)).toBe(uid)
    expect(parseQr(`fuda:v2:${uid}`)).toBeNull()
    expect(QR_RE.test(`fuda:v1:${uid}`)).toBe(true)
  })
  it('level codes are 0/1/2 and invert', () => {
    expect(LEVEL_CODE).toEqual({ bearer: 0, signed: 1, private: 2 })
    expect(levelFromCode(1)).toBe('signed')
    expect(levelFromCode(3)).toBeNull()
  })
})
```

Run: `./node_modules/.bin/vp -C packages/sdk test`
Expected: FAIL — cannot resolve `./constants.ts`.

- [ ] **Step 3: Implement constants**

`packages/sdk/src/constants.ts`:

```ts
export type Hex = `0x${string}`

export const UID_RE = /^0x[0-9a-fA-F]{64}$/
export const QR_PREFIX = 'fuda:v1:'
export const QR_RE = /^fuda:v1:(0x[0-9a-fA-F]{64})$/
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
export const META_ADDRESS_RE = /^0x[0-9a-fA-F]{132}$/
export const NONCE_RE = /^0x[0-9a-fA-F]{32}$/
export const SIGNATURE_RE = /^0x[0-9a-fA-F]+$/

export function isUid(s: string): s is Hex {
  return UID_RE.test(s)
}

export function toQr(uid: Hex): string {
  return `${QR_PREFIX}${uid}`
}

export function parseQr(qr: string): Hex | null {
  const m = QR_RE.exec(qr)
  return m === null ? null : (m[1] as Hex)
}

// level = the verification level a right was issued at (never "mode").
export type Level = 'bearer' | 'signed' | 'private'
export const LEVEL_CODE = { bearer: 0, signed: 1, private: 2 } as const satisfies Record<Level, number>
export type LevelCode = (typeof LEVEL_CODE)[Level]
const LEVELS: readonly Level[] = ['bearer', 'signed', 'private']
export function levelFromCode(code: number): Level | null {
  return LEVELS[code] ?? null
}

// path = how an entry was made (never the right's level).
export type EntryPath = 'qr' | 'signature'

export type UsageModel = 0 | 1 | 2 // SINGLE_USE | MULTI_USE | METERED
export const USAGE_MODEL = { SINGLE_USE: 0, MULTI_USE: 1, METERED: 2 } as const
export type Tier = 0 | 1 | 2 | 3 // FREE | REGULAR | VIP | FOUNDER
export const TIER_LABEL = ['FREE', 'REGULAR', 'VIP', 'FOUNDER'] as const

export const REASONS = [
  'OK',
  'NOT_FOUND',
  'WRONG_SCHEMA',
  'REVOKED',
  'UNKNOWN_USAGE_MODEL',
  'NOT_YET_VALID',
  'EXPIRED',
  'NO_DELEGATION',
  'ISSUER_NOT_DELEGATED',
  'DELEGATION_UNAVAILABLE',
  'DELEGATION_CONFIG_MISSING',
  'LEVEL_REQUIRED',
  'ALREADY_USED',
  'BAD_CHALLENGE',
  'BAD_SIGNATURE',
] as const
export type Reason = (typeof REASONS)[number]

export const ERROR_CODES = [
  'bad_input',
  'bad_uid',
  'bad_qr',
  'bad_meta_address',
  'client_ip_required',
  'unauthorized',
  'not_found',
  'rate_limited',
  'no_signer',
  'chain_error',
  'rpc_unavailable',
  'apple_not_configured',
  'google_not_configured',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
```

Run: `./node_modules/.bin/vp -C packages/sdk test`
Expected: 3 passing.

- [ ] **Step 4: Failing tests for request schemas**

`packages/sdk/src/schemas.test.ts`:

```ts
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { deriveIssueKind, IssueBody, RevokeBody, VerifyBody } from './schemas.ts'

const addr = `0x${'11'.repeat(20)}`
const uid = `0x${'ab'.repeat(32)}`
const meta = `0x${'cd'.repeat(66)}`

describe('IssueBody', () => {
  it('bearer: memberId only, defaults tier 0 and usageModel 1', () => {
    const out = v.parse(IssueBody, { memberId: 'alice' })
    expect(out).toEqual({ memberId: 'alice', tier: 0, usageModel: 1, validFrom: 0, validUntil: 0, metaURI: '' })
    expect(deriveIssueKind(out)).toBe('bearer')
  })
  it('signed: holder only', () => {
    expect(deriveIssueKind(v.parse(IssueBody, { holder: addr }))).toBe('signed')
  })
  it('private: stealthMetaAddress with optional memberId', () => {
    expect(deriveIssueKind(v.parse(IssueBody, { stealthMetaAddress: meta, memberId: 'x' }))).toBe('private')
  })
  it('rejects holder + memberId, empty body, and holder + stealthMetaAddress', () => {
    expect(deriveIssueKind(v.parse(IssueBody, { holder: addr, memberId: 'a' }))).toBeNull()
    expect(deriveIssueKind(v.parse(IssueBody, {}))).toBeNull()
    expect(deriveIssueKind(v.parse(IssueBody, { holder: addr, stealthMetaAddress: meta }))).toBeNull()
  })
  it('rejects out-of-range tier / usageModel and empty memberId', () => {
    expect(v.safeParse(IssueBody, { memberId: 'a', tier: 4 }).success).toBe(false)
    expect(v.safeParse(IssueBody, { memberId: 'a', usageModel: 3 }).success).toBe(false)
    expect(v.safeParse(IssueBody, { memberId: '' }).success).toBe(false)
  })
})

describe('VerifyBody / RevokeBody', () => {
  it('accepts a fuda:v1 qr and a uid', () => {
    expect(v.safeParse(VerifyBody, { qr: `fuda:v1:${uid}` }).success).toBe(true)
    expect(v.safeParse(VerifyBody, { qr: uid }).success).toBe(false)
    expect(v.safeParse(RevokeBody, { uid }).success).toBe(true)
  })
})
```

Run: `./node_modules/.bin/vp -C packages/sdk test`
Expected: FAIL — cannot resolve `./schemas.ts`.

- [ ] **Step 5: Implement schemas and types**

`packages/sdk/src/schemas.ts`:

```ts
import * as v from 'valibot'
import { ADDRESS_RE, META_ADDRESS_RE, NONCE_RE, QR_RE, SIGNATURE_RE, UID_RE } from './constants.ts'

const uid = v.pipe(v.string(), v.regex(UID_RE))
const address = v.pipe(v.string(), v.regex(ADDRESS_RE))
const unix = v.pipe(v.number(), v.integer(), v.minValue(0))

export const IssueBody = v.object({
  memberId: v.optional(v.pipe(v.string(), v.minLength(1))),
  holder: v.optional(address),
  stealthMetaAddress: v.optional(v.pipe(v.string(), v.regex(META_ADDRESS_RE))),
  tier: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3)), 0),
  usageModel: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2)), 1),
  validFrom: v.optional(unix, 0),
  validUntil: v.optional(unix, 0),
  metaURI: v.optional(v.string(), ''),
})
export type IssueRequest = v.InferOutput<typeof IssueBody>

// Exact rule from spec §3: stealthMetaAddress → private (holder forbidden);
// else holder → signed (memberId forbidden); else memberId → bearer; else null.
export function deriveIssueKind(b: IssueRequest): 'bearer' | 'signed' | 'private' | null {
  if (b.stealthMetaAddress !== undefined) {
    return b.holder === undefined ? 'private' : null
  }
  if (b.holder !== undefined) {
    return b.memberId === undefined ? 'signed' : null
  }
  return b.memberId === undefined ? null : 'bearer'
}

export const VerifyBody = v.object({ qr: v.pipe(v.string(), v.regex(QR_RE)) })
export const RevokeBody = v.object({ uid })
export const ChallengeBody = v.object({ uid })
export const VerifySignedBody = v.object({
  uid,
  nonce: v.pipe(v.string(), v.regex(NONCE_RE)),
  signature: v.pipe(v.string(), v.regex(SIGNATURE_RE)),
})
```

`packages/sdk/src/types.ts`:

```ts
import type { EntryPath, ErrorCode, Hex, Level, Reason } from './constants.ts'

export type ErrorResponse = { error: ErrorCode }

export type PassUrls = { web: string; google: string; apple: string }

export type IssueResponse =
  | { uid: Hex; level: 'bearer' | 'signed'; holder: Hex; qr: string; passUrls: PassUrls }
  | { uid: Hex; level: 'private'; announced: true; announceTx: Hex }

export type EntitlementView = {
  holder: Hex
  issuer: Hex
  usageModel: number
  tier: number
  level: number
  validFrom: number
  validUntil: number
  schemaVersion: number
}
export type DelegationView = { issuer: Hex; active: boolean; name: string }

export type VerifyResponse = {
  decision: 'ADMIT' | 'REJECT'
  reason: Reason
  entitlement?: EntitlementView
  delegation?: DelegationView
}

export type VerifySignedResponse = VerifyResponse & {
  path: EntryPath
  holder?: Hex
  stage?: 'entitlement' | 'challenge'
}

export type MemberRow = {
  uid: Hex
  memberId: string
  holder: Hex | null
  level: Level
  tier: number
  status: 'active' | 'revoked'
  createdAt: number
}
export type MembersResponse = { members: MemberRow[] }
export type RevokeResponse = { revoked: true; uid: Hex }
```

`packages/sdk/src/index.ts`:

```ts
export * from './constants.ts'
export * from './schemas.ts'
export type * from './types.ts'
```

Run: `./node_modules/.bin/vp -C packages/sdk test`
Expected: all passing (8 tests).

- [ ] **Step 6: Check and commit**

Run: `./node_modules/.bin/vp check` → pass.

```bash
git add packages/sdk pnpm-lock.yaml
git commit -m "feat(sdk): add wire constants, enums and valibot request schemas"
```

---

### Task 3: Bigint-safe JSON

EAS values are `uint64`; viem returns them as `bigint`, and `JSON.stringify` throws on bigint. Every API response goes through one helper.

**Files:**
- Create: `apps/api/src/json.ts`
- Test: `apps/api/src/json.test.ts`

**Interfaces:**
- Produces: `toJsonSafe(value: unknown): unknown` (deep-converts `bigint` → `number` when `<= Number.MAX_SAFE_INTEGER`, else → decimal string) and `jsonResponse(c, body, status?)` helper used by every route.

- [ ] **Step 1: Failing test**

`apps/api/src/json.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toJsonSafe } from './json.ts'

describe('toJsonSafe', () => {
  it('converts safe bigints to numbers and huge ones to strings, recursively', () => {
    const out = toJsonSafe({ a: 1n, b: [2n, { c: 2n ** 60n }], d: 'x', e: null })
    expect(out).toEqual({ a: 1, b: [2, { c: (2n ** 60n).toString() }], d: 'x', e: null })
    expect(JSON.stringify(out)).toContain('"a":1')
  })
})
```

Run tests → FAIL (module missing).

- [ ] **Step 2: Implement**

`apps/api/src/json.ts`:

```ts
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const MAX = BigInt(Number.MAX_SAFE_INTEGER)

export function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value <= MAX && value >= -MAX ? Number(value) : value.toString()
  }
  if (Array.isArray(value)) {
    return value.map(toJsonSafe)
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = toJsonSafe(v)
    }
    return out
  }
  return value
}

export function jsonResponse(c: Context, body: unknown, status: ContentfulStatusCode = 200): Response {
  return c.json(toJsonSafe(body), status)
}

export function errorResponse(c: Context, error: string, status: ContentfulStatusCode): Response {
  return c.json({ error }, status)
}
```

Run tests → PASS.

- [ ] **Step 3: Check and commit**

`./node_modules/.bin/vp check` → pass.

```bash
git add apps/api/src/json.ts apps/api/src/json.test.ts
git commit -m "feat(api): add bigint-safe JSON response helpers"
```

---

### Task 4: D1 schema — Drizzle tables and the initial migration

**Files:**
- Create: `apps/api/src/db/schema.ts`, `apps/api/src/db/client.ts` (replaces the Task 1 stub), `apps/api/drizzle.config.ts`
- Modify: `apps/api/migrations/0000_init.sql` (replace the placeholder)
- Test: `apps/api/test/db.test.ts`

**Interfaces:**
- Produces: Drizzle tables `members`, `rateLimits`, `challenges`, `slots`, `entryLog`, `announcements`, `syncState`; `type Db = DrizzleD1Database<typeof schema>`; `getDb(env: Bindings): Db`.

Decision (spec ambiguity): the spec says "migrations: `drizzle-kit generate`". The **initial** migration is hand-written as the §2 DDL verbatim so the table text in the repo equals the canonical spec text; `drizzle-kit generate` is used for every later diff (its config is added here). Drizzle's schema below is the typed mirror of that DDL.

- [ ] **Step 1: Migration SQL (spec §2 verbatim)**

`apps/api/migrations/0000_init.sql`:

```sql
CREATE TABLE members (
  attestation_uid TEXT PRIMARY KEY,
  member_id       TEXT NOT NULL DEFAULT '',
  holder          TEXT,
  level           TEXT NOT NULL,
  tier            INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      INTEGER NOT NULL
);
CREATE INDEX members_holder ON members(holder);
CREATE INDEX members_member_id ON members(member_id);

CREATE TABLE rate_limits (
  ip           TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (ip, window_start)
);

CREATE TABLE challenges (
  nonce      TEXT PRIMARY KEY,
  uid        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at    INTEGER
);

CREATE TABLE slots (
  uid         TEXT NOT NULL,
  slot        TEXT NOT NULL,
  consumed_at INTEGER NOT NULL,
  PRIMARY KEY (uid, slot)
);

CREATE TABLE entry_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  uid      TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason   TEXT NOT NULL,
  path     TEXT NOT NULL,
  at       INTEGER NOT NULL,
  attendance_uid TEXT
);

CREATE TABLE announcements (
  tx_hash           TEXT NOT NULL,
  log_index         INTEGER NOT NULL,
  block_number      INTEGER NOT NULL,
  scheme_id         INTEGER NOT NULL,
  stealth_address   TEXT NOT NULL,
  caller            TEXT NOT NULL,
  ephemeral_pub_key TEXT NOT NULL,
  metadata          TEXT NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE TABLE sync_state (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
```

- [ ] **Step 2: Failing test**

`apps/api/test/db.test.ts`:

```ts
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getDb } from '../src/db/client.ts'
import { members, slots } from '../src/db/schema.ts'

describe('D1 schema', () => {
  it('has all seven tables after migration', async () => {
    const rows = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%'").all<{ name: string }>()
    expect(rows.results.map((r) => r.name).sort()).toEqual(
      ['announcements', 'challenges', 'entry_log', 'members', 'rate_limits', 'slots', 'sync_state'],
    )
  })
  it('inserts a member row through drizzle', async () => {
    const db = getDb({ DB: env.DB } as never)
    await db.insert(members).values({ attestationUid: `0x${'01'.repeat(32)}`, memberId: 'alice', holder: `0x${'11'.repeat(20)}`, level: 'bearer', tier: 0, status: 'active', createdAt: 1 })
    const all = await db.select().from(members)
    expect(all).toHaveLength(1)
    expect(all[0]?.level).toBe('bearer')
  })
  it('INSERT OR IGNORE on slots reports changes', async () => {
    const db = getDb({ DB: env.DB } as never)
    const uid = `0x${'02'.repeat(32)}`
    const first = await db.insert(slots).values({ uid, slot: 'default', consumedAt: 1 }).onConflictDoNothing().run()
    const second = await db.insert(slots).values({ uid, slot: 'default', consumedAt: 2 }).onConflictDoNothing().run()
    expect(first.meta.changes).toBe(1)
    expect(second.meta.changes).toBe(0)
  })
})
```

Run tests → FAIL (schema module missing).

- [ ] **Step 3: Drizzle schema + client + drizzle-kit config**

`apps/api/src/db/schema.ts`:

```ts
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const members = sqliteTable(
  'members',
  {
    attestationUid: text('attestation_uid').primaryKey(),
    memberId: text('member_id').notNull().default(''),
    holder: text('holder'),
    level: text('level', { enum: ['bearer', 'signed', 'private'] }).notNull(),
    tier: integer('tier').notNull().default(0),
    status: text('status', { enum: ['active', 'revoked'] }).notNull().default('active'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('members_holder').on(t.holder), index('members_member_id').on(t.memberId)],
)

export const rateLimits = sqliteTable(
  'rate_limits',
  {
    ip: text('ip').notNull(),
    windowStart: integer('window_start').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ip, t.windowStart] })],
)

export const challenges = sqliteTable('challenges', {
  nonce: text('nonce').primaryKey(),
  uid: text('uid').notNull(),
  createdAt: integer('created_at').notNull(),
  usedAt: integer('used_at'),
})

export const slots = sqliteTable(
  'slots',
  {
    uid: text('uid').notNull(),
    slot: text('slot').notNull(),
    consumedAt: integer('consumed_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.uid, t.slot] })],
)

export const entryLog = sqliteTable('entry_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  uid: text('uid').notNull(),
  decision: text('decision', { enum: ['ADMIT', 'REJECT'] }).notNull(),
  reason: text('reason').notNull(),
  path: text('path', { enum: ['qr', 'signature'] }).notNull(),
  at: integer('at').notNull(),
  attendanceUid: text('attendance_uid'),
})

export const announcements = sqliteTable(
  'announcements',
  {
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    blockNumber: integer('block_number').notNull(),
    schemeId: integer('scheme_id').notNull(),
    stealthAddress: text('stealth_address').notNull(),
    caller: text('caller').notNull(),
    ephemeralPubKey: text('ephemeral_pub_key').notNull(),
    metadata: text('metadata').notNull(),
  },
  (t) => [primaryKey({ columns: [t.txHash, t.logIndex] })],
)

export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: integer('value').notNull(),
})
```

`apps/api/src/db/client.ts`:

```ts
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import type { Bindings } from '../env.ts'
import * as schema from './schema.ts'

export type Db = DrizzleD1Database<typeof schema>

export function getDb(env: Pick<Bindings, 'DB'>): Db {
  return drizzle(env.DB, { schema })
}
```

`apps/api/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
})
```

Wire `db` into the app: in `apps/api/src/app.ts` add `c.set('db', getDb(c.env))` inside the first middleware (import `getDb` from `./db/client.ts`).

Run tests → PASS (3 in `db.test.ts`, plus health).

- [ ] **Step 4: Check and commit**

`./node_modules/.bin/vp check` → pass.

```bash
git add apps/api/migrations apps/api/src/db apps/api/drizzle.config.ts apps/api/src/app.ts apps/api/test/db.test.ts
git commit -m "feat(api): add D1 schema with the seven MVP tables and drizzle client"
```

---

### Task 5: Middleware — admin auth, CORS, per-IP budget

**Files:**
- Create: `apps/api/src/middleware/admin-auth.ts`, `apps/api/src/middleware/cors.ts`, `apps/api/src/middleware/rate-limit.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/admin-auth.test.ts`, `apps/api/test/rate-limit.test.ts`, `apps/api/test/cors.test.ts`

**Interfaces:**
- Produces: `adminAuth(): MiddlewareHandler<AppEnv>`; `corsPolicy(): MiddlewareHandler`; `rateLimit(opts: { budget: number }): MiddlewareHandler<AppEnv>`. `createApp` mounts `corsPolicy()` and the `x-auth-mode` header globally; `adminAuth()` is applied per admin route in Tasks 10–12. `rateLimit` is mounted only on a test route in this plan.

- [ ] **Step 1: Failing tests**

`apps/api/test/admin-auth.test.ts`:

```ts
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { AppEnv } from '../src/env.ts'
import { adminAuth } from '../src/middleware/admin-auth.ts'
import { testEnv } from './env.ts'

function guarded() {
  return new Hono<AppEnv>().get('/admin', adminAuth(), (c) => c.json({ ok: true }))
}

describe('adminAuth', () => {
  it('rejects a missing or wrong token when ADMIN_TOKEN is set', async () => {
    const app = guarded()
    const env = testEnv({ ADMIN_TOKEN: 'secret' })
    expect((await app.request('/admin', {}, env)).status).toBe(401)
    const wrong = await app.request('/admin', { headers: { Authorization: 'Bearer nope' } }, env)
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toEqual({ error: 'unauthorized' })
  })
  it('admits the right token', async () => {
    const res = await guarded().request('/admin', { headers: { Authorization: 'Bearer secret' } }, testEnv({ ADMIN_TOKEN: 'secret' }))
    expect(res.status).toBe(200)
  })
  it('is open with x-auth-mode: open when ADMIN_TOKEN is unset', async () => {
    const res = await guarded().request('/admin', {}, testEnv({ ADMIN_TOKEN: undefined }))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-auth-mode')).toBe('open')
  })
})
```

`apps/api/test/rate-limit.test.ts`:

```ts
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { getDb } from '../src/db/client.ts'
import type { AppEnv } from '../src/env.ts'
import { rateLimit } from '../src/middleware/rate-limit.ts'
import { testEnv } from './env.ts'

function budgeted(now: number) {
  return new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('db', getDb(c.env))
      c.set('now', () => now)
      await next()
    })
    .get('/limited', rateLimit({ budget: 3 }), (c) => c.json({ ok: true }))
}

describe('rateLimit', () => {
  it('400s without a client IP', async () => {
    const res = await budgeted(1_000_000).request('/limited', {}, testEnv())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'client_ip_required' })
  })
  it('allows `budget` requests per IP per hour, then 429s, and resets on the next window', async () => {
    const hit = (now: number, ip = '203.0.113.7') =>
      budgeted(now).request('/limited', { headers: { 'CF-Connecting-IP': ip } }, testEnv())
    const t = 7200
    expect((await hit(t)).status).toBe(200)
    expect((await hit(t + 1)).status).toBe(200)
    expect((await hit(t + 2)).status).toBe(200)
    const over = await hit(t + 3)
    expect(over.status).toBe(429)
    expect(await over.json()).toEqual({ error: 'rate_limited' })
    expect((await hit(t + 3, '198.51.100.1')).status).toBe(200)
    expect((await hit(t + 3600)).status).toBe(200)
  })
})
```

`apps/api/test/cors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { appWith, testEnv } from './env.ts'

describe('CORS', () => {
  it('allows the three fuda hosts and a localhost dev port, not others', async () => {
    const app = appWith({ chain: {} })
    for (const origin of ['https://app.fuda.sh', 'https://dash.fuda.sh', 'https://gate.fuda.sh', 'http://localhost:5173']) {
      const res = await app.request('/health', { headers: { Origin: origin } }, testEnv())
      expect(res.headers.get('access-control-allow-origin')).toBe(origin)
    }
    const bad = await app.request('/health', { headers: { Origin: 'https://evil.example' } }, testEnv())
    expect(bad.headers.get('access-control-allow-origin')).toBeNull()
  })
})
```

Run tests → FAIL (modules missing).

- [ ] **Step 2: Implement admin auth**

`apps/api/src/middleware/admin-auth.ts`:

```ts
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env.ts'

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
}

// Constant-time compare: hash both sides to equal length, then timingSafeEqual.
export async function tokenMatches(presented: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(presented), sha256(expected)])
  return crypto.subtle.timingSafeEqual(a, b)
}

export function adminAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const expected = c.env.ADMIN_TOKEN
    if (expected === undefined || expected === '') {
      await next()
      return
    }
    const header = c.req.header('Authorization') ?? ''
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
    if (presented === '' || !(await tokenMatches(presented, expected))) {
      c.status(401)
      c.res = c.json({ error: 'unauthorized' }, 401)
      return
    }
    await next()
  }
}

// Global: every response carries x-auth-mode: open while ADMIN_TOKEN is unset (local dev).
export function authModeHeader(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next()
    if (c.env.ADMIN_TOKEN === undefined || c.env.ADMIN_TOKEN === '') {
      c.res.headers.set('x-auth-mode', 'open')
    }
  }
}
```

If Hono's typing rejects assigning `c.res` inside the middleware, replace the two lines with `return c.json({ error: 'unauthorized' }, 401)` — Hono accepts a returned Response from middleware.

- [ ] **Step 3: Implement CORS**

`apps/api/src/middleware/cors.ts`:

```ts
import { cors } from 'hono/cors'

const PROD_ORIGINS = ['https://app.fuda.sh', 'https://dash.fuda.sh', 'https://gate.fuda.sh']
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/

export function corsPolicy() {
  return cors({
    origin: (origin) => (PROD_ORIGINS.includes(origin) || DEV_ORIGIN.test(origin) ? origin : null),
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  })
}
```

If `hono/cors` types `origin` callback return as `string | undefined | null` differently in the installed version, return `''` for the rejected case — the header is then omitted.

- [ ] **Step 4: Implement the per-IP budget**

`apps/api/src/middleware/rate-limit.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'
import { rateLimits } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'

export const DEFAULT_BUDGET = 120 // requests / hour / IP
const WINDOW = 3600

// Fixed hourly window on D1: floor(now / 3600) * 3600. Upsert-and-read so two
// concurrent requests both see the incremented count.
export function rateLimit(opts: { budget: number } = { budget: DEFAULT_BUDGET }): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const ip = c.req.header('CF-Connecting-IP')
    if (ip === undefined || ip === '') {
      return c.json({ error: 'client_ip_required' }, 400)
    }
    const windowStart = Math.floor(c.get('now')() / WINDOW) * WINDOW
    const db = c.get('db')
    await db
      .insert(rateLimits)
      .values({ ip, windowStart, count: 1 })
      .onConflictDoUpdate({ target: [rateLimits.ip, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
    const row = await db
      .select({ count: rateLimits.count })
      .from(rateLimits)
      .where(and(eq(rateLimits.ip, ip), eq(rateLimits.windowStart, windowStart)))
      .get()
    if (row !== undefined && row.count > opts.budget) {
      return c.json({ error: 'rate_limited' }, 429)
    }
    await next()
  }
}
```

- [ ] **Step 5: Mount in `createApp`**

In `apps/api/src/app.ts`, before the route mounts:

```ts
app.use('*', corsPolicy())
app.use('*', authModeHeader())
```

(`rateLimit` is not mounted on any production route in this plan; Plan 4 mounts `rateLimit()` on `GET /announcements`.)

Run tests → PASS.

- [ ] **Step 6: Check and commit**

`./node_modules/.bin/vp check` → pass.

```bash
git add apps/api/src/middleware apps/api/src/app.ts apps/api/test/admin-auth.test.ts apps/api/test/rate-limit.test.ts apps/api/test/cors.test.ts
git commit -m "feat(api): add admin auth, CORS policy and per-IP hourly budget middleware"
```

---

### Task 6: EAS schemas, UID computation, accepted-version sets, codecs

**Files:**
- Create: `apps/api/src/eas/schemas.ts`, `apps/api/src/eas/codecs.ts`, `apps/api/src/eas/abi.ts`
- Test: `apps/api/src/eas/schemas.test.ts`, `apps/api/src/eas/codecs.test.ts`

**Interfaces:**
- Produces:
  - `SCHEMA_STRINGS = { entitlement, issuerDelegation, attendance }`, `schemaUid(schema: string): Hex`
  - `type AcceptedVersion = { uid: Hex; version: number }`, `type SchemaSets = Record<'entitlement'|'issuerDelegation'|'attendance', AcceptedVersion[]>`, `parseSchemaSets(json: string): SchemaSets`, `findVersion(set, uid): AcceptedVersion | null`, `newest(set): AcceptedVersion | null`
  - `Entitlement` canonical type; `encodeEntitlementV1(e): Hex`, `decodeEntitlementV1(data): EntitlementV1`, `toCanonical(v1): Entitlement`, `decodeEntitlement(version, data): Entitlement`
  - `Delegation` type; `encodeDelegationV1`, `decodeDelegation(version, data)`
  - `Attendance` type; `encodeAttendanceV1`, `decodeAttendanceV1`
  - `EAS_ABI`, `SCHEMA_REGISTRY_ABI`, `FACTORY_ABI` (viem `parseAbi` outputs)

- [ ] **Step 1: Failing tests**

`apps/api/src/eas/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { findVersion, newest, parseSchemaSets, SCHEMA_STRINGS, schemaUid } from './schemas.ts'

describe('schemaUid', () => {
  it('is keccak256(encodePacked(string, address(0), true)) and stable', () => {
    const a = schemaUid(SCHEMA_STRINGS.entitlement)
    expect(a).toMatch(/^0x[0-9a-f]{64}$/)
    expect(schemaUid(SCHEMA_STRINGS.entitlement)).toBe(a)
    expect(schemaUid(SCHEMA_STRINGS.attendance)).not.toBe(a)
  })
})

describe('accepted-version sets', () => {
  const json = JSON.stringify({
    entitlement: [{ uid: `0x${'aa'.repeat(32)}`, version: 1 }],
    issuerDelegation: [{ uid: `0x${'bb'.repeat(32)}`, version: 1 }, { uid: `0x${'bc'.repeat(32)}`, version: 2 }],
    attendance: [{ uid: `0x${'cc'.repeat(32)}`, version: 1 }],
  })
  it('parses and looks up by uid; unknown uid → null; newest picks the highest version', () => {
    const sets = parseSchemaSets(json)
    expect(findVersion(sets.entitlement, `0x${'aa'.repeat(32)}`)?.version).toBe(1)
    expect(findVersion(sets.entitlement, `0x${'ff'.repeat(32)}`)).toBeNull()
    expect(newest(sets.issuerDelegation)?.version).toBe(2)
    expect(newest([])).toBeNull()
  })
  it('rejects malformed config', () => {
    expect(() => parseSchemaSets('{}')).toThrow()
    expect(() => parseSchemaSets('nope')).toThrow()
  })
})
```

No hard-coded digest is needed: `register-schemas.ts` (Task 7) cross-checks the computed UID against the registry's `getSchema` on chain.

`apps/api/src/eas/codecs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  decodeAttendanceV1, decodeDelegation, decodeEntitlement, decodeEntitlementV1,
  encodeAttendanceV1, encodeDelegationV1, encodeEntitlementV1, toCanonical,
} from './codecs.ts'

const holder = `0x${'11'.repeat(20)}` as const
const issuer = `0x${'22'.repeat(20)}` as const
const zero32 = `0x${'00'.repeat(32)}` as const

describe('Entitlement codec', () => {
  const e = { holder, issuer, usageModel: 1, tier: 2, level: 1, serial: zero32, validFrom: 0n, validUntil: 1_800_000_000n, metaURI: 'ipfs://x' } as const
  it('round-trips v1 including level', () => {
    const data = encodeEntitlementV1(e)
    expect(decodeEntitlementV1(data)).toEqual(e)
  })
  it('v1 → canonical upcast is the identity plus schemaVersion', () => {
    expect(toCanonical(decodeEntitlementV1(encodeEntitlementV1(e)))).toEqual({ ...e, schemaVersion: 1 })
    expect(decodeEntitlement(1, encodeEntitlementV1(e)).schemaVersion).toBe(1)
    expect(() => decodeEntitlement(9, encodeEntitlementV1(e))).toThrow()
  })
})

describe('Delegation and Attendance codecs', () => {
  it('round-trip', () => {
    const d = { issuer, active: true, name: 'fuda root' }
    expect(decodeDelegation(1, encodeDelegationV1(d))).toEqual({ ...d, schemaVersion: 1 })
    const a = { rightUID: `0x${'ab'.repeat(32)}` as const, holder, enteredAt: 1_757_000_000n, slotId: zero32 }
    expect(decodeAttendanceV1(encodeAttendanceV1(a))).toEqual(a)
  })
})
```

Run tests → FAIL (modules missing).

- [ ] **Step 2: Implement schemas + ABIs**

`apps/api/src/eas/schemas.ts`:

```ts
import * as v from 'valibot'
import { encodePacked, keccak256, zeroAddress, type Hex } from 'viem'

export const SCHEMA_STRINGS = {
  entitlement:
    'address holder,address issuer,uint8 usageModel,uint8 tier,uint8 level,bytes32 serial,uint64 validFrom,uint64 validUntil,string metaURI',
  issuerDelegation: 'address issuer,bool active,string name',
  attendance: 'bytes32 rightUID,address holder,uint64 enteredAt,bytes32 slotId',
} as const
export type SchemaKind = keyof typeof SCHEMA_STRINGS

// EAS schema UIDs are deterministic: keccak256(encodePacked(schema, resolver, revocable)).
// All fuda schemas use resolver = 0x0 and revocable = true.
export function schemaUid(schema: string): Hex {
  return keccak256(encodePacked(['string', 'address', 'bool'], [schema, zeroAddress, true]))
}

export type AcceptedVersion = { uid: Hex; version: number }
export type SchemaSets = Record<SchemaKind, AcceptedVersion[]>

const Version = v.object({ uid: v.pipe(v.string(), v.regex(/^0x[0-9a-fA-F]{64}$/)), version: v.pipe(v.number(), v.integer(), v.minValue(1)) })
const Sets = v.object({ entitlement: v.array(Version), issuerDelegation: v.array(Version), attendance: v.array(Version) })

export function parseSchemaSets(json: string): SchemaSets {
  const parsed: unknown = JSON.parse(json)
  const out = v.parse(Sets, parsed)
  const lower = (list: v.InferOutput<typeof Version>[]): AcceptedVersion[] =>
    list.map((e) => ({ uid: e.uid.toLowerCase() as Hex, version: e.version }))
  return { entitlement: lower(out.entitlement), issuerDelegation: lower(out.issuerDelegation), attendance: lower(out.attendance) }
}

export function findVersion(set: AcceptedVersion[], uid: string): AcceptedVersion | null {
  const needle = uid.toLowerCase()
  return set.find((e) => e.uid === needle) ?? null
}

export function newest(set: AcceptedVersion[]): AcceptedVersion | null {
  return set.reduce<AcceptedVersion | null>((best, e) => (best === null || e.version > best.version ? e : best), null)
}
```

`apps/api/src/eas/abi.ts`:

```ts
import { parseAbi } from 'viem'

export const EAS_ABI = parseAbi([
  'struct AttestationRequestData { address recipient; uint64 expirationTime; bool revocable; bytes32 refUID; bytes data; uint256 value; }',
  'struct AttestationRequest { bytes32 schema; AttestationRequestData data; }',
  'struct RevocationRequestData { bytes32 uid; uint256 value; }',
  'struct RevocationRequest { bytes32 schema; RevocationRequestData data; }',
  'struct Attestation { bytes32 uid; bytes32 schema; uint64 time; uint64 expirationTime; uint64 revocationTime; bytes32 refUID; address recipient; address attester; bool revocable; bytes data; }',
  'function attest(AttestationRequest request) payable returns (bytes32)',
  'function revoke(RevocationRequest request) payable',
  'function getAttestation(bytes32 uid) view returns (Attestation)',
  'event Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)',
])

export const SCHEMA_REGISTRY_ABI = parseAbi([
  'struct SchemaRecord { bytes32 uid; address resolver; bool revocable; string schema; }',
  'function register(string schema, address resolver, bool revocable) returns (bytes32)',
  'function getSchema(bytes32 uid) view returns (SchemaRecord)',
])

// Coinbase Smart Wallet factory — the Claimable smart account's counterfactual address.
export const FACTORY_ABI = parseAbi(['function getAddress(bytes[] owners, uint256 nonce) view returns (address)'])
```

- [ ] **Step 3: Implement codecs**

`apps/api/src/eas/codecs.ts`:

```ts
import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters, type Hex } from 'viem'
import { SCHEMA_STRINGS } from './schemas.ts'

const ENTITLEMENT_V1 = parseAbiParameters(SCHEMA_STRINGS.entitlement)
const DELEGATION_V1 = parseAbiParameters(SCHEMA_STRINGS.issuerDelegation)
const ATTENDANCE_V1 = parseAbiParameters(SCHEMA_STRINGS.attendance)

export type EntitlementV1 = {
  holder: Hex
  issuer: Hex
  usageModel: number
  tier: number
  level: number
  serial: Hex
  validFrom: bigint
  validUntil: bigint
  metaURI: string
}
// Canonical internal type. v1 → canonical is the identity plus the version tag;
// a future v2 adds a codec here and an entry in EAS_SCHEMAS, nothing else.
export type Entitlement = EntitlementV1 & { schemaVersion: number }

export function encodeEntitlementV1(e: EntitlementV1): Hex {
  return encodeAbiParameters(ENTITLEMENT_V1, [
    e.holder, e.issuer, e.usageModel, e.tier, e.level, e.serial, e.validFrom, e.validUntil, e.metaURI,
  ])
}

export function decodeEntitlementV1(data: Hex): EntitlementV1 {
  const [holder, issuer, usageModel, tier, level, serial, validFrom, validUntil, metaURI] = decodeAbiParameters(ENTITLEMENT_V1, data)
  return { holder, issuer, usageModel, tier, level, serial, validFrom, validUntil, metaURI }
}

export function toCanonical(v1: EntitlementV1): Entitlement {
  return { ...v1, schemaVersion: 1 }
}

export function decodeEntitlement(version: number, data: Hex): Entitlement {
  if (version === 1) {
    return toCanonical(decodeEntitlementV1(data))
  }
  throw new Error(`no Entitlement codec for schema version ${version}`)
}

export type DelegationV1 = { issuer: Hex; active: boolean; name: string }
export type Delegation = DelegationV1 & { schemaVersion: number }

export function encodeDelegationV1(d: DelegationV1): Hex {
  return encodeAbiParameters(DELEGATION_V1, [d.issuer, d.active, d.name])
}

export function decodeDelegation(version: number, data: Hex): Delegation {
  if (version === 1) {
    const [issuer, active, name] = decodeAbiParameters(DELEGATION_V1, data)
    return { issuer, active, name, schemaVersion: 1 }
  }
  throw new Error(`no IssuerDelegation codec for schema version ${version}`)
}

export type Attendance = { rightUID: Hex; holder: Hex; enteredAt: bigint; slotId: Hex }

export function encodeAttendanceV1(a: Attendance): Hex {
  return encodeAbiParameters(ATTENDANCE_V1, [a.rightUID, a.holder, a.enteredAt, a.slotId])
}

export function decodeAttendanceV1(data: Hex): Attendance {
  const [rightUID, holder, enteredAt, slotId] = decodeAbiParameters(ATTENDANCE_V1, data)
  return { rightUID, holder, enteredAt, slotId }
}
```

Run tests → PASS.

- [ ] **Step 4: Check and commit**

`./node_modules/.bin/vp check` → pass.

```bash
git add apps/api/src/eas
git commit -m "feat(api): add EAS schema UIDs, accepted-version sets and v1 codecs"
```

---

### Task 7: `ChainClient` interface, viem implementation, `FakeChain`, Bearer holder, `register-schemas.ts`

**Files:**
- Create: `apps/api/src/chain/client.ts` (replaces the Task 1 stub), `apps/api/src/chain/viem-chain.ts`, `apps/api/src/chain/fake-chain.ts`, `apps/api/src/chain/holder.ts`
- Create: `apps/api/scripts/register-schemas.ts`
- Modify: `apps/api/src/index.ts`, `apps/api/test/env.ts`
- Test: `apps/api/src/chain/fake-chain.test.ts`, `apps/api/src/chain/holder.test.ts`

**Interfaces:**
- Produces (`src/chain/client.ts`):

```ts
import type { Hex } from 'viem'

export type RawAttestation = {
  uid: Hex
  schema: Hex
  time: bigint
  expirationTime: bigint
  revocationTime: bigint
  refUID: Hex
  recipient: Hex
  attester: Hex
  revocable: boolean
  data: Hex
}

export type AttestParams = {
  schema: Hex
  recipient: Hex
  refUID: Hex
  data: Hex
  revocable: boolean
  expirationTime: bigint
}

export class ChainError extends Error {
  override readonly name = 'ChainError'
}
export class NoSignerError extends Error {
  override readonly name = 'NoSignerError'
}

export interface ChainClient {
  /** Signer address, or null when SIGNER_PRIVATE_KEY is unset (write calls then throw NoSignerError). */
  signerAddress(): Hex | null
  /** EAS.getAttestation via eth_call. A missing uid returns a struct with uid = 0x00…00. Throws ChainError on RPC failure. */
  readAttestation(uid: Hex): Promise<RawAttestation>
  /** Coinbase Smart Wallet factory getAddress(owners, nonce) — pure CREATE2 computation, nothing deployed. */
  getAddressFromFactory(owners: Hex[], nonce: bigint): Promise<Hex>
  /** Submit an attestation and wait for the receipt; returns the new uid. Throws NoSignerError / ChainError. */
  attest(p: AttestParams): Promise<{ uid: Hex; txHash: Hex }>
  /** Revoke; waits for the receipt. Throws ChainError when the tx reverts (unknown or already-revoked uid). */
  revoke(schema: Hex, uid: Hex): Promise<{ txHash: Hex }>
  // Plan 4 extends this with announce() and getAnnouncementLogs().
}

export const ZERO_UID: Hex = `0x${'00'.repeat(32)}`
export const ZERO_ADDRESS: Hex = `0x${'00'.repeat(20)}`
```

- `createViemChain(env: Bindings): ChainClient`
- `class FakeChain implements ChainClient` with test controls: `constructor(opts?: { signer?: Hex | null })`, `seed(att: Omit<RawAttestation,'uid'> & { uid?: Hex }): Hex`, `revokeAt(uid, time)`, `failReads = false`, `failWrites = false`, `readonly attestations: Map<Hex, RawAttestation>`, `readonly txs: Hex[]`.
- `bearerHolder(chain: ChainClient, issuerAddress: Hex, memberId: string): Promise<Hex>`
- `test/env.ts` gains `fakeChain(opts?)` returning a fresh `FakeChain` with signer `0x` + `'f0'.repeat(20)`.

- [ ] **Step 1: Failing tests**

`apps/api/src/chain/fake-chain.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ChainError, NoSignerError, ZERO_UID } from './client.ts'
import { FakeChain } from './fake-chain.ts'

const schema = `0x${'aa'.repeat(32)}` as const
const holder = `0x${'11'.repeat(20)}` as const

describe('FakeChain', () => {
  it('attests, reads back, and reports unknown uids as zero', async () => {
    const chain = new FakeChain()
    const { uid } = await chain.attest({ schema, recipient: holder, refUID: ZERO_UID, data: '0x', revocable: true, expirationTime: 0n })
    const a = await chain.readAttestation(uid)
    expect(a.uid).toBe(uid)
    expect(a.recipient).toBe(holder)
    expect(a.attester).toBe(chain.signerAddress())
    expect(a.revocationTime).toBe(0n)
    expect((await chain.readAttestation(`0x${'ee'.repeat(32)}`)).uid).toBe(ZERO_UID)
  })
  it('revoke sets revocationTime; revoking twice or an unknown uid throws ChainError', async () => {
    const chain = new FakeChain()
    const { uid } = await chain.attest({ schema, recipient: holder, refUID: ZERO_UID, data: '0x', revocable: true, expirationTime: 0n })
    await chain.revoke(schema, uid)
    expect((await chain.readAttestation(uid)).revocationTime).toBeGreaterThan(0n)
    await expect(chain.revoke(schema, uid)).rejects.toBeInstanceOf(ChainError)
    await expect(chain.revoke(schema, `0x${'ee'.repeat(32)}`)).rejects.toBeInstanceOf(ChainError)
  })
  it('throws NoSignerError on writes without a signer, ChainError when failing is forced', async () => {
    const noSigner = new FakeChain({ signer: null })
    await expect(noSigner.attest({ schema, recipient: holder, refUID: ZERO_UID, data: '0x', revocable: true, expirationTime: 0n })).rejects.toBeInstanceOf(NoSignerError)
    const flaky = new FakeChain()
    flaky.failReads = true
    await expect(flaky.readAttestation(ZERO_UID)).rejects.toBeInstanceOf(ChainError)
  })
  it('factory addresses are deterministic in owners + nonce', async () => {
    const chain = new FakeChain()
    const a = await chain.getAddressFromFactory([holder], 1n)
    expect(a).toBe(await chain.getAddressFromFactory([holder], 1n))
    expect(a).not.toBe(await chain.getAddressFromFactory([holder], 2n))
  })
})
```

`apps/api/src/chain/holder.test.ts`:

```ts
import { keccak256, pad, toBytes } from 'viem'
import { describe, expect, it } from 'vitest'
import { FakeChain } from './fake-chain.ts'
import { bearerHolder } from './holder.ts'

describe('bearerHolder', () => {
  it('uses keccak(memberId) as nonce and the issuer padded to 32 bytes as the sole owner', async () => {
    const chain = new FakeChain()
    const issuer = `0x${'f0'.repeat(20)}` as const
    const expected = await chain.getAddressFromFactory([pad(issuer, { size: 32 })], BigInt(keccak256(toBytes('alice'))))
    expect(await bearerHolder(chain, issuer, 'alice')).toBe(expected)
    expect(await bearerHolder(chain, issuer, 'bob')).not.toBe(expected)
  })
})
```

Run tests → FAIL.

- [ ] **Step 2: Write `client.ts`** exactly as in the Interfaces block above (replace the Task 1 stub).

- [ ] **Step 3: `FakeChain`**

`apps/api/src/chain/fake-chain.ts`:

```ts
import { encodeAbiParameters, keccak256, type Hex } from 'viem'
import { type AttestParams, ChainError, type ChainClient, NoSignerError, type RawAttestation, ZERO_UID } from './client.ts'

const DEFAULT_SIGNER: Hex = `0x${'f0'.repeat(20)}`

// In-memory EAS + factory used by the workerd integration tests and by
// `wrangler dev` without a signer. Deterministic, no network.
export class FakeChain implements ChainClient {
  readonly attestations = new Map<Hex, RawAttestation>()
  readonly txs: Hex[] = []
  failReads = false
  failWrites = false
  now: () => bigint = () => BigInt(Math.floor(Date.now() / 1000))
  private readonly signer: Hex | null
  private counter = 0

  constructor(opts: { signer?: Hex | null } = {}) {
    this.signer = opts.signer === undefined ? DEFAULT_SIGNER : opts.signer
  }

  signerAddress(): Hex | null {
    return this.signer
  }

  seed(att: Omit<RawAttestation, 'uid'> & { uid?: Hex }): Hex {
    const uid = att.uid ?? this.nextUid()
    this.attestations.set(uid, { ...att, uid })
    return uid
  }

  revokeAt(uid: Hex, time: bigint): void {
    const a = this.attestations.get(uid)
    if (a !== undefined) {
      this.attestations.set(uid, { ...a, revocationTime: time })
    }
  }

  readAttestation(uid: Hex): Promise<RawAttestation> {
    if (this.failReads) {
      return Promise.reject(new ChainError('rpc down'))
    }
    return Promise.resolve(
      this.attestations.get(uid.toLowerCase() as Hex) ?? {
        uid: ZERO_UID, schema: ZERO_UID, time: 0n, expirationTime: 0n, revocationTime: 0n,
        refUID: ZERO_UID, recipient: `0x${'00'.repeat(20)}`, attester: `0x${'00'.repeat(20)}`, revocable: false, data: '0x',
      },
    )
  }

  getAddressFromFactory(owners: Hex[], nonce: bigint): Promise<Hex> {
    const h = keccak256(encodeAbiParameters([{ type: 'bytes[]' }, { type: 'uint256' }], [owners, nonce]))
    return Promise.resolve(`0x${h.slice(-40)}`)
  }

  attest(p: AttestParams): Promise<{ uid: Hex; txHash: Hex }> {
    if (this.signer === null) {
      return Promise.reject(new NoSignerError('SIGNER_PRIVATE_KEY unset'))
    }
    if (this.failWrites) {
      return Promise.reject(new ChainError('tx failed'))
    }
    const uid = this.nextUid()
    this.attestations.set(uid, {
      uid, schema: p.schema, time: this.now(), expirationTime: p.expirationTime, revocationTime: 0n,
      refUID: p.refUID, recipient: p.recipient, attester: this.signer, revocable: p.revocable, data: p.data,
    })
    const txHash = this.nextTx()
    return Promise.resolve({ uid, txHash })
  }

  revoke(schema: Hex, uid: Hex): Promise<{ txHash: Hex }> {
    if (this.signer === null) {
      return Promise.reject(new NoSignerError('SIGNER_PRIVATE_KEY unset'))
    }
    const a = this.attestations.get(uid.toLowerCase() as Hex)
    if (this.failWrites || a === undefined || a.schema !== schema || a.revocationTime !== 0n) {
      return Promise.reject(new ChainError('revert'))
    }
    this.attestations.set(a.uid, { ...a, revocationTime: this.now() })
    return Promise.resolve({ txHash: this.nextTx() })
  }

  private nextUid(): Hex {
    this.counter += 1
    return keccak256(`0x${this.counter.toString(16).padStart(64, '0')}`)
  }

  private nextTx(): Hex {
    const tx = keccak256(`0x${'ff'.repeat(16)}${(this.txs.length + 1).toString(16).padStart(32, '0')}`)
    this.txs.push(tx)
    return tx
  }
}
```

Note the `uid.toLowerCase() as Hex` casts: lint's `require-safety-comment-for-type-assertion` will demand a comment. Write them as `// SAFETY: lowercasing a 0x-hex string keeps it a Hex` above each, or centralise in a `lowerHex(h: Hex): Hex` helper with one such comment.

- [ ] **Step 4: Bearer holder**

`apps/api/src/chain/holder.ts`:

```ts
import { keccak256, pad, toBytes, type Hex } from 'viem'
import type { ChainClient } from './client.ts'

// The Bearer holder is a Claimable smart account (Coinbase Smart Wallet) at a
// counterfactual address: sole owner = the fuda signer, nonce = keccak(memberId).
// Nothing is deployed; the member takes control later via Activation (B1).
export async function bearerHolder(chain: ChainClient, issuerAddress: Hex, memberId: string): Promise<Hex> {
  const nonce = BigInt(keccak256(toBytes(memberId)))
  const owners = [pad(issuerAddress, { size: 32 })]
  return chain.getAddressFromFactory(owners, nonce)
}
```

Run tests → PASS for the two new files.

- [ ] **Step 5: viem implementation**

`apps/api/src/chain/viem-chain.ts`:

```ts
import {
  createPublicClient, createWalletClient, http, isHex, parseEventLogs, type Hex, type PublicClient, type WalletClient,
} from 'viem'
import { nonceManager, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { EAS_ABI, FACTORY_ABI } from '../eas/abi.ts'
import type { Bindings } from '../env.ts'
import { type AttestParams, ChainError, type ChainClient, NoSignerError, type RawAttestation } from './client.ts'

export const DEFAULT_RPC = 'https://sepolia.base.org'

function toHexAddress(s: string): Hex {
  if (!isHex(s)) {
    throw new ChainError(`bad address in config: ${s}`)
  }
  return s
}

export function createViemChain(env: Bindings): ChainClient {
  const transport = http(env.BASE_RPC_URL ?? DEFAULT_RPC)
  const publicClient: PublicClient = createPublicClient({ chain: baseSepolia, transport })
  const eas = toHexAddress(env.EAS_ADDRESS)
  const factory = toHexAddress(env.FACTORY_ADDRESS)
  const key = env.SIGNER_PRIVATE_KEY
  // One account with viem's nonce manager: /issue attests, announces (Plan 4) and
  // waitUntil Attendance attests (Plan 2) share this signer concurrently.
  const account = key !== undefined && isHex(key) ? privateKeyToAccount(key, { nonceManager }) : null
  const wallet: WalletClient | null = account === null ? null : createWalletClient({ account, chain: baseSepolia, transport })

  async function wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      throw new ChainError(err instanceof Error ? err.message : String(err))
    }
  }

  return {
    signerAddress: () => account?.address ?? null,

    readAttestation: (uid) =>
      wrap(async () => {
        const a = await publicClient.readContract({ address: eas, abi: EAS_ABI, functionName: 'getAttestation', args: [uid] })
        return { ...a }
      }),

    getAddressFromFactory: (owners, nonce) =>
      wrap(() => publicClient.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'getAddress', args: [owners, nonce] })),

    attest: (p) => {
      if (wallet === null || account === null) {
        return Promise.reject(new NoSignerError('SIGNER_PRIVATE_KEY unset'))
      }
      return wrap(async () => {
        const txHash = await wallet.writeContract({
          account, chain: baseSepolia, address: eas, abi: EAS_ABI, functionName: 'attest',
          args: [{ schema: p.schema, data: { recipient: p.recipient, expirationTime: p.expirationTime, revocable: p.revocable, refUID: p.refUID, data: p.data, value: 0n } }],
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        if (receipt.status !== 'success') {
          throw new ChainError('attest reverted')
        }
        const [log] = parseEventLogs({ abi: EAS_ABI, eventName: 'Attested', logs: receipt.logs })
        if (log === undefined) {
          throw new ChainError('no Attested event in receipt')
        }
        return { uid: log.args.uid, txHash }
      })
    },

    revoke: (schema, uid) => {
      if (wallet === null || account === null) {
        return Promise.reject(new NoSignerError('SIGNER_PRIVATE_KEY unset'))
      }
      return wrap(async () => {
        const txHash = await wallet.writeContract({
          account, chain: baseSepolia, address: eas, abi: EAS_ABI, functionName: 'revoke',
          args: [{ schema, data: { uid, value: 0n } }],
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        if (receipt.status !== 'success') {
          throw new ChainError('revoke reverted')
        }
        return { txHash }
      })
    },
  }
}
```

`readAttestation` returns the struct spread; if viem's inferred struct type does not match `RawAttestation` field-for-field, map the ten fields explicitly rather than casting.

- [ ] **Step 6: Wire the entry and the test helper**

`apps/api/src/index.ts`:

```ts
import { createApp } from './app.ts'
import { createViemChain } from './chain/viem-chain.ts'
import type { Bindings } from './env.ts'

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const app = createApp({ chain: createViemChain(env) })
    return Promise.resolve(app.fetch(request, env, ctx))
  },
}
```

`apps/api/test/env.ts` — add:

```ts
import { FakeChain } from '../src/chain/fake-chain.ts'
export function fakeChain(opts: { signer?: `0x${string}` | null } = {}): FakeChain {
  return new FakeChain(opts)
}
```

and change the existing tests that pass `{ chain: {} }` to `{ chain: fakeChain() }` (health, cors).

- [ ] **Step 7: `register-schemas.ts`**

`apps/api/scripts/register-schemas.ts` (run with `pnpm --filter api register-schemas`; needs `SIGNER_PRIVATE_KEY` and optional `BASE_RPC_URL` in the environment):

```ts
import { createPublicClient, createWalletClient, http, isHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { SCHEMA_REGISTRY_ABI } from '../src/eas/abi.ts'
import { SCHEMA_STRINGS, schemaUid } from '../src/eas/schemas.ts'

const REGISTRY = '0x4200000000000000000000000000000000000020'
const key = process.env.SIGNER_PRIVATE_KEY
if (key === undefined || !isHex(key)) {
  throw new Error('SIGNER_PRIVATE_KEY (0x-hex) is required')
}
const transport = http(process.env.BASE_RPC_URL ?? 'https://sepolia.base.org')
const account = privateKeyToAccount(key)
const pub = createPublicClient({ chain: baseSepolia, transport })
const wallet = createWalletClient({ account, chain: baseSepolia, transport })

const out: Record<string, { uid: string; version: number }[]> = {}
for (const [kind, schema] of Object.entries(SCHEMA_STRINGS)) {
  const uid = schemaUid(schema)
  // oxlint-disable-next-line no-await-in-loop -- one registration at a time keeps the signer nonce sequential
  const existing = await pub.readContract({ address: REGISTRY, abi: SCHEMA_REGISTRY_ABI, functionName: 'getSchema', args: [uid] })
  if (existing.uid === uid) {
    console.log(`${kind}: already registered ${uid}`)
  } else {
    // oxlint-disable-next-line no-await-in-loop -- see above
    const hash = await wallet.writeContract({ address: REGISTRY, abi: SCHEMA_REGISTRY_ABI, functionName: 'register', args: [schema, '0x0000000000000000000000000000000000000000', true] })
    // oxlint-disable-next-line no-await-in-loop -- see above
    await pub.waitForTransactionReceipt({ hash })
    console.log(`${kind}: registered ${uid} in ${hash}`)
  }
  out[kind] = [{ uid, version: 1 }]
}
console.log('\nPaste into wrangler.jsonc vars.EAS_SCHEMAS:')
console.log(JSON.stringify(JSON.stringify(out)))
```

If the lint preset forbids `console` in scripts, add an override in the root `vite.config.ts` for `apps/*/scripts/**` with `'no-console': 'off'` and a comment that scripts are CLI tools.

- [ ] **Step 8: Check and commit**

Run all api tests → PASS. `./node_modules/.bin/vp check` → pass.

```bash
git add apps/api/src/chain apps/api/src/index.ts apps/api/test/env.ts apps/api/test/health.test.ts apps/api/test/cors.test.ts apps/api/scripts/register-schemas.ts vite.config.ts
git commit -m "feat(api): add ChainClient with viem and in-memory implementations, bearer holder and schema registration script"
```

---

### Task 8: `verifyUid` — §6 ordering and the delegation check

**Files:**
- Create: `apps/api/src/verify/verify-uid.ts`, `apps/api/src/verify/config.ts`
- Test: `apps/api/src/verify/verify-uid.test.ts`

**Interfaces:**
- Produces:

```ts
export type VerifyDeps = { chain: ChainClient; sets: SchemaSets; issuerAddress: Hex; now: number }
export type VerifyOutcome =
  | { decision: 'REJECT'; reason: Reason; entitlement?: EntitlementView; delegation?: DelegationView; attester?: Hex }
  | { decision: 'ADMIT'; reason: 'OK'; entitlement: EntitlementView; delegation: DelegationView; attester: Hex; canonical: Entitlement }
export function verifyUid(deps: VerifyDeps, uid: Hex): Promise<VerifyOutcome>   // throws ChainError only for the Entitlement read
export function verifyConfig(env: Bindings, chain: ChainClient, now: number): VerifyDeps  // parses EAS_SCHEMAS once per request
export function toEntitlementView(e: Entitlement): EntitlementView
```

Decisions (spec ambiguities):
- `DELEGATION_CONFIG_MISSING` = `ISSUER_ADDRESS` unset/zero **or** the IssuerDelegation accepted set is empty.
- `NO_DELEGATION` = `refUID` is zero, the referenced attestation does not exist, is revoked, has a schema outside the IssuerDelegation set, has an attester other than `ISSUER_ADDRESS`, or `active = false`.
- `ISSUER_NOT_DELEGATED` = the delegation is valid but its `issuer` ≠ the Entitlement's `attester`.
- `DELEGATION_UNAVAILABLE` = the delegation read threw.
- An RPC failure on the **Entitlement** read has no reason code in §6; `verifyUid` rethrows `ChainError` and the routes answer `502 { error: 'chain_error' }` (fail closed, not logged — it is not decision-shaped). Plan 2's gate UI shows this as the network-error banner (§11).

- [ ] **Step 1: Failing tests**

`apps/api/src/verify/verify-uid.test.ts`:

```ts
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'
import { ChainError, ZERO_UID } from '../chain/client.ts'
import { FakeChain } from '../chain/fake-chain.ts'
import { encodeDelegationV1, encodeEntitlementV1 } from '../eas/codecs.ts'
import { SCHEMA_STRINGS, schemaUid } from '../eas/schemas.ts'
import { verifyUid, type VerifyDeps } from './verify-uid.ts'

const ENT = schemaUid(SCHEMA_STRINGS.entitlement)
const DEL = schemaUid(SCHEMA_STRINGS.issuerDelegation)
const ROOT: Hex = `0x${'f0'.repeat(20)}`
const HOLDER: Hex = `0x${'11'.repeat(20)}`
const NOW = 1_757_000_000

let chain: FakeChain
let deps: VerifyDeps
let delegationUid: Hex

function seedDelegation(opts: { issuer?: Hex; active?: boolean; attester?: Hex } = {}): Hex {
  return chain.seed({
    schema: DEL, time: 1n, expirationTime: 0n, revocationTime: 0n, refUID: ZERO_UID, recipient: ROOT,
    attester: opts.attester ?? ROOT, revocable: true,
    data: encodeDelegationV1({ issuer: opts.issuer ?? ROOT, active: opts.active ?? true, name: 'fuda root' }),
  })
}

function seedRight(over: Partial<{ level: number; usageModel: number; validFrom: bigint; validUntil: bigint; refUID: Hex; schema: Hex; attester: Hex; revocationTime: bigint }> = {}): Hex {
  return chain.seed({
    schema: over.schema ?? ENT, time: 1n, expirationTime: 0n, revocationTime: over.revocationTime ?? 0n,
    refUID: over.refUID ?? delegationUid, recipient: HOLDER, attester: over.attester ?? ROOT, revocable: true,
    data: encodeEntitlementV1({
      holder: HOLDER, issuer: ROOT, usageModel: over.usageModel ?? 1, tier: 1, level: over.level ?? 0,
      serial: ZERO_UID, validFrom: over.validFrom ?? 0n, validUntil: over.validUntil ?? 0n, metaURI: '',
    }),
  })
}

beforeEach(() => {
  chain = new FakeChain({ signer: ROOT })
  delegationUid = seedDelegation()
  deps = {
    chain, issuerAddress: ROOT, now: NOW,
    sets: { entitlement: [{ uid: ENT, version: 1 }], issuerDelegation: [{ uid: DEL, version: 1 }], attendance: [] },
  }
})

describe('verifyUid — §6 ordering', () => {
  it('ADMIT with decoded entitlement and delegation views', async () => {
    const out = await verifyUid(deps, seedRight())
    expect(out.decision).toBe('ADMIT')
    expect(out.entitlement).toMatchObject({ holder: HOLDER, level: 0, usageModel: 1, tier: 1, schemaVersion: 1 })
    expect(out.delegation).toEqual({ issuer: ROOT, active: true, name: 'fuda root' })
  })
  it('NOT_FOUND', async () => {
    expect((await verifyUid(deps, `0x${'ee'.repeat(32)}`)).reason).toBe('NOT_FOUND')
  })
  it('WRONG_SCHEMA for a uid outside the accepted set', async () => {
    expect((await verifyUid(deps, seedRight({ schema: `0x${'99'.repeat(32)}` }))).reason).toBe('WRONG_SCHEMA')
  })
  it('REVOKED', async () => {
    expect((await verifyUid(deps, seedRight({ revocationTime: 5n }))).reason).toBe('REVOKED')
  })
  it('UNKNOWN_USAGE_MODEL for usageModel 3', async () => {
    expect((await verifyUid(deps, seedRight({ usageModel: 3 }))).reason).toBe('UNKNOWN_USAGE_MODEL')
  })
  it('NOT_YET_VALID and EXPIRED, with 0 meaning unbounded', async () => {
    expect((await verifyUid(deps, seedRight({ validFrom: BigInt(NOW + 10) }))).reason).toBe('NOT_YET_VALID')
    expect((await verifyUid(deps, seedRight({ validUntil: BigInt(NOW - 10) }))).reason).toBe('EXPIRED')
    expect((await verifyUid(deps, seedRight({ validFrom: BigInt(NOW), validUntil: BigInt(NOW) }))).decision).toBe('ADMIT')
  })
  it('revocation is reported before usage model and validity', async () => {
    expect((await verifyUid(deps, seedRight({ revocationTime: 5n, usageModel: 3, validUntil: 1n }))).reason).toBe('REVOKED')
  })
  it('does not reject on level (that is the QR route’s job)', async () => {
    const out = await verifyUid(deps, seedRight({ level: 1 }))
    expect(out.decision).toBe('ADMIT')
    expect(out.entitlement?.level).toBe(1)
  })
})

describe('verifyUid — delegation', () => {
  it('NO_DELEGATION when refUID is zero, missing, revoked, inactive, wrong schema, or not attested by the root', async () => {
    expect((await verifyUid(deps, seedRight({ refUID: ZERO_UID }))).reason).toBe('NO_DELEGATION')
    expect((await verifyUid(deps, seedRight({ refUID: `0x${'ee'.repeat(32)}` }))).reason).toBe('NO_DELEGATION')
    chain.revokeAt(delegationUid, 5n)
    expect((await verifyUid(deps, seedRight())).reason).toBe('NO_DELEGATION')
    expect((await verifyUid(deps, seedRight({ refUID: seedDelegation({ active: false }) }))).reason).toBe('NO_DELEGATION')
    expect((await verifyUid(deps, seedRight({ refUID: seedDelegation({ attester: HOLDER }) }))).reason).toBe('NO_DELEGATION')
    const wrongSchema = chain.seed({ schema: ENT, time: 1n, expirationTime: 0n, revocationTime: 0n, refUID: ZERO_UID, recipient: ROOT, attester: ROOT, revocable: true, data: encodeDelegationV1({ issuer: ROOT, active: true, name: 'x' }) })
    expect((await verifyUid(deps, seedRight({ refUID: wrongSchema }))).reason).toBe('NO_DELEGATION')
  })
  it('ISSUER_NOT_DELEGATED when the delegation names another issuer', async () => {
    expect((await verifyUid(deps, seedRight({ refUID: seedDelegation({ issuer: HOLDER }) }))).reason).toBe('ISSUER_NOT_DELEGATED')
  })
  it('DELEGATION_UNAVAILABLE when the delegation read fails (fail closed)', async () => {
    const uid = seedRight()
    const original = chain.readAttestation.bind(chain)
    let calls = 0
    chain.readAttestation = (u) => {
      calls += 1
      return calls === 1 ? original(u) : Promise.reject(new ChainError('rpc'))
    }
    expect((await verifyUid(deps, uid)).reason).toBe('DELEGATION_UNAVAILABLE')
  })
  it('DELEGATION_CONFIG_MISSING when ISSUER_ADDRESS is zero or the delegation set is empty', async () => {
    const uid = seedRight()
    expect((await verifyUid({ ...deps, issuerAddress: `0x${'00'.repeat(20)}` }, uid)).reason).toBe('DELEGATION_CONFIG_MISSING')
    expect((await verifyUid({ ...deps, sets: { ...deps.sets, issuerDelegation: [] } }, uid)).reason).toBe('DELEGATION_CONFIG_MISSING')
  })
  it('rethrows ChainError when the Entitlement read itself fails', async () => {
    chain.failReads = true
    await expect(verifyUid(deps, seedRight())).rejects.toBeInstanceOf(ChainError)
  })
})
```

Run tests → FAIL.

- [ ] **Step 2: Implement**

`apps/api/src/verify/config.ts`:

```ts
import type { Hex } from 'viem'
import type { ChainClient } from '../chain/client.ts'
import { parseSchemaSets, type SchemaSets } from '../eas/schemas.ts'
import type { Bindings } from '../env.ts'

export type VerifyDeps = { chain: ChainClient; sets: SchemaSets; issuerAddress: Hex; now: number }

// SAFETY: ISSUER_ADDRESS is validated as 0x + 40 hex before use; a bad value
// yields DELEGATION_CONFIG_MISSING downstream instead of a crash.
function asAddress(s: string): Hex {
  return (/^0x[0-9a-fA-F]{40}$/.test(s) ? s : `0x${'00'.repeat(20)}`) as Hex
}

export function verifyConfig(env: Bindings, chain: ChainClient, now: number): VerifyDeps {
  return { chain, sets: parseSchemaSets(env.EAS_SCHEMAS), issuerAddress: asAddress(env.ISSUER_ADDRESS), now }
}
```

`apps/api/src/verify/verify-uid.ts`:

```ts
import type { DelegationView, EntitlementView, Reason } from '@fuda/sdk'
import type { Hex } from 'viem'
import { ZERO_ADDRESS, ZERO_UID } from '../chain/client.ts'
import { decodeDelegation, decodeEntitlement, type Entitlement } from '../eas/codecs.ts'
import { findVersion } from '../eas/schemas.ts'
import type { VerifyDeps } from './config.ts'

export type { VerifyDeps } from './config.ts'

export type VerifyOutcome =
  | { decision: 'REJECT'; reason: Reason; entitlement?: EntitlementView; delegation?: DelegationView; attester?: Hex }
  | { decision: 'ADMIT'; reason: 'OK'; entitlement: EntitlementView; delegation: DelegationView; attester: Hex; canonical: Entitlement }

export function toEntitlementView(e: Entitlement): EntitlementView {
  return {
    holder: e.holder, issuer: e.issuer, usageModel: e.usageModel, tier: e.tier, level: e.level,
    validFrom: Number(e.validFrom), validUntil: Number(e.validUntil), schemaVersion: e.schemaVersion,
  }
}

type DelegationResult = { ok: true; view: DelegationView } | { ok: false; reason: Reason }

async function checkDelegation(deps: VerifyDeps, refUID: Hex, attester: Hex): Promise<DelegationResult> {
  if (deps.issuerAddress === ZERO_ADDRESS || deps.sets.issuerDelegation.length === 0) {
    return { ok: false, reason: 'DELEGATION_CONFIG_MISSING' }
  }
  if (refUID === ZERO_UID) {
    return { ok: false, reason: 'NO_DELEGATION' }
  }
  let raw
  try {
    raw = await deps.chain.readAttestation(refUID)
  } catch {
    return { ok: false, reason: 'DELEGATION_UNAVAILABLE' }
  }
  const version = findVersion(deps.sets.issuerDelegation, raw.schema)
  if (raw.uid === ZERO_UID || version === null || raw.revocationTime !== 0n || raw.attester.toLowerCase() !== deps.issuerAddress.toLowerCase()) {
    return { ok: false, reason: 'NO_DELEGATION' }
  }
  const d = decodeDelegation(version.version, raw.data)
  if (!d.active) {
    return { ok: false, reason: 'NO_DELEGATION' }
  }
  if (d.issuer.toLowerCase() !== attester.toLowerCase()) {
    return { ok: false, reason: 'ISSUER_NOT_DELEGATED' }
  }
  return { ok: true, view: { issuer: d.issuer, active: d.active, name: d.name } }
}

// §6: EAS.getAttestation, then the checks in table order. The first failure is
// the reported reason. Level and slot checks belong to the routes (they differ
// per entry path); this function never rejects on level.
export async function verifyUid(deps: VerifyDeps, uid: Hex): Promise<VerifyOutcome> {
  const raw = await deps.chain.readAttestation(uid) // ChainError propagates → 502 chain_error
  if (raw.uid === ZERO_UID) {
    return { decision: 'REJECT', reason: 'NOT_FOUND' }
  }
  const version = findVersion(deps.sets.entitlement, raw.schema)
  if (version === null) {
    return { decision: 'REJECT', reason: 'WRONG_SCHEMA' }
  }
  const canonical = decodeEntitlement(version.version, raw.data)
  const entitlement = toEntitlementView(canonical)
  const reject = (reason: Reason): VerifyOutcome => ({ decision: 'REJECT', reason, entitlement, attester: raw.attester })
  if (raw.revocationTime !== 0n) {
    return reject('REVOKED')
  }
  if (canonical.usageModel > 2) {
    return reject('UNKNOWN_USAGE_MODEL')
  }
  const now = BigInt(deps.now)
  if (canonical.validFrom !== 0n && now < canonical.validFrom) {
    return reject('NOT_YET_VALID')
  }
  if (canonical.validUntil !== 0n && now > canonical.validUntil) {
    return reject('EXPIRED')
  }
  const delegation = await checkDelegation(deps, raw.refUID, raw.attester)
  if (!delegation.ok) {
    return reject(delegation.reason)
  }
  return { decision: 'ADMIT', reason: 'OK', entitlement, delegation: delegation.view, attester: raw.attester, canonical }
}
```

Run tests → PASS.

- [ ] **Step 3: Check and commit**

`./node_modules/.bin/vp check` → pass.

```bash
git add apps/api/src/verify
git commit -m "feat(api): add verifyUid with the §6 reason order and delegation check"
```

---

### Task 9: `GET /verify/:uid` (read-only preview)

**Files:**
- Create: `apps/api/src/routes/verify.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/verify-get.test.ts`, `apps/api/test/fixtures.ts`

**Interfaces:**
- Consumes: `verifyUid`, `verifyConfig` (Task 8), `isUid` (`@fuda/sdk`), `jsonResponse`/`errorResponse` (Task 3).
- Produces: `verifyRoutes: Hono<AppEnv>` mounting `GET /verify/:uid` (and `POST /verify` in Task 11); `test/fixtures.ts` with `seedRoot(chain)` and `seedRight(chain, over)` shared by the route tests, and `configuredEnv(overrides)` returning bindings whose `EAS_SCHEMAS`, `ISSUER_ADDRESS`, `DELEGATION_UID` match the fake chain.

- [ ] **Step 1: Shared fixtures**

`apps/api/test/fixtures.ts`:

```ts
import type { Hex } from 'viem'
import { ZERO_UID } from '../src/chain/client.ts'
import type { FakeChain } from '../src/chain/fake-chain.ts'
import { encodeDelegationV1, encodeEntitlementV1 } from '../src/eas/codecs.ts'
import { SCHEMA_STRINGS, schemaUid } from '../src/eas/schemas.ts'
import type { Bindings } from '../src/env.ts'
import { testEnv } from './env.ts'

export const ENT = schemaUid(SCHEMA_STRINGS.entitlement)
export const DEL = schemaUid(SCHEMA_STRINGS.issuerDelegation)
export const ATT = schemaUid(SCHEMA_STRINGS.attendance)
export const ROOT: Hex = `0x${'f0'.repeat(20)}`
export const HOLDER: Hex = `0x${'11'.repeat(20)}`
export const NOW = 1_757_000_000

export function seedRoot(chain: FakeChain): Hex {
  return chain.seed({
    schema: DEL, time: 1n, expirationTime: 0n, revocationTime: 0n, refUID: ZERO_UID, recipient: ROOT, attester: ROOT, revocable: true,
    data: encodeDelegationV1({ issuer: ROOT, active: true, name: 'fuda root' }),
  })
}

export type RightOverrides = Partial<{ level: number; usageModel: number; tier: number; validFrom: bigint; validUntil: bigint; holder: Hex; refUID: Hex }>

export function seedRight(chain: FakeChain, delegationUid: Hex, over: RightOverrides = {}): Hex {
  return chain.seed({
    schema: ENT, time: 1n, expirationTime: 0n, revocationTime: 0n, refUID: over.refUID ?? delegationUid,
    recipient: over.holder ?? HOLDER, attester: ROOT, revocable: true,
    data: encodeEntitlementV1({
      holder: over.holder ?? HOLDER, issuer: ROOT, usageModel: over.usageModel ?? 1, tier: over.tier ?? 1, level: over.level ?? 0,
      serial: ZERO_UID, validFrom: over.validFrom ?? 0n, validUntil: over.validUntil ?? 0n, metaURI: '',
    }),
  })
}

export function configuredEnv(delegationUid: Hex, overrides: Partial<Bindings> = {}): Bindings {
  return testEnv({
    EAS_SCHEMAS: JSON.stringify({ entitlement: [{ uid: ENT, version: 1 }], issuerDelegation: [{ uid: DEL, version: 1 }], attendance: [{ uid: ATT, version: 1 }] }),
    ISSUER_ADDRESS: ROOT,
    DELEGATION_UID: delegationUid,
    ADMIN_TOKEN: undefined,
    ...overrides,
  })
}
```

- [ ] **Step 2: Failing test**

`apps/api/test/verify-get.test.ts`:

```ts
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { entryLog } from '../src/db/schema.ts'
import { getDb } from '../src/db/client.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, HOLDER, NOW, seedRight, seedRoot } from './fixtures.ts'

describe('GET /verify/:uid', () => {
  it('400 bad_uid on a malformed uid', async () => {
    const chain = fakeChain()
    const res = await appWith({ chain, now: () => NOW }).request('/verify/0x123', {}, configuredEnv(seedRoot(chain)))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_uid' })
  })
  it('returns the verdict with entitlement + delegation and never logs', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    const res = await appWith({ chain, now: () => NOW }).request(`/verify/${uid}`, {}, configuredEnv(del))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      decision: 'ADMIT', reason: 'OK',
      entitlement: { holder: HOLDER, issuer: expect.any(String), usageModel: 1, tier: 1, level: 0, validFrom: 0, validUntil: 0, schemaVersion: 1 },
      delegation: { issuer: expect.any(String), active: true, name: 'fuda root' },
    })
    expect(await getDb({ DB: env.DB } as never).select().from(entryLog)).toHaveLength(0)
  })
  it('reports level >= 1 as ADMIT (preview never rejects on level)', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { level: 1 })
    const body = await (await appWith({ chain, now: () => NOW }).request(`/verify/${uid}`, {}, configuredEnv(del))).json()
    expect(body).toMatchObject({ decision: 'ADMIT', entitlement: { level: 1 } })
  })
  it('REVOKED and NOT_FOUND are 200 verdicts; an RPC failure is 502 chain_error', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    chain.revokeAt(uid, 5n)
    const app = appWith({ chain, now: () => NOW })
    expect(await (await app.request(`/verify/${uid}`, {}, configuredEnv(del))).json()).toMatchObject({ decision: 'REJECT', reason: 'REVOKED' })
    expect(await (await app.request(`/verify/0x${'ee'.repeat(32)}`, {}, configuredEnv(del))).json()).toMatchObject({ decision: 'REJECT', reason: 'NOT_FOUND' })
    chain.failReads = true
    const down = await app.request(`/verify/${uid}`, {}, configuredEnv(del))
    expect(down.status).toBe(502)
    expect(await down.json()).toEqual({ error: 'chain_error' })
  })
})
```

Run tests → FAIL (404 route missing).

- [ ] **Step 3: Implement**

`apps/api/src/routes/verify.ts`:

```ts
import { isUid } from '@fuda/sdk'
import { Hono } from 'hono'
import { ChainError } from '../chain/client.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { verifyConfig } from '../verify/config.ts'
import { verifyUid, type VerifyOutcome } from '../verify/verify-uid.ts'

export function verdictBody(out: VerifyOutcome) {
  return { decision: out.decision, reason: out.reason, entitlement: out.entitlement, delegation: out.delegation }
}

export const verifyRoutes = new Hono<AppEnv>()

// Read-only preview: answers "is this right valid?", never "may it enter by QR?".
// Never consumes a slot, never logged, never rejects on level.
verifyRoutes.get('/verify/:uid', async (c) => {
  const uid = c.req.param('uid')
  if (!isUid(uid)) {
    return errorResponse(c, 'bad_uid', 400)
  }
  try {
    const out = await verifyUid(verifyConfig(c.env, c.get('chain'), c.get('now')()), uid)
    return jsonResponse(c, verdictBody(out))
  } catch (err) {
    if (err instanceof ChainError) {
      return errorResponse(c, 'chain_error', 502)
    }
    throw err
  }
})
```

In `apps/api/src/app.ts`: `app.route('/', verifyRoutes)`.

Run tests → PASS.

- [ ] **Step 4: Check and commit**

`./node_modules/.bin/vp check` → pass.

```bash
git add apps/api/src/routes/verify.ts apps/api/src/app.ts apps/api/test/fixtures.ts apps/api/test/verify-get.test.ts
git commit -m "feat(api): add GET /verify/:uid read-only preview"
```

---

### Task 10: `POST /issue` — Bearer branch

**Files:**
- Create: `apps/api/src/routes/issue.ts`, `apps/api/src/issue/issue-bearer.ts`, `apps/api/src/issue/pass-urls.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/issue.test.ts`

**Interfaces:**
- Consumes: `IssueBody`, `deriveIssueKind`, `toQr`, `LEVEL_CODE` (`@fuda/sdk`); `bearerHolder` (Task 7); `encodeEntitlementV1`, `newest`, `parseSchemaSets` (Task 6); `adminAuth` (Task 5); `members` table (Task 4).
- Produces: `issueRoutes: Hono<AppEnv>`; `passUrls(baseUrl, uid): PassUrls`; `issueBearer(ctx, body): Promise<IssueResponse>`. The spec defines no "not implemented" error code, so until Plans 3–4 land the `'signed'` and `'private'` results of `deriveIssueKind` answer `400 { error: 'bad_input' }` behind a `// TODO(plan-3)` / `// TODO(plan-4)` comment; those plans replace the branch.

- [ ] **Step 1: Failing test**

`apps/api/test/issue.test.ts`:

```ts
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getDb } from '../src/db/client.ts'
import { members } from '../src/db/schema.ts'
import { decodeEntitlementV1 } from '../src/eas/codecs.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, ENT, NOW, ROOT, seedRoot } from './fixtures.ts'

describe('POST /issue (bearer)', () => {
  it('issues a Bearer right: attests to the Claimable smart account, stores the row, returns qr + passUrls', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const res = await app.request('/issue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: 'alice', tier: 2 }) }, configuredEnv(del, { API_BASE_URL: 'https://api.test' }))
    expect(res.status).toBe(200)
    const body = await res.json() as { uid: string; level: string; holder: string; qr: string; passUrls: Record<string, string> }
    expect(body.level).toBe('bearer')
    expect(body.qr).toBe(`fuda:v1:${body.uid}`)
    expect(body.passUrls).toEqual({
      web: `https://api.test/pass/${body.uid}`,
      google: `https://api.test/pass/${body.uid}/google`,
      apple: `https://api.test/pass/${body.uid}/apple.pkpass`,
    })
    const raw = await chain.readAttestation(body.uid as `0x${string}`)
    expect(raw.schema).toBe(ENT)
    expect(raw.refUID).toBe(del)
    expect(raw.recipient).toBe(body.holder)
    const decoded = decodeEntitlementV1(raw.data)
    expect(decoded).toMatchObject({ holder: body.holder, issuer: ROOT, usageModel: 1, tier: 2, level: 0, validFrom: 0n, validUntil: 0n, metaURI: '' })
    const rows = await getDb({ DB: env.DB } as never).select().from(members)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ attestationUid: body.uid, memberId: 'alice', holder: body.holder, level: 'bearer', tier: 2, status: 'active', createdAt: NOW })
  })
  it('same memberId twice → two rows, same holder', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const e = configuredEnv(del)
    const a = await (await app.request('/issue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: 'bob' }) }, e)).json() as { uid: string; holder: string }
    const b = await (await app.request('/issue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: 'bob' }) }, e)).json() as { uid: string; holder: string }
    expect(a.uid).not.toBe(b.uid)
    expect(a.holder).toBe(b.holder)
    expect(await getDb({ DB: env.DB } as never).select().from(members)).toHaveLength(2)
  })
  it('400 bad_input on validation failure, holder+memberId, and an empty body', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    for (const body of [{}, { memberId: 'a', holder: `0x${'11'.repeat(20)}` }, { memberId: 'a', tier: 9 }, { memberId: '' }]) {
      const res = await app.request('/issue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, configuredEnv(del))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad_input' })
    }
  })
  it('501 no_signer without a signer; 502 chain_error when the attest fails and nothing is persisted', async () => {
    const noSigner = fakeChain({ signer: null })
    const del = seedRoot(noSigner)
    const res = await appWith({ chain: noSigner, now: () => NOW }).request('/issue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: 'a' }) }, configuredEnv(del))
    expect(res.status).toBe(501)
    expect(await res.json()).toEqual({ error: 'no_signer' })

    const flaky = fakeChain({ signer: ROOT })
    const del2 = seedRoot(flaky)
    flaky.failWrites = true
    const res2 = await appWith({ chain: flaky, now: () => NOW }).request('/issue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: 'a' }) }, configuredEnv(del2))
    expect(res2.status).toBe(502)
    expect(await res2.json()).toEqual({ error: 'chain_error' })
    expect(await getDb({ DB: env.DB } as never).select().from(members)).toHaveLength(0)
  })
  it('401 unauthorized when ADMIN_TOKEN is set and the header is missing', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const res = await appWith({ chain, now: () => NOW }).request('/issue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: 'a' }) }, configuredEnv(del, { ADMIN_TOKEN: 'secret' }))
    expect(res.status).toBe(401)
  })
})
```

Run tests → FAIL.

- [ ] **Step 2: Implement**

`apps/api/src/issue/pass-urls.ts`:

```ts
import type { PassUrls } from '@fuda/sdk'
import type { Hex } from 'viem'

// Always all three keys, even when a platform is unconfigured (the endpoint 501s).
export function passUrls(baseUrl: string, uid: Hex): PassUrls {
  const base = baseUrl.replace(/\/$/, '')
  return { web: `${base}/pass/${uid}`, google: `${base}/pass/${uid}/google`, apple: `${base}/pass/${uid}/apple.pkpass` }
}
```

`apps/api/src/issue/issue-bearer.ts`:

```ts
import { type IssueRequest, type IssueResponse, LEVEL_CODE, toQr } from '@fuda/sdk'
import type { Hex } from 'viem'
import type { ChainClient } from '../chain/client.ts'
import { bearerHolder } from '../chain/holder.ts'
import type { Db } from '../db/client.ts'
import { members } from '../db/schema.ts'
import { encodeEntitlementV1 } from '../eas/codecs.ts'
import { newest, type SchemaSets } from '../eas/schemas.ts'
import { passUrls } from './pass-urls.ts'

export type IssueContext = {
  chain: ChainClient
  db: Db
  sets: SchemaSets
  issuerAddress: Hex
  delegationUid: Hex
  baseUrl: string
  now: number
}

export class IssueConfigError extends Error {
  override readonly name = 'IssueConfigError'
}

// Bearer: holder = the member's Claimable smart account (counterfactual address),
// level = 0. Synchronous attest; the member row is written only after the receipt.
export async function issueBearer(ctx: IssueContext, body: IssueRequest & { memberId: string }): Promise<IssueResponse> {
  const schema = newest(ctx.sets.entitlement)
  if (schema === null) {
    throw new IssueConfigError('EAS_SCHEMAS.entitlement is empty')
  }
  const holder = await bearerHolder(ctx.chain, ctx.issuerAddress, body.memberId)
  const data = encodeEntitlementV1({
    holder, issuer: ctx.issuerAddress, usageModel: body.usageModel, tier: body.tier, level: LEVEL_CODE.bearer,
    serial: `0x${'00'.repeat(32)}`, validFrom: BigInt(body.validFrom), validUntil: BigInt(body.validUntil), metaURI: body.metaURI,
  })
  const { uid } = await ctx.chain.attest({ schema: schema.uid, recipient: holder, refUID: ctx.delegationUid, data, revocable: true, expirationTime: 0n })
  await ctx.db.insert(members).values({ attestationUid: uid, memberId: body.memberId, holder, level: 'bearer', tier: body.tier, status: 'active', createdAt: ctx.now })
  return { uid, level: 'bearer', holder, qr: toQr(uid), passUrls: passUrls(ctx.baseUrl, uid) }
}
```

`apps/api/src/routes/issue.ts`:

```ts
import { deriveIssueKind, IssueBody } from '@fuda/sdk'
import { Hono } from 'hono'
import * as v from 'valibot'
import type { Hex } from 'viem'
import { ChainError, NoSignerError } from '../chain/client.ts'
import { parseSchemaSets } from '../eas/schemas.ts'
import type { AppEnv } from '../env.ts'
import { IssueConfigError, issueBearer, type IssueContext } from '../issue/issue-bearer.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { adminAuth } from '../middleware/admin-auth.ts'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const UID_RE = /^0x[0-9a-fA-F]{64}$/

function issueContext(c: Parameters<Parameters<Hono<AppEnv>['post']>[1]>[0]): IssueContext | null {
  const issuerAddress = c.env.ISSUER_ADDRESS
  const delegationUid = c.env.DELEGATION_UID
  if (!ADDRESS_RE.test(issuerAddress) || !UID_RE.test(delegationUid)) {
    return null
  }
  // SAFETY: both strings were regex-checked as 0x-hex of the right length just above.
  return {
    chain: c.get('chain'), db: c.get('db'), sets: parseSchemaSets(c.env.EAS_SCHEMAS),
    issuerAddress: issuerAddress as Hex, delegationUid: delegationUid as Hex, baseUrl: c.env.API_BASE_URL, now: c.get('now')(),
  }
}

export const issueRoutes = new Hono<AppEnv>()

issueRoutes.post('/issue', adminAuth(), async (c) => {
  const parsed = v.safeParse(IssueBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  const kind = deriveIssueKind(parsed.output)
  if (kind === null) {
    return errorResponse(c, 'bad_input', 400)
  }
  if (c.get('chain').signerAddress() === null) {
    return errorResponse(c, 'no_signer', 501)
  }
  const ctx = issueContext(c)
  if (ctx === null) {
    return errorResponse(c, 'chain_error', 502) // ISSUER_ADDRESS / DELEGATION_UID not configured
  }
  try {
    if (kind === 'bearer' && parsed.output.memberId !== undefined) {
      return jsonResponse(c, await issueBearer(ctx, { ...parsed.output, memberId: parsed.output.memberId }))
    }
    // TODO(plan-3): Signed branch. TODO(plan-4): +Private branch.
    return errorResponse(c, 'bad_input', 400)
  } catch (err) {
    if (err instanceof NoSignerError) {
      return errorResponse(c, 'no_signer', 501)
    }
    if (err instanceof ChainError || err instanceof IssueConfigError) {
      return errorResponse(c, 'chain_error', 502)
    }
    throw err
  }
})
```

If the `issueContext` parameter type is unwieldy, type it as `Context<AppEnv>` (import `Context` from `hono`) — same thing, simpler.

In `apps/api/src/app.ts`: `app.route('/', issueRoutes)`.

Run tests → PASS.

- [ ] **Step 3: Check and commit**

`./node_modules/.bin/vp check` → pass.

```bash
git add apps/api/src/routes/issue.ts apps/api/src/issue apps/api/src/app.ts apps/api/test/issue.test.ts
git commit -m "feat(api): add POST /issue for Bearer rights with synchronous attest"
```

---

### Task 11: `POST /verify` — QR admission with level check, slot consumption, entry log

**Files:**
- Modify: `apps/api/src/routes/verify.ts`
- Create: `apps/api/src/verify/admit.ts`
- Test: `apps/api/test/verify-post.test.ts`

**Interfaces:**
- Consumes: `VerifyBody`, `parseQr` (`@fuda/sdk`); `verifyUid` (Task 8); `slots`, `entryLog` tables (Task 4).
- Produces: `consumeSlot(db, uid, now): Promise<boolean>` (true iff consumed now), `logEntry(db, row): Promise<number>` (returns the `entry_log.id`), both reused by Plan 3's `/verify-signed`; `AdmitHook = (info: { uid: Hex; holder: Hex; entryLogId: number; now: number }) => void` — an optional `onAdmit` in `AppDeps` that Plan 2 uses for the Attendance hook (no-op here).

- [ ] **Step 1: Failing test**

`apps/api/test/verify-post.test.ts`:

```ts
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getDb } from '../src/db/client.ts'
import { entryLog, slots } from '../src/db/schema.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, seedRight, seedRoot } from './fixtures.ts'

const db = () => getDb({ DB: env.DB } as never)
const scan = (app: ReturnType<typeof appWith>, e: ReturnType<typeof configuredEnv>, qr: string) =>
  app.request('/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ qr }) }, e)

describe('POST /verify', () => {
  it('400 bad_qr on a bare uid or a bad prefix; nothing logged', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const uid = seedRight(chain, del)
    for (const qr of [uid, `fuda:v2:${uid}`, 'hello']) {
      const res = await scan(app, configuredEnv(del), qr)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad_qr' })
    }
    expect(await db().select().from(entryLog)).toHaveLength(0)
  })
  it('ADMIT a bearer right and log path qr', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    const res = await scan(appWith({ chain, now: () => NOW }), configuredEnv(del), `fuda:v1:${uid}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ decision: 'ADMIT', reason: 'OK', entitlement: { level: 0 } })
    const log = await db().select().from(entryLog)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ uid, decision: 'ADMIT', reason: 'OK', path: 'qr', at: NOW, attendanceUid: null })
  })
  it('SINGLE_USE: GREEN once, ALREADY_USED the second time; both logged', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { usageModel: 0 })
    const app = appWith({ chain, now: () => NOW })
    expect(await (await scan(app, configuredEnv(del), `fuda:v1:${uid}`)).json()).toMatchObject({ decision: 'ADMIT' })
    expect(await (await scan(app, configuredEnv(del), `fuda:v1:${uid}`)).json()).toMatchObject({ decision: 'REJECT', reason: 'ALREADY_USED' })
    expect(await db().select().from(slots)).toHaveLength(1)
    expect((await db().select().from(entryLog)).map((r) => r.reason)).toEqual(['OK', 'ALREADY_USED'])
  })
  it('MULTI_USE admits repeatedly without touching slots', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { usageModel: 1 })
    const app = appWith({ chain, now: () => NOW })
    expect(await (await scan(app, configuredEnv(del), `fuda:v1:${uid}`)).json()).toMatchObject({ decision: 'ADMIT' })
    expect(await (await scan(app, configuredEnv(del), `fuda:v1:${uid}`)).json()).toMatchObject({ decision: 'ADMIT' })
    expect(await db().select().from(slots)).toHaveLength(0)
  })
  it('level >= 1 by QR → LEVEL_REQUIRED, before slot consumption (slot stays unconsumed)', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { level: 1, usageModel: 0 })
    const res = await scan(appWith({ chain, now: () => NOW }), configuredEnv(del), `fuda:v1:${uid}`)
    expect(await res.json()).toMatchObject({ decision: 'REJECT', reason: 'LEVEL_REQUIRED', entitlement: { level: 1 } })
    expect(await db().select().from(slots)).toHaveLength(0)
    expect((await db().select().from(entryLog))[0]).toMatchObject({ reason: 'LEVEL_REQUIRED', path: 'qr' })
  })
  it('REVOKED is logged as a REJECT; a chain read failure is 502 and not logged', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    chain.revokeAt(uid, 5n)
    const app = appWith({ chain, now: () => NOW })
    expect(await (await scan(app, configuredEnv(del), `fuda:v1:${uid}`)).json()).toMatchObject({ decision: 'REJECT', reason: 'REVOKED' })
    chain.failReads = true
    expect((await scan(app, configuredEnv(del), `fuda:v1:${uid}`)).status).toBe(502)
    expect(await db().select().from(entryLog)).toHaveLength(1)
  })
  it('calls onAdmit with the entry log id on ADMIT only', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    const calls: unknown[] = []
    const app = appWith({ chain, now: () => NOW, onAdmit: (info) => { calls.push(info) } })
    await scan(app, configuredEnv(del), `fuda:v1:${uid}`)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ uid, entryLogId: 1, now: NOW })
  })
})
```

Run tests → FAIL.

- [ ] **Step 2: Implement**

`apps/api/src/verify/admit.ts`:

```ts
import type { EntryPath, Reason } from '@fuda/sdk'
import type { Hex } from 'viem'
import type { Db } from '../db/client.ts'
import { entryLog, slots } from '../db/schema.ts'

export const DEFAULT_SLOT = 'default'

// SINGLE_USE consumption: INSERT OR IGNORE on (uid, slot); consumed iff changes > 0.
export async function consumeSlot(db: Db, uid: Hex, now: number): Promise<boolean> {
  const res = await db.insert(slots).values({ uid, slot: DEFAULT_SLOT, consumedAt: now }).onConflictDoNothing().run()
  return res.meta.changes > 0
}

export type EntryRow = { uid: Hex; decision: 'ADMIT' | 'REJECT'; reason: Reason; path: EntryPath; at: number }

export async function logEntry(db: Db, row: EntryRow): Promise<number> {
  const inserted = await db.insert(entryLog).values(row).returning({ id: entryLog.id }).get()
  return inserted?.id ?? 0
}

export type AdmitInfo = { uid: Hex; holder: Hex; entryLogId: number; now: number }
export type AdmitHook = (info: AdmitInfo) => void
```

Add to `AppDeps` in `src/app.ts`: `onAdmit?: AdmitHook`, and to `Variables` in `src/env.ts`: `onAdmit: AdmitHook` (set in the first middleware to `deps.onAdmit ?? (() => {})`).

Append to `apps/api/src/routes/verify.ts`:

```ts
import { parseQr, USAGE_MODEL, VerifyBody } from '@fuda/sdk'
import * as v from 'valibot'
import { consumeSlot, logEntry } from '../verify/admit.ts'

// Gate admission by QR. Order: chain verification (§6) → level == 0 →
// SINGLE_USE slot → log → onAdmit. Every decision-shaped response is logged
// with path 'qr'; 4xx input errors and 502 chain errors are not.
verifyRoutes.post('/verify', async (c) => {
  const parsed = v.safeParse(VerifyBody, await c.req.json().catch(() => null))
  const uid = parsed.success ? parseQr(parsed.output.qr) : null
  if (uid === null) {
    return errorResponse(c, 'bad_qr', 400)
  }
  const now = c.get('now')()
  const db = c.get('db')
  let out: VerifyOutcome
  try {
    out = await verifyUid(verifyConfig(c.env, c.get('chain'), now), uid)
  } catch (err) {
    if (err instanceof ChainError) {
      return errorResponse(c, 'chain_error', 502)
    }
    throw err
  }
  if (out.decision === 'REJECT') {
    await logEntry(db, { uid, decision: 'REJECT', reason: out.reason, path: 'qr', at: now })
    return jsonResponse(c, verdictBody(out))
  }
  if (out.canonical.level !== 0) {
    await logEntry(db, { uid, decision: 'REJECT', reason: 'LEVEL_REQUIRED', path: 'qr', at: now })
    return jsonResponse(c, verdictBody({ ...out, decision: 'REJECT', reason: 'LEVEL_REQUIRED' }))
  }
  if (out.canonical.usageModel === USAGE_MODEL.SINGLE_USE && !(await consumeSlot(db, uid, now))) {
    await logEntry(db, { uid, decision: 'REJECT', reason: 'ALREADY_USED', path: 'qr', at: now })
    return jsonResponse(c, verdictBody({ ...out, decision: 'REJECT', reason: 'ALREADY_USED' }))
  }
  const entryLogId = await logEntry(db, { uid, decision: 'ADMIT', reason: 'OK', path: 'qr', at: now })
  c.get('onAdmit')({ uid, holder: out.canonical.holder, entryLogId, now })
  return jsonResponse(c, verdictBody(out))
})
```

`verdictBody` must accept the widened `{ ...out, decision: 'REJECT', reason }` shape — type its parameter as `Pick<VerifyOutcome, 'decision' | 'reason' | 'entitlement' | 'delegation'>`.

Run tests → PASS.

- [ ] **Step 3: Check and commit**

`./node_modules/.bin/vp check` → pass.

```bash
git add apps/api/src/routes/verify.ts apps/api/src/verify/admit.ts apps/api/src/app.ts apps/api/src/env.ts apps/api/test/verify-post.test.ts
git commit -m "feat(api): add POST /verify QR admission with level check, slot consumption and entry log"
```

---

### Task 12: `POST /revoke` and `GET /members`

**Files:**
- Create: `apps/api/src/routes/revoke.ts`, `apps/api/src/routes/members.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/revoke.test.ts`, `apps/api/test/members.test.ts`

**Interfaces:**
- Consumes: `RevokeBody` (`@fuda/sdk`), `adminAuth`, `newest`/`parseSchemaSets`, `members` table, `ChainClient.revoke`.
- Produces: `revokeRoutes`, `membersRoutes`.

- [ ] **Step 1: Failing tests**

`apps/api/test/revoke.test.ts`:

```ts
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getDb } from '../src/db/client.ts'
import { members } from '../src/db/schema.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, ROOT, seedRoot } from './fixtures.ts'

const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('POST /revoke', () => {
  it('revokes on chain, marks the row revoked, and the QR then verifies REVOKED', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const e = configuredEnv(del)
    const issued = await (await app.request('/issue', json({ memberId: 'alice' }), e)).json() as { uid: `0x${string}` }
    const res = await app.request('/revoke', json({ uid: issued.uid }), e)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ revoked: true, uid: issued.uid })
    expect((await chain.readAttestation(issued.uid)).revocationTime).not.toBe(0n)
    expect((await getDb({ DB: env.DB } as never).select().from(members))[0]?.status).toBe('revoked')
    expect(await (await app.request('/verify', json({ qr: `fuda:v1:${issued.uid}` }), e)).json()).toMatchObject({ decision: 'REJECT', reason: 'REVOKED' })
  })
  it('400 bad_uid, 501 no_signer, 502 chain_error for unknown / already-revoked uid (row untouched)', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const e = configuredEnv(del)
    expect((await app.request('/revoke', json({ uid: '0x12' }), e)).status).toBe(400)
    const unknown = await app.request('/revoke', json({ uid: `0x${'ee'.repeat(32)}` }), e)
    expect(unknown.status).toBe(502)
    expect(await unknown.json()).toEqual({ error: 'chain_error' })
    const issued = await (await app.request('/issue', json({ memberId: 'alice' }), e)).json() as { uid: string }
    await app.request('/revoke', json({ uid: issued.uid }), e)
    expect((await app.request('/revoke', json({ uid: issued.uid }), e)).status).toBe(502)
    const noSigner = fakeChain({ signer: null })
    expect((await appWith({ chain: noSigner, now: () => NOW }).request('/revoke', json({ uid: issued.uid }), configuredEnv(seedRoot(noSigner)))).status).toBe(501)
  })
  it('401 without the admin token when one is set', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    expect((await appWith({ chain, now: () => NOW }).request('/revoke', json({ uid: `0x${'ee'.repeat(32)}` }), configuredEnv(del, { ADMIN_TOKEN: 's' }))).status).toBe(401)
  })
})
```

`apps/api/test/members.test.ts`:

```ts
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getDb } from '../src/db/client.ts'
import { members } from '../src/db/schema.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, ROOT, seedRoot } from './fixtures.ts'

describe('GET /members', () => {
  it('lists rows newest first with the camelCase shape, private rows with holder null', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const db = getDb({ DB: env.DB } as never)
    await db.insert(members).values([
      { attestationUid: `0x${'01'.repeat(32)}`, memberId: 'old', holder: `0x${'11'.repeat(20)}`, level: 'bearer', tier: 0, status: 'active', createdAt: NOW - 10 },
      { attestationUid: `0x${'02'.repeat(32)}`, memberId: '', holder: null, level: 'private', tier: 2, status: 'active', createdAt: NOW },
      { attestationUid: `0x${'03'.repeat(32)}`, memberId: 'mid', holder: `0x${'22'.repeat(20)}`, level: 'signed', tier: 1, status: 'revoked', createdAt: NOW - 5 },
    ])
    const res = await appWith({ chain, now: () => NOW }).request('/members', {}, configuredEnv(del))
    expect(res.status).toBe(200)
    const body = await res.json() as { members: { uid: string; memberId: string; holder: string | null; level: string; tier: number; status: string; createdAt: number }[] }
    expect(body.members.map((m) => m.uid)).toEqual([`0x${'02'.repeat(32)}`, `0x${'03'.repeat(32)}`, `0x${'01'.repeat(32)}`])
    expect(body.members[0]).toEqual({ uid: `0x${'02'.repeat(32)}`, memberId: '', holder: null, level: 'private', tier: 2, status: 'active', createdAt: NOW })
  })
  it('caps at 200 rows and requires the admin token when set', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const db = getDb({ DB: env.DB } as never)
    const rows = Array.from({ length: 205 }, (_, i) => ({ attestationUid: `0x${i.toString(16).padStart(64, '0')}`, memberId: `m${i}`, holder: null, level: 'bearer' as const, tier: 0, status: 'active' as const, createdAt: i }))
    await db.insert(members).values(rows)
    const body = await (await appWith({ chain, now: () => NOW }).request('/members', {}, configuredEnv(del))).json() as { members: unknown[] }
    expect(body.members).toHaveLength(200)
    expect((await appWith({ chain, now: () => NOW }).request('/members', {}, configuredEnv(del, { ADMIN_TOKEN: 's' }))).status).toBe(401)
  })
})
```

If D1 rejects a 205-row multi-insert in one statement, insert in chunks of 50 with a `for` loop and the `no-await-in-loop` disable comment shown in Global Constraints.

Run tests → FAIL.

- [ ] **Step 2: Implement**

`apps/api/src/routes/revoke.ts`:

```ts
import { RevokeBody } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import * as v from 'valibot'
import type { Hex } from 'viem'
import { ChainError, NoSignerError } from '../chain/client.ts'
import { members } from '../db/schema.ts'
import { newest, parseSchemaSets } from '../eas/schemas.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { adminAuth } from '../middleware/admin-auth.ts'

export const revokeRoutes = new Hono<AppEnv>()

// On-chain revoke, then mark the row. An unknown or already-revoked uid reverts
// on EAS → 502 chain_error and the row is left untouched (no idempotence in the MVP).
revokeRoutes.post('/revoke', adminAuth(), async (c) => {
  const parsed = v.safeParse(RevokeBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse(c, 'bad_uid', 400)
  }
  // SAFETY: RevokeBody validated uid as 0x + 64 hex.
  const uid = parsed.output.uid as Hex
  const chain = c.get('chain')
  if (chain.signerAddress() === null) {
    return errorResponse(c, 'no_signer', 501)
  }
  const schema = newest(parseSchemaSets(c.env.EAS_SCHEMAS).entitlement)
  if (schema === null) {
    return errorResponse(c, 'chain_error', 502)
  }
  try {
    await chain.revoke(schema.uid, uid)
  } catch (err) {
    if (err instanceof NoSignerError) {
      return errorResponse(c, 'no_signer', 501)
    }
    if (err instanceof ChainError) {
      return errorResponse(c, 'chain_error', 502)
    }
    throw err
  }
  await c.get('db').update(members).set({ status: 'revoked' }).where(eq(members.attestationUid, uid))
  return jsonResponse(c, { revoked: true, uid })
})
```

`apps/api/src/routes/members.ts`:

```ts
import type { MemberRow } from '@fuda/sdk'
import { asc, desc } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Hex } from 'viem'
import { members } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { jsonResponse } from '../json.ts'
import { adminAuth } from '../middleware/admin-auth.ts'

export const MEMBERS_LIMIT = 200

export const membersRoutes = new Hono<AppEnv>()

membersRoutes.get('/members', adminAuth(), async (c) => {
  const rows = await c.get('db').select().from(members).orderBy(desc(members.createdAt), asc(members.attestationUid)).limit(MEMBERS_LIMIT)
  const out: MemberRow[] = rows.map((r) => ({
    // SAFETY: attestation_uid and holder are written only from validated Hex values.
    uid: r.attestationUid as Hex,
    memberId: r.memberId,
    holder: r.holder === null ? null : (r.holder as Hex),
    level: r.level,
    tier: r.tier,
    status: r.status,
    createdAt: r.createdAt,
  }))
  return jsonResponse(c, { members: out })
})
```

In `apps/api/src/app.ts`: `app.route('/', revokeRoutes)` and `app.route('/', membersRoutes)`.

Run tests → PASS.

- [ ] **Step 3: Check and commit**

`./node_modules/.bin/vp check` → pass.

```bash
git add apps/api/src/routes/revoke.ts apps/api/src/routes/members.ts apps/api/src/app.ts apps/api/test/revoke.test.ts apps/api/test/members.test.ts
git commit -m "feat(api): add POST /revoke and GET /members admin routes"
```

---

### Task 13: Local dev without a signer, live smoke script, api README

**Files:**
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/scripts/smoke-live.ts`, `apps/api/README.md`, `apps/api/.dev.vars.example`

**Interfaces:**
- Consumes: everything above.
- Produces: `wrangler dev` runs with `FakeChain` when `SIGNER_PRIVATE_KEY` and `BASE_RPC_URL` are both unset **and** `USE_FAKE_CHAIN=1` (explicit opt-in — never silently fake in prod); `pnpm --filter api smoke:live` performs issue → verify → revoke → verify against a deployed or `wrangler dev` api.

- [ ] **Step 1: Fake chain opt-in for local dev**

`apps/api/src/index.ts`:

```ts
import { createApp } from './app.ts'
import { FakeChain } from './chain/fake-chain.ts'
import { createViemChain } from './chain/viem-chain.ts'
import type { Bindings } from './env.ts'

type DevBindings = Bindings & { USE_FAKE_CHAIN?: string }

// One FakeChain per isolate so `wrangler dev` keeps issued rights across requests.
let devChain: FakeChain | null = null

export default {
  fetch(request: Request, env: DevBindings, ctx: ExecutionContext): Promise<Response> {
    const useFake = env.USE_FAKE_CHAIN === '1' && env.SIGNER_PRIVATE_KEY === undefined
    devChain ??= useFake ? new FakeChain() : null
    const chain = devChain ?? createViemChain(env)
    return Promise.resolve(createApp({ chain }).fetch(request, env, ctx))
  },
}
```

Add `USE_FAKE_CHAIN?: string` handling to `.dev.vars.example`:

```
# Copy to .dev.vars (gitignored). Leave SIGNER_PRIVATE_KEY unset and set
# USE_FAKE_CHAIN=1 to run the api against an in-memory chain.
USE_FAKE_CHAIN=1
#SIGNER_PRIVATE_KEY=0x…
#BASE_RPC_URL=https://sepolia.base.org
#ADMIN_TOKEN=change-me
```

With the fake chain, verification needs a root delegation the fake knows about. Add to `FakeChain`:

```ts
// Seeds an active root IssuerDelegation attested by the fake signer; returns its uid.
seedRootDelegation(delegationSchema: Hex): Hex {
  if (this.signer === null) {
    throw new NoSignerError('cannot seed without a signer')
  }
  return this.seed({
    schema: delegationSchema, time: this.now(), expirationTime: 0n, revocationTime: 0n, refUID: ZERO_UID,
    recipient: this.signer, attester: this.signer, revocable: true,
    data: encodeDelegationV1({ issuer: this.signer, active: true, name: 'fuda root (fake)' }),
  })
}
```

(import `encodeDelegationV1` from `../eas/codecs.ts`). In `index.ts`, when creating the dev `FakeChain`, call `seedRootDelegation(schemaUid(SCHEMA_STRINGS.issuerDelegation))` and `console.warn` the returned uid and the fake signer address once; the developer sets `ISSUER_ADDRESS` to that address and `DELEGATION_UID` to that uid in a `wrangler.jsonc` `env.dev.vars` block (and `EAS_SCHEMAS` to the three computed `schemaUid`s with `version: 1`), then runs `wrangler dev --env dev`. This whole path is behind `USE_FAKE_CHAIN=1`; production never constructs a `FakeChain`.

- [ ] **Step 2: Live smoke script**

`apps/api/scripts/smoke-live.ts` (`API_URL` and `ADMIN_TOKEN` from the environment; exits non-zero on the first unexpected verdict):

```ts
const api = process.env.API_URL ?? 'http://localhost:8787'
const token = process.env.ADMIN_TOKEN
const headers: Record<string, string> = { 'content-type': 'application/json', ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${api}${path}`, init)
  const body = (await res.json()) as T
  console.log(`${init?.method ?? 'GET'} ${path} → ${res.status}`, JSON.stringify(body))
  return body
}

function expectMatch(label: string, actual: unknown, expected: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(expected)) {
    if ((actual as Record<string, unknown>)[k] !== v) {
      throw new Error(`${label}: expected ${k}=${String(v)}, got ${JSON.stringify(actual)}`)
    }
  }
}

const issued = await call<{ uid: string; qr: string }>('/issue', { method: 'POST', headers, body: JSON.stringify({ memberId: `smoke-${Date.now()}`, usageModel: 0 }) })
expectMatch('verify preview', await call(`/verify/${issued.uid}`), { decision: 'ADMIT' })
expectMatch('first scan', await call('/verify', { method: 'POST', headers, body: JSON.stringify({ qr: issued.qr }) }), { decision: 'ADMIT' })
expectMatch('second scan', await call('/verify', { method: 'POST', headers, body: JSON.stringify({ qr: issued.qr }) }), { decision: 'REJECT', reason: 'ALREADY_USED' })
expectMatch('revoke', await call('/revoke', { method: 'POST', headers, body: JSON.stringify({ uid: issued.uid }) }), { revoked: true })
expectMatch('after revoke', await call(`/verify/${issued.uid}`), { decision: 'REJECT', reason: 'REVOKED' })
console.log('smoke OK')
```

- [ ] **Step 3: README**

`apps/api/README.md` — sections, each a short paragraph or list:

1. **Run locally**: `cp .dev.vars.example .dev.vars`, `pnpm --filter api migrate:local`, `pnpm --filter api dev`. With `USE_FAKE_CHAIN=1` the api answers without a signer or RPC.
2. **Tests**: the command settled in Task 1 (`./node_modules/.bin/vp -C apps/api test` or the fallback). Tests run in workerd with a real D1 and the in-memory chain; no network.
3. **One-time chain setup (§13)**: fund the signer → `pnpm --filter api register-schemas` → attest the root IssuerDelegation (a 12-line `tsx` snippet using `EAS_ABI` + `encodeDelegationV1` — write it out in the README) → paste `EAS_SCHEMAS`, `DELEGATION_UID`, `ISSUER_ADDRESS` into `wrangler.jsonc` → `wrangler d1 create fuda` and paste the id → `pnpm --filter api migrate:remote` → `wrangler secret put` for `SIGNER_PRIVATE_KEY`, `ADMIN_TOKEN`, `BASE_RPC_URL` → `pnpm --filter api deploy`.
4. **Smoke**: `API_URL=https://api.fuda.sh ADMIN_TOKEN=… pnpm --filter api smoke:live`.
5. **Endpoints**: the §3 table rows implemented in this plan, with a note that `/challenge`, `/verify-signed`, `/pass/*`, `/announcements` arrive in Plans 2–4.

- [ ] **Step 4: Run everything, check, commit**

Run: all tests (api + sdk) → PASS. `./node_modules/.bin/vp check` → pass. Then `pnpm --filter api dev` with `USE_FAKE_CHAIN=1`, and `pnpm --filter api smoke:live` against it → prints `smoke OK`.

```bash
git add apps/api/src/index.ts apps/api/src/chain/fake-chain.ts apps/api/scripts/smoke-live.ts apps/api/README.md apps/api/.dev.vars.example
git commit -m "feat(api): add fake-chain local dev opt-in, live smoke script and README"
```

---

## Self-review (done while writing; re-run before execution)

**Spec coverage for steps 1–2 of §14:**

| Spec item | Task |
| --- | --- |
| Workspace + api skeleton | 1 |
| D1 schema incl. `rate_limits` + per-IP middleware | 4, 5 |
| `register-schemas.ts` | 7 |
| Entitlement codec + versioning seam | 6 |
| `/issue` (bearer) with counterfactual holder, sync attest, `passUrls` | 7, 10 |
| `/verify/:uid`, `/verify` incl. `level` check before slot | 9, 11 |
| delegation check, §6 ordering | 8 |
| `entry_log`, slots | 11 |
| `/revoke`, `/members` | 12 |
| admin auth, `x-auth-mode`, CORS | 5 |
| bigint-safe JSON | 3 |
| chain error → fail closed | 8, 9, 11 |
| §12 unit + integration rows for these endpoints | tests in 2, 3, 6, 7, 8, 9, 10, 11, 12 |

Deferred by design: Attendance hook (Plan 2 — the `onAdmit` seam is in Task 11), `/challenge` + `/verify-signed` (Plan 3 — `challenges` table exists), stealth + `/announcements` (Plan 4 — `announcements`/`sync_state` tables and `rateLimit` exist), passes (Plans 2 and 5).

**Type consistency:** `ChainClient` (Task 7) is used by `verifyUid` (8), `issueBearer` (10), `revokeRoutes` (12). `VerifyOutcome.canonical` (8) is used by `/verify` (11). `AdmitHook` (11) is wired into `AppDeps`/`Variables` (1, 11). `configuredEnv` / `seedRoot` / `seedRight` (9) are used by 10–12. `passUrls` shape matches `PassUrls` in `@fuda/sdk` (2).

**Resolved ambiguities** (also listed in the plan's commit body): initial migration is hand-written §2 DDL, drizzle-kit for later diffs; Entitlement-read RPC failure → `502 chain_error` (not logged); delegation reason assignment as spelled out in Task 8; `API_BASE_URL` var added for absolute `passUrls`; `FACTORY_ADDRESS` var added; unconfigured `ISSUER_ADDRESS`/`DELEGATION_UID` at `/issue` → `502 chain_error`; Signed/+Private branches answer `400 bad_input` until Plans 3–4.
