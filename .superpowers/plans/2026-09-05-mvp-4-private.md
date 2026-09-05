# fuda MVP — Plan 4 of 5: +Private Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the +Private extension end to end — spec §14 step 6: `@fuda/stealth`, the `/issue` stealth branch with the ERC-5564 announcement, `GET /announcements` behind the per-IP budget, and the member app's derive / discover / enter screens — so the full level ladder (Bearer → Signed → +Private) is demoable.

**Architecture:** Nothing new at the gate. A +Private right is a Signed right whose holder is a one-time stealth address, so `/verify-signed` is unchanged: the member recovers the stealth private key client-side and signs the same challenge. New pieces: a dependency-light crypto package (`packages/stealth`), two more `ChainClient` methods (`announce`, `getAnnouncementLogs`) implemented by the viem client and the fake, one more `/issue` branch, and one new read endpoint that lazily syncs the Announcer log into D1. The first task extracts the admit → log → hook spine both admission routes already duplicate, so the plan starts by removing duplication rather than adding a third copy.

**Tech Stack:** `@noble/curves` 1.9.1 (secp256k1), `@noble/hashes` 1.8.0 (sha256, hkdf, keccak), viem 2.56.3 utils; Hono + Drizzle + D1 on workerd; hono/jsx-dom + `@fuda/web-kit` in `apps/app`; WebAuthn PRF for the member secret. Exact versions pinned where a package is added.

**Spec:** `.superpowers/specs/2026-09-05-fuda-mvp-design.md` (temporary) — §1 (Announcer address), §2 (`announcements`, `sync_state`, `rate_limits`), §3 (+Private branch of `/issue`, `GET /announcements`, per-IP budget), §5 (wire constants), §7 (`@fuda/stealth`), §8 (announcements as the second exhaust stream), §10.2, §11, §12 (stealth rows), §15, §16.5 — with `docs/specs/attestation-model.md` and `docs/CONTEXT.md` canonical. Prior interfaces come from the code at HEAD (`c995f86`) and the three handoff files under `.superpowers/sdd/`, never from the deleted plans.

**Plan series:** Plans 1–3 are complete (api core; gate + dash + Attendance + browser pass; Signed). **This plan** is 4. Plan 5 (last): `packages/pass` Google then Apple, deploy topology, canonical docs update, artifact deletion. The Plan 5 obligations accumulated so far are listed at the end of this header so they are not lost when this plan is deleted.

**Rulings this plan makes (binding on every task):**

- **`/pass/:uid` for a private row answers `404 not_found`.** Spec §3: the private `/issue` response carries no `passUrls` because "the operator holds nothing to hand out"; a right whose holder is a stealth address has no pass. The dash already hides pass links for private rows.
- **Announce failing after a successful attest → `502 chain_error`, no `members` row, uid logged.** The right exists on chain but nobody can discover it; the operator retries and revokes the undiscoverable duplicate from the dash. Joins the Plan 5 reconciliation list.
- **`GET /announcements` pulls at most `SYNC_CHUNKS_PER_REQUEST = 5` chunks of ≤1000 blocks per request** and returns `syncedTo` wherever it stopped; the next request continues. A cold deployment with a deep `ANNOUNCER_FROM_BLOCK` therefore warms up across a few requests instead of exceeding the worker's CPU budget on the first.
- **The per-IP budget is mounted on `GET /announcements` only** (spec §3), not on `/pass/:uid`.
- **`rp.id` comes from `VITE_RP_ID`** (default `fuda.sh`, local dev `localhost`), the same shape as `VITE_APP_ORIGIN`. "PRF unsupported" is a first-class error state with member-facing copy.
- **The stealth signer is not a provider.** `recoverStealthPrivateKey` → `privateKeyToAccount` → `signMessage` is the `sign` closure handed to the existing `enterSigned`; no second orchestration.
- **§7's EOA-signature derivation source is documented, not built.**

**Plan 5 obligations carried from Plans 1–3 (keep with the plan header until Plan 5 owns them):** move the wire constants (Announcer + factory addresses, `fuda:v1:`, `fuda-gate:<uid>:<nonce>`, nonce TTL 300 s, HKDF salt, PRF eval input, `rp.id`, announcement metadata layout) and the `challenges` / `rate_limits` / `announcements` / `sync_state` tables into `docs/specs/`; spec §6 gains an EAS `expirationTime` row (→ `EXPIRED`) implemented together with the doc; `internal` (500) into spec §3 and `ERROR_CODES`; vars `API_BASE_URL`, `FACTORY_ADDRESS`, `USE_FAKE_CHAIN` (dev-only), `VITE_API_BASE_URL`, `VITE_APP_ORIGIN`, `VITE_RP_ID`; `env.dev` mirrors top-level vars; hand-written migrations (bootstrap a drizzle-kit snapshot before any `generate`); `$schema` paths in the three `wrangler.jsonc`; "bump all three `pnpm-workspace.yaml` overrides with vite-plus"; the `ADMIN_TOKEN`-unset-with-signer guard + runbook; `database_id` placeholders; the `/pass/:uid` contract (never 5xx → UNKNOWN; 404 vs 400; `no-store`); the gate three-state rule; the dash surface; `POST /verify` threat model (public uid can burn a SINGLE_USE slot); `x-auth-mode` wording note; member number (naming.md) = B1's generated Member id, admin `memberId` stays free text; `challenges` retention rule; apex `fuda.sh` not a CORS origin (landing only, `/signed` redirects to the app origin); `/challenge` + `/verify-signed` shapes into `pass-types-and-flows.md`; viem folds RPC outages on `verifyMessage` into `BAD_SIGNATURE` (re-test on a viem major bump); orphan attestation on a `members` insert failure and lost `attendance_uid` → reconciliation list; the ERC-6492/1271 path (Base Account passkey wallet) needs a live Base Sepolia smoke before deploy; `no-store` on 400s; `passUrls` shared helper with `packages/pass`; Solana/CDP transitive deps of `@base-org/account` noted for a dependency audit.

## Global Constraints

Copied from the spec, the repo instructions and the three handoff files. Every task's requirements include this section.

