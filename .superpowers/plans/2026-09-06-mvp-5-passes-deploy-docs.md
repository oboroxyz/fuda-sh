# fuda MVP — Plan 5 of 5: passes, deploy topology, canonical docs

> **Temporary artifact.** Lives on `feat/mvp` only; deleted together with the design spec in the last task of this plan (repo policy: `.agents/rules/superpowers-policy.md`). Never merged to `main` as a file.

**Goal:** finish the MVP branch: the two wallet-pass builders behind `GET /pass/:uid/google` and `GET /pass/:uid/apple.pkpass`, the EAS `expirationTime` check, the `ADMIN_TOKEN` fail-closed guard, deploy topology as code (routes, custom domains, one-time chain scripts, extended live smoke), and the move of every durable fact from the temporary design spec into `docs/specs/`, `docs/adr/` and a runbook — then delete the spec and this plan.

**Architecture:** unchanged from Plans 1–4. `apps/api` (Hono on Workers, Drizzle + D1, viem, EAS on Base Sepolia); `apps/gate` / `apps/dash` / `apps/app` (hono/jsx-dom SPAs on assets-only Workers); `packages/sdk` (shared contract), `packages/stealth` (ERC-5564), `packages/web-kit`. This plan adds `packages/pass` (`@fuda/pass`): pure builders (Google Wallet JWT, Apple `.pkpass`) with no Hono or D1 dependency, called from the api's pass route.

**Tech stack:** as above plus WebCrypto (`crypto.subtle`: RSASSA-PKCS1-v1_5 / SHA-256 for the Google JWT; SHA-1 digests for the Apple manifest), `pkijs` + `asn1js` for the Apple CMS signature (Apple task only), `tsx` for scripts.

**Spec:** `.superpowers/specs/2026-09-05-fuda-mvp-design.md` §3 (endpoints, error table), §5 (wire constants), §6 (verification order), §9 (passes), §13 (deploy topology), §15 (out of scope), §16 (acceptance). Obligations ledger: `.superpowers/sdd/plan-5-obligations.md` (gitignored; every item there is embedded in a task below).

**Branch / base:** `feat/mvp` at `a38cc69` (Plan 4 artifact deleted). Tests at base: api 207, stealth 19, sdk 21, web-kit 8, gate 18, dash 19, app 42; `vp check` green.

---

## Global constraints (apply to every task)

- Run everything from the worktree `/home/yuji/code/github.com/oboroxyz/fuda-sh/.claude/worktrees/mvp`. Never `cd` into the main checkout.
- **Never `git commit --amend`. Never bare `git stash`.** One implementer at a time on this branch. Commit messages: English, conventional-commit, no attribution lines.
- `./node_modules/.bin/vp check` (format + lint + type-aware type check) must be green at the end of every task, and the package test suites touched by the task must pass (`./node_modules/.bin/vp -C <dir> test`). Do not weaken assertions to satisfy lint.
- Lint rules that bit earlier plans and still apply: arrow functions only; `describe(fn, …)` with a function title; at most 5 `expect`s per test; no `(await x).y`; no `TODO`/`FIXME` comments (write prose markers); exact boolean assertions `toBe(true)` / `toBe(false)`; kebab-case file names (PascalCase for `.tsx` components); no `any`, non-null `!`, or unsafe casts in `src/` — where a cast is unavoidable, a `// SAFETY:` line plus `// oxlint-disable-next-line <rule> -- <why>`; inline suppressions only, never file-level. `scripts/` is linted too (see `apps/api/scripts/smoke-live.ts` for the accepted idiom).
- The Worker entry module `apps/api/src/index.ts` exports functions and the default handler only (a string export crashed workerd).
- D1 binds at most 100 parameters per statement.
- `@cloudflare/vitest-pool-workers@0.22` has no per-test storage isolation: write-path tests truncate the tables they touch in a per-file `beforeEach`.
- Vocabulary in canonical docs (`docs/`): the organization is **Issuer** in specs, schemas and code, **Venue** only in member/operator-facing UI copy; **Operator** is a dashboard role. The word "mode" is not used for a level or an entry path (Bearer / Signed / +Private are levels; `qr` / `signature` are paths); the `x-auth-mode` response header keeps its name.
- Canonical docs describe **what the system does now**, in present tense. No task breakdowns, no sequencing, no "until Plan N", no "Plan N adds"; nothing under `docs/` may reference Superpowers artifacts or plan numbers.
- The dev fake chain (`USE_FAKE_CHAIN=1`, `wrangler dev --env dev`) is the local verification path; the bearer, Signed and +Private ladders must stay green on it. The WebAuthn PRF ceremony and the Base Account ERC-6492 path are manual-only and need a live Base Sepolia smoke before the deploy is called done (runbook, Task 13).

---

## File structure after this plan

```
packages/pass/                       NEW — @fuda/pass
  package.json, tsconfig.json, vite.config.ts
  src/index.ts
  src/base64url.ts                   base64url encode/decode over Uint8Array / string
  src/pem.ts                         PEM → DER bytes (handles literal "\n" escapes)
  src/google.ts                      config, GenericObject, RS256 JWT, saveUrl
  src/google.test.ts
  src/apple/zip.ts                   stored (method 0) ZIP writer with CRC-32   (Task 5)
  src/apple/manifest.ts              SHA-1 manifest                              (Task 5)
  src/apple/pass-json.ts             storeCard pass.json                         (Task 5)
  src/apple/cms.ts                   detached CMS SignedData via pkijs           (Task 5)
  src/apple/pkpass.ts                buildPkpass()                               (Task 5)
  src/apple/*.test.ts                                                            (Task 5)
packages/sdk/src/pass-urls.ts        NEW — passUrls() moved here from the api (Task 3)
apps/api/src/routes/pass.ts          real google/apple handlers; 404-before-501 order
apps/api/src/pass/pass-row.ts        NEW — shared members lookup for the three pass routes
apps/api/src/pass/PassPage.tsx       "Add to Google Wallet" button (hidden unless the endpoint answers 200)
apps/api/src/middleware/admin-auth.ts ADMIN_TOKEN fail-closed guard (Task 2)
apps/api/src/verify/verify-uid.ts    EAS expirationTime check (Task 1)
apps/api/src/env.ts                  GOOGLE_* / APPLE_* optional bindings
apps/api/scripts/attest-root-delegation.ts  NEW (Task 6)
apps/api/scripts/smoke-live.ts       + Signed and +Private ladders (Task 6)
apps/*/wrangler.jsonc                routes / custom domains, $schema fixes (Task 6)
docs/specs/attestation-model.md      Tasks 1, 7
docs/specs/pass-types-and-flows.md   Task 8
docs/specs/README.md                 Task 9
docs/specs/naming.md                 Task 10
docs/CONTEXT.md                      Task 11
docs/adr/0001-unfiltered-announcement-log.md   NEW (Task 12)
docs/runbook.md                      NEW (Task 13)
```

---

## Task 1 — EAS `expirationTime` → `EXPIRED`, with its doc row (one commit)

**Ruling being implemented:** "behavior change lands with its doc" — the code change and the attestation-model.md row go in the same commit.

**Files:** `apps/api/src/verify/verify-uid.ts`, `apps/api/src/verify/verify-uid.test.ts`, `apps/api/test/fixtures.ts`, `docs/specs/attestation-model.md`.

### Steps

1. In `verifyUid`, insert the check immediately after the `revocationTime` check and **before** `checkWindow` (so before `UNKNOWN_USAGE_MODEL`, `NOT_YET_VALID` and the schema's own `validUntil`):

   ```ts
   if (raw.revocationTime !== 0n) {
     return reject('REVOKED')
   }
   // EAS-level expiry on the attestation itself, distinct from the schema's
   // validUntil. fuda's own /issue pins it to 0; a delegated third-party
   // attester may set it, and EAS does not reject reads of an expired uid.
   if (raw.expirationTime !== 0n && BigInt(deps.now) > raw.expirationTime) {
     return reject('EXPIRED')
   }
   const windowReason = checkWindow(canonical, deps.now)
   ```

2. `apps/api/test/fixtures.ts`: add `expirationTime: bigint` to `RightOverrides` and use `over.expirationTime ?? 0n` in `seedRight`. The local `seedRight` in `verify-uid.test.ts` already takes raw overrides (it seeds `revocationTime: 5n`); extend it the same way if it does not pass `expirationTime` through.

3. Tests in `verify-uid.test.ts` (exact assertions, ≤5 expects each):
   - `expirationTime` in the past (`NOW - 1`) → `EXPIRED`, with `entitlement` present on the REJECT (decoded) — pin that `holder` is present via `entitlement.holder`.
   - `expirationTime` in the future (`NOW + 100`) → `ADMIT`.
   - `expirationTime === NOW` → `ADMIT` (inclusive bound, mirrors `validUntil`).
   - ordering: revoked **and** expired → `REVOKED`; expired **and** `usageModel: 3` → `EXPIRED` (expiry precedes the usage-model check).

4. `docs/specs/attestation-model.md`, "Gate verification order and reasons" table: insert this row directly under the `revocationTime == 0` row:

   ```
   | `expirationTime == 0 \|\| now <= expirationTime` (EAS-level expiry on the attestation itself; fuda's `/issue` pins it to 0) | `EXPIRED` |
   ```

   Re-align the table columns so `oxfmt` (which formats Markdown tables) is happy: run `./node_modules/.bin/vp format` and commit the result.

5. Run `./node_modules/.bin/vp -C apps/api test` and `./node_modules/.bin/vp check`.

**Commit:** `feat(api): reject an attestation past its EAS expirationTime as EXPIRED`

---

## Task 2 — `ADMIN_TOKEN` fail-closed guard

**Ruling being implemented:** "`ADMIN_TOKEN` unset with a signer leaves admin routes open → add a guard (fail closed) and a runbook line". Pinned here: the guard answers **`401 unauthorized`** (no new error code; the dash already handles 401), logs one `console.error` per isolate, and the `x-auth-mode` header must not claim `open` while the guard is active.

**Files:** `apps/api/src/middleware/admin-auth.ts`, `apps/api/test/admin-auth.test.ts`, `apps/api/README.md`.

### Steps

1. `admin-auth.ts`:

   ```ts
   const isSet = (v: string | undefined): v is string => v !== undefined && v !== ''

   // A deployment with a real signer but no ADMIN_TOKEN would expose /issue,
   // /revoke and /members to the internet. Fail closed: the admin routes answer
   // 401 until the secret is set. Local dev on the fake chain has no signer, so
   // it stays open (isFakeChainEnabled already requires SIGNER_PRIVATE_KEY unset).
   export const adminLocked = (env: Pick<Bindings, 'ADMIN_TOKEN' | 'SIGNER_PRIVATE_KEY'>): boolean =>
     isTokenUnset(env.ADMIN_TOKEN) && isSet(env.SIGNER_PRIVATE_KEY)

   let lockedWarned = false
   const warnLockedOnce = (): void => {
     if (!lockedWarned) {
       lockedWarned = true
       // oxlint-disable-next-line no-console -- a misconfigured deploy must be visible in wrangler tail
       console.error('[fuda-api] ADMIN_TOKEN is unset while SIGNER_PRIVATE_KEY is set: admin routes are locked. Run `wrangler secret put ADMIN_TOKEN`.')
     }
   }
   ```

   In `adminAuth()`: before the existing `isTokenUnset(expected)` branch, `if (adminLocked(c.env)) { warnLockedOnce(); return c.json({ error: 'unauthorized' }, 401) }`.
   In `authModeHeader()`: set `x-auth-mode: open` only when `isTokenUnset(...) && !adminLocked(c.env)`; when `adminLocked`, set `x-auth-mode: locked` instead (so an operator can see the state from any response, e.g. `GET /health`). The existing `adminAuth` "open" branch keeps its `open` header only when not locked (it is unreachable when locked, since the guard returns first).

2. Tests (`admin-auth.test.ts`, using `testEnv({ ADMIN_TOKEN: undefined, SIGNER_PRIVATE_KEY: '0x' + '11'.repeat(32) })` — the signer value is never used to sign; `buildChain` is not involved because tests build the app with `FakeChain` directly):
   - `POST /issue` with no token and a signer set → `401 { error: 'unauthorized' }`; `x-auth-mode` is `locked`.
   - `GET /health` in the same env → `200`, `x-auth-mode: locked`.
   - token unset, signer unset (dev) → unchanged behaviour: admin route passes, `x-auth-mode: open`.
   - token set → the guard never triggers (a correct bearer still passes).

3. `apps/api/README.md`, "Secrets and vars" → `ADMIN_TOKEN` bullet: append "Required whenever `SIGNER_PRIVATE_KEY` is set: with a signer and no token the api locks every admin route (`401 unauthorized`, `x-auth-mode: locked` on every response) and logs the reason once per isolate. Local dev on the fake chain has no signer and stays open." Also update the earlier README line that says admin routes are open when the token is unset (search `x-auth-mode`) to say "when `ADMIN_TOKEN` is unset **and no signer is configured**".

**Commit:** `feat(api): lock admin routes when a signer is configured without ADMIN_TOKEN`

---

## Task 3 — `passUrls` into `@fuda/sdk`; `ERROR_CODES` gains `internal`

**Files:** `packages/sdk/src/pass-urls.ts` (new), `packages/sdk/src/pass-urls.test.ts` (new), `packages/sdk/src/index.ts`, `packages/sdk/src/constants.ts`, `packages/sdk/src/constants.test.ts`, `apps/api/src/issue/pass-urls.ts` (delete), every api import of it (`grep -rn "pass-urls" apps/api/src`), `apps/dash/src/members-view.ts`, `apps/api/src/app.ts` (comment only).

### Steps

1. `packages/sdk/src/pass-urls.ts` — byte-for-byte the current api helper, typed on the sdk's own `Hex`:

   ```ts
   import type { Hex } from './types.ts'  // or wherever the sdk's Hex type lives — grep `export type Hex`
   import type { PassUrls } from './types.ts'

   // Always all three keys, even when a platform is unconfigured (that endpoint 501s).
   export const passUrls = (baseUrl: string, uid: Hex): PassUrls => {
     const base = baseUrl.replace(/\/$/u, '')
     return {
       apple: `${base}/pass/${uid}/apple.pkpass`,
       google: `${base}/pass/${uid}/google`,
       web: `${base}/pass/${uid}`,
     }
   }
   ```

   Export from `index.ts`. Test: trailing slash stripped; the three shapes.

2. Delete `apps/api/src/issue/pass-urls.ts`; repoint its importers to `import { passUrls } from '@fuda/sdk'`. If the api's uid type is viem's `Hex`, both are template-literal `0x${string}` types and are assignable; if not, `asHex` from the sdk is already available at the call site.

3. `apps/dash/src/members-view.ts`: replace the inline object with `passUrls(apiBase, row.uid)` (private rows keep `null`). Existing `members-view.test.ts` expectations stay byte-identical.

4. `packages/sdk/src/constants.ts`: add `'internal'` to `ERROR_CODES` (after `'rpc_unavailable'`). `apps/api/src/app.ts`: rewrite the comment above `unclassifiedError` to: "`internal` is the sdk's catch-all ErrorCode for an unclassified defect (500); the error itself is logged rather than swallowed." Update the sdk constants test that enumerates the union, if one does.

5. `./node_modules/.bin/vp -C packages/sdk test`, `-C apps/api test`, `-C apps/dash test`, `vp check`.

**Commit:** `refactor(sdk): share passUrls and add the internal error code`

---

## Task 4 — `@fuda/pass` Google Wallet builder and `GET /pass/:uid/google`

**Contract (spec §9 + rulings):**

- `GET /pass/:uid/google` → `200 { saveUrl }` where `saveUrl = https://pay.google.com/gp/v/save/<jwt>`; `Cache-Control: no-store`.
- Order of checks on all three pass routes: bad uid → `400 bad_uid`; no `members` row → `404 not_found`; `level === 'private'` → `404 not_found`; platform unconfigured → `501 google_not_configured` / `501 apple_not_configured`. **404 precedes 501** so a private row never reveals whether the platform is configured and the "private → 404 on all three routes" rule holds.
- Google is configured iff all four secrets are set and non-empty: `GOOGLE_ISSUER_ID`, `GOOGLE_CLASS_ID`, `GOOGLE_SA_EMAIL`, `GOOGLE_SA_KEY_PEM`.
- JWT: header `{ alg: 'RS256', typ: 'JWT' }`; claims `{ iss: <GOOGLE_SA_EMAIL>, aud: 'google', typ: 'savetowallet', iat: <now>, origins, payload: { genericObjects: [object] } }`; **`origins` = `[<origin of API_BASE_URL>, 'https://dash.fuda.sh', 'https://app.fuda.sh']`** (the api origin is derived from the binding, not a literal, so a local dev origin works; the pass page that carries the button lives on the api host, and the dash links the endpoint).
- GenericObject exactly as spec §9 (reproduced in step 2).
- The service-account JSON's `private_key` is PKCS#8 (`-----BEGIN PRIVATE KEY-----`) and carries literal `\n` escapes when pasted through `wrangler secret put`; the PEM parser normalizes `\\n` → newline before base64-decoding.
- Consumer: the browser pass page gets an "Add to Google Wallet" button that fetches the endpoint and opens `saveUrl`; hidden unless the endpoint answers 200. The dash's `google` link keeps pointing at the JSON endpoint (operators use it for debugging; members save from the pass page on their phone).

**Files:** `packages/pass/{package.json,tsconfig.json,vite.config.ts}`, `packages/pass/src/{index.ts,base64url.ts,pem.ts,google.ts,google.test.ts,base64url.test.ts,pem.test.ts}`, `apps/api/package.json` (dependency `"@fuda/pass": "workspace:*"`), `apps/api/src/env.ts`, `apps/api/test/env.ts`, `apps/api/.dev.vars.example`, `apps/api/src/pass/pass-row.ts` (new), `apps/api/src/routes/pass.ts`, `apps/api/src/pass/PassPage.tsx`, `apps/api/test/pass.test.ts`, `apps/api/README.md`, root `README.md` (surfaces table row for `packages/pass`), `pnpm-lock.yaml` (via `pnpm install`).

### Steps

1. Scaffold `packages/pass` mirroring `packages/stealth`:

   ```json
   {
     "name": "@fuda/pass",
     "version": "0.0.0",
     "private": true,
     "type": "module",
     "exports": { ".": "./src/index.ts" },
     "scripts": { "test": "vp test" },
     "dependencies": { "@fuda/sdk": "workspace:*" },
     "devDependencies": { "vitest": "4.1.11" }
   }
   ```

   `tsconfig.json`: `{ "extends": "../../tsconfig.json", "include": ["src", "vite.config.ts"] }`. `vite.config.ts`: `defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'] } })` from `vite-plus`. Node 24's `globalThis.crypto.subtle` is what the tests use; no polyfill.

2. `src/base64url.ts`:

   ```ts
   const toBinary = (bytes: Uint8Array): string => {
     let s = ''
     for (const b of bytes) {
       s += String.fromCharCode(b)
     }
     return s
   }
   export const base64urlBytes = (bytes: Uint8Array): string =>
     btoa(toBinary(bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
   export const base64urlText = (text: string): string => base64urlBytes(new TextEncoder().encode(text))
   export const base64Decode = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
   ```

   `src/pem.ts`:

   ```ts
   // Accepts a PEM block as pasted into a Worker secret: real newlines or the
   // literal "\n" escapes a service-account JSON carries. Returns the DER bytes.
   export const pemToDer = (pem: string, label: string): Uint8Array => {
     const normalized = pem.replaceAll('\\n', '\n')
     const body = normalized
       .replace(`-----BEGIN ${label}-----`, '')
       .replace(`-----END ${label}-----`, '')
       .replaceAll(/\s+/gu, '')
     if (body === '' || !normalized.includes(`-----BEGIN ${label}-----`)) {
       throw new Error(`malformed PEM: expected a ${label} block`)
     }
     return base64Decode(body)
   }
   ```

3. `src/google.ts`:

   ```ts
   import type { Hex } from '@fuda/sdk'

   export interface GoogleConfig { issuerId: string; classId: string; saEmail: string; saKeyPem: string }
   export type GoogleEnv = Partial<Record<'GOOGLE_ISSUER_ID' | 'GOOGLE_CLASS_ID' | 'GOOGLE_SA_EMAIL' | 'GOOGLE_SA_KEY_PEM', string>>

   // null unless all four secrets are present and non-empty (spec: "all four or the endpoint 501s").
   export const googleConfigFrom = (env: GoogleEnv): GoogleConfig | null => { … }

   export interface GooglePassInput {
     uid: Hex
     tierLabel: string      // FREE | REGULAR | VIP | FOUNDER (TIER_LABEL from the sdk, or `TIER n`)
     holderShort: string    // `${holder.slice(0, 6)}…${holder.slice(-4)}`
     qr: string             // toQr(uid) → 'fuda:v1:<uid>'
   }

   export const buildGenericObject = (cfg: GoogleConfig, input: GooglePassInput) => ({
     id: `${cfg.issuerId}.${input.uid.slice(2)}`,
     classId: cfg.classId,
     state: 'ACTIVE',
     cardTitle: { defaultValue: { language: 'en-US', value: 'fuda membership' } },
     header: { defaultValue: { language: 'en-US', value: input.tierLabel } },
     barcode: { type: 'QR_CODE', value: input.qr, alternateText: input.uid.slice(0, 10) },
     textModulesData: [
       { id: 'tier', header: 'Tier', body: input.tierLabel },
       { id: 'member', header: 'Member', body: input.holderShort },
     ],
   })

   export const importRs256Key = async (pem: string): Promise<CryptoKey> =>
     await crypto.subtle.importKey('pkcs8', pemToDer(pem, 'PRIVATE KEY'), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])

   export const signJwtRs256 = async (key: CryptoKey, claims: Record<string, unknown>): Promise<string> => {
     const head = base64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
     const body = base64urlText(JSON.stringify(claims))
     const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`))
     return `${head}.${body}.${base64urlBytes(new Uint8Array(sig))}`
   }

   export const GOOGLE_SAVE_BASE = 'https://pay.google.com/gp/v/save/'

   export const buildGoogleSaveUrl = async (
     cfg: GoogleConfig, input: GooglePassInput, origins: string[], now: number,
   ): Promise<string> => {
     const key = await importRs256Key(cfg.saKeyPem)
     const jwt = await signJwtRs256(key, {
       aud: 'google', iat: now, iss: cfg.saEmail, origins,
       payload: { genericObjects: [buildGenericObject(cfg, input)] }, typ: 'savetowallet',
     })
     return `${GOOGLE_SAVE_BASE}${jwt}`
   }
   ```

   Give `buildGenericObject` an explicit return interface (`GoogleGenericObject`) rather than an inferred literal — the anti-slop preset rejects `Record<string, unknown>` in `src/` unless suppressed; use a typed `GoogleJwtClaims` interface for the claims too.

4. Tests (`google.test.ts`): generate an RSA key in the test —

   ```ts
   const pair = await crypto.subtle.generateKey(
     { hash: 'SHA-256', modulusLength: 2048, name: 'RSASSA-PKCS1-v1_5', publicExponent: new Uint8Array([1, 0, 1]) },
     true, ['sign', 'verify'],
   )
   const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
   const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(...)}\n-----END PRIVATE KEY-----`
   ```

   Cases: (a) `googleConfigFrom` → `null` when any of the four is missing or `''`; (b) the JWT has three segments, header decodes to `{ alg: 'RS256', typ: 'JWT' }`, and `crypto.subtle.verify` with `pair.publicKey` over `head.body` returns `true`; (c) decoded claims: `aud`, `typ`, `iss`, `origins`, `iat`, and `payload.genericObjects[0].id === '<issuerId>.<uid without 0x>'`, `barcode.value === 'fuda:v1:<uid>'`; (d) a PEM with literal `\n` escapes imports (pem.test.ts); (e) `saveUrl` starts with `GOOGLE_SAVE_BASE`. Keep ≤5 expects per test — split across tests.