- **Toolchain:** `./node_modules/.bin/vp check` from the worktree root = format + lint + type-aware type check, must be green before every commit. Tests: `cd <package> && ../../node_modules/.bin/vp test` (the session's git guard rejects `vp -C`); the api suite runs in workerd with real D1 (`@cloudflare/vitest-pool-workers@0.22`, `cloudflareTest` plugin, migrations from `apps/api/migrations/`). Root `pnpm test` runs every package.
- **Lint is near-full-strict.** Arrow functions; `describe(fn, …)`; ≤5 `expect`s per `it` (split tests); no `(await x).y`; no TODO comments (prose markers); exact boolean assertions `toBe(true/false)`; inline suppressions only as `// oxlint-disable-next-line <rule> -- <why>` and `vp check` must accept them (`vp check --no-fmt --no-lint` ignores inline disables). No `any`, no non-null assertions, no unsafe casts in `src/` (`// SAFETY:` + `typescript/no-unsafe-type-assertion` disable only where an invariant licenses it, as `web-kit/src/fetch.ts` does). Test files get the fixture latitude the root `vite.config.ts` grants.
- **Test isolation:** pool-workers 0.22 has no per-test storage isolation — every api test file truncates the tables it writes in `beforeEach`. `testEnv()` strips `USE_FAKE_CHAIN` / `SIGNER_PRIVATE_KEY` / `BASE_RPC_URL`; a test that wants the fake chain opts in.
- **`FakeChain`** EIP-55-checksums every address it stores or returns, mints uids from a random per-instance offset (never hardcode a uid), and has `failReads` / `failWrites` switches. `normalizeUid` at every route entry.
- **File names:** kebab-case; PascalCase for `.tsx` components.
- **Vocabulary (`docs/CONTEXT.md`):** `level` = what a right is (`'bearer' | 'signed' | 'private'`, on-chain `0 | 1 | 2`); `path` = how an entry was made (`'qr' | 'signature'`); never "mode". +Private is an extension of Signed, never "the third level". "Venue" in member/operator copy, "Issuer" in code and specs. "Meta-address" is what the member gives the Issuer; "stealth address" is the per-right Holder; "Announcement" is the ERC-5564 log.
- **Chain fixtures (Base Sepolia), verbatim:** ERC-5564 Announcer `0x55649E01B5Df198D18D95b5cc5051630cfD45564` (already in `wrangler.jsonc` as `ANNOUNCER_ADDRESS`, with `ANNOUNCER_FROM_BLOCK`); EAS `0x4200000000000000000000000000000000000021`.
- **Wire constants (§5, §7), verbatim:** HKDF domain salt `fuda.sh/stealth/v1` (UTF-8 bytes); HKDF info strings `member-secret`, `stealth-spend`, `stealth-view`; WebAuthn PRF eval input `fuda.sh/stealth/prf/v1`; `rp.id` `fuda.sh`; announcement metadata `0x` + viewTag (2 hex) + uid (64 hex) = `0x` + 66 hex; meta-address = spendPub ‖ viewPub, 33-byte compressed each, `0x` + 132 hex (`META_ADDRESS_RE` exists in `@fuda/sdk`); ERC-5564 scheme id `1`; Announcer event `Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)`; call `announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)`.
- **`/issue` +Private (§3):** `stealthMetaAddress` present → private (`holder` forbidden; `memberId` optional = the member's persistent id); malformed meta-address → `400 bad_meta_address`; `level = 2`; attest with `recipient = holder = stealthAddress`; then announce; `members` row `holder = NULL`, `member_id = memberId ?? ''`, `level = 'private'`; response `{ uid, level: 'private', announced: true, announceTx }` — no `passUrls`, no stealth address.
- **`GET /announcements?fromBlock=N` (§3):** all `schemeId == 1` announcements, no `caller` filter, ≤1000-block chunks, cursor in `sync_state` after each chunk, scan floor `ANNOUNCER_FROM_BLOCK`; response `{ announcements: [rows], syncedTo }`, rows ordered by block ascending, ≤1000; RPC down with an empty cache → `502 rpc_unavailable`; budget 120 requests / hour / IP → `429 rate_limited`, missing `CF-Connecting-IP` → `400 client_ip_required`.
- **Error codes (HTTP):** `400 bad_input`, `400 bad_uid`, `400 bad_qr`, `400 bad_meta_address`, `400 client_ip_required`, `401 unauthorized`, `404 not_found`, `429 rate_limited`, `501 no_signer`, `502 chain_error`, `502 rpc_unavailable`, `500 internal`. Body always `{ "error": "<code>" }`.
- **Commits:** English, conventional-commit style, no attribution lines. **No copying** from other repositories.

---

## File structure

```
packages/stealth/
  package.json                    "@fuda/stealth", exports "./src/index.ts"; deps @noble/curves 1.9.1, @noble/hashes 1.8.0, viem ^2.56.3
  tsconfig.json                   extends ../../tsconfig.json
  vite.config.ts                  plain Vitest, node
  src/index.ts                    re-exports
  src/constants.ts                SALT, INFO_*, PRF_EVAL_INPUT, SCHEME_ID, METADATA_RE
  src/derive.ts                   deriveMemberSecret, deriveStealthKeys, StealthKeys
  src/stealth.ts                  generateStealthAddress, checkAnnouncement, recoverStealthPrivateKey, matchAnnouncements
  src/metadata.ts                 buildAnnouncementMetadata, parseAnnouncementMetadata
  src/*.test.ts
apps/api/
  src/verify/admit.ts             + admitAndHook (the shared spine)
  src/routes/verify.ts            uses admitAndHook
  src/routes/verify-signed.ts     uses admitAndHook
  src/routes/pass.ts              private row → 404
  src/eas/abi.ts                  + ANNOUNCER_ABI
  src/chain/client.ts             + AnnounceParams, AnnouncementLog, announce(), getAnnouncementLogs()
  src/chain/viem-chain.ts         implements both
  src/chain/fake-chain.ts         implements both (in-memory log with block numbers)
  src/issue/issue-private.ts      the +Private branch
  src/routes/issue.ts             dispatches 'private'
  src/announcements/sync.ts       syncAnnouncements (chunked, cursor)
  src/routes/announcements.ts     GET /announcements behind rateLimit
  src/app.ts                      mounts announcementsRoutes
  test/issue-private.test.ts, test/announcements.test.ts, test/admit-and-hook.test.ts
apps/dash/src/IssueForm.tsx       drop the "400 bad_input until that level lands" note
apps/app/
  src/config.ts                   + RP_ID
  src/vite-env.d.ts               + VITE_RP_ID
  src/passkey.ts                  WebAuthn PRF ceremony (browser only)
  src/private-member.ts           pure: prfOutput → keys → metaAddress; discover; stealth signer
  src/api.ts                      + announcements(fromBlock)
  src/PrivateScreen.tsx           derive / discover / enter
  src/App.tsx, src/route.ts       + '/private'
  src/Landing.tsx                 + link to /private
  src/private-member.test.ts, src/route.test.ts (+ cases)
apps/api/README.md, README.md    docs touch-ups
```

---

### Task 1: `admitAndHook` — one admission spine for both routes

**Files:**
- Modify: `apps/api/src/verify/admit.ts`
- Modify: `apps/api/src/routes/verify.ts`
- Modify: `apps/api/src/routes/verify-signed.ts`
- Test: `apps/api/test/admit-and-hook.test.ts`

**Interfaces:**
- Consumes: `admitSingleUse`, `logEntry`, `AdmitHook`, `AdmitInfo` (`src/verify/admit.ts`), `Entitlement` (`src/eas/codecs.ts`), `waitUntilOf` (`src/routes/verify.ts`), `USAGE_MODEL`, `EntryPath` (`@fuda/sdk`).
- Produces (`src/verify/admit.ts`):
  ```ts
  export interface AdmitContext {
    db: Db
    uid: Hex
    canonical: Pick<Entitlement, 'holder' | 'usageModel'>
    path: EntryPath
    now: number
    onAdmit: AdmitHook
    waitUntil: (p: Promise<unknown>) => void
  }
  export type AdmitOutcome = { admitted: true; entryLogId: number } | { admitted: false; reason: 'ALREADY_USED' }
  /** SINGLE_USE → admitSingleUse; otherwise a plain ADMIT log row; then the best-effort hook. Never throws for the hook. */
  export const admitAndHook = (ctx: AdmitContext) => Promise<AdmitOutcome>
  ```

Both routes keep their own REJECT logging and response shaping; only the spine after "the right may enter" moves. Behaviour is unchanged, which the existing 155 api tests prove.

- [ ] **Step 1: Write the failing test**

`apps/api/test/admit-and-hook.test.ts`:

```ts
import { env } from 'cloudflare:test'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { entryLog, slots } from '../src/db/schema.ts'
import { admitAndHook } from '../src/verify/admit.ts'
import type { AdmitInfo } from '../src/verify/admit.ts'
import { HOLDER, NOW } from './fixtures.ts'

const db = () => getDb({ DB: env.DB })
const UID: Hex = `0x${'a1'.repeat(32)}`
const keep = (p: Promise<unknown>): void => {
  void p
}

describe(admitAndHook, () => {
  beforeEach(async () => {
    await db().delete(slots)
    await db().delete(entryLog)
  })

  it('logs a MULTI_USE admission without touching slots and calls the hook once', async () => {
    const calls: AdmitInfo[] = []
    const out = await admitAndHook({
      canonical: { holder: HOLDER, usageModel: 1 },
      db: db(),
      now: NOW,
      onAdmit: (info) => {
        calls.push(info)
      },
      path: 'qr',
      uid: UID,
      waitUntil: keep,
    })
    expect(out.admitted).toBe(true)
    expect(await db().select().from(slots)).toHaveLength(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ holder: HOLDER, now: NOW, uid: UID })
  })

  it('burns the slot of a SINGLE_USE right and rejects the second admission', async () => {
    const ctx = {
      canonical: { holder: HOLDER, usageModel: 0 as const },
      db: db(),
      now: NOW,
      onAdmit: () => {
        // hook not under test here
      },
      path: 'signature' as const,
      uid: UID,
      waitUntil: keep,
    }
    const first = await admitAndHook(ctx)
    const second = await admitAndHook(ctx)
    expect(first.admitted).toBe(true)
    expect(second).toStrictEqual({ admitted: false, reason: 'ALREADY_USED' })
    expect(await db().select().from(slots)).toHaveLength(1)
  })

  it('keeps the admission when the hook throws synchronously', async () => {
    const out = await admitAndHook({
      canonical: { holder: HOLDER, usageModel: 1 },
      db: db(),
      now: NOW,
      onAdmit: () => {
        throw new Error('hook exploded')
      },
      path: 'qr',
      uid: UID,
      waitUntil: keep,
    })
    expect(out.admitted).toBe(true)
    const rows = await db().select().from(entryLog)
    expect(rows.map((r) => [r.decision, r.reason])).toStrictEqual([['ADMIT', 'OK']])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && ../../node_modules/.bin/vp test test/admit-and-hook.test.ts`
Expected: FAIL — `admitAndHook` is not exported.

- [ ] **Step 3: Implement `admitAndHook`**

Append to `apps/api/src/verify/admit.ts` (after `noAdmitHook`; add `import type { Entitlement } from '../eas/codecs.ts'` and `import { USAGE_MODEL } from '@fuda/sdk'` at the top):

```ts
export interface AdmitContext {
  db: Db
  uid: Hex
  canonical: Pick<Entitlement, 'holder' | 'usageModel'>
  path: EntryPath
  now: number
  onAdmit: AdmitHook
  waitUntil: (p: Promise<unknown>) => void
}

export type AdmitOutcome = { admitted: true; entryLogId: number } | { admitted: false; reason: 'ALREADY_USED' }

// The spine every entry path shares once §6 (and, for the signature path, the
// challenge and the signature) have said the right may enter: burn the slot of a
// SINGLE_USE right or log a plain ADMIT, then fire the best-effort hook. The
// caller still writes its own REJECT row for ALREADY_USED, because the REJECT's
// response shape differs per path.
export const admitAndHook = async (ctx: AdmitContext): Promise<AdmitOutcome> => {
  let entryLogId: number
  if (ctx.canonical.usageModel === USAGE_MODEL.SINGLE_USE) {
    const admitted = await admitSingleUse(ctx.db, ctx.uid, ctx.path, ctx.now)
    if (!admitted.admitted) {
      return { admitted: false, reason: 'ALREADY_USED' }
    }
    ;({ entryLogId } = admitted)
  } else {
    entryLogId = await logEntry(ctx.db, {
      at: ctx.now,
      decision: 'ADMIT',
      path: ctx.path,
      reason: 'OK',
      uid: ctx.uid,
    })
  }
  try {
    ctx.onAdmit({
      entryLogId,
      holder: ctx.canonical.holder,
      now: ctx.now,
      uid: ctx.uid,
      waitUntil: ctx.waitUntil,
    })
  } catch {
    // Attendance is best-effort (spec §8): a failed side effect never fails an admission
  }
  return { admitted: true, entryLogId }
}
```

- [ ] **Step 4: Switch both routes to it**

In `apps/api/src/routes/verify.ts`, replace everything from `let entryLogId: number` to the closing `return jsonResponse(c, verdictBody(out))` of the POST handler with:

```ts
  const outcome = await admitAndHook({
    canonical: out.canonical,
    db,
    now,
    onAdmit: c.get('onAdmit'),
    path: 'qr',
    uid,
    waitUntil: waitUntilOf(c),
  })
  if (!outcome.admitted) {
    return await reject(outcome.reason)
  }
  return jsonResponse(c, verdictBody(out))
```

and change the import line to `import { admitAndHook, logEntry } from '../verify/admit.ts'` (drop `USAGE_MODEL` from the `@fuda/sdk` import if it is now unused).

In `apps/api/src/routes/verify-signed.ts`, replace everything from `let entryLogId: number` to the final `return jsonResponse(c, { … } satisfies VerifySignedResponse)` with:

```ts
  const outcome = await admitAndHook({
    canonical: out.canonical,
    db,
    now,
    onAdmit: c.get('onAdmit'),
    path: 'signature',
    uid,
    waitUntil: waitUntilOf(c),
  })
  if (!outcome.admitted) {
    return await answer({ decision: 'REJECT', holder, path: 'signature', reason: outcome.reason })
  }
  return jsonResponse(c, {
    decision: 'ADMIT',
    holder,
    path: 'signature',
    reason: 'OK',
  } satisfies VerifySignedResponse)
```

and import `admitAndHook` instead of `admitSingleUse` (keep `logEntry`; drop `USAGE_MODEL` if unused).

- [ ] **Step 5: Run the api suite**

Run: `cd apps/api && ../../node_modules/.bin/vp test`
Expected: PASS — 155 existing + 3 new. In particular `test/verify-post.test.ts`, `test/verify-signed.test.ts` and `test/attendance.test.ts` are untouched and green: the refactor changed no behaviour.

- [ ] **Step 6: Check and commit**

```bash
./node_modules/.bin/vp check
git add apps/api/src/verify/admit.ts apps/api/src/routes/verify.ts apps/api/src/routes/verify-signed.ts apps/api/test/admit-and-hook.test.ts
git commit -m "refactor(api): share the admit-log-hook spine between the QR and signature paths"
```

---

### Task 2: `packages/stealth` — derivation, stealth math, announcements

**Files:**
- Create: `packages/stealth/package.json`, `packages/stealth/tsconfig.json`, `packages/stealth/vite.config.ts`, `packages/stealth/src/index.ts`, `packages/stealth/src/constants.ts`, `packages/stealth/src/derive.ts`, `packages/stealth/src/stealth.ts`, `packages/stealth/src/metadata.ts`
- Test: `packages/stealth/src/derive.test.ts`, `packages/stealth/src/stealth.test.ts`, `packages/stealth/src/metadata.test.ts`

**Interfaces:**
- Produces (`@fuda/stealth`), all byte-exact to spec §7:
  ```ts
  export const SALT: Uint8Array                       // utf8('fuda.sh/stealth/v1')
  export const PRF_EVAL_INPUT = 'fuda.sh/stealth/prf/v1'
  export const SCHEME_ID = 1
  export const METADATA_RE = /^0x[0-9a-fA-F]{66}$/u
  export interface StealthKeys { spendPriv: Uint8Array; viewPriv: Uint8Array; spendPub: Hex; viewPub: Hex; metaAddress: Hex }
  export const deriveMemberSecret = (entropy: Uint8Array) => Uint8Array          // hkdf(sha256, entropy, SALT, utf8('member-secret'), 32)
  export const deriveStealthKeys = (memberSecret: Uint8Array) => StealthKeys
  export const generateStealthAddress = (metaAddress: Hex, ephemeralPriv?: Uint8Array) => { stealthAddress: Hex; ephemeralPublicKey: Hex; viewTag: number }
  export interface AnnouncementRow { stealthAddress: Hex; ephemeralPubKey: Hex; metadata: Hex }
  export const checkAnnouncement = (keys: StealthKeys, a: AnnouncementRow) => boolean
  export const recoverStealthPrivateKey = (keys: StealthKeys, ephemeralPublicKey: Hex) => Hex
  export interface DiscoveredPass { uid: Hex; stealthAddress: Hex; stealthPrivateKey: Hex }
  export const matchAnnouncements = (keys: StealthKeys, rows: AnnouncementRow[]) => DiscoveredPass[]
  export const buildAnnouncementMetadata = (viewTag: number, uid: Hex) => Hex
  export const parseAnnouncementMetadata = (hex: string) => { viewTag: number; uid: Hex } | null
  ```

Decisions (spec §7, pinned here): scalars are `(bytesToBigInt(hkdf32) % (N - 1n)) + 1n`; public keys are 33-byte compressed; the shared secret is `keccak256(ECDH(ephPriv, viewPub).toRawBytes(true))` — the compressed 33-byte point — and the tweak `BigInt(shared) % N` must be non-zero (throw); the view tag is the first byte of `shared`. The EOA-signature derivation source (§7 item 2) is a documented seam: `deriveMemberSecret` takes any 32-byte entropy, and a future `keccak256(personal_sign('fuda.sh/stealth/eoa/v1'))` source plugs into the same function — nothing else is built for it.

- [ ] **Step 1: Scaffold the package**

`packages/stealth/package.json`:

```json
{
  "name": "@fuda/stealth",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vp test"
  },
  "dependencies": {
    "@noble/curves": "1.9.1",
    "@noble/hashes": "1.8.0",
    "viem": "^2.56.3"
  },
  "devDependencies": {
    "vitest": "4.1.11"
  }
}
```

`packages/stealth/tsconfig.json`:

```json
{ "extends": "../../tsconfig.json", "include": ["src", "vite.config.ts"] }
```

`packages/stealth/vite.config.ts`:

```ts
import { defineConfig } from 'vite-plus'

export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'] } })
```

`packages/stealth/src/constants.ts`:

```ts
// Every string here is a wire constant (spec §5, §7): changing one changes
// every meta-address ever derived, so none may be edited in place.
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

export const SALT: Uint8Array = utf8('fuda.sh/stealth/v1')
export const INFO_MEMBER_SECRET: Uint8Array = utf8('member-secret')
export const INFO_SPEND: Uint8Array = utf8('stealth-spend')
export const INFO_VIEW: Uint8Array = utf8('stealth-view')

// The WebAuthn PRF eval input (§5). The PRF output is a function of this input,
// so it must never change.
export const PRF_EVAL_INPUT = 'fuda.sh/stealth/prf/v1'

// ERC-5564 scheme 1: secp256k1 with view tags.
export const SCHEME_ID = 1

// 0x + viewTag (1 byte) + uid (32 bytes)
export const METADATA_RE = /^0x[0-9a-fA-F]{66}$/u
```

Run `pnpm install` from the worktree root (adds the package to the lockfile).

- [ ] **Step 2: Write the failing derivation tests**

`packages/stealth/src/derive.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { deriveMemberSecret, deriveStealthKeys } from './derive.ts'

const ENTROPY = new Uint8Array(32).fill(7)

describe(deriveMemberSecret, () => {
  it('is deterministic and 32 bytes', () => {
    const a = deriveMemberSecret(ENTROPY)
    const b = deriveMemberSecret(new Uint8Array(32).fill(7))
    expect(a).toHaveLength(32)
    expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'))
  })

  it('changes with the entropy', () => {
    const a = deriveMemberSecret(ENTROPY)
    const b = deriveMemberSecret(new Uint8Array(32).fill(8))
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'))
  })
})

describe(deriveStealthKeys, () => {
  it('yields two distinct 33-byte compressed public keys and a 66-byte meta-address', () => {
    const keys = deriveStealthKeys(deriveMemberSecret(ENTROPY))
    expect(keys.spendPub).toMatch(/^0x0[23][0-9a-f]{64}$/u)
    expect(keys.viewPub).toMatch(/^0x0[23][0-9a-f]{64}$/u)
    expect(keys.spendPub).not.toBe(keys.viewPub)
    expect(keys.metaAddress).toBe(`${keys.spendPub}${keys.viewPub.slice(2)}`)
    expect(keys.metaAddress).toHaveLength(2 + 132)
  })

  // Pinned from the first run of this suite: the same passkey + the same eval
  // input must reproduce the same meta-address on every device, forever. If
  // this value ever changes, a derivation constant changed — that is a breaking
  // change for every +Private member, not a test to update.
  it('pins the meta-address for a fixed entropy', () => {
    const keys = deriveStealthKeys(deriveMemberSecret(ENTROPY))
    expect(keys.metaAddress).toBe('0xPINNED_ON_FIRST_RUN')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd packages/stealth && ../../node_modules/.bin/vp test`
Expected: FAIL — `./derive.ts` does not exist.

- [ ] **Step 4: Implement `derive.ts`**

`packages/stealth/src/derive.ts`:

```ts
import { secp256k1 } from '@noble/curves/secp256k1'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import type { Hex } from 'viem'

import { INFO_MEMBER_SECRET, INFO_SPEND, INFO_VIEW, SALT } from './constants.ts'

export interface StealthKeys {
  spendPriv: Uint8Array
  viewPriv: Uint8Array
  spendPub: Hex
  viewPub: Hex
  metaAddress: Hex
}

const N = secp256k1.CURVE.n

// Annotated (not cast): a hex string with the 0x prefix is contextually typed as Hex.
const toHex = (bytes: Uint8Array): Hex => `0x${bytesToHex(bytes)}`

const bytesToBigInt = (bytes: Uint8Array): bigint => BigInt(`0x${bytesToHex(bytes)}`)

// A uniformly random 32-byte string folded into [1, N-1], so the scalar is
// always a valid private key.
const toScalar = (bytes: Uint8Array): bigint => (bytesToBigInt(bytes) % (N - 1n)) + 1n

const scalarToBytes = (k: bigint): Uint8Array => {
  const hex = k.toString(16).padStart(64, '0')
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

// The convergence point of every derivation source (§7): the PRF output today,
// keccak256(personal_sign('fuda.sh/stealth/eoa/v1')) if the EOA source is ever built.
export const deriveMemberSecret = (entropy: Uint8Array): Uint8Array =>
  hkdf(sha256, entropy, SALT, INFO_MEMBER_SECRET, 32)

export const deriveStealthKeys = (memberSecret: Uint8Array): StealthKeys => {
  const spendPriv = scalarToBytes(toScalar(hkdf(sha256, memberSecret, SALT, INFO_SPEND, 32)))
  const viewPriv = scalarToBytes(toScalar(hkdf(sha256, memberSecret, SALT, INFO_VIEW, 32)))
  const spendPub = toHex(secp256k1.getPublicKey(spendPriv, true))
  const viewPub = toHex(secp256k1.getPublicKey(viewPriv, true))
  return { metaAddress: `${spendPub}${viewPub.slice(2)}`, spendPriv, spendPub, viewPriv, viewPub }
}
```

Run the suite once; copy the meta-address the pin test prints in its failure message into the `'0xPINNED_ON_FIRST_RUN'` placeholder, and re-run. Expected: PASS (5 tests). Record the pinned value in your report.

- [ ] **Step 5: Write the failing stealth tests**

`packages/stealth/src/stealth.test.ts`:

```ts
import { verifyMessage } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import { deriveMemberSecret, deriveStealthKeys } from './derive.ts'
import { buildAnnouncementMetadata } from './metadata.ts'
import {
  checkAnnouncement,
  generateStealthAddress,
  matchAnnouncements,
  recoverStealthPrivateKey,
} from './stealth.ts'

const keys = deriveStealthKeys(deriveMemberSecret(new Uint8Array(32).fill(1)))
const other = deriveStealthKeys(deriveMemberSecret(new Uint8Array(32).fill(2)))
const UID = `0x${'ab'.repeat(32)}` as const

describe(generateStealthAddress, () => {
  it('produces a fresh address per ephemeral key', () => {
    const a = generateStealthAddress(keys.metaAddress)
    const b = generateStealthAddress(keys.metaAddress)
    expect(a.stealthAddress).not.toBe(b.stealthAddress)
    expect(a.ephemeralPublicKey).toMatch(/^0x0[23][0-9a-f]{64}$/u)
    expect(a.viewTag).toBeGreaterThanOrEqual(0)
    expect(a.viewTag).toBeLessThanOrEqual(255)
  })

  it('is deterministic for a given ephemeral private key', () => {
    const eph = new Uint8Array(32).fill(9)
    expect(generateStealthAddress(keys.metaAddress, eph)).toStrictEqual(
      generateStealthAddress(keys.metaAddress, eph),
    )
  })

  it('rejects a malformed meta-address', () => {
    expect(() => generateStealthAddress('0x1234')).toThrow(/meta-address/u)
  })
})

describe(recoverStealthPrivateKey, () => {
  // The proof of the whole scheme: the recovered key controls the announced address.
  it('recovers a key that controls the stealth address', async () => {
    const { ephemeralPublicKey, stealthAddress } = generateStealthAddress(keys.metaAddress)
    const key = recoverStealthPrivateKey(keys, ephemeralPublicKey)
    const account = privateKeyToAccount(key)
    expect(account.address).toBe(stealthAddress)
    const signature = await account.signMessage({ message: 'fuda-gate:x:y' })
    await expect(verifyMessage({ address: stealthAddress, message: 'fuda-gate:x:y', signature })).resolves.toBe(true)
  })

  it('recovers a different, non-controlling key for another member', () => {
    const { ephemeralPublicKey, stealthAddress } = generateStealthAddress(keys.metaAddress)
    const wrong = privateKeyToAccount(recoverStealthPrivateKey(other, ephemeralPublicKey))
    expect(wrong.address).not.toBe(stealthAddress)
  })
})

describe(checkAnnouncement, () => {
  it('matches an announcement made to this member and skips a view-tag mismatch', () => {
    const g = generateStealthAddress(keys.metaAddress)
    const row = {
      ephemeralPubKey: g.ephemeralPublicKey,
      metadata: buildAnnouncementMetadata(g.viewTag, UID),
      stealthAddress: g.stealthAddress,
    }
    expect(checkAnnouncement(keys, row)).toBe(true)
    expect(checkAnnouncement(other, row)).toBe(false)
    const wrongTag = { ...row, metadata: buildAnnouncementMetadata((g.viewTag + 1) % 256, UID) }
    expect(checkAnnouncement(keys, wrongTag)).toBe(false)
  })
})

describe(matchAnnouncements, () => {
  it('returns the discovered passes with a controlling key, ignoring the rest', () => {
    const mine = generateStealthAddress(keys.metaAddress)
    const theirs = generateStealthAddress(other.metaAddress)
    const rows = [
      {
        ephemeralPubKey: theirs.ephemeralPublicKey,
        metadata: buildAnnouncementMetadata(theirs.viewTag, `0x${'cd'.repeat(32)}`),
        stealthAddress: theirs.stealthAddress,
      },
      {
        ephemeralPubKey: mine.ephemeralPublicKey,
        metadata: buildAnnouncementMetadata(mine.viewTag, UID),
        stealthAddress: mine.stealthAddress,
      },
      { ephemeralPubKey: mine.ephemeralPublicKey, metadata: '0xdead', stealthAddress: mine.stealthAddress },
    ]
    const found = matchAnnouncements(keys, rows)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ stealthAddress: mine.stealthAddress, uid: UID })
    expect(privateKeyToAccount(found[0]?.stealthPrivateKey ?? '0x').address).toBe(mine.stealthAddress)
  })
})
```

`packages/stealth/src/metadata.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { buildAnnouncementMetadata, parseAnnouncementMetadata } from './metadata.ts'

const UID = `0x${'ab'.repeat(32)}` as const

describe(buildAnnouncementMetadata, () => {
  it('is 0x + tag(2 hex) + uid(64 hex)', () => {
    expect(buildAnnouncementMetadata(0x1f, UID)).toBe(`0x1f${'ab'.repeat(32)}`)
    expect(buildAnnouncementMetadata(5, UID)).toBe(`0x05${'ab'.repeat(32)}`)
  })
})

describe(parseAnnouncementMetadata, () => {
  it('round-trips and rejects anything else', () => {
    expect(parseAnnouncementMetadata(buildAnnouncementMetadata(0xff, UID))).toStrictEqual({ uid: UID, viewTag: 255 })
    expect(parseAnnouncementMetadata(`0x1F${'AB'.repeat(32)}`)).toStrictEqual({ uid: UID, viewTag: 31 })
    expect(parseAnnouncementMetadata('0xdead')).toBeNull()
    expect(parseAnnouncementMetadata(`0x${'ab'.repeat(33)}`)).toBeNull()
  })
})
```

- [ ] **Step 6: Run to verify they fail**

Run: `cd packages/stealth && ../../node_modules/.bin/vp test`
Expected: FAIL — `./stealth.ts` and `./metadata.ts` do not exist.

- [ ] **Step 7: Implement `metadata.ts` and `stealth.ts`**

`packages/stealth/src/metadata.ts`:

```ts
import type { Hex } from 'viem'

import { METADATA_RE } from './constants.ts'

// Annotated (not cast): the template literal is contextually typed as Hex.
export const buildAnnouncementMetadata = (viewTag: number, uid: Hex): Hex =>
  `0x${viewTag.toString(16).padStart(2, '0')}${uid.slice(2).toLowerCase()}`

export const parseAnnouncementMetadata = (hex: string): { viewTag: number; uid: Hex } | null => {
  if (!METADATA_RE.test(hex)) {
    return null
  }
  const body = hex.slice(2).toLowerCase()
  const uid: Hex = `0x${body.slice(2)}`
  return { uid, viewTag: Number.parseInt(body.slice(0, 2), 16) }
}
```

`packages/stealth/src/stealth.ts`:

```ts
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils'
import { publicKeyToAddress } from 'viem/accounts'
import type { Hex } from 'viem'

import type { StealthKeys } from './derive.ts'
import { parseAnnouncementMetadata } from './metadata.ts'

const N = secp256k1.CURVE.n
const META_RE = /^0x[0-9a-fA-F]{132}$/u

const toHex = (bytes: Uint8Array): Hex => `0x${bytesToHex(bytes)}`
const fromHex = (h: Hex): Uint8Array => hexToBytes(h.slice(2))
const bytesToBigInt = (bytes: Uint8Array): bigint => BigInt(`0x${bytesToHex(bytes)}`)

const scalarToBytes = (k: bigint): Uint8Array => hexToBytes(k.toString(16).padStart(64, '0'))

// shared = keccak256(compressed ECDH point); the tweak is that hash as a scalar.
// A zero tweak would make the stealth key equal the spend key — degenerate by
// definition, and astronomically unlikely — so it is refused rather than used.
const sharedSecret = (priv: Uint8Array, pub: Uint8Array): { shared: Uint8Array; tweak: bigint } => {
  const point = secp256k1.getSharedSecret(priv, pub, true)
  const shared = keccak_256(point)
  const tweak = bytesToBigInt(shared) % N
  if (tweak === 0n) {
    throw new Error('degenerate stealth tweak')
  }
  return { shared, tweak }
}

const splitMeta = (metaAddress: Hex): { spendPub: Uint8Array; viewPub: Uint8Array } => {
  if (!META_RE.test(metaAddress)) {
    throw new Error('malformed meta-address')
  }
  const body = metaAddress.slice(2)
  return { spendPub: hexToBytes(body.slice(0, 66)), viewPub: hexToBytes(body.slice(66)) }
}

// The uncompressed 65-byte form viem's publicKeyToAddress expects.
const addressOf = (compressed: Uint8Array): Hex =>
  publicKeyToAddress(toHex(secp256k1.ProjectivePoint.fromHex(compressed).toRawBytes(false)))

// Sender side (the api at /issue): a fresh ephemeral key per right.
export const generateStealthAddress = (
  metaAddress: Hex,
  ephemeralPriv: Uint8Array = randomBytes(32),
): { stealthAddress: Hex; ephemeralPublicKey: Hex; viewTag: number } => {
  const { spendPub, viewPub } = splitMeta(metaAddress)
  const { shared, tweak } = sharedSecret(ephemeralPriv, viewPub)
  const spend = secp256k1.ProjectivePoint.fromHex(spendPub)
  const stealthPub = spend.add(secp256k1.ProjectivePoint.BASE.multiply(tweak)).toRawBytes(true)
  return {
    ephemeralPublicKey: toHex(secp256k1.getPublicKey(ephemeralPriv, true)),
    stealthAddress: addressOf(stealthPub),
    viewTag: shared[0] ?? 0,
  }
}

export interface AnnouncementRow {
  stealthAddress: Hex
  ephemeralPubKey: Hex
  metadata: Hex
}

// Receiver side: the view tag is the cheap prefilter (one byte, rejects 255/256
// of foreign announcements); a match then does the full ECDH and compares the
// derived address.
export const checkAnnouncement = (keys: StealthKeys, a: AnnouncementRow): boolean => {
  const meta = parseAnnouncementMetadata(a.metadata)
  if (meta === null) {
    return false
  }
  let derived: { shared: Uint8Array; tweak: bigint }
  try {
    derived = sharedSecret(keys.viewPriv, fromHex(a.ephemeralPubKey))
  } catch {
    return false
  }
  if ((derived.shared[0] ?? -1) !== meta.viewTag) {
    return false
  }
  const spend = secp256k1.ProjectivePoint.fromHex(fromHex(keys.spendPub))
  const stealthPub = spend.add(secp256k1.ProjectivePoint.BASE.multiply(derived.tweak)).toRawBytes(true)
  return addressOf(stealthPub).toLowerCase() === a.stealthAddress.toLowerCase()
}

export const recoverStealthPrivateKey = (keys: StealthKeys, ephemeralPublicKey: Hex): Hex => {
  const { tweak } = sharedSecret(keys.viewPriv, fromHex(ephemeralPublicKey))
  const key = (bytesToBigInt(keys.spendPriv) + tweak) % N
  return toHex(scalarToBytes(key))
}

export interface DiscoveredPass {
  uid: Hex
  stealthAddress: Hex
  stealthPrivateKey: Hex
}

export const matchAnnouncements = (keys: StealthKeys, rows: AnnouncementRow[]): DiscoveredPass[] =>
  rows.flatMap((row) => {
    if (!checkAnnouncement(keys, row)) {
      return []
    }
    const meta = parseAnnouncementMetadata(row.metadata)
    if (meta === null) {
      return []
    }
    return [
      {
        stealthAddress: row.stealthAddress,
        stealthPrivateKey: recoverStealthPrivateKey(keys, row.ephemeralPubKey),
        uid: meta.uid,
      },
    ]
  })
```

`packages/stealth/src/index.ts`:

```ts
export * from './constants.ts'
export * from './derive.ts'
export * from './metadata.ts'
export * from './stealth.ts'
```

If `@noble/curves` 1.9.1 exposes the point class under a different name than `ProjectivePoint` (check `node_modules/@noble/curves/secp256k1.d.ts`), adapt the three call sites and record it in the report; the math does not change.

- [ ] **Step 8: Run, check, commit**

Run: `cd packages/stealth && ../../node_modules/.bin/vp test` — Expected: PASS (13 tests).
Run: `./node_modules/.bin/vp check` from the root — Expected: green.

```bash
git add packages/stealth pnpm-lock.yaml
git commit -m "feat(stealth): add the +Private crypto core (ERC-5564 scheme 1 with view tags)"
```

---

### Task 3: `ChainClient.announce` and `getAnnouncementLogs`

**Files:**
- Modify: `apps/api/src/eas/abi.ts`, `apps/api/src/chain/client.ts`, `apps/api/src/chain/fake-chain.ts`, `apps/api/src/chain/viem-chain.ts`, `apps/api/src/env.ts` (no new vars — `ANNOUNCER_ADDRESS` / `ANNOUNCER_FROM_BLOCK` already exist)
- Test: `apps/api/src/chain/fake-chain.test.ts` (+ cases), `apps/api/src/chain/viem-chain.test.ts` (+ construction case)

**Interfaces:**
- Produces (`src/chain/client.ts`):
  ```ts
  export interface AnnounceParams { stealthAddress: Hex; ephemeralPubKey: Hex; metadata: Hex }
  export interface AnnouncementLog {
    txHash: Hex; logIndex: number; blockNumber: number; schemeId: number
    stealthAddress: Hex; caller: Hex; ephemeralPubKey: Hex; metadata: Hex
  }
  // ChainClient gains:
  /** ERC-5564 Announcer.announce(1, …); waits for the receipt. Throws NoSignerError / ChainError. */
  announce: (p: AnnounceParams) => Promise<{ txHash: Hex }>
  /** Announcement logs with schemeId == 1 in [fromBlock, toBlock] inclusive, no caller filter. Throws ChainError. */
  getAnnouncementLogs: (fromBlock: number, toBlock: number) => Promise<AnnouncementLog[]>
  /** The chain head, for the sync's upper bound. Throws ChainError. */
  blockNumber: () => Promise<number>
  ```
- `FakeChain`: `readonly announcements: AnnouncementLog[]`; `failAnnounce = false` (independent of `failWrites`, so a test can make attest succeed and announce fail); `head` (block number) starts at 100 and increments per announce; `announce` records `{ schemeId: 1, caller: signer, blockNumber: ++head, logIndex: 0, txHash }`.
- `src/eas/abi.ts` gains `ANNOUNCER_ABI`.

- [ ] **Step 1: Write the failing fake-chain tests**

Append to `apps/api/src/chain/fake-chain.test.ts`:

```ts
describe('FakeChain announcements', () => {
  const p = {
    ephemeralPubKey: `0x02${'11'.repeat(32)}` as const,
    metadata: `0x1f${'ab'.repeat(32)}` as const,
    stealthAddress: `0x${'22'.repeat(20)}` as const,
  }

  it('records an announcement with an increasing block number and the signer as caller', async () => {
    const chain = new FakeChain()
    const a = await chain.announce(p)
    const b = await chain.announce({ ...p, metadata: `0x20${'ab'.repeat(32)}` })
    expect(a.txHash).not.toBe(b.txHash)
    expect(chain.announcements.map((l) => l.blockNumber)).toStrictEqual([101, 102])
    expect(chain.announcements[0]).toMatchObject({ caller: chain.signerAddress(), logIndex: 0, schemeId: 1 })
  })

  it('serves logs by inclusive block range and reports the head', async () => {
    const chain = new FakeChain()
    await chain.announce(p)
    await chain.announce(p)
    await chain.announce(p)
    expect(await chain.blockNumber()).toBe(103)
    expect((await chain.getAnnouncementLogs(102, 103)).map((l) => l.blockNumber)).toStrictEqual([102, 103])
    expect(await chain.getAnnouncementLogs(104, 200)).toStrictEqual([])
  })

  it('fails announce independently of attest', async () => {
    const chain = new FakeChain()
    chain.failAnnounce = true
    await expect(chain.announce(p)).rejects.toBeInstanceOf(ChainError)
    chain.failAnnounce = false
    chain.failReads = true
    await expect(chain.getAnnouncementLogs(0, 10)).rejects.toBeInstanceOf(ChainError)
    await expect(chain.blockNumber()).rejects.toBeInstanceOf(ChainError)
  })

  it('needs a signer to announce', async () => {
    await expect(new FakeChain({ signer: null }).announce(p)).rejects.toBeInstanceOf(NoSignerError)
  })
})
```

(Import `NoSignerError` alongside `ChainError` at the top of the file if it is not already.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && ../../node_modules/.bin/vp test src/chain/fake-chain.test.ts`
Expected: FAIL — `announce` is not a function.

- [ ] **Step 3: Extend the interface and the ABI**

In `apps/api/src/chain/client.ts`, add after `VerifyMessageParams`:

```ts
export interface AnnounceParams {
  stealthAddress: Hex
  ephemeralPubKey: Hex
  metadata: Hex
}

export interface AnnouncementLog {
  txHash: Hex
  logIndex: number
  blockNumber: number
  schemeId: number
  stealthAddress: Hex
  caller: Hex
  ephemeralPubKey: Hex
  metadata: Hex
}
```

and replace the `// Plan 4 extends this …` comment inside `ChainClient` with:

```ts
  /** ERC-5564 Announcer.announce(1, stealthAddress, ephemeralPubKey, metadata); waits for the receipt. Throws NoSignerError / ChainError. */
  announce: (p: AnnounceParams) => Promise<{ txHash: Hex }>
  /** Announcement logs with schemeId == 1 in [fromBlock, toBlock], inclusive, no caller filter. Throws ChainError. */
  getAnnouncementLogs: (fromBlock: number, toBlock: number) => Promise<AnnouncementLog[]>
  /** The chain head. Throws ChainError. */
  blockNumber: () => Promise<number>
```

Append to `apps/api/src/eas/abi.ts`:

```ts
// ERC-5564 Announcer (canonical singleton). Only scheme 1 is used.
export const ANNOUNCER_ABI = parseAbi([
  'function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)',
  'event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)',
])
```

- [ ] **Step 4: Implement the fake**

In `apps/api/src/chain/fake-chain.ts`, import `AnnounceParams`, `AnnouncementLog` from `./client.ts`, add the fields after `failWrites`:

```ts
  failAnnounce = false
  readonly announcements: AnnouncementLog[] = []
  // A small in-memory chain height so the sync has a head to walk towards.
  private head = 100
```

and the methods (after `verifyMessage`):

```ts
  // oxlint-disable-next-line eslint/require-await -- ChainClient's interface is async; this fake resolves synchronously
  async announce(p: AnnounceParams): Promise<{ txHash: Hex }> {
    if (this.signer === null) {
      throw new NoSignerError('SIGNER_PRIVATE_KEY unset')
    }
    if (this.failAnnounce) {
      throw new ChainError('announce reverted')
    }
    this.head += 1
    const txHash = this.nextTx()
    this.announcements.push({
      blockNumber: this.head,
      caller: this.signer,
      ephemeralPubKey: p.ephemeralPubKey,
      logIndex: 0,
      metadata: p.metadata,
      schemeId: 1,
      stealthAddress: checksum(p.stealthAddress),
      txHash,
    })
    return { txHash }
  }

  // oxlint-disable-next-line eslint/require-await -- ChainClient's interface is async; this fake resolves synchronously
  async getAnnouncementLogs(fromBlock: number, toBlock: number): Promise<AnnouncementLog[]> {
    if (this.failReads) {
      throw new ChainError('rpc down')
    }
    return this.announcements.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock)
  }

  // oxlint-disable-next-line eslint/require-await -- ChainClient's interface is async; this fake resolves synchronously
  async blockNumber(): Promise<number> {
    if (this.failReads) {
      throw new ChainError('rpc down')
    }
    return this.head
  }
```

- [ ] **Step 5: Implement the viem client**

In `apps/api/src/chain/viem-chain.ts`, import `ANNOUNCER_ABI` and add `const announcer = toHexAddress(env.ANNOUNCER_ADDRESS)` next to `factory`; add to the returned object:

```ts
    announce: async (p) => {
      if (wallet === null || account === null) {
        throw new NoSignerError('SIGNER_PRIVATE_KEY unset')
      }
      return await wrap(async () => {
        const txHash = await wallet.writeContract({
          abi: ANNOUNCER_ABI,
          account,
          address: announcer,
          args: [1n, p.stealthAddress, p.ephemeralPubKey, p.metadata],
          chain: baseSepolia,
          functionName: 'announce',
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        if (receipt.status !== 'success') {
          throw new ChainError('announce reverted')
        }
        return { txHash }
      })
    },

    blockNumber: async () => await wrap(async () => Number(await publicClient.getBlockNumber())),

    getAnnouncementLogs: async (fromBlock, toBlock) =>
      await wrap(async () => {
        const logs = await publicClient.getContractEvents({
          abi: ANNOUNCER_ABI,
          address: announcer,
          args: { schemeId: 1n },
          eventName: 'Announcement',
          fromBlock: BigInt(fromBlock),
          toBlock: BigInt(toBlock),
        })
        return logs.flatMap((log) => {
          const { blockNumber, logIndex, transactionHash } = log
          if (blockNumber === null || logIndex === null || transactionHash === null) {
            return []
          }
          return [
            {
              blockNumber: Number(blockNumber),
              caller: log.args.caller,
              ephemeralPubKey: log.args.ephemeralPubKey,
              logIndex,
              metadata: log.args.metadata,
              schemeId: Number(log.args.schemeId),
              stealthAddress: log.args.stealthAddress,
              txHash: transactionHash,
            },
          ]
        })
      }),
```

(viem types the indexed args of a filtered `getContractEvents` as possibly `undefined`; if the type check demands it, guard each `log.args.*` the same way as `blockNumber` and skip the log.) Add one construction-time case to `viem-chain.test.ts` asserting `announce`, `getAnnouncementLogs` and `blockNumber` are functions on the built client.

- [ ] **Step 6: Run, check, commit**

Run: `cd apps/api && ../../node_modules/.bin/vp test` — Expected: PASS (all prior + 5 new).
Run: `./node_modules/.bin/vp check` — Expected: green.

```bash
git add apps/api/src/eas/abi.ts apps/api/src/chain
git commit -m "feat(api): announce and read ERC-5564 announcements through ChainClient"
```

---

### Task 4: `/issue` +Private branch, the private pass page, the dash note

**Files:**
- Create: `apps/api/src/issue/issue-private.ts`
- Modify: `apps/api/src/routes/issue.ts`, `apps/api/src/routes/pass.ts`, `apps/api/package.json` (dep `@fuda/stealth`), `apps/dash/src/IssueForm.tsx`
- Test: `apps/api/test/issue-private.test.ts`, `apps/api/test/pass.test.ts` (+1 case)

**Interfaces:**
- Consumes: `generateStealthAddress`, `buildAnnouncementMetadata` (`@fuda/stealth`), `IssueContext`, `IssueConfigError` (`src/issue/issue-right.ts`), `encodeEntitlementV1`, `newest`, `members`, `ChainClient.attest/announce`, `LEVEL_CODE`, `META_ADDRESS_RE`.
- Produces:
  ```ts
  // issue-private.ts
  export const issuePrivate = (ctx: IssueContext, body: IssueRequest & { stealthMetaAddress: string }) => Promise<IssueResponse>
  ```
  Order: generate → attest (`recipient = stealthAddress`, `level = 2`) → announce → insert `members` (`holder: null`, `memberId: body.memberId ?? ''`, `level: 'private'`). Announce failure → `ChainError` (502), uid logged, no row. Insert failure after both → the existing `attestRight` convention (log + `ChainError`).

Decisions: `attestRight` stays the public-holder path (it returns `passUrls`); `issuePrivate` shares the encode/attest code through a small `attestEntitlement(ctx, { holder, level, body })` helper extracted from `attestRight` (returns `{ uid }`), so the two do not duplicate the encoding.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/issue-private.test.ts`:

```ts
import { deriveMemberSecret, deriveStealthKeys, matchAnnouncements } from '@fuda/stealth'
import { env } from 'cloudflare:test'
import { privateKeyToAccount } from 'viem/accounts'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { challenges, entryLog, members, slots } from '../src/db/schema.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, seedRoot } from './fixtures.ts'

const db = () => getDb({ DB: env.DB })
const keys = deriveStealthKeys(deriveMemberSecret(new Uint8Array(32).fill(3)))

const setup = () => {
  const chain = fakeChain()
  const del = seedRoot(chain)
  return { app: appWith({ chain, now: () => NOW }), bindings: configuredEnv(del), chain }
}

const post = async (app: ReturnType<typeof appWith>, bindings: ReturnType<typeof configuredEnv>, path: string, body: unknown) =>
  await app.request(
    path,
    { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'POST' },
    bindings,
  )

describe('POST /issue (+Private)', () => {
  beforeEach(async () => {
    await db().delete(members)
    await db().delete(challenges)
    await db().delete(slots)
    await db().delete(entryLog)
  })

  it('attests to a fresh stealth address, announces it, and answers without passUrls or the address', async () => {
    const { app, bindings, chain } = setup()
    const res = await post(app, bindings, '/issue', { stealthMetaAddress: keys.metaAddress, tier: 2 })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ announced: true, level: 'private' })
    expect(body).not.toHaveProperty('passUrls')
    expect(body).not.toHaveProperty('holder')
    expect(chain.announcements).toHaveLength(1)
  })

  it('stores a row with holder NULL and the representative id', async () => {
    const { app, bindings } = setup()
    const res = await post(app, bindings, '/issue', { memberId: 'alice', stealthMetaAddress: keys.metaAddress })
    const { uid } = await res.json()
    const rows = await db().select().from(members)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ attestationUid: uid, holder: null, level: 'private', memberId: 'alice' })
  })

  it('stores an empty member id when none is given', async () => {
    const { app, bindings } = setup()
    await post(app, bindings, '/issue', { stealthMetaAddress: keys.metaAddress })
    const rows = await db().select().from(members)
    expect(rows[0]?.memberId).toBe('')
  })

  it('is discoverable and enterable by the member with the recovered stealth key', async () => {
    const { app, bindings, chain } = setup()
    const res = await post(app, bindings, '/issue', { stealthMetaAddress: keys.metaAddress, usageModel: 0 })
    const { uid } = await res.json()
    const found = matchAnnouncements(keys, chain.announcements)
    expect(found.map((f) => f.uid)).toStrictEqual([uid])
    const account = privateKeyToAccount(found[0]?.stealthPrivateKey ?? '0x')
    const minted = await (await post(app, bindings, '/challenge', { uid })).json()
    const signature = await account.signMessage({ message: minted.challenge })
    const entered = await post(app, bindings, '/verify-signed', { nonce: minted.nonce, signature, uid })
    await expect(entered.json()).resolves.toMatchObject({ decision: 'ADMIT', holder: account.address, path: 'signature' })
  })

  it('rejects a +Private right presented by QR with LEVEL_REQUIRED', async () => {
    const { app, bindings } = setup()
    const { uid } = await (await post(app, bindings, '/issue', { stealthMetaAddress: keys.metaAddress })).json()
    const res = await post(app, bindings, '/verify', { qr: `fuda:v1:${uid}` })
    await expect(res.json()).resolves.toMatchObject({ decision: 'REJECT', reason: 'LEVEL_REQUIRED' })
  })

  it('answers 400 bad_meta_address for a malformed meta-address', async () => {
    const { app, bindings } = setup()
    const res = await post(app, bindings, '/issue', { stealthMetaAddress: '0x1234' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toStrictEqual({ error: 'bad_meta_address' })
  })

  it('answers 400 bad_input when holder is also supplied', async () => {
    const { app, bindings } = setup()
    const res = await post(app, bindings, '/issue', {
      holder: `0x${'11'.repeat(20)}`,
      stealthMetaAddress: keys.metaAddress,
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toStrictEqual({ error: 'bad_input' })
  })

  it('answers 502 chain_error with no row when the announce fails after the attest', async () => {
    const { app, bindings, chain } = setup()
    chain.failAnnounce = true
    const res = await post(app, bindings, '/issue', { stealthMetaAddress: keys.metaAddress })
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toStrictEqual({ error: 'chain_error' })
    expect(await db().select().from(members)).toHaveLength(0)
    expect(chain.attestations.size).toBe(2)
  })
})
```

(The last assertion counts the root delegation plus the orphaned right: the attest did land.)

Add to `apps/api/test/pass.test.ts`:

```ts
  it('answers 404 for a private row: a +Private right has no pass', async () => {
    const { app, bindings } = setup()
    const uid = `0x${'77'.repeat(32)}` as const
    await db().insert(members).values({
      attestationUid: uid,
      createdAt: NOW,
      holder: null,
      level: 'private',
      memberId: '',
      status: 'active',
      tier: 0,
    })
    const res = await app.request(`/pass/${uid}`, {}, bindings)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toStrictEqual({ error: 'not_found' })
  })
```

(adapt `setup`/`db` to that file's existing helpers).

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && ../../node_modules/.bin/vp test test/issue-private.test.ts test/pass.test.ts`
Expected: FAIL — `/issue` answers `400 bad_input` for the private body; the pass page answers 200 for the private row.

- [ ] **Step 3: Add the dependency and the private branch**

In `apps/api/package.json` add `"@fuda/stealth": "workspace:*"` to `dependencies`; run `pnpm install`.

In `apps/api/src/issue/issue-right.ts`, extract the encode + attest into a helper and reuse it:

```ts
export interface EntitlementParams {
  holder: Hex
  level: 'bearer' | 'signed' | 'private'
  body: IssueRequest
}

// Encode and attest synchronously; the caller decides what to persist.
export const attestEntitlement = async (ctx: IssueContext, p: EntitlementParams): Promise<{ uid: Hex }> => {
  const schema = newest(ctx.sets.entitlement)
  if (schema === null) {
    throw new IssueConfigError('EAS_SCHEMAS.entitlement is empty')
  }
  const data = encodeEntitlementV1({
    holder: p.holder,
    issuer: ctx.issuerAddress,
    level: LEVEL_CODE[p.level],
    metaURI: p.body.metaURI,
    serial: ZERO_UID,
    tier: p.body.tier,
    usageModel: p.body.usageModel,
    validFrom: BigInt(p.body.validFrom),
    validUntil: BigInt(p.body.validUntil),
  })
  return await ctx.chain.attest({
    data,
    expirationTime: 0n,
    recipient: p.holder,
    refUID: ctx.delegationUid,
    revocable: true,
    schema: schema.uid,
  })
}

// The members insert after a successful attest, with the orphan-logging
// contract both public and private rights share.
export const insertMemberRow = async (
  ctx: IssueContext,
  row: { uid: Hex; holder: Hex | null; level: 'bearer' | 'signed' | 'private'; memberId: string; tier: number },
): Promise<void> => {
  try {
    await ctx.db.insert(members).values({
      attestationUid: row.uid,
      createdAt: ctx.now,
      holder: row.holder,
      level: row.level,
      memberId: row.memberId,
      status: 'active',
      tier: row.tier,
    })
  } catch (error) {
    // oxlint-disable-next-line no-console -- the orphaned attestation uid is the only trace of an on-chain right with no member row
    console.error('members insert failed after attest', { error, uid: row.uid })
    throw new ChainError(`members insert failed for attestation ${row.uid}`)
  }
}
```

and rewrite `attestRight` to `const { uid } = await attestEntitlement(ctx, p); await insertMemberRow(ctx, { holder: p.holder, level: p.level, memberId: p.memberId, tier: p.body.tier, uid }); return { holder: p.holder, level: p.level, passUrls: passUrls(ctx.baseUrl, uid), qr: toQr(uid), uid }`.

`apps/api/src/issue/issue-private.ts`:

```ts
import type { IssueRequest, IssueResponse } from '@fuda/sdk'
import { buildAnnouncementMetadata, generateStealthAddress } from '@fuda/stealth'
import type { Hex } from 'viem'

import { ChainError } from '../chain/client.ts'
import { attestEntitlement, insertMemberRow } from './issue-right.ts'
import type { IssueContext } from './issue-right.ts'

// +Private (spec §3, §7): the right goes to a one-time stealth address derived
// from the member's meta-address, then the ERC-5564 announcement lets the member
// discover it client-side. Both chain writes are synchronous and share the
// signer; the member row is written only after both landed. The stealth address
// is never stored (holder NULL) and never returned — discovery is the member's path.
export const issuePrivate = async (
  ctx: IssueContext,
  body: IssueRequest & { stealthMetaAddress: string },
): Promise<IssueResponse> => {
  // META_ADDRESS_RE already validated the shape; the template literal narrows to Hex.
  const metaAddress: Hex = `0x${body.stealthMetaAddress.slice(2)}`
  const { ephemeralPublicKey, stealthAddress, viewTag } = generateStealthAddress(metaAddress)
  const { uid } = await attestEntitlement(ctx, { body, holder: stealthAddress, level: 'private' })
  let announceTx: Hex
  try {
    ;({ txHash: announceTx } = await ctx.chain.announce({
      ephemeralPubKey: ephemeralPublicKey,
      metadata: buildAnnouncementMetadata(viewTag, uid),
      stealthAddress,
    }))
  } catch (error) {
    // The right is on chain but no announcement points at it, so the member
    // can never discover it. Nothing is persisted; the operator retries and
    // revokes this undiscoverable duplicate from the dash.
    // oxlint-disable-next-line no-console -- the uid is the only handle on an attested-but-unannounced right
    console.error('announce failed after attest', { error, uid })
    throw error instanceof ChainError ? error : new ChainError(`announce failed for attestation ${uid}`)
  }
  await insertMemberRow(ctx, { holder: null, level: 'private', memberId: body.memberId ?? '', tier: body.tier, uid })
  return { announceTx, announced: true, level: 'private', uid }
}
```

In `apps/api/src/routes/issue.ts`: import `issuePrivate` and `META_ADDRESS_RE`; the `IssueBody` regex already rejects a malformed `stealthMetaAddress` as `bad_input`, but §3 names `bad_meta_address` for it — so before the `IssueBody` parse, peek: if `body` is an object with a string `stealthMetaAddress` that fails `META_ADDRESS_RE`, answer `400 bad_meta_address` (a small `v.object({ stealthMetaAddress: v.string() })` safe-parse, as `verify-signed.ts` does for `bad_uid`). Then replace the `// The +Private branch lands in plan-4 …` lines with:

```ts
    if (kind === 'private' && parsed.output.stealthMetaAddress !== undefined) {
      return jsonResponse(c, await issuePrivate(ctx, { ...parsed.output, stealthMetaAddress: parsed.output.stealthMetaAddress }))
    }
    return errorResponse(c, 'bad_input', 400)
```

In `apps/api/src/routes/pass.ts`, after the `members` lookup:

```ts
  // A +Private right has no pass (spec §3: the private /issue response carries
  // no passUrls); its holder is a one-time stealth address only the member can
  // recover. The page does not exist for it.
  if (row.level === 'private') {
    return errorResponse(c, 'not_found', 404)
  }
```

In `apps/dash/src/IssueForm.tsx`: delete the `<p class="text-xs opacity-60">+Private submits today, but the api answers 400 bad_input …</p>` paragraph and reword the `Outcome` comment to "The api's error code is shown verbatim so the operator sees exactly what it said."

- [ ] **Step 4: Run, check, commit**

Run: `cd apps/api && ../../node_modules/.bin/vp test` — Expected: PASS (all + 9 new).
Run: `cd apps/dash && ../../node_modules/.bin/vp test && ../../node_modules/.bin/vp build` — Expected: green.
Run: `./node_modules/.bin/vp check` — Expected: green.

```bash
git add apps/api apps/dash/src/IssueForm.tsx pnpm-lock.yaml
git commit -m "feat(api): issue +Private rights to a stealth address and announce them"
```

---

### Task 5: `GET /announcements` — lazy sync behind the per-IP budget

**Files:**
- Create: `apps/api/src/announcements/sync.ts`, `apps/api/src/routes/announcements.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/announcements.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // announcements/sync.ts
  export const CHUNK_BLOCKS = 1000
  export const SYNC_CHUNKS_PER_REQUEST = 5
  export const SYNC_KEY = 'announcements'
  export interface SyncDeps { chain: ChainClient; db: Db; fromBlock: number }   // fromBlock = ANNOUNCER_FROM_BLOCK
  export type SyncResult = { ok: true; syncedTo: number } | { ok: false; syncedTo: number | null }   // ok:false = RPC failed; syncedTo = the cursor if any
  export const syncAnnouncements = (deps: SyncDeps) => Promise<SyncResult>
  // routes/announcements.ts
  export const announcementsRoutes: Hono<AppEnv>   // GET /announcements?fromBlock=N, rateLimit({ budget: DEFAULT_BUDGET })
  ```

Algorithm: `cursor = sync_state[announcements] ?? fromBlock - 1`; `head = chain.blockNumber()`; up to `SYNC_CHUNKS_PER_REQUEST` times while `cursor < head`: `to = min(cursor + CHUNK_BLOCKS, head)`, `logs = getAnnouncementLogs(cursor + 1, to)`, `INSERT OR IGNORE` each row, then `UPSERT sync_state = to`, `cursor = to`. Any `ChainError` stops the loop and returns `{ ok: false, syncedTo: cursorOrNull }`. The route: sync; if `!ok` and the cache is empty → `502 rpc_unavailable`; otherwise select rows with `block_number >= fromBlock` ordered by block, log index ascending, limit 1000, and answer `{ announcements, syncedTo }` (`syncedTo` = the cursor, stale or not). Rows serialize as `{ txHash, logIndex, blockNumber, schemeId, stealthAddress, caller, ephemeralPubKey, metadata }`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/announcements.test.ts`:

```ts
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { syncAnnouncements } from '../src/announcements/sync.ts'
import { getDb } from '../src/db/client.ts'
import { announcements, rateLimits, syncState } from '../src/db/schema.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, seedRoot } from './fixtures.ts'

const db = () => getDb({ DB: env.DB })
const IP = { 'CF-Connecting-IP': '203.0.113.9' }

const announced = async (chain: ReturnType<typeof fakeChain>, n: number) => {
  for (let i = 0; i < n; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- announcements must land in block order
    await chain.announce({
      ephemeralPubKey: `0x02${'11'.repeat(32)}`,
      metadata: `0x${i.toString(16).padStart(2, '0')}${'ab'.repeat(32)}`,
      stealthAddress: `0x${'22'.repeat(20)}`,
    })
  }
}

const setup = () => {
  const chain = fakeChain()
  const del = seedRoot(chain)
  return { app: appWith({ chain, now: () => NOW }), bindings: configuredEnv(del, { ANNOUNCER_FROM_BLOCK: '100' }), chain }
}

describe(syncAnnouncements, () => {
  beforeEach(async () => {
    await db().delete(announcements)
    await db().delete(syncState)
  })

  it('walks the chain in chunks and persists the cursor after each', async () => {
    const chain = fakeChain()
    await announced(chain, 3)
    const ranges: [number, number][] = []
    const spy = chain.getAnnouncementLogs.bind(chain)
    chain.getAnnouncementLogs = async (from, to) => {
      ranges.push([from, to])
      return await spy(from, to)
    }
    const out = await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    expect(out).toStrictEqual({ ok: true, syncedTo: 103 })
    expect(ranges).toStrictEqual([[100, 103]])
    expect(await db().select().from(announcements)).toHaveLength(3)
    expect((await db().select().from(syncState))[0]).toStrictEqual({ key: 'announcements', value: 103 })
  })

  it('caps the chunks per request and continues from the cursor next time', async () => {
    const chain = fakeChain()
    // 5 chunks × 1000 blocks from 100 reaches 5100; the fake's head is well past that.
    for (let i = 0; i < 6000; i += 1) {
      chain.announcements.push({
        blockNumber: 101 + i,
        caller: chain.signerAddress() ?? `0x${'00'.repeat(20)}`,
        ephemeralPubKey: '0x02',
        logIndex: 0,
        metadata: '0x00',
        schemeId: 1,
        stealthAddress: `0x${'22'.repeat(20)}`,
        txHash: `0x${i.toString(16).padStart(64, '0')}`,
      })
    }
    chain.blockNumber = async () => await Promise.resolve(6100)
    const first = await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    expect(first).toStrictEqual({ ok: true, syncedTo: 5100 })
    const second = await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    expect(second).toStrictEqual({ ok: true, syncedTo: 6100 })
    expect(await db().select().from(announcements)).toHaveLength(6000)
  })

  it('reports the last good cursor when the RPC fails mid-way', async () => {
    const chain = fakeChain()
    await announced(chain, 1)
    const first = await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    chain.failReads = true
    const second = await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    expect(first.ok).toBe(true)
    expect(second).toStrictEqual({ ok: false, syncedTo: 101 })
  })

  it('ignores a log it already holds', async () => {
    const chain = fakeChain()
    await announced(chain, 2)
    await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    await db().delete(syncState)
    await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    expect(await db().select().from(announcements)).toHaveLength(2)
  })
})

describe('GET /announcements', () => {
  beforeEach(async () => {
    await db().delete(announcements)
    await db().delete(syncState)
    await db().delete(rateLimits)
  })

  it('serves synced rows in block order with the cursor', async () => {
    const { app, bindings, chain } = setup()
    await announced(chain, 2)
    const res = await app.request('/announcements', { headers: IP }, bindings)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.syncedTo).toBe(102)
    expect(body.announcements.map((a: { blockNumber: number }) => a.blockNumber)).toStrictEqual([101, 102])
    expect(body.announcements[0]).toMatchObject({ logIndex: 0, schemeId: 1 })
  })

  it('filters by fromBlock', async () => {
    const { app, bindings, chain } = setup()
    await announced(chain, 3)
    const res = await app.request('/announcements?fromBlock=103', { headers: IP }, bindings)
    const body = await res.json()
    expect(body.announcements.map((a: { blockNumber: number }) => a.blockNumber)).toStrictEqual([103])
  })

  it('answers 502 rpc_unavailable when the RPC is down and nothing is cached', async () => {
    const { app, bindings, chain } = setup()
    chain.failReads = true
    const res = await app.request('/announcements', { headers: IP }, bindings)
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toStrictEqual({ error: 'rpc_unavailable' })
  })

  it('serves the stale cache when the RPC is down but something is cached', async () => {
    const { app, bindings, chain } = setup()
    await announced(chain, 1)
    await app.request('/announcements', { headers: IP }, bindings)
    chain.failReads = true
    const res = await app.request('/announcements', { headers: IP }, bindings)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ syncedTo: 101 })
  })

  it('requires a client ip and answers 400 without one', async () => {
    const { app, bindings } = setup()
    const res = await app.request('/announcements', {}, bindings)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toStrictEqual({ error: 'client_ip_required' })
  })

  it('is budgeted at 120 per hour per ip, while POST /verify is not', async () => {
    const { app, bindings } = setup()
    await db().insert(rateLimits).values({ count: 120, ip: '203.0.113.9', windowStart: Math.floor(NOW / 3600) * 3600 })
    const limited = await app.request('/announcements', { headers: IP }, bindings)
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toStrictEqual({ error: 'rate_limited' })
    const verify = await app.request(
      '/verify',
      { body: JSON.stringify({ qr: `fuda:v1:0x${'ab'.repeat(32)}` }), headers: { ...IP, 'content-type': 'application/json' }, method: 'POST' },
      bindings,
    )
    expect(verify.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && ../../node_modules/.bin/vp test test/announcements.test.ts`
Expected: FAIL — module not found / route 404.

- [ ] **Step 3: Implement the sync and the route**

`apps/api/src/announcements/sync.ts`:

```ts
import { eq } from 'drizzle-orm'

import { ChainError } from '../chain/client.ts'
import type { ChainClient } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { announcements, syncState } from '../db/schema.ts'

// Public Base Sepolia RPCs cap eth_getLogs ranges (spec §3).
export const CHUNK_BLOCKS = 1000
// A cold deployment warms up across a few requests instead of spending one
// request's whole CPU budget on a deep history.
export const SYNC_CHUNKS_PER_REQUEST = 5
export const SYNC_KEY = 'announcements'

export interface SyncDeps {
  chain: ChainClient
  db: Db
  fromBlock: number
}

export type SyncResult = { ok: true; syncedTo: number } | { ok: false; syncedTo: number | null }

const readCursor = async (db: Db): Promise<number | null> => {
  const row = await db.select({ value: syncState.value }).from(syncState).where(eq(syncState.key, SYNC_KEY)).get()
  return row?.value ?? null
}

// Lazily pulls scheme-1 announcements into D1, ≤1000 blocks at a time, and
// persists the cursor after every chunk so partial progress survives an RPC
// failure or the per-request cap. Logs are keyed by (tx_hash, log_index), so a
// re-scan of an already-held range is a no-op.
export const syncAnnouncements = async (deps: SyncDeps): Promise<SyncResult> => {
  let cursor = (await readCursor(deps.db)) ?? deps.fromBlock - 1
  const started = cursor >= deps.fromBlock ? cursor : null
  try {
    const head = await deps.chain.blockNumber()
    for (let i = 0; i < SYNC_CHUNKS_PER_REQUEST && cursor < head; i += 1) {
      const to = Math.min(cursor + CHUNK_BLOCKS, head)
      // oxlint-disable-next-line no-await-in-loop -- chunks are applied in block order; the cursor must not skip ahead
      const logs = await deps.chain.getAnnouncementLogs(cursor + 1, to)
      if (logs.length > 0) {
        // oxlint-disable-next-line no-await-in-loop -- see above
        await deps.db.insert(announcements).values(logs).onConflictDoNothing()
      }
      // oxlint-disable-next-line no-await-in-loop -- see above
      await deps.db
        .insert(syncState)
        .values({ key: SYNC_KEY, value: to })
        .onConflictDoUpdate({ set: { value: to }, target: syncState.key })
      cursor = to
    }
    return { ok: true, syncedTo: cursor }
  } catch (error) {
    if (error instanceof ChainError) {
      return { ok: false, syncedTo: cursor >= deps.fromBlock ? cursor : started }
    }
    throw error
  }
}
```

`apps/api/src/routes/announcements.ts`:

```ts
import { asc, gte } from 'drizzle-orm'
import { Hono } from 'hono'

import { syncAnnouncements } from '../announcements/sync.ts'
import { announcements } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { DEFAULT_BUDGET, rateLimit } from '../middleware/rate-limit.ts'

export const ANNOUNCEMENTS_LIMIT = 1000

export const announcementsRoutes = new Hono<AppEnv>()

// The cached ERC-5564 log served to member apps (spec §3): the api never learns
// which rows are the caller's — matching happens client-side with the viewing
// key. The only budgeted route in the MVP: it is open, unauthenticated, and each
// call may cost RPC reads.
announcementsRoutes.get('/announcements', rateLimit({ budget: DEFAULT_BUDGET }), async (c) => {
  const floor = Number.parseInt(c.env.ANNOUNCER_FROM_BLOCK, 10)
  const fromParam = Number.parseInt(c.req.query('fromBlock') ?? '0', 10)
  const fromBlock = Number.isFinite(fromParam) && fromParam >= 0 ? fromParam : 0
  const db = c.get('db')
  const synced = await syncAnnouncements({ chain: c.get('chain'), db, fromBlock: Number.isFinite(floor) ? floor : 0 })
  const rows = await db
    .select()
    .from(announcements)
    .where(gte(announcements.blockNumber, fromBlock))
    .orderBy(asc(announcements.blockNumber), asc(announcements.logIndex))
    .limit(ANNOUNCEMENTS_LIMIT)
  if (!synced.ok && synced.syncedTo === null) {
    return errorResponse(c, 'rpc_unavailable', 502)
  }
  c.header('cache-control', 'no-store')
  return jsonResponse(c, { announcements: rows, syncedTo: synced.syncedTo })
})
```

Mount in `apps/api/src/app.ts`: `app.route('/', announcementsRoutes)` after `passRoutes`.

- [ ] **Step 4: Run, check, commit**

Run: `cd apps/api && ../../node_modules/.bin/vp test` — Expected: PASS (all + 10 new).
Run: `./node_modules/.bin/vp check` — Expected: green.

```bash
git add apps/api/src/announcements apps/api/src/routes/announcements.ts apps/api/src/app.ts apps/api/test/announcements.test.ts
git commit -m "feat(api): serve cached ERC-5564 announcements behind the per-IP budget"
```

---

### Task 6: `apps/app` — derive, discover, enter (+Private screens)

**Files:**
- Create: `apps/app/src/passkey.ts`, `apps/app/src/private-member.ts`, `apps/app/src/private-member.test.ts`, `apps/app/src/PrivateScreen.tsx`
- Modify: `apps/app/src/config.ts`, `apps/app/src/vite-env.d.ts`, `apps/app/src/api.ts`, `apps/app/src/route.ts`, `apps/app/src/route.test.ts`, `apps/app/src/App.tsx`, `apps/app/src/Landing.tsx`, `apps/app/package.json` (dep `@fuda/stealth`)

**Interfaces:**
- Produces (pure, tested):
  ```ts
  // private-member.ts
  export const keysFromPrf = (prfOutput: Uint8Array) => StealthKeys                 // deriveStealthKeys(deriveMemberSecret(prfOutput))
  export interface AnnouncementDto { txHash: Hex; logIndex: number; blockNumber: number; schemeId: number; stealthAddress: Hex; caller: Hex; ephemeralPubKey: Hex; metadata: Hex }
  export const discover = (keys: StealthKeys, rows: AnnouncementDto[]) => DiscoveredPass[]
  export const stealthSigner = (pass: DiscoveredPass) => (message: string) => Promise<Hex>   // privateKeyToAccount(pass.stealthPrivateKey).signMessage
  // passkey.ts (browser only, manual)
  export type PrfResult = { ok: true; output: Uint8Array } | { ok: false; reason: 'unsupported' | 'cancelled' | 'error'; detail: string }
  export const createPasskey = (rpId: string, userName: string) => Promise<PrfResult>     // create with prf: {}, then get with the pinned eval input
  export const loadPasskey = (rpId: string) => Promise<PrfResult>                        // get with the pinned eval input
  // route.ts: Route gains 'private'; routeFor treats '/private' like '/signed' (app origin only)
  ```

Decisions: the ceremony always ends in a `get` with `prf.eval.first = utf8(PRF_EVAL_INPUT)` because some platforms report PRF support only at `get` time; the `create` step passes `extensions: { prf: {} }`, `residentKey: 'required'`, `userVerification: 'required'`, `rp: { id: RP_ID, name: 'fuda' }`. A missing `prf.results.first` on `get` is `unsupported`. The Discover screen fetches `/announcements` from `fromBlock = 0` and runs `discover` locally; the Enter screen reuses `enterSigned` with `sign = stealthSigner(pass)`.

- [ ] **Step 1: Write the failing pure tests**

`apps/app/src/private-member.test.ts`:

```ts
import { challengeMessage } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'
import { buildAnnouncementMetadata, generateStealthAddress } from '@fuda/stealth'
import { verifyMessage } from 'viem'
import { describe, expect, it } from 'vitest'

import { discover, keysFromPrf, stealthSigner } from './private-member.ts'

const PRF = new Uint8Array(32).fill(42)
const UID: Hex = `0x${'ab'.repeat(32)}`
const NONCE: Hex = `0x${'cd'.repeat(16)}`

describe(keysFromPrf, () => {
  it('is deterministic per PRF output and yields a 66-byte meta-address', () => {
    const a = keysFromPrf(PRF)
    const b = keysFromPrf(new Uint8Array(32).fill(42))
    expect(a.metaAddress).toBe(b.metaAddress)
    expect(a.metaAddress).toMatch(/^0x[0-9a-f]{132}$/u)
  })
})

describe(discover, () => {
  it('finds the passes announced to this member and ignores the rest', () => {
    const keys = keysFromPrf(PRF)
    const stranger = keysFromPrf(new Uint8Array(32).fill(1))
    const mine = generateStealthAddress(keys.metaAddress)
    const theirs = generateStealthAddress(stranger.metaAddress)
    const row = (g: typeof mine, uid: Hex, block: number) => ({
      blockNumber: block,
      caller: `0x${'00'.repeat(20)}` as Hex,
      ephemeralPubKey: g.ephemeralPublicKey,
      logIndex: 0,
      metadata: buildAnnouncementMetadata(g.viewTag, uid),
      schemeId: 1,
      stealthAddress: g.stealthAddress,
      txHash: `0x${block.toString(16).padStart(64, '0')}` as Hex,
    })
    const found = discover(keys, [row(theirs, `0x${'11'.repeat(32)}`, 1), row(mine, UID, 2)])
    expect(found.map((f) => f.uid)).toStrictEqual([UID])
  })
})

describe(stealthSigner, () => {
  // The whole member-side path: derive → (sender) generate → recover → sign →
  // the api's pure check against the stealth address.
  it('signs the challenge with a key the stealth address controls', async () => {
    const keys = keysFromPrf(PRF)
    const g = generateStealthAddress(keys.metaAddress)
    const [pass] = discover(keys, [
      {
        blockNumber: 1,
        caller: `0x${'00'.repeat(20)}`,
        ephemeralPubKey: g.ephemeralPublicKey,
        logIndex: 0,
        metadata: buildAnnouncementMetadata(g.viewTag, UID),
        schemeId: 1,
        stealthAddress: g.stealthAddress,
        txHash: `0x${'01'.repeat(32)}`,
      },
    ])
    expect(pass).toBeDefined()
    const message = challengeMessage(UID, NONCE)
    const signature = await stealthSigner(pass ?? { stealthAddress: g.stealthAddress, stealthPrivateKey: '0x', uid: UID })(message)
    await expect(verifyMessage({ address: g.stealthAddress, message, signature })).resolves.toBe(true)
  })
})
```

Add to `apps/app/src/route.test.ts`: `/private` on the app origin → `'private'`; `/private` on the apex → `{ redirect: 'https://app.fuda.sh/private' }`; `/private/` → `'private'` on the app origin.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/app && ../../node_modules/.bin/vp test` — Expected: FAIL (module not found; route cases fail).

- [ ] **Step 3: Implement the pure modules, config and routing**

`apps/app/package.json` `dependencies`: add `"@fuda/stealth": "workspace:*"`; `pnpm install`.

`apps/app/src/config.ts`, append:

```ts
// The WebAuthn relying-party id for every fuda passkey ceremony (spec §5):
// `fuda.sh` in production so app.fuda.sh and the B1 landing share one passkey.
// Browsers reject an rp.id that is not a registrable suffix of the page's host,
// so local dev must set VITE_RP_ID=localhost.
export const RP_ID: string = import.meta.env.VITE_RP_ID ?? 'fuda.sh'
```

`apps/app/src/vite-env.d.ts`: add `readonly VITE_RP_ID?: string`.

`apps/app/src/private-member.ts`:

```ts
import type { Hex } from '@fuda/sdk'
import { deriveMemberSecret, deriveStealthKeys, matchAnnouncements } from '@fuda/stealth'
import type { DiscoveredPass, StealthKeys } from '@fuda/stealth'
import { privateKeyToAccount } from 'viem/accounts'

// One passkey + one eval input → one member secret → the same meta-address on
// every device that holds the passkey (spec §7).
export const keysFromPrf = (prfOutput: Uint8Array): StealthKeys => deriveStealthKeys(deriveMemberSecret(prfOutput))

// The row shape GET /announcements serves.
export interface AnnouncementDto {
  txHash: Hex
  logIndex: number
  blockNumber: number
  schemeId: number
  stealthAddress: Hex
  caller: Hex
  ephemeralPubKey: Hex
  metadata: Hex
}

// Entirely client-side: the api only served candidates.
export const discover = (keys: StealthKeys, rows: AnnouncementDto[]): DiscoveredPass[] =>
  matchAnnouncements(keys, rows)

// The stealth key is derived, not held by a wallet: it signs the same challenge
// a Signed member's wallet would, so enterSigned needs no second flow.
export const stealthSigner =
  (pass: DiscoveredPass) =>
  async (message: string): Promise<Hex> =>
    await privateKeyToAccount(pass.stealthPrivateKey).signMessage({ message })
```

`apps/app/src/passkey.ts`:

```ts
import { PRF_EVAL_INPUT } from '@fuda/stealth'

export type PrfResult =
  | { ok: true; output: Uint8Array }
  | { ok: false; reason: 'unsupported' | 'cancelled' | 'error'; detail: string }

const EVAL_INPUT = new TextEncoder().encode(PRF_EVAL_INPUT)

// lib.dom does not yet type the PRF extension results; the shape is the spec's.
interface PrfExtensionResults {
  prf?: { results?: { first?: ArrayBuffer } }
}

const prfOf = (credential: Credential | null): PrfResult => {
  if (!(credential instanceof PublicKeyCredential)) {
    return { detail: 'no credential', ok: false, reason: 'error' }
  }
  // SAFETY: getClientExtensionResults() is typed as an empty record by lib.dom; the PRF
  // extension's result shape is fixed by the WebAuthn spec and is only read, never trusted blindly.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- lib.dom lacks the PRF extension types
  const ext = credential.getClientExtensionResults() as PrfExtensionResults
  const first = ext.prf?.results?.first
  if (first === undefined) {
    return { detail: 'this passkey or platform does not support the PRF extension', ok: false, reason: 'unsupported' }
  }
  return { ok: true, output: new Uint8Array(first) }
}

const failure = (error: unknown): PrfResult => {
  const detail = error instanceof Error ? error.message : 'passkey ceremony failed'
  const cancelled = error instanceof DOMException && error.name === 'NotAllowedError'
  return { detail, ok: false, reason: cancelled ? 'cancelled' : 'error' }
}

// Some platforms only report PRF support at get() time, so every path ends in a
// get() with the pinned eval input: the PRF output is a function of that input
// and must never change.
export const loadPasskey = async (rpId: string): Promise<PrfResult> => {
  try {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        extensions: { prf: { eval: { first: EVAL_INPUT } } },
        rpId,
        userVerification: 'required',
      },
    })
    return prfOf(credential)
  } catch (error) {
    return failure(error)
  }
}

export const createPasskey = async (rpId: string, userName: string): Promise<PrfResult> => {
  try {
    await navigator.credentials.create({
      publicKey: {
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        extensions: { prf: {} },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        rp: { id: rpId, name: 'fuda' },
        user: { displayName: userName, id: crypto.getRandomValues(new Uint8Array(16)), name: userName },
      },
    })
  } catch (error) {
    return failure(error)
  }
  return await loadPasskey(rpId)
}
```

(If lib.dom in the pinned TypeScript lacks `extensions.prf` on the request types, type the `publicKey` option objects through a local `PublicKeyCredentialCreationOptions & { extensions: { prf: unknown } }`-style interface with a `SAFETY:` note; record what was needed.)

`apps/app/src/api.ts`, append:

```ts
import type { AnnouncementDto } from './private-member.ts'

export interface AnnouncementsResponse {
  announcements: AnnouncementDto[]
  syncedTo: number | null
}

export const announcements = async (fromBlock = 0): Promise<Result<AnnouncementsResponse>> =>
  await apiFetch<AnnouncementsResponse>(API_BASE_URL, `/announcements?fromBlock=${fromBlock}`)
```

`apps/app/src/route.ts`: `export type Route = 'landing' | 'signed' | 'private' | { redirect: string }`; generalize the app-origin-only paths:

```ts
const APP_ONLY = new Set(['/signed', '/private'])

export const routeFor = (origin: string, pathname: string, appOrigin: string = APP_ORIGIN): Route => {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname
  const app = originOf(appOrigin)
  if (!APP_ONLY.has(path) || app === null) {
    return 'landing'
  }
  if (originOf(origin) !== app) {
    return { redirect: `${app}${path}` }
  }
  return path === '/signed' ? 'signed' : 'private'
}
```

`apps/app/src/App.tsx`: render `<PrivateScreen />` for `'private'`. `apps/app/src/Landing.tsx` `LINKS`: add `{ href: \`${APP_ORIGIN}/private\`, label: '+Private — passkey, meta-address, discover and enter' }`.

- [ ] **Step 4: The screen**

`apps/app/src/PrivateScreen.tsx`:

```tsx
/** @jsxImportSource hono/jsx/dom */
import type { Hex } from '@fuda/sdk'
import type { DiscoveredPass, StealthKeys } from '@fuda/stealth'
import { short } from '@fuda/web-kit'
import { useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { announcements, challenge, verifySigned } from './api.ts'
import { RP_ID } from './config.ts'
import { createPasskey, loadPasskey } from './passkey.ts'
import type { PrfResult } from './passkey.ts'
import { discover, keysFromPrf, stealthSigner } from './private-member.ts'
import { displayOf, enterSigned } from './signed-gate.ts'
import type { SignedDisplay } from './signed-gate.ts'
import { Verdict } from './Verdict.tsx'

// Member-facing copy for the three ways a PRF ceremony ends without a secret.
const PRF_COPY = {
  cancelled: 'The passkey prompt was dismissed. Try again when you are ready.',
  error: 'The passkey ceremony failed.',
  unsupported:
    'This passkey or device cannot derive a +Private key (no PRF support). Try a platform passkey on a recent phone or browser.',
} as const

// Spec §10.2: (a) passkey → meta-address, (b) discover, (c) enter with the
// recovered stealth key through the same challenge flow as Signed.
export const PrivateScreen = (): JSX.Element => {
  const [keys, setKeys] = useState<StealthKeys | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [passes, setPasses] = useState<DiscoveredPass[] | null>(null)
  const [state, setState] = useState<SignedDisplay | null>(null)
  const [busy, setBusy] = useState(false)

  const settle = (result: PrfResult): void => {
    if (result.ok) {
      setKeys(keysFromPrf(result.output))
      setError(null)
    } else {
      setError(`${PRF_COPY[result.reason]} (${result.detail})`)
    }
  }

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const find = async (k: StealthKeys): Promise<void> => {
    const res = await announcements(0)
    if (!res.ok) {
      setError(res.network ? 'Could not reach the api — try again.' : res.error)
      return
    }
    setPasses(discover(k, res.body.announcements))
  }

  const enter = async (pass: DiscoveredPass): Promise<void> => {
    const outcome = await enterSigned({ challenge, sign: stealthSigner(pass), verify: verifySigned }, pass.uid)
    setState(displayOf(outcome))
  }

  if (state !== null) {
    return (
      <Verdict
        state={state}
        onDone={() => {
          setState(null)
        }}
      />
    )
  }
  return (
    <main class="flex min-h-screen flex-col items-center gap-4 p-4">
      <h1 class="text-xl font-bold">+Private</h1>
      <p class="text-center text-sm opacity-70">
        Your passkey derives a meta-address. Give it to the Venue; your pass lands on a one-time address only
        you can find.
      </p>
      {keys === null ? (
        <div class="flex gap-2">
          <button type="button" class="btn btn-primary" disabled={busy} onClick={() => void run(async () => settle(await createPasskey(RP_ID, 'fuda member')))}>
            Create passkey
          </button>
          <button type="button" class="btn" disabled={busy} onClick={() => void run(async () => settle(await loadPasskey(RP_ID)))}>
            Use existing passkey
          </button>
        </div>
      ) : (
        <MetaAddress keys={keys} onDiscover={() => void run(async () => await find(keys))} busy={busy} />
      )}
      {error === null ? null : <div class="alert alert-error text-sm">{error}</div>}
      {passes === null ? null : (
        <ul class="flex w-full max-w-md flex-col gap-2">
          {passes.length === 0 ? <li class="text-sm opacity-70">No pass announced to this meta-address yet.</li> : null}
          {passes.map((pass) => (
            <li class="card bg-base-200" key={pass.uid}>
              <div class="card-body gap-2">
                <div class="font-mono text-xs break-all">{pass.uid}</div>
                <div class="text-xs opacity-70">stealth address {short(pass.stealthAddress)}</div>
                <button type="button" class="btn btn-primary btn-sm" disabled={busy} onClick={() => void run(async () => await enter(pass))}>
                  Enter
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

const MetaAddress = ({ keys, onDiscover, busy }: { keys: StealthKeys; onDiscover: () => void; busy: boolean }): JSX.Element => {
  const [copied, setCopied] = useState(false)
  const copy = async (value: Hex): Promise<void> => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
  }
  return (
    <div class="flex w-full max-w-md flex-col gap-2">
      <div class="text-sm font-bold">Your meta-address</div>
      <div class="font-mono text-xs break-all">{keys.metaAddress}</div>
      <div class="flex gap-2">
        <button type="button" class="btn btn-sm" onClick={() => void copy(keys.metaAddress)}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" class="btn btn-sm btn-primary" disabled={busy} onClick={onDiscover}>
          Discover my passes
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run, build, check, commit**

Run: `cd apps/app && ../../node_modules/.bin/vp test && ../../node_modules/.bin/vp build` — Expected: PASS (26 + 6 new; `@fuda/stealth` + noble land in a chunk reached from `/private`; report the size).
Run: `./node_modules/.bin/vp check` — Expected: green.

```bash
git add apps/app pnpm-lock.yaml
git commit -m "feat(app): derive a meta-address from a passkey, discover +Private passes and enter with the stealth key"
```

---

### Task 7: Docs touch-ups

**Files:**
- Modify: `apps/api/README.md` (a "+Private" section: the `/issue` branch, the announce-after-attest ruling, `GET /announcements` with the chunk cap and the budget, the private pass page 404; endpoints table rows; error codes `bad_meta_address`, `rpc_unavailable`, `rate_limited`, `client_ip_required`), `README.md` (workspace map: `packages/stealth`; `/private` in the app row; `VITE_RP_ID=localhost` for local dev), `AGENTS.md` only if a toolchain fact changed.

- [ ] **Step 1: Edit the docs** — every command, path, port and env var checked against the repo.
- [ ] **Step 2: Verify** — `./node_modules/.bin/vp check` green; root `pnpm test` green (report the per-package counts).
- [ ] **Step 3: Commit**

```bash
git add README.md apps/api/README.md AGENTS.md
git commit -m "docs: describe the +Private issuance, announcements and the member app's private screens"
```

---

## Self-review

**Spec coverage:**

| Spec item | Task |
| --- | --- |
| §3 `/issue` +Private: derivation rule, `bad_meta_address`, `level 2`, attest to the stealth address, announce, `members` row (`holder NULL`, `member_id`), response without `passUrls`/address | 4 |
| §3 `GET /announcements`: all scheme-1 logs, no caller filter, ≤1000-block chunks, cursor per chunk, `ANNOUNCER_FROM_BLOCK` floor, `{ announcements, syncedTo }`, ≤1000 rows ascending, `502 rpc_unavailable` on empty cache | 5 |
| §3 per-IP budget: 120/h on `/announcements` only, `429`, `400 client_ip_required`; §12 "429 on `/announcements` and NOT on `/verify`" | 5 |
| §5 metadata layout, HKDF salt, PRF eval input, `rp.id` | 2, 6 |
| §7 `@fuda/stealth`: every function, scalar mapping, shared secret, view tag, degenerate tweak; PRF source built, EOA source seam-only | 2 |
| §8 announcements as the second exhaust stream | 4 (emit), 5 (serve) |
| §10.2 (a) passkey + PRF → meta-address with copy; (b) Discover; (c) Enter with the recovered key, no wallet prompt | 6 |
| §11 announcements RPC down → `502 rpc_unavailable`, app shows "try again" | 5, 6 |
| §12 stealth unit rows (vectors, round trip, view-tag skip, metadata, degenerate) and the integration row "stealth issue → announce → /announcements → match → verify-signed with recovered key"; "+Private issue → member row `holder = NULL`, `member_id` = the supplied id" | 2, 4, 5 |
| §16.5 acceptance: derive from a passkey, discover via announcement scan, enter through `/verify-signed` | 6 (manual ceremony) + 4 (node proof) |
| Plan 3 handoff: `admitAndHook` seam | 1 |
| Plan 2 handoff: private-row `/pass/:uid` decision | 4 (404) |

**Placeholder scan:** the only intentional placeholder is `'0xPINNED_ON_FIRST_RUN'` in Task 2 Step 2, which Step 4 instructs to replace with the value from the first run and to record.

**Type consistency:** `AnnouncementLog` (Task 3) is what `FakeChain.announcements` holds, what `syncAnnouncements` inserts (its fields match the `announcements` Drizzle table's camelCase columns exactly), and what the route serializes; `AnnouncementDto` in the app (Task 6) mirrors it. `DiscoveredPass` / `StealthKeys` / `AnnouncementRow` come from `@fuda/stealth` (Task 2) and are consumed unchanged by Tasks 4 and 6. `admitAndHook` (Task 1) is consumed by both admission routes only; Task 4's private right enters through the unchanged `/verify-signed`. `attestEntitlement` / `insertMemberRow` (Task 4) are the seam between `attestRight` and `issuePrivate`.