5. api wiring:
   - `env.ts` `Bindings`: add optional `GOOGLE_ISSUER_ID`, `GOOGLE_CLASS_ID`, `GOOGLE_SA_EMAIL`, `GOOGLE_SA_KEY_PEM`, `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_CERT_PEM`, `APPLE_KEY_PEM`, `APPLE_WWDR_PEM` (all `?: string`).
   - `test/env.ts` `testEnv`: also strip the nine new secrets to `undefined`, so a developer's `.dev.vars` cannot flip the "unconfigured → 501" tests.
   - `.dev.vars.example`: add commented `#GOOGLE_ISSUER_ID=`, `#GOOGLE_CLASS_ID=`, `#GOOGLE_SA_EMAIL=`, `#GOOGLE_SA_KEY_PEM=` and the five `#APPLE_*=` lines with a one-line comment "all four GOOGLE_* (resp. all five APPLE_*) or that pass endpoint answers 501".
   - `apps/api/src/pass/pass-row.ts`:

     ```ts
     // The one lookup the three /pass routes share. Order matters and is part of
     // the contract: 400 (bad uid) → 404 (no row) → 404 (+Private: there is no pass
     // for a one-time stealth holder) → only then the platform check.
     export type PassRowResult = { ok: true; row: PassRow } | { ok: false; res: Response }
     export const loadPassRow = async (c: Context<AppEnv>, rawUid: string): Promise<PassRowResult>
     ```

     `PassRow` is the existing interface in `pass-view.ts` (uid, holder, level, tier). Refactor `GET /pass/:uid` to use it (no behaviour change; `pass.test.ts` stays green).
   - `routes/pass.ts` `GET /pass/:uid/google`: `loadPassRow` → `googleConfigFrom(c.env)` → `null` ⇒ `501 google_not_configured` → else `jsonResponse(c, { saveUrl }, 200)` with `no-store`, where `origins = [new URL(c.env.API_BASE_URL).origin, 'https://dash.fuda.sh', 'https://app.fuda.sh']`, `tierLabel = TIER_LABEL[row.tier] ?? \`TIER ${row.tier}\``, `holderShort = shortAddress(holder)` (`'—'` when null), `qr = toQr(uid)`, `now = c.get('now')()`. A malformed `GOOGLE_SA_KEY_PEM` throws inside `importRs256Key` → catch and answer `501 google_not_configured` with one `console.error` (a bad secret is a configuration problem, not an internal defect).
   - `GET /pass/:uid/apple.pkpass`: switch to `loadPassRow` now (so private → 404 holds immediately) and keep the `501 apple_not_configured` tail until Task 5 fills it in. Rewrite the file comment: "Wallet-pass builders live in @fuda/pass; an unconfigured platform answers 501."
   - `PassPage.tsx`: add `<a id="gw" class="btn" hidden href="#">Add to Google Wallet</a>` under the status, and extend `refreshScript(uid)` with one more fetch (same uid interpolation rule):

     ```js
     const gw=document.getElementById('gw');
     fetch('/pass/${uid}/google').then(async r=>{if(!r.ok)return;const j=await r.json();gw.href=j.saveUrl;gw.hidden=false}).catch(()=>{});
     ```

     Add `.btn{display:inline-block;margin-top:12px;padding:10px 16px;border-radius:999px;background:#fff;color:#141414;font-weight:600;text-decoration:none}` to `STYLE`.

6. api tests (`test/pass.test.ts`, per-file `beforeEach` truncation already present): unknown uid → 404; bad uid → 400; private row → 404 **even with** all four `GOOGLE_*` set; bearer row unconfigured → `501 google_not_configured`; bearer row configured (generate a key in `beforeAll` as in step 4 and pass the PEM through `configuredEnv(..., { GOOGLE_* })`) → `200`, body `saveUrl` starts with `https://pay.google.com/gp/v/save/`, `cache-control: no-store`; `apple.pkpass` on a private row → 404. The pass page HTML contains `id="gw"` (one string assertion).

7. `pnpm install` (lockfile updates for the new workspace package and the api dependency; commit `pnpm-lock.yaml`). `vp -C packages/pass test`, `-C apps/api test`, `vp check`.

8. Docs owned by this task: `apps/api/README.md` — replace the "stubs that answer 501 until Plan 5" sentences (browser pass section and the endpoints table) with present-tense contract text: "`GET /pass/:uid/google` answers `{ saveUrl }` (a signed Google Wallet save link) when the four `GOOGLE_*` secrets are set and `501 google_not_configured` otherwise; `GET /pass/:uid/apple.pkpass` streams a `.pkpass` when the five `APPLE_*` secrets are set and `501 apple_not_configured` otherwise. Both answer `404 not_found` for an unknown uid and for a +Private row before any platform check." Add the nine secrets to "Secrets and vars" with the PEM `\n` note. Root `README.md` surfaces table: add `| wallet passes | \`packages/pass\` | Google Wallet save-link JWT and Apple \`.pkpass\` builders (WebCrypto; no platform SDKs) |`.

**Commits:** `feat(pass): add @fuda/pass with the Google Wallet save-link builder` then `feat(api): serve Google Wallet save links from /pass/:uid/google` (two commits; the second contains the api wiring, page button, tests and README).

---

## Task 5 — Apple `.pkpass` (droppable)

**Droppable:** if the Pass Type ID certificate has not arrived or the CMS work slips, skip this task entirely — the route keeps answering `501 apple_not_configured` (Task 4 already put it behind `loadPassRow`), the browser pass is the floor, and nothing else in this plan depends on it. If skipped, say so in the completion report; do not leave a half-built `apple/` directory.

**Contract (spec §9):** `.pkpass` = ZIP (method 0, stored) of `pass.json`, `icon.png`, `manifest.json` (SHA-1 hex of every other file, keyed by filename), `signature` (detached PKCS#7/CMS SignedData over `manifest.json`, RSASSA-PKCS1-v1_5 + SHA-256, signer = Pass Type ID certificate, certificates included = signer + WWDR intermediate). Configured iff all five `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_CERT_PEM`, `APPLE_KEY_PEM` (PKCS#8), `APPLE_WWDR_PEM` are set and non-empty.

`pass.json`:

```json
{
  "formatVersion": 1,
  "passTypeIdentifier": "<APPLE_PASS_TYPE_ID>",
  "teamIdentifier": "<APPLE_TEAM_ID>",
  "organizationName": "fuda",
  "serialNumber": "<uid>",
  "description": "fuda membership",
  "foregroundColor": "rgb(255,255,255)",
  "backgroundColor": "rgb(20,20,20)",
  "labelColor": "rgb(170,170,170)",
  "barcodes": [{ "format": "PKBarcodeFormatQR", "message": "fuda:v1:<uid>", "messageEncoding": "iso-8859-1" }],
  "storeCard": {
    "primaryFields": [{ "key": "tier", "label": "TIER", "value": "<tier label>" }],
    "secondaryFields": [{ "key": "member", "label": "MEMBER", "value": "<short holder>" }],
    "backFields": [{ "key": "uid", "label": "Attestation", "value": "<uid>" }]
  }
}
```

**Files:** `packages/pass/src/apple/{zip.ts,manifest.ts,pass-json.ts,cms.ts,pkpass.ts,icon.ts}` + tests, `packages/pass/package.json` (add `pkijs` and `asn1js`, exact versions from the registry at implementation time), `packages/pass/src/index.ts` (export `buildPkpass`, `appleConfigFrom` **from a separate subpath entry `./apple`** — add `"./apple": "./src/apple/index.ts"` to `exports` — so the Google path and the api's non-Apple code never import pkijs), `apps/api/src/routes/pass.ts`, `apps/api/test/pass.test.ts`, `apps/api/README.md`.

### Steps

1. `zip.ts`: stored ZIP writer. Per entry: local file header (`0x04034b50`, version 20, flags 0, method 0, DOS time/date 0, CRC-32, sizes, name), then the central directory (`0x02014b50`) and the end record (`0x06054b50`). CRC-32 table-driven. Test: the emitted bytes for two small entries match a hand-computed layout (signature bytes, offsets, CRC of `'abc'` = `0x352441c2`).
2. `icon.ts`: a 29×29 solid dark PNG as a base64 constant (generate once with any tool, or hand-build the minimal PNG: IHDR + one IDAT with a stored deflate block + IEND). Test: bytes start with the PNG signature.
3. `manifest.ts`: `manifestOf(files: Map<string, Uint8Array>) → string` — `{ "<name>": "<sha1 hex>" }` via `crypto.subtle.digest('SHA-1', …)` (available in Node 24 and workerd). Test against a known SHA-1 (`'abc'` → `a9993e364706816aba3e25717850c26c9cd0d89d`).
4. `pass-json.ts`: `passJson(cfg, input)` producing the object above; test the exact shape.
5. `cms.ts`: with pkijs — parse the signer cert and WWDR cert (`pemToDer(…, 'CERTIFICATE')` → `asn1js.fromBER` → `new pkijs.Certificate({ schema })`), import the key (`pkcs8`, RSASSA-PKCS1-v1_5/SHA-256), build `new pkijs.SignedData({ version: 1, encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: '1.2.840.113549.1.7.1' }), signerInfos: [new pkijs.SignerInfo({ version: 1, sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }), signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes: [contentType id-data, signingTime now, messageDigest sha256(manifest)] }) })], certificates: [signerCert, wwdrCert] })`, `await signed.sign(privateKey, 0, 'SHA-256', manifestBytes)` (detached: `eContent` absent), wrap in `new pkijs.ContentInfo({ contentType: '1.2.840.113549.1.7.2', content: signed.toSchema(true) })`, return `toBER`. pkijs picks up `globalThis.crypto` on Node 24 and workerd; call `pkijs.setEngine` only if the default engine is missing. Test: generate a self-signed certificate in the test with pkijs (`Certificate` + `sign`), run `buildDetachedCms`, then `SignedData.verify({ signer: 0, data: manifestBytes, trustedCerts: [cert] })` → `true`; a tampered manifest → `false`.
6. `pkpass.ts`: `buildPkpass(cfg, input, now) → Uint8Array` assembling the four files. Test: the ZIP lists exactly `pass.json`, `icon.png`, `manifest.json`, `signature`.
7. Route: `loadPassRow` → `appleConfigFrom(c.env)` null ⇒ 501 → else `new Response(bytes, { headers: { 'content-type': 'application/vnd.apple.pkpass', 'content-disposition': 'attachment; filename="fuda.pkpass"', 'cache-control': 'no-store' } })`. Import via `await import('@fuda/pass/apple')` inside the handler so the api bundle only pulls pkijs when the route is hit. api test: configured (self-signed cert generated in the test) → 200 with the pkpass content type and a body starting with `PK\x03\x04`.
8. README: the Apple paragraph from Task 4 step 8 stays accurate; add the manual verification line "Open the downloaded `.pkpass` on an iPhone, or run `openssl smime -verify -in signature -inform DER -content manifest.json -noverify` after unzipping".

**Commit:** `feat(pass): build signed Apple Wallet passes for /pass/:uid/apple.pkpass`

---

## Task 6 — Deploy topology as code, chain scripts, live smoke ladders

**Files:** `apps/api/wrangler.jsonc`, `apps/gate/wrangler.jsonc`, `apps/dash/wrangler.jsonc`, `apps/app/wrangler.jsonc`, `apps/api/scripts/attest-root-delegation.ts` (new), `apps/api/scripts/smoke-live.ts`, `apps/api/package.json`, `apps/api/README.md`, root `README.md`, `apps/api/src/chain/viem-chain.ts` (comment only).

### Steps

1. **Routes / custom domains.** Top-level in each `wrangler.jsonc` (named env `dev` in the api file gets none — `wrangler dev --env dev` never deploys):
   - api: `"routes": [{ "pattern": "api.fuda.sh", "custom_domain": true }]`
   - gate: `"routes": [{ "pattern": "gate.fuda.sh", "custom_domain": true }]`
   - dash: `"routes": [{ "pattern": "dash.fuda.sh", "custom_domain": true }]`
   - app: `"routes": [{ "pattern": "app.fuda.sh", "custom_domain": true }, { "pattern": "fuda.sh", "custom_domain": true }]` (the apex landing is this Worker's `/` route; `/signed` and `/private` on the apex redirect to `app.fuda.sh` — that is app code, already in place).
   Rewrite the comments in all four files in present tense ("gate.fuda.sh is a custom domain of this Worker"); remove every "(Plan 5)".
2. **`$schema`.** All four files: `"$schema": "../../node_modules/wrangler/config-schema.json"` (wrangler is hoisted to the root; `apps/api/node_modules/wrangler` does not exist, so the api's current relative path is dangling too).
3. **Vars placeholders** in the api's top-level `vars` stay as checked in (`EAS_SCHEMAS` empty sets, zero `ISSUER_ADDRESS` / `DELEGATION_UID`, `ANNOUNCER_FROM_BLOCK: "0"`, `database_id: "REPLACE_AFTER_wrangler_d1_create"`) — they are **operator-replaced at deploy time** and each one fails closed until replaced (`/issue` → `502 chain_error` on empty schema sets, `/announcements` → `502 rpc_unavailable` on `"0"`). Add a one-line comment above `vars` listing exactly which keys the runbook replaces. `API_BASE_URL` stays `https://api.fuda.sh`.
4. **`scripts/attest-root-delegation.ts`** (replaces the inline README snippet, which Task 6 deletes from the README):

   ```ts
   // One-time CLI: attests the root IssuerDelegation (the signer delegating
   // issuance to itself) and prints DELEGATION_UID / ISSUER_ADDRESS for
   // wrangler.jsonc. Runs under tsx (node). Needs SIGNER_PRIVATE_KEY, optionally
   // BASE_RPC_URL. Idempotence is the operator's: run it once per deployment.
   import { isHex } from 'viem'
   import { privateKeyToAccount } from 'viem/accounts'

   import { createViemChain } from '../src/chain/viem-chain.ts'
   import { ZERO_UID } from '../src/chain/client.ts'
   import { encodeDelegationV1 } from '../src/eas/codecs.ts'
   import { SCHEMA_STRINGS, schemaUid } from '../src/eas/schemas.ts'

   const key = process.env.SIGNER_PRIVATE_KEY
   if (key === undefined || !isHex(key)) {
     throw new Error('SIGNER_PRIVATE_KEY (0x-hex) is required')
   }
   const account = privateKeyToAccount(key)
   const chain = createViemChain({ /* the minimal Bindings createViemChain reads: BASE_RPC_URL, EAS_ADDRESS, SCHEMA_REGISTRY_ADDRESS, ANNOUNCER_ADDRESS, SIGNER_PRIVATE_KEY — fill the rest with '' / zero values; check its parameter type and pass exactly what it reads */ })
   const { uid, txHash } = await chain.attest({
     data: encodeDelegationV1({ active: true, issuer: account.address, name: 'fuda root' }),
     expirationTime: 0n,
     recipient: account.address,
     refUID: ZERO_UID,
     revocable: true,
     schema: schemaUid(SCHEMA_STRINGS.issuerDelegation),
   })
   console.log(`tx ${txHash}`)
   console.log(`ISSUER_ADDRESS=${account.address}`)
   console.log(`DELEGATION_UID=${uid}`)
   ```

   Match `AttestParams` exactly (read `apps/api/src/chain/client.ts`); if `createViemChain` needs a full `Bindings`, build it from `process.env` with the same defaults `register-schemas.ts` uses. `console.log` lines carry the same `no-console` suppression idiom as the other scripts. Add `"attest-root-delegation": "tsx scripts/attest-root-delegation.ts"` to `apps/api/package.json`.
5. **`smoke-live.ts`**: keep the bearer ladder, then append the Signed and +Private ladders, rewritten in the file's own `call` / `expectMatch` idiom (no `any`, no `!`, no `process.exit`; `throw` on failure like the existing code). Two fixed test keys are fine (they are throwaway Base Sepolia EOAs that never hold funds). Add `import { privateKeyToAccount } from 'viem/accounts'` and `import { deriveMemberSecret, deriveStealthKeys, matchAnnouncements } from '@fuda/stealth'` (already an api dependency).

   Signed ladder: `POST /issue { holder, usageModel: 0, tier: 1 }` → `level: 'signed'`; `GET /verify/:uid` → `ADMIT`; `POST /verify { qr }` → `REJECT` `LEVEL_REQUIRED`; `POST /challenge` → sign with the **other** key → `BAD_SIGNATURE`; reuse the nonce with the right key → `BAD_CHALLENGE`; fresh challenge + right key → `ADMIT`, `path: 'signature'`; replay → `BAD_CHALLENGE`; third challenge → `ALREADY_USED` (SINGLE_USE).

   +Private ladder: derive `keys = deriveStealthKeys(deriveMemberSecret(prfBytes))` from a fixed 32-byte array; `POST /issue { stealthMetaAddress: keys.metaAddress, memberId: 'smoke-private', usageModel: 1 }` → `level: 'private'`, `announced: true`, no `passUrls`; `GET /pass/:uid` → 404 (assert status via a `callStatus` helper that returns `{ status, body }`); page `GET /announcements?fromBlock=0` following the client paging rule (short page ⇒ done, resume at the last row's `blockNumber`, dedupe on `txHash:logIndex`, cap 50 pages) until the uid is matched by `matchAnnouncements(keys, rows)`; `POST /verify { qr }` → `LEVEL_REQUIRED`; `privateKeyToAccount(found.stealthPrivateKey)` → challenge → `ADMIT` with `holder === found.stealthAddress`. On a real chain the announcement lands only after `CONFIRMATIONS` (5) blocks: poll `/announcements` every 5 s for up to 2 minutes before failing (this doubles as the real-chain warm-up). Budget note in a comment: the ladder spends a handful of the 120/h `/announcements` budget.

   Flags: `SMOKE_LADDERS=bearer,signed,private` (default all three) so an operator can run one ladder.
6. **Frontend build env**: root `README.md` "Setup" gains a "Production build" subsection: `VITE_API_BASE_URL=https://api.fuda.sh`, `VITE_APP_ORIGIN=https://app.fuda.sh`, `VITE_RP_ID=fuda.sh` must be set in the environment of `pnpm --filter <app> build` (they are baked in); each app deploys with `pnpm --filter <app> exec wrangler deploy` after its build. Confirm `VITE_RP_ID` is read by `apps/app` (grep `VITE_RP_ID`) and that its default is `location.hostname` for localhost.
7. `viem-chain.ts` lines 44–45 comment: drop the "(Plan 4)" / "(Plan 2)" parentheticals.
8. Sweep: `grep -rn "Plan [0-9]" apps packages README.md --include='*.ts' --include='*.tsx' --include='*.jsonc' --include='*.md' | grep -v node_modules` must be empty after this task (docs/ is swept in Task 14).
9. `vp check`; `pnpm --filter api exec wrangler deploy --dry-run --outdir /tmp/claude-1000/-home-yuji-code-github-com-oboroxyz-fuda-sh/1e1de527-c8aa-4897-a9ce-84bf3a052217/scratchpad/dry` for the api to validate the config (routes with `custom_domain` are accepted by the dry run); the three SPA configs validate with the same flag after `pnpm --filter <app> build`. Run the three ladders against the fake chain (`USE_FAKE_CHAIN=1` in `apps/api/.dev.vars`, `pnpm --filter api dev`, then `pnpm --filter api smoke:live`); remove `.dev.vars` and stop the dev server afterwards.

**Commits:** `chore(deploy): declare custom domains and fix wrangler schema paths`, `feat(api): add the root-delegation script and Signed/+Private live smoke ladders`, `docs: production build environment for the frontends`.

---

## Task 7 — `docs/specs/attestation-model.md` (canonical: constants, tables, contracts)

All prose below is inserted verbatim (adjust only heading levels/links if a neighbouring section demands it). Run `vp format` after editing (tables are reformatted by oxfmt).

1. **"Chain fixtures" table** — add rows:

   ```
   | ERC-5564 Announcer            | `0x55649E01B5Df198D18D95b5cc5051630cfD45564` (`ANNOUNCER_ADDRESS`); scan floor `ANNOUNCER_FROM_BLOCK` = the block this contract was deployed at on the target chain |
   | Coinbase Smart Wallet factory | `0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a` (`FACTORY_ADDRESS`); derives the counterfactual claimable-smart-account address for Bearer holders |
   ```

2. **New subsection `### Wire constants`** right after "Chain fixtures":

   > Every string a client and the api must agree on byte-for-byte. Changing any of them is a protocol version bump.
   >
   > | Constant | Value |
   > | --- | --- |
   > | Pass / QR payload | `fuda:v1:<uid>` (uid = `0x` + 64 lowercase hex) |
   > | Challenge string (what is signed, EIP-191 personal-sign) | `fuda-gate:<uid>:<nonce>` |
   > | Challenge nonce | `0x` + 32 hex (16 random bytes); TTL 300 s; one-time |
   > | Announcement metadata | `0x` + viewTag (2 hex) + uid (64 hex) |
   > | HKDF domain salt (`@fuda/stealth`) | `fuda.sh/stealth/v1` (UTF-8 bytes) |
   > | WebAuthn PRF eval input | `prf: { eval: { first: utf8('fuda.sh/stealth/prf/v1') } }` — the PRF output is a function of this input; it must never change |
   > | WebAuthn `rp.id` | `fuda.sh` for every fuda passkey ceremony in production (`VITE_RP_ID`, baked into the member app at build time; local dev overrides it to `localhost`) |
   >
   > `uid` values are normalized to lowercase at every route entry; a mixed-case uid in a QR, path or body is accepted and treated as the same right.

3. **"Configured values" table** — add rows (keep the existing four):

   ```
   | `ANNOUNCER_ADDRESS`     | `wrangler.jsonc` `vars` | The ERC-5564 Announcer `/issue` writes +Private announcements to and `GET /announcements` reads |
   | `ANNOUNCER_FROM_BLOCK`  | `wrangler.jsonc` `vars` | Sync floor for the announcement cache. Must be this deployment's Announcer deployment block; `0`, missing or unparseable counts as unconfigured and `GET /announcements` answers `502 rpc_unavailable` without touching the chain (fails closed rather than walking from genesis) |
   | `FACTORY_ADDRESS`       | `wrangler.jsonc` `vars` | Coinbase Smart Wallet factory used to derive Bearer holder addresses |
   | `API_BASE_URL`          | `wrangler.jsonc` `vars` | Absolute base for the `passUrls` in `/issue` responses and the Google Wallet `origins` claim |
   | `ADMIN_TOKEN`           | Worker secret           | Bearer token for `/issue`, `/revoke`, `/members`. Required whenever a signer is configured: with `SIGNER_PRIVATE_KEY` set and no token the admin routes answer `401 unauthorized` and every response carries `x-auth-mode: locked`; with neither set (local dev) they are open and responses carry `x-auth-mode: open` |
   | `BASE_RPC_URL`          | Worker secret           | Base Sepolia RPC; falls back to the public endpoint |
   | `GOOGLE_ISSUER_ID`, `GOOGLE_CLASS_ID`, `GOOGLE_SA_EMAIL`, `GOOGLE_SA_KEY_PEM` | Worker secrets | Google Wallet; all four or `GET /pass/:uid/google` answers `501 google_not_configured` |
   | `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_CERT_PEM`, `APPLE_KEY_PEM`, `APPLE_WWDR_PEM` | Worker secrets | Apple Wallet; all five or `GET /pass/:uid/apple.pkpass` answers `501 apple_not_configured` |
   ```

   Below the table add:

   > `USE_FAKE_CHAIN=1` is a local-development opt-in only (`apps/api/.dev.vars`): it swaps in an in-memory chain and is ignored whenever a signer or RPC binding is present. It is never set in a deployed environment. Wrangler named environments do not inherit top-level `vars` or `d1_databases`, so the `env.dev` block in `apps/api/wrangler.jsonc` repeats them in full with deterministic fake-chain values.
   >
   > Migrations under `apps/api/migrations/` are hand-written SQL; there is no drizzle-kit snapshot. Before any future `drizzle-kit generate`, bootstrap the baseline snapshot first, or the generator re-emits every table as a new migration.

4. **New subsection `### Error codes`** after "Gate verification order and reasons":

   > Errors are `{ "error": "<code>" }` with these statuses. Every gate verdict is `200` and decision-shaped; only input, auth, configuration and infrastructure failures use these codes.
   >
   > | Code | Status | When |
   > | --- | --- | --- |
   > | `bad_input` | 400 | body fails validation |
   > | `bad_uid` | 400 | uid is not `0x` + 64 hex |
   > | `bad_qr` | 400 | QR payload is not `fuda:v1:<uid>` |
   > | `bad_meta_address` | 400 | +Private meta-address is malformed or off-curve |
   > | `client_ip_required` | 400 | budgeted route called without `CF-Connecting-IP` |
   > | `unauthorized` | 401 | admin bearer missing or wrong, or admin routes locked |
   > | `not_found` | 404 | no `members` row for the uid (also a +Private row on the pass routes) |
   > | `rate_limited` | 429 | per-IP hourly budget exceeded |
   > | `internal` | 500 | unclassified defect; logged |
   > | `no_signer` | 501 | write route without `SIGNER_PRIVATE_KEY` |
   > | `google_not_configured` / `apple_not_configured` | 501 | wallet platform secrets absent |
   > | `chain_error` | 502 | chain write reverted or failed, or the accepted schema set is empty or malformed |
   > | `rpc_unavailable` | 502 | announcement cache empty and the chain unreachable, or `ANNOUNCER_FROM_BLOCK` unconfigured |
   >
   > The `ErrorCode` union in `packages/sdk` is this list.

5. **After the `POST /verify` payload paragraph**, add:

   > **Threat model of the public verify endpoints.** `GET /verify/:uid` and `POST /verify` are unauthenticated, and every Bearer uid is public on chain and in the pass URL scheme (`/pass/<uid>`). Anyone who learns a uid can preview it and, for a SINGLE_USE right, burn its slot with a bare `POST /verify`. This is by design: a Bearer right is a bearer credential, and the venue's own scanner shares the same anonymous path. Rights that must resist this are issued at Signed, where admission needs a challenge signature from the holder.
   >
   > **Signature verification and RPC outages.** `POST /verify-signed` verifies possession through viem's `publicClient.verifyMessage`, which covers EOAs (ecrecover), deployed smart accounts (ERC-1271) and undeployed ones (ERC-6492) in one call. viem folds a transport error during the ERC-1271/6492 path into a `false` result, so an RPC outage surfaces as `BAD_SIGNATURE` (fail closed) rather than `502`; the burned challenge is cheap to re-mint. Re-test this behaviour on every viem major bump.

6. **"D1 tables that mirror or extend attestations"** — replace the SQL block with the full `apps/api/migrations/0000_init.sql` contents (all seven tables, byte-identical), then add below the existing SINGLE_USE paragraph:

   > `challenges` rows are one-time and short-lived: `POST /verify-signed` consumes a nonce with a conditional `UPDATE … WHERE used_at IS NULL AND created_at > now − 300`, and `POST /challenge` opportunistically deletes rows older than the 300 s TTL on every mint, so the table holds only live nonces. `rate_limits` is the per-IP fixed hourly window (`floor(now / 3600) * 3600`) behind `GET /announcements` only: 120 requests per hour per IP; the gate routes, admin routes and `/health` are never budgeted. `announcements` and `sync_state` are the ERC-5564 log cache and its cursor (next subsection).

7. **New subsection `### Announcement cache (`GET /announcements`)`** after the D1 subsection:

   > The api mirrors every scheme-1 `Announcement` event of the configured Announcer into D1 and serves it to every caller identically; it never filters by caller or by anything a member could be identified by (see ADR 0001). Contract:
   >
   > - **Lazy sync.** Each request first syncs from the persisted cursor (floor: `max(sync_state, ANNOUNCER_FROM_BLOCK − 1)`) in chunks of at most 1000 blocks, at most 5 chunks per request; each chunk's rows and its new cursor land in one D1 batch, and the cursor write is monotone (`max`) so concurrent requests cannot lower it. Multi-row inserts are sliced to stay under D1's 100-parameter cap.
   > - **Reorg guarantee.** Sync stops `CONFIRMATIONS = 5` blocks short of the head, so a re-org cannot strand a row behind the cursor.
   > - **Response.** `{ announcements, syncedTo }`: up to 1000 rows ascending by `(block_number, log_index)` starting at `fromBlock` (default 0; a non-integer or negative value clamps to 0).
   > - **Paging (client rule).** A page shorter than 1000 rows is the last one. Otherwise resume at the last row's `blockNumber` (the api pages by block, so the boundary block is returned again) and de-duplicate on `(txHash, logIndex)`. The member app caps a discovery walk at 50 pages and marks the result incomplete when the cap is hit; a full walk of a large log can therefore spend up to 50 of the caller's 120 hourly requests.
   > - **Degradation.** With the chain unreachable the route serves the stale cache and its last `syncedTo`; it answers `502 rpc_unavailable` only when nothing has ever been cached, and likewise when `ANNOUNCER_FROM_BLOCK` is unconfigured. A freshly deployed api therefore needs one warm-up call (or the live smoke) before the first member discovery.

8. **New subsection `### Operational reconciliation`** before "Tests that pin this model":

   > Two writes are deliberately non-atomic across the chain and D1, and each leaves a trace an operator reconciles by hand:
   >
   > - **Orphan attestation.** `POST /issue` attests first and writes the `members` row (and, for +Private, the announcement) second. If the row insert or the announce fails, the route answers `502 chain_error`, persists nothing, and logs the uid. The right exists on chain but fuda's ledger does not know it; revoke it from the dash by uid, or re-run the issue.
   > - **Lost `attendance_uid`.** Attendance is attested best-effort after the verdict; if the attest or the write-back fails, the `entry_log` row keeps `attendance_uid = NULL` and the failure is logged. The admission stands; the on-chain evidence is missing for that entry. `SELECT * FROM entry_log WHERE decision = 'ADMIT' AND attendance_uid IS NULL` lists them.

9. **"Tests that pin this model"** — append: "EAS `expirationTime` in the past → `EXPIRED`, precedence over the usage-model check; admin routes locked without `ADMIN_TOKEN` when a signer is set; `/pass/:uid/google` 404 for a +Private row before any platform check; announcement paging (short page stops, boundary-block dedupe, 50-page cap); monotone cursor; confirmation depth."

**Commit:** `docs(specs): record wire constants, error codes, D1 tables and the announcement cache contract`

---

## Task 8 — `docs/specs/pass-types-and-flows.md` (flows and surface contracts)

1. **New section `## Gate protocol` before "Supporting verification concepts"**:

   > ### Bearer entry (`POST /verify`)
   >
   > The gate scans `fuda:v1:<uid>`, posts `{ "qr" }`, and renders the verdict. Verdicts are always `200` and decision-shaped; every verdict is appended to `entry_log` with `path: 'qr'`. A Signed or +Private right presented by bare QR answers `REJECT LEVEL_REQUIRED` before any slot is consumed — a photo of a Signed pass does not admit.
   >
   > **Three-state gate rule.** The gate previews a scanned uid with `GET /verify/:uid` before admitting. GREEN = preview `ADMIT` with `entitlement.level === 0`; YELLOW = preview `ADMIT` with `level ≥ 1` (valid, but needs the Signed flow), or a preview whose `entitlement` is missing (fail closed, treated as not admissible by QR); RED = preview `REJECT`, and every `POST /verify` `REJECT`.
   >
   > ### Signed entry (`POST /challenge` → `POST /verify-signed`)
   >
   > `POST /challenge { "uid" }` → `200 { "challenge": "fuda-gate:<uid>:<nonce>", "nonce": "0x…32hex" }`. No chain lookup: a challenge for an unknown or revoked uid is minted anyway and rejected at the next step. `400 bad_uid` for a malformed uid. `Cache-Control: no-store`.
   >
   > `POST /verify-signed { "uid", "nonce", "signature" }` (`400 bad_uid` / `400 bad_input` on shape) → always `200`:
   >
   > ```jsonc
   > { "decision": "ADMIT" | "REJECT", "reason": "<reason>", "path": "signature", "holder": "0x…", "stage": "entitlement" | "challenge" }
   > ```
   >
   > `stage` marks the two early stops: `entitlement` (chain verification failed — `reason` is the gate reason table's entry) and `challenge` (`BAD_CHALLENGE`: nonce unknown, expired past 300 s, or already used). `holder` is present once the attestation was decoded, including on those REJECTs. After the challenge is consumed the signature is verified (`BAD_SIGNATURE` — a wrong signature also burns the nonce), then the SINGLE_USE slot (`ALREADY_USED`), then `ADMIT`. The slot insert and the ADMIT log row are one D1 batch. `no-store` on every verdict.
   >
   > ### +Private entry
   >
   > Identical to Signed. The member recovers the stealth address's private key client-side and signs the same challenge; `holder` in the verdict is the stealth address. There is no separate +Private gate machinery.

2. **Extend "U2. Privacy-first issuance"** (after the "The issuance response does not identify…" paragraph) with:

   > **Discovery.** The member app walks `GET /announcements` from block 0 (paging rule in the attestation model) and matches rows locally with the viewing key; the api never learns which rows are the member's. Matching is the ERC-5564 view-tag prefilter followed by the full ECDH check.
   >
   > **Interoperability caveat.** fuda's shared secret is `keccak256` of the **compressed** 33-byte ECDH point. A third-party ERC-5564 scanner that hashes the uncompressed point will not discover fuda announcements, and fuda will not discover theirs; the meta-address format and the announcement layout are standard scheme 1.
   >
   > **Same meta-address on every device** holds for a passkey that the platform syncs (iCloud Keychain, Google Password Manager). A device-bound passkey yields a different member secret, hence a different meta-address, and rights issued to the first one are not discoverable from the second.
   >
   > **Privacy boundary.** Unlinkability holds against chain observers, not against the issuer: the api's `members` row carries `member_id` next to the uid, the uid resolves publicly to the EAS attestation, and the operator can therefore join `member_id ↔ uid ↔ stealth address`. The gate likewise sees which right entered. Members who need unlinkability from the issuer as well are outside the MVP (nullifier design).

3. **New section `## Passes` before "Supporting verification concepts"** (after Gate protocol):

   > A pass presents a right; it is never the source of validity. The api serves three forms for every Bearer and Signed right, all linked from the `/issue` response (`passUrls.web`, `.google`, `.apple`) and the dashboard. A +Private right has no pass: its holder is a one-time stealth address only the member can recover, the `/issue` response carries no `passUrls`, and all three pass routes answer `404 not_found` for it.
   >
   > | Route | Answer |
   > | --- | --- |
   > | `GET /pass/:uid` | self-contained HTML (inline SVG QR of `fuda:v1:<uid>`, tier, short holder, live status re-read from `GET /verify/:uid` every 30 s, add-to-home-screen hint, "Add to Google Wallet" when available). Never `5xx`: a chain failure renders the status as `UNKNOWN`. `404 not_found` when fuda never issued the uid; `400 bad_uid` when it is malformed; `Cache-Control: no-store` |
   > | `GET /pass/:uid/google` | `200 { "saveUrl": "https://pay.google.com/gp/v/save/<jwt>" }` — an RS256 `savetowallet` JWT (`iss` = service-account email, `aud: google`, `origins` = the api origin, `https://dash.fuda.sh`, `https://app.fuda.sh`) carrying one GenericObject: id `<issuerId>.<uid without 0x>`, title "fuda membership", header = tier label, QR barcode `fuda:v1:<uid>`, text modules Tier and Member. `501 google_not_configured` without the four `GOOGLE_*` secrets |
   > | `GET /pass/:uid/apple.pkpass` | `application/vnd.apple.pkpass`: a stored ZIP of `pass.json` (storeCard; serial = uid; QR `fuda:v1:<uid>`; fields TIER / MEMBER / Attestation), `icon.png`, `manifest.json` (SHA-1 per file) and a detached CMS `signature` (RSASSA-PKCS1-v1_5 + SHA-256, Pass Type ID certificate with the WWDR intermediate). `501 apple_not_configured` without the five `APPLE_*` secrets |
   >
   > The check order on every pass route is bad uid → unknown uid → +Private → platform configuration, so a 404 never reveals platform state.

   (If Task 5 was dropped, keep the Apple row: it documents the contract the 501 fallback guards.)

4. **New section `## Surfaces` at the end, before "Related specs"**:

   > | Host | Worker | Dev port | Role |
   > | --- | --- | --- | --- |
   > | `api.fuda.sh` | `apps/api` | 8787 | the api |
   > | `gate.fuda.sh` | `apps/gate` | 5174 | scanner: QR preview, verdict, Signed hand-off |
   > | `dash.fuda.sh` | `apps/dash` | 5175 | operator dashboard: issue, list, revoke, pass links |
   > | `app.fuda.sh` | `apps/app` | 5173 | member app: `/signed` challenge-response, `/private` enrolment and discovery |
   > | `fuda.sh` (apex) | `apps/app` | — | landing only |
   >
   > The frontends call the api cross-origin at `VITE_API_BASE_URL` (baked in at build time; `http://localhost:8787` by default). The api's CORS allow-list is exactly `https://app.fuda.sh`, `https://dash.fuda.sh`, `https://gate.fuda.sh` plus any `http://localhost:<port>` / `http://127.0.0.1:<port>` origin. The apex `fuda.sh` is served by the member-app Worker but is **not** a CORS origin: it hosts the landing only, and `/signed` and `/private` on the apex redirect to `https://app.fuda.sh` (`VITE_APP_ORIGIN`) with a one-line interstitial ("Redirecting to app.fuda.sh…"), so every gate call originates from an allowed origin. `VITE_RP_ID` fixes the passkey `rp.id` to `fuda.sh` in production builds.

**Commit:** `docs(specs): document the gate protocol, pass contracts and surfaces`

---

## Task 9 — `docs/specs/README.md`

1. Components table: change the Passes row responsibility to "Builds the Google Wallet save link and the Apple `.pkpass`; the api renders the browser-based pass. Passes present a right and are never its source of truth".
2. Replace "Related documentation — TBD" with:

   ```
   - [Runbook](../runbook.md) — one-time chain setup, secrets and vars, deploy order, smoke ladders, reconciliation
   - [ADR 0001 — unfiltered announcement log](../adr/0001-unfiltered-announcement-log.md)
   - [api README](../../apps/api/README.md) — running the api locally, endpoints, error codes
   - [Glossary](../CONTEXT.md)
   ```

3. Under "Authority and trust boundaries" add one bullet: "**Admin routes fail closed.** Issue, revoke and member listing require `ADMIN_TOKEN`; a deployment with a signer and no token locks them rather than opening them."

**Commit:** `docs(specs): link the runbook and ADR from the architecture overview`

---

## Task 10 — `docs/specs/naming.md`

After the "Member number" table's trailing paragraphs, add:

> **Member number and the admin `memberId`.** The member number above is the identifier the self-serve issuance path generates for a right. The admin path (`POST /issue` from the dashboard) accepts `memberId` as free-text — any non-empty string the operator chooses — and stores it as-is in `members.member_id`; it is neither validated against nor converted to the member number format. The two coexist: an admin-issued right has whatever id the operator typed, a self-serve right has a generated member number. No route in the api generates member numbers.

**Commit:** `docs(specs): distinguish the generated member number from the admin memberId`

---

## Task 11 — `docs/CONTEXT.md`

1. **Member id** entry: append to its definition: "In the admin issuance path the Member id is operator-chosen free text; the generated member number (see naming) belongs to the self-serve path."
2. Add a short entry under "Entering" (or wherever the level/path terms live):

   > **Level and path, never "mode":** a Right has a **level** (Bearer, Signed; +Private is a privacy extension of Signed) and an Entry has a **path** (`qr` or `signature`). "Mode" is not used for either. The api's `x-auth-mode` response header (`open` / `locked`) names the admin-auth state and keeps its name.

**Commit:** `docs: glossary notes for the admin member id and the level/path vocabulary`

---

## Task 12 — `docs/adr/0001-unfiltered-announcement-log.md`

Create `docs/adr/` with this file:

```markdown
# ADR 0001: the api serves the whole ERC-5564 announcement log, unfiltered

Status: accepted (2026-09-06)

## Context

+Private rights are attested to one-time stealth addresses and announced through the ERC-5564 Announcer. The member app must find its own announcements. The api already indexes the Announcer log into D1 (`GET /announcements`) and could, in principle, narrow what it returns — by caller (fuda's signer), by a member-supplied key, or by a server-side match.

## Decision

`GET /announcements` returns every scheme-1 announcement from `ANNOUNCER_FROM_BLOCK` onward, identically to every caller, paged by block number. The only parameter is `fromBlock`. Matching happens exclusively client-side with the member's viewing key. The api never accepts a viewing key, a meta-address, a member id or any other selector on this route, and never applies a caller filter.

## Consequences

- The privacy property is the absence of a query: the api cannot learn which rows belong to which member because it is never told anything about the member. Adding a filter, even a harmless-looking one, would turn each request into a statement about the caller and is therefore forbidden by this decision.
- A caller allow-list on the Announcer's `caller` field would break the moment an issuer other than fuda's signer announces (the venue-signed issuance path); the receiver's view tag is the filter ERC-5564 intends.
- Cost is bandwidth and budget: a full walk of a large log takes up to 50 pages of 1000 rows and spends that many of the caller's 120 hourly requests. Base Sepolia's Announcer volume keeps this small; if it grows, the mitigation is a larger page or a longer window, never a filter.
- Unlinkability holds against chain observers and the api's log, not against the issuer, whose ledger carries the member id next to the uid.
```

**Commit:** `docs(adr): record why the announcement log is served unfiltered`

---

## Task 13 — `docs/runbook.md`

Create the file with these sections, in this order, present tense, commands in fenced blocks. Move (do not duplicate) the "One-time chain setup" and "Secrets and vars" content out of `apps/api/README.md`, leaving there a one-line pointer to the runbook; keep the README's "Run locally" and endpoints sections.

1. **Prerequisites.** Cloudflare zone `fuda.sh`; a funded Base Sepolia EOA for the signer; `pnpm install --frozen-lockfile`.
2. **One-time chain setup** (gated, in order): fund the signer → `SIGNER_PRIVATE_KEY=0x… pnpm --filter api register-schemas` → paste `EAS_SCHEMAS` → `SIGNER_PRIVATE_KEY=0x… pnpm --filter api attest-root-delegation` → paste `ISSUER_ADDRESS` and `DELEGATION_UID` → look up the Announcer's deployment block on the Base Sepolia explorer and set `ANNOUNCER_FROM_BLOCK` (the api refuses to sync while it is `0`; this is the operator-visible fail-closed state) → `wrangler d1 create fuda` and replace both `database_id` placeholders → `pnpm --filter api migrate:remote`.
3. **Secrets.** `wrangler secret put` for `SIGNER_PRIVATE_KEY`, `ADMIN_TOKEN` (**required with a signer** — the api locks admin routes and answers `x-auth-mode: locked` otherwise), `BASE_RPC_URL`, the four `GOOGLE_*`, the five `APPLE_*`. PEM secrets: paste the block as-is; literal `\n` escapes from a service-account JSON are accepted.
4. **Google Wallet setup.** Create the issuer account, a GenericClass with id `GOOGLE_CLASS_ID` (objects referencing a non-existent class fail), request publishing approval, and add the demo phones' Google accounts as testers so demo mode works before approval.
5. **Apple Wallet setup.** Request the Pass Type ID certificate early (lead time); export the certificate and PKCS#8 key as PEM; download the WWDR intermediate. If the certificate has not arrived, leave the five secrets unset — the route answers 501 and the browser pass is the floor.
6. **Deploy order.** api (`pnpm --filter api deploy`) → frontends: `VITE_API_BASE_URL=https://api.fuda.sh VITE_APP_ORIGIN=https://app.fuda.sh VITE_RP_ID=fuda.sh pnpm --filter <app> build && pnpm --filter <app> exec wrangler deploy` for gate, dash, app. Custom domains are declared in each `wrangler.jsonc`.
7. **Warm-up and smoke.** `curl https://api.fuda.sh/health` (expect `x-auth-mode` absent, not `locked`); one `GET /announcements` call warms the cache (lazy sync); `API_URL=https://api.fuda.sh ADMIN_TOKEN=… pnpm --filter api smoke:live` runs the bearer, Signed and +Private ladders. The Attendance attestation for an ADMIT appears on the explorer within a few blocks.
8. **Manual checks that no script covers.** (a) WebAuthn PRF: on a real phone, `app.fuda.sh/private` → create passkey → the meta-address renders; (b) ERC-6492: issue a Signed right to a Base Account (passkey smart wallet) address, enter at `app.fuda.sh/signed` before the account is deployed — the api must answer `ADMIT` through the ERC-6492 path; this is the one path the fake chain cannot exercise, so it must be run once on Base Sepolia before the deploy is called done; (c) Google: open `/pass/<uid>` on an Android phone, tap "Add to Google Wallet"; (d) Apple: open `/pass/<uid>/apple.pkpass` on an iPhone.
9. **Reconciliation.** The two lists from the attestation model: orphan attestations (`502 chain_error` on issue with a logged uid → revoke by uid or re-issue) and `entry_log` rows with `attendance_uid IS NULL` (`wrangler d1 execute fuda --remote --command "SELECT id, uid, at FROM entry_log WHERE decision = 'ADMIT' AND attendance_uid IS NULL"`).
10. **Local development.** Pointer to `apps/api/README.md` (fake chain, `.dev.vars.example`, ports 8787 / 5174 / 5175 / 5173).
11. **Budget note.** `/announcements` is the only budgeted route (120/h per IP); a Discover walk of a large log can use up to 50 of them; the venue gate and admin routes are never budgeted.

**Commit:** `docs: add the deployment runbook`

---

## Task 14 — Delete the temporary artifacts (final commit of the plan)

1. `git rm .superpowers/specs/2026-09-05-fuda-mvp-design.md .superpowers/plans/2026-09-06-mvp-5-passes-deploy-docs.md`.
2. Verify nothing canonical leans on them:
   - `grep -rn "superpowers" docs/ README.md AGENTS.md apps/*/README.md` → only the policy references in `AGENTS.md` (the `.agents/rules` import) may remain; nothing under `docs/`.
   - `grep -rn "Plan [0-9]\|spec §\|design spec" docs/ README.md apps/*/README.md apps/*/src packages/*/src apps/*/wrangler.jsonc` → empty.
   - `ls .superpowers/specs .superpowers/plans` → both empty (or absent).
3. `./node_modules/.bin/vp check`; run every package's tests once more (`vp -C apps/api test`, `-C packages/pass`, `-C packages/sdk`, `-C packages/stealth`, `-C packages/web-kit`, `-C apps/gate`, `-C apps/dash`, `-C apps/app`).
4. Commit: `docs: remove the completed MVP design spec and phase 5 plan`.

This is the last task. It is **not** "merge": the controller runs the final whole-branch review and then the finishing-a-development-branch flow (merge commit or rebase onto `main`, never squash).

---

## Self-review — coverage of the obligations ledger and spec §9 / §13 / §16

| Obligation | Task |
| --- | --- |
| Wire constants (Announcer, factory, `fuda:v1:`, `fuda-gate:`, TTL 300 s, HKDF salt, PRF input, `rp.id`, metadata layout) | 7 (§2, §1) |
| Four missing D1 tables | 7 (§6) |
| Per-IP budget 120/h on `/announcements` only | 7 (§6), 13 (§11) |
| Pass JSON shapes | 8 (§3) |
| `rp.id` env override for localhost | 7 (§2 row) |
| Google `origins` = api host + dash + app | 4, 8 |
| CORS localhost ports | 8 (§4) |
| EAS `expirationTime` → `EXPIRED` row + code, same commit | 1 |
| `internal` in spec error table and `ERROR_CODES` | 3, 7 (§4) |
| Vars `API_BASE_URL`, `FACTORY_ADDRESS`; `USE_FAKE_CHAIN` dev-only; `env.dev` mirror | 7 (§3) |
| `ADMIN_TOKEN` guard + runbook line; `database_id` placeholders | 2, 6 (§3), 13 (§2, §3) |
| Hand-written migrations, bootstrap before `generate` | 7 (§3) |
| `/pass` contract (never 5xx → UNKNOWN, 404 vs 400, `no-store`, private → 404 on all three) | 4, 8 (§3) |
| Gate three-state rule | 8 (§1) |
| Dash / operator surface, `VITE_API_BASE_URL`, ports | 8 (§4) |
| uid lowercase at route entry | 7 (§2) |
| Public `/verify` threat model | 7 (§5) |
| naming.md member number vs admin `memberId` | 10, 11 |
| "mode" ban scope, `x-auth-mode` stays | 11, global constraints |
| `$schema` paths (all three SPA files and the api) | 6 |
| Apex not in CORS; `/signed` `/private` redirect via `APP_ORIGIN` / `VITE_APP_ORIGIN`; interstitial copy | 8 (§4) |
| `challenges` retention (swept on mint) | 7 (§6) |
| `/challenge` + `/verify-signed` shapes (`stage`, `holder` once decoded); `no-store` | 8 (§1) |
| viem transport-error folding → `BAD_SIGNATURE`; re-test on viem major bump | 7 (§5) |
| Orphan attestation + lost `attendance_uid` reconciliation | 7 (§8), 13 (§9) |
| ERC-6492 needs a live Base Sepolia smoke | 13 (§8) |
| Compressed-point ECDH interop caveat | 8 (§2) |
| Privacy boundary paragraph (operator can join) | 8 (§2), 12 |
| `/announcements` paging and reorg (`CONFIRMATIONS = 5`) contracts | 7 (§7) |
| "Same meta-address" only for synced passkeys | 8 (§2) |
| `ANNOUNCER_FROM_BLOCK` gated deploy step; api 502 when 0 | 6 (§3), 7 (§3), 13 (§2) |
| ErrorCode union vs README (`rate_limited`, `client_ip_required`) | 7 (§4) |
| ADR for the unfiltered announcement log | 12 |
| `VITE_RP_ID=fuda.sh` in the build env | 6 (§6), 13 (§6) |
| Real-chain `/announcements` warm-up | 6 (§5), 13 (§7) |
| Discover paging may use up to 50 of 120/h | 7 (§7), 12, 13 (§11) |
| Production `wrangler.jsonc` ships `ANNOUNCER_FROM_BLOCK "0"` (fails closed, operator-visible) | 6 (§3), 13 (§2) |
| `passUrls` shared helper (dash duplicate) | 3 |
| Private-row 404 on `/google` and `/apple.pkpass` | 4, 5 |
| Toolchain: pnpm-workspace overrides bump note | already in `AGENTS.md` at base (no change) |
| Spec §9 build order (web → Google → Apple), Google JWT + GenericObject, Apple `.pkpass` layout, secrets lists | 4, 5, 8 |
| Spec §13 hosts, CORS, D1, nonce manager (present in `viem-chain.ts` at base), secrets, vars, one-time setup incl. Google class/testers and Apple certificate lead time | 6, 13 |
| Spec §16 acceptance 1–7 | 1 and 2 via Task 6 smoke + Google path (Task 4); 3–6 via the three smoke ladders (Task 6); 7 via `vp check` + all suites (Task 14) |
| §15 out-of-scope statements (Bearer QR copying, Attendance publishes entries, unlinkability not against the issuer) | 7 (§5), 8 (§2) |

Placeholder scan: no task says "similar to Task N"; every doc task carries its prose inline; the Google and Apple tasks carry their code and exact shapes. Type consistency: `loadPassRow` / `PassRow` / `PassOutcome` names match `apps/api/src/pass/pass-view.ts`; `googleConfigFrom` / `buildGoogleSaveUrl` / `appleConfigFrom` / `buildPkpass` are used with the same names in Tasks 4, 5 and 8.
