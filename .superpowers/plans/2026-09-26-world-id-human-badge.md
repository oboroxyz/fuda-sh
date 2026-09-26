# Verified Human badge (World ID) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fuda Right can carry a Verified Human badge, proven once through World ID, visible in the gate verdict — without changing how Rights are issued or admitted.

**Architecture:** Issuance and admission are untouched. A new `badges` table records one badge per `(Right, kind)` and enforces one subject per `(verifier, scope)`. A `BadgeVerifier` seam holds one adapter (`world`). Two routes named after the claim (`/badges/human/...`) serve an RP-signed context and accept a proof. `VerifyResponse` gains an optional `badges` array, read advisorily so a badge lookup can never change a decision.

**Tech Stack:** Hono + Drizzle on Cloudflare Workers (`apps/api`), hono/jsx/dom SPA (`apps/app`, `apps/gate`), D1, vitest via `@cloudflare/vitest-pool-workers`, World ID 4.x (`@worldcoin/idkit-core`).

**Design spec:** `.superpowers/specs/2026-09-26-world-id-human-badge-design.md`. Read it before Task 1.

## Global Constraints

- Branch `feat/idkit`. Every task ends in a commit. Commit messages in English.
- Repository language is English — code, comments, docs, commit messages.
- Node 24.18.0, pnpm 11.x. Install with `pnpm install --frozen-lockfile` unless a task adds a dependency.
- Tests: `pnpm --filter api test`, `pnpm --filter app test`, `pnpm --filter gate test`. Whole workspace: `pnpm test`. Lint+format: `pnpm check`.
- **One preset ships.** Never accept both 4.0 and legacy proofs — two nullifier families for one person breaks the uniqueness claim this feature exists to make.
- Store **only** a subject key already scoped to `(verifier, scope)`. Never store a World identity, a raw globally-stable identifier, or a free-form evidence blob.
- The feature is config-gated: with `WORLD_APP_ID` / `WORLD_RP_ID` / `WORLD_ACTION` / `WORLD_RP_SIGNING_KEY` unset, routes answer 501 and every other behavior is exactly as today.
- Routes name the claim (`/badges/human`), never the vendor.
- `apps/app` is **hono/jsx/dom, not React**. The React IDKit widget cannot be used.

## Time budget and checkpoints

Deadline: **2026-09-27 09:00 JST**. Working budget ≈ 8h.

| Checkpoint | By | If missed |
| --- | --- | --- |
| Task 1 produced a real nullifier from the phone | **17:30** | Stop. Decide whether World ID is viable at all before spending the evening. |
| Tasks 2–5 green (API complete) | **22:00** | Drop Task 7 (gate chip) to a text line; keep the member flow. |
| Deployed and demonstrated on a real phone (Task 8) | **05:00** | Submit what is deployed; no new code after this. |

Stretch S1/S2 are attempted only after Task 8 is fully done.

## File structure

**Create**

- `apps/api/scripts/world-spike.ts` — throwaway measurement script (Task 1).
- `apps/api/migrations/0015_badges.sql` — the table.
- `apps/api/src/badges/store.ts` — badge persistence and conflict rules. No HTTP, no World.
- `apps/api/src/badges/verifier.ts` — the `BadgeVerifier` interface and the kind→verifier lookup.
- `apps/api/src/badges/providers/world.ts` — the only adapter: RP context signing and v4 proof verification.
- `apps/api/src/routes/badges.ts` — the two HTTP routes.
- `apps/api/test/badges-store.test.ts`, `apps/api/test/badges-routes.test.ts`.
- `apps/app/src/badges.ts` — pure client controller (state machine + fetches), unit-tested.
- `apps/app/src/badges.test.ts`.

**Modify**

- `packages/sdk/src/constants.ts` — `ERROR_CODES` additions, `BADGE_KINDS`.
- `packages/sdk/src/types.ts` — `BadgeView`, `VerifyResponse.badges`.
- `apps/api/src/db/schema.ts` — the `badges` table definition.
- `apps/api/src/env.ts` — four bindings.
- `apps/api/src/routes/verify.ts` — `verdictBody` fills `badges`.
- `apps/api/src/app.ts` — mount `badgeRoutes`.
- `apps/app/src/venue/CardScreen.tsx`, `apps/app/src/venue/copy.ts` — the member action.
- `apps/gate/src/verdict.ts`, `apps/gate/src/Verdict.tsx` — the chip.
- `docs/CONTEXT.md`, `docs/specs/pass-types-and-flows.md`, `README.md` — documentation (Task 8).

---

### Task 1: Spike — Developer Portal, signing, and one real verification

**Not TDD.** This is a measurement task. Its output is knowledge, recorded in a file, that every later task depends on. Do not start Task 2 before it is finished.

**Files:**
- Create: `apps/api/scripts/world-spike.ts`
- Create: `.superpowers/2026-09-26-world-spike-notes.md`

**Interfaces:**
- Produces: the answers later tasks consume — package name for server-side signing, the exact v4 request/response field names, whether the nullifier is stable, which preset ships, and the four env var values.

- [ ] **Step 1: Register the RP in the Developer Portal**

Go to https://developer.worldcoin.org. Create (or reuse) an app. Create an action with identifier `ethtokyo2026-human`. Generate an RP signing key. Record `app_id`, `rp_id`, and the signing key.

Put them in `apps/api/.dev.vars` (gitignored — confirm with `git check-ignore apps/api/.dev.vars`):

```
WORLD_APP_ID=app_xxxxxxxx
WORLD_RP_ID=...
WORLD_ACTION=ethtokyo2026-human
WORLD_RP_SIGNING_KEY=...
```

- [ ] **Step 2: Install the client package and confirm the build survives**

```bash
pnpm --filter app add @worldcoin/idkit-core
pnpm --filter app build
```

Expected: build succeeds. If it fails, note the failure in the spike notes — a package that cannot build in `apps/app` changes Task 6 entirely.

- [ ] **Step 3: Find the server-side signing helper**

Read https://docs.world.org/world-id/idkit/signatures.md and https://docs.world.org/world-id/idkit/integrate.md.

Answer in the notes: **which import provides `signRequest`, and does it run on Workers?** The React docs show `@worldcoin/idkit/signing`. A Worker has WebCrypto but no Node `crypto` module. If the helper needs Node built-ins, record the signature algorithm and input encoding so `world.ts` can sign with WebCrypto directly.

- [ ] **Step 4: Write the throwaway spike script**

```ts
// apps/api/scripts/world-spike.ts — throwaway; deleted in Task 8.
// Prints an RP-signed context so a phone can produce a proof against it.
const signingKeyHex = process.env.WORLD_RP_SIGNING_KEY ?? ''
const action = process.env.WORLD_ACTION ?? ''
// Replace this import with whatever Step 3 established:
const { signRequest } = await import('@worldcoin/idkit/signing')
const signed = signRequest({ signingKeyHex, action })
console.log(JSON.stringify({ action, app_id: process.env.WORLD_APP_ID, rp_context: signed }, null, 2))
```

Run: `pnpm --filter api exec tsx scripts/world-spike.ts`
Expected: a JSON object containing a signature, a nonce and an expiry.

- [ ] **Step 5: Produce a proof on the real phone and verify it**

Build the smallest possible page (a scratch HTML file outside the repo, or a temporary route) that feeds the printed context to
`IDKit.request({ app_id, action, rp_context }).preset(<preset>({ signal: '0x' + '11'.repeat(32) }))`
and opens World App. Forward the result verbatim:

```bash
curl -sS -X POST "https://developer.world.org/api/v4/verify/$WORLD_RP_ID" \
  -H 'content-type: application/json' -d @proof.json | tee verify-response.json
```

Record in the notes, verbatim: the request body shape, the response body shape, **the exact field name carrying the nullifier / subject key**, and whether the signal is echoed back or must be supplied to the verify call.

- [ ] **Step 6: Measure nullifier stability — the decision that shapes the feature**

Repeat Step 5 **on the same phone, same action, same preset**, and compare the two subject values.

- Identical → 4.0 preset, `allow_legacy_proofs: false`.
- Different → switch to the legacy Orb preset and repeat until a stable value is found.
- Neither stable → record it plainly. The uniqueness claim is withdrawn (spec, "The preset is chosen empirically"); the feature still ships as "verified by a human" and the submission says so.

- [ ] **Step 7: Check the round-trip survives the browser**

On the phone, with the page open in Safari, complete a verification and confirm the page still receives the result after returning from World App (`pollUntilCompletion()` resolves). If the tab is suspended and the poll dies, note it: Task 6 then needs a resume-on-`visibilitychange` retry.

- [ ] **Step 8: Write the notes and commit**

`.superpowers/2026-09-26-world-spike-notes.md` must contain: the signing import and whether it runs on Workers; the verify request/response field names; the chosen preset and why; the nullifier-stability result; the browser round-trip result; and **the wall-clock time from starting Task 1 to the first successful verification** (the debrief needs this number).

```bash
git add apps/api/scripts/world-spike.ts .superpowers/2026-09-26-world-spike-notes.md apps/app/package.json pnpm-lock.yaml
git commit -m "spike: verify a World ID proof end to end and record the findings"
```

---

### Task 2: The badges table and its store

**Files:**
- Create: `apps/api/migrations/0015_badges.sql`
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/badges/store.ts`
- Create: `apps/api/test/badges-store.test.ts`
- Modify: `packages/sdk/src/constants.ts`, `packages/sdk/src/types.ts`

**Interfaces:**
- Consumes: nothing from Task 1 except the confirmed subject-key format (hex string).
- Produces:
  - `BADGE_KINDS`, `type BadgeKind = 'human'` (sdk)
  - `interface BadgeView { kind: BadgeKind; verifier: string; at: number; expiresAt?: number }` (sdk)
  - `readBadges(db: Db, uid: Hex): Promise<BadgeView[]>`
  - `saveBadge(db: Db, input: SaveBadgeInput): Promise<SaveBadgeResult>` where
    `SaveBadgeInput = { uid: Hex; kind: BadgeKind; verifier: string; scope: string; subjectKey: string; credential: string; verifiedAt: number; expiresAt: number | null }`
    and `SaveBadgeResult = { ok: true; badge: BadgeView } | { ok: false; conflict: 'subject' | 'pass' }`

- [ ] **Step 1: Add the sdk types**

In `packages/sdk/src/constants.ts`, after the `REASONS` block:

```ts
export const BADGE_KINDS = ['human'] as const
export type BadgeKind = (typeof BADGE_KINDS)[number]
```

and add to `ERROR_CODES`: `'already_badged'`, `'pass_already_badged'`, `'bad_proof'`, `'badges_not_configured'`.

In `packages/sdk/src/types.ts`, import `BadgeKind` alongside the existing type imports and add:

```ts
// A verified fact about the Member holding a Right, attached after issuance
// (docs/CONTEXT.md: Badge). An array from the first version: this type is
// public and a second kind must not be a breaking change.
export interface BadgeView {
  kind: BadgeKind
  verifier: string
  at: number
  expiresAt?: number
}
```

and extend `VerifyResponse` with `badges?: BadgeView[]`.

- [ ] **Step 2: Write the migration**

`apps/api/migrations/0015_badges.sql`:

```sql
CREATE TABLE badges (
  uid         TEXT NOT NULL,
  kind        TEXT NOT NULL,
  verifier    TEXT NOT NULL,
  scope       TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  credential  TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  expires_at  INTEGER,
  PRIMARY KEY (uid, kind)
);
CREATE UNIQUE INDEX badges_subject ON badges (verifier, scope, subject_key);
```

- [ ] **Step 3: Add the Drizzle table**

At the end of `apps/api/src/db/schema.ts` (`uniqueIndex` and `primaryKey` are already imported):

```ts
// One Badge per (Right, kind); one subject per (verifier, scope). The two
// constraints are different rules: the first leaves room for other kinds on
// the same Right, the second is the one-per-human guarantee.
export const badges = sqliteTable(
  'badges',
  {
    credential: text('credential').notNull(),
    expiresAt: integer('expires_at'),
    kind: text('kind').notNull(),
    scope: text('scope').notNull(),
    subjectKey: text('subject_key').notNull(),
    uid: text('uid').notNull(),
    verifiedAt: integer('verified_at').notNull(),
    verifier: text('verifier').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.uid, t.kind] }),
    uniqueIndex('badges_subject').on(t.verifier, t.scope, t.subjectKey),
  ],
)
```

- [ ] **Step 4: Write the failing store tests**

`apps/api/test/badges-store.test.ts`:

```ts
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { readBadges, saveBadge } from '../src/badges/store.ts'
import { getDb } from '../src/db/client.ts'
import { badges } from '../src/db/schema.ts'

const db = () => getDb({ DB: env.DB })
const UID_A = `0x${'a1'.repeat(32)}` as const
const UID_B = `0x${'b2'.repeat(32)}` as const
const NOW = 1_759_000_000

const input = (uid: typeof UID_A, subjectKey: string) => ({
  credential: 'orb',
  expiresAt: null,
  kind: 'human' as const,
  scope: 'ethtokyo2026',
  subjectKey,
  uid,
  verifiedAt: NOW,
  verifier: 'world',
})

describe('badge store', () => {
  beforeEach(async () => {
    await db().delete(badges)
  })

  it('stores a badge and reads it back', async () => {
    const saved = await saveBadge(db(), input(UID_A, '0xdead'))
    expect(saved).toEqual({ badge: { at: NOW, kind: 'human', verifier: 'world' }, ok: true })
    expect(await readBadges(db(), UID_A)).toEqual([{ at: NOW, kind: 'human', verifier: 'world' }])
  })

  it('is idempotent for the same subject on the same right', async () => {
    await saveBadge(db(), input(UID_A, '0xdead'))
    const again = await saveBadge(db(), { ...input(UID_A, '0xdead'), verifiedAt: NOW + 60 })
    expect(again).toEqual({ badge: { at: NOW, kind: 'human', verifier: 'world' }, ok: true })
  })

  it('rejects the same subject badging a second right', async () => {
    await saveBadge(db(), input(UID_A, '0xdead'))
    expect(await saveBadge(db(), input(UID_B, '0xdead'))).toEqual({ conflict: 'subject', ok: false })
  })

  it('rejects a different subject on an already badged right', async () => {
    await saveBadge(db(), input(UID_A, '0xdead'))
    expect(await saveBadge(db(), input(UID_A, '0xbeef'))).toEqual({ conflict: 'pass', ok: false })
  })

  it('reads an empty list for an unbadged right', async () => {
    expect(await readBadges(db(), UID_B)).toEqual([])
  })
})
```

- [ ] **Step 5: Run the tests and watch them fail**

Run: `pnpm --filter api test badges-store`
Expected: FAIL — `../src/badges/store.ts` does not exist.

- [ ] **Step 6: Implement the store**

`apps/api/src/badges/store.ts`:

```ts
import type { BadgeKind, BadgeView, Hex } from '@fuda/sdk'
import { and, eq } from 'drizzle-orm'

import type { Db } from '../db/client.ts'
import { badges } from '../db/schema.ts'

export interface SaveBadgeInput {
  uid: Hex
  kind: BadgeKind
  verifier: string
  scope: string
  subjectKey: string
  credential: string
  verifiedAt: number
  expiresAt: number | null
}

// 'subject' — this subject already badged another Right in this scope.
// 'pass'    — this Right already carries a badge of this kind, from someone else.
export type SaveBadgeResult = { ok: true; badge: BadgeView } | { ok: false; conflict: 'subject' | 'pass' }

const view = (row: typeof badges.$inferSelect): BadgeView => ({
  at: row.verifiedAt,
  kind: row.kind as BadgeKind,
  verifier: row.verifier,
  ...(row.expiresAt === null ? {} : { expiresAt: row.expiresAt }),
})

export const readBadges = async (db: Db, uid: Hex): Promise<BadgeView[]> =>
  (await db.select().from(badges).where(eq(badges.uid, uid))).map(view)

// A repeat verification is the normal case — a member taps the button twice —
// so an existing row with the same subject answers success rather than an error.
export const saveBadge = async (db: Db, input: SaveBadgeInput): Promise<SaveBadgeResult> => {
  const existing = await db
    .select()
    .from(badges)
    .where(and(eq(badges.uid, input.uid), eq(badges.kind, input.kind)))
    .get()
  if (existing !== undefined) {
    return existing.subjectKey === input.subjectKey
      ? { badge: view(existing), ok: true }
      : { conflict: 'pass', ok: false }
  }
  const held = await db
    .select()
    .from(badges)
    .where(
      and(
        eq(badges.verifier, input.verifier),
        eq(badges.scope, input.scope),
        eq(badges.subjectKey, input.subjectKey),
      ),
    )
    .get()
  if (held !== undefined) {
    return { conflict: 'subject', ok: false }
  }
  const row = {
    credential: input.credential,
    expiresAt: input.expiresAt,
    kind: input.kind,
    scope: input.scope,
    subjectKey: input.subjectKey,
    uid: input.uid,
    verifiedAt: input.verifiedAt,
    verifier: input.verifier,
  }
  // Two simultaneous requests both pass the reads above; the unique index is
  // the authority and the loser re-resolves rather than throwing.
  try {
    await db.insert(badges).values(row)
  } catch {
    return await saveBadge(db, input)
  }
  return { badge: view(row), ok: true }
}
```

- [ ] **Step 7: Run the tests until green**

Run: `pnpm --filter api test badges-store`
Expected: 5 passed.

- [ ] **Step 8: Commit**

```bash
git add apps/api/migrations/0015_badges.sql apps/api/src/db/schema.ts apps/api/src/badges/store.ts \
        apps/api/test/badges-store.test.ts packages/sdk/src/constants.ts packages/sdk/src/types.ts
git commit -m "feat(api): add the badges table and its store"
```

---

### Task 3: The verifier seam and the World adapter

**Files:**
- Create: `apps/api/src/badges/verifier.ts`
- Create: `apps/api/src/badges/providers/world.ts`
- Create: `apps/api/test/badges-world.test.ts`
- Modify: `apps/api/src/env.ts`

**Interfaces:**
- Consumes: `SaveBadgeInput` field names from Task 2; the verify request/response shape recorded in Task 1's notes.
- Produces:
  - `interface VerifiedSubject { subjectKey: string; credential: string; scope: string; expiresAt: number | null }`
  - `interface BadgeVerifier { kind: BadgeKind; name: string; configured: (env: Bindings) => boolean; context: (env: Bindings) => Promise<unknown>; verify: (env: Bindings, input: { uid: Hex; payload: unknown }) => Promise<VerifiedSubject | { error: 'bad_proof' | 'bad_input' }> }`
  - `verifierFor(kind: string): BadgeVerifier | null`

- [ ] **Step 1: Add the bindings**

In `apps/api/src/env.ts`, inside `Bindings`, after the ENS block:

```ts
  // World ID badge verification. All four or nothing: unset, /badges answers
  // 501 and no verdict carries a badge.
  WORLD_APP_ID?: string
  WORLD_RP_ID?: string
  WORLD_ACTION?: string
  WORLD_RP_SIGNING_KEY?: string
```

- [ ] **Step 2: Write the failing adapter tests**

`apps/api/test/badges-world.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

import { worldVerifier } from '../src/badges/providers/world.ts'
import { verifierFor } from '../src/badges/verifier.ts'
import type { Bindings } from '../src/env.ts'

const UID = `0x${'a1'.repeat(32)}` as const
const configured = {
  WORLD_ACTION: 'ethtokyo2026-human',
  WORLD_APP_ID: 'app_test',
  WORLD_RP_ID: 'rp_test',
  WORLD_RP_SIGNING_KEY: '0x' + '11'.repeat(32),
} as unknown as Bindings

afterEach(() => {
  vi.restoreAllMocks()
})

describe('world verifier', () => {
  it('is the verifier for the human kind', () => {
    expect(verifierFor('human')?.name).toBe('world')
    expect(verifierFor('nonsense')).toBeNull()
  })

  it('is unconfigured when any binding is missing', () => {
    expect(worldVerifier.configured(configured)).toBe(true)
    expect(worldVerifier.configured({ ...configured, WORLD_RP_ID: '' })).toBe(false)
    expect(worldVerifier.configured({ ...configured, WORLD_APP_ID: undefined })).toBe(false)
  })

  it('returns the subject key when the portal accepts the proof', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ nullifier: '0xDEAD', success: true })),
    )
    const out = await worldVerifier.verify(configured, { payload: { signal: UID }, uid: UID })
    expect(out).toEqual({
      credential: 'orb',
      expiresAt: null,
      scope: 'ethtokyo2026-human',
      subjectKey: '0xdead',
    })
  })

  it('rejects a proof whose signal is not the requested right', async () => {
    const other = `0x${'b2'.repeat(32)}`
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ nullifier: '0xdead', success: true })))
    expect(await worldVerifier.verify(configured, { payload: { signal: other }, uid: UID })).toEqual({
      error: 'bad_input',
    })
  })

  it('rejects when the portal refuses the proof', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'invalid_proof' }, { status: 400 })))
    expect(await worldVerifier.verify(configured, { payload: { signal: UID }, uid: UID })).toEqual({
      error: 'bad_proof',
    })
  })
})
```

> **Adjust to the spike.** The field names above (`nullifier`, `success`, `signal`) are the plan's best guess. Task 1's notes are authoritative: if the portal names them differently, fix the test **and** the implementation together, and say so in the commit message.

- [ ] **Step 3: Run the tests and watch them fail**

Run: `pnpm --filter api test badges-world`
Expected: FAIL — modules do not exist.

- [ ] **Step 4: Implement the seam**

`apps/api/src/badges/verifier.ts`:

```ts
import type { BadgeKind, Hex } from '@fuda/sdk'

import type { Bindings } from '../env.ts'
import { worldVerifier } from './providers/world.ts'

// What a verifier tells fuda about the person behind a proof. `subjectKey` must
// already be scoped to (verifier, scope): fuda never stores an identifier that
// could correlate someone across contexts.
export interface VerifiedSubject {
  subjectKey: string
  credential: string
  scope: string
  expiresAt: number | null
}

export interface BadgeVerifier {
  kind: BadgeKind
  name: string
  configured: (env: Bindings) => boolean
  context: (env: Bindings) => Promise<unknown>
  verify: (
    env: Bindings,
    input: { uid: Hex; payload: unknown },
  ) => Promise<VerifiedSubject | { error: 'bad_proof' | 'bad_input' }>
}

// One kind, one verifier. A registry is not needed until a second kind exists.
export const verifierFor = (kind: string): BadgeVerifier | null =>
  kind === worldVerifier.kind ? worldVerifier : null
```

`apps/api/src/badges/providers/world.ts`:

```ts
import { normalizeUid } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'

import type { Bindings } from '../../env.ts'
import type { BadgeVerifier, VerifiedSubject } from '../verifier.ts'

const VERIFY_BASE = 'https://developer.world.org/api/v4/verify'

const set = (value: string | undefined): value is string => value !== undefined && value !== ''

// The signal the client bound into the proof, in the one canonical form both
// sides agree on. A checksummed or upper-cased uid here reads like a bad proof.
const signalOf = (payload: unknown): Hex | null => {
  const raw = (payload as { signal?: unknown }).signal
  return typeof raw === 'string' ? normalizeUid(raw) : null
}

export const worldVerifier: BadgeVerifier = {
  configured: (env) =>
    set(env.WORLD_APP_ID) && set(env.WORLD_RP_ID) && set(env.WORLD_ACTION) && set(env.WORLD_RP_SIGNING_KEY),
  context: async (env) => {
    // Replace with the signing call Task 1 established. Keep the key inside
    // this module: it is a Worker secret and never reaches a client.
    const { signRequest } = await import('@worldcoin/idkit/signing')
    return {
      action: env.WORLD_ACTION,
      app_id: env.WORLD_APP_ID,
      rp_context: signRequest({ action: env.WORLD_ACTION, signingKeyHex: env.WORLD_RP_SIGNING_KEY }),
    }
  },
  kind: 'human',
  name: 'world',
  verify: async (env, input) => {
    if (signalOf(input.payload) !== input.uid) {
      return { error: 'bad_input' }
    }
    const res = await fetch(`${VERIFY_BASE}/${env.WORLD_RP_ID}`, {
      body: JSON.stringify(input.payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    if (!res.ok) {
      return { error: 'bad_proof' }
    }
    const body: unknown = await res.json()
    const nullifier = (body as { nullifier?: unknown }).nullifier
    if (typeof nullifier !== 'string' || nullifier === '') {
      return { error: 'bad_proof' }
    }
    return {
      credential: 'orb',
      expiresAt: null,
      scope: env.WORLD_ACTION ?? '',
      subjectKey: nullifier.toLowerCase(),
    } satisfies VerifiedSubject
  },
}
```

- [ ] **Step 5: Run the tests until green**

Run: `pnpm --filter api test badges-world`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/badges/verifier.ts apps/api/src/badges/providers/world.ts \
        apps/api/test/badges-world.test.ts apps/api/src/env.ts
git commit -m "feat(api): add the badge verifier seam and the World adapter"
```

---

### Task 4: The badge routes

**Files:**
- Create: `apps/api/src/routes/badges.ts`
- Create: `apps/api/test/badges-routes.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `verifierFor`, `worldVerifier` (Task 3); `saveBadge` (Task 2); `verifyUid` from `../verify/verify-uid.ts`; `rateLimit` from `../middleware/rate-limit.ts`; `errorResponse` / `jsonResponse` from `../json.ts`.
- Produces: `badgeRoutes` (a `Hono<AppEnv>`), mounted under `/v1`.

- [ ] **Step 1: Write the failing route tests**

`apps/api/test/badges-routes.test.ts`:

```ts
import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { badges } from '../src/db/schema.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, seedRight, seedRoot } from './fixtures.ts'

const db = () => getDb({ DB: env.DB })
const worldEnv = (bindings: ReturnType<typeof configuredEnv>) => ({
  ...bindings,
  WORLD_ACTION: 'ethtokyo2026-human',
  WORLD_APP_ID: 'app_test',
  WORLD_RP_ID: 'rp_test',
  WORLD_RP_SIGNING_KEY: `0x${'11'.repeat(32)}`,
})

const post = async (path: string, body: unknown, bindings: Record<string, unknown>) => {
  const chain = fakeChain()
  seedRoot(chain)
  return await appWith({ chain, now: () => NOW }).request(
    path,
    { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'POST' },
    bindings,
  )
}

beforeEach(async () => {
  await db().delete(badges)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /v1/badges/human', () => {
  it('answers 501 when World is not configured', async () => {
    const bindings = configuredEnv()
    const res = await post('/v1/badges/human', { payload: {}, uid: `0x${'a1'.repeat(32)}` }, bindings)
    expect(res.status).toBe(501)
    expect(await res.json()).toEqual({ error: 'badges_not_configured' })
  })

  it('rejects an unknown kind', async () => {
    const res = await post('/v1/badges/nonsense', { payload: {}, uid: `0x${'a1'.repeat(32)}` }, worldEnv(configuredEnv()))
    expect(res.status).toBe(404)
  })

  it('rejects a malformed uid before calling the portal', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const res = await post('/v1/badges/human', { payload: {}, uid: 'nope' }, worldEnv(configuredEnv()))
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
```

> Add the success and 409 cases in Step 4 using the same `seedRight` fixture the admission tests use, with `fetch` stubbed exactly as in `badges-world.test.ts`. Read `apps/api/test/attendance.test.ts` first for how a Right is seeded on the fake chain.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter api test badges-routes`
Expected: FAIL — 404 for every route (nothing mounted).

- [ ] **Step 3: Implement the routes**

`apps/api/src/routes/badges.ts`:

```ts
import { normalizeUid } from '@fuda/sdk'
import { Hono } from 'hono'

import { verifierFor } from '../badges/verifier.ts'
import { saveBadge } from '../badges/store.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { rateLimit } from '../middleware/rate-limit.ts'
import { verifyUid } from '../verify/verify-uid.ts'

// The route names the claim, not the vendor: replacing the verifier behind a
// kind is not a client-visible change.
export const badgeRoutes = new Hono<AppEnv>()

const BADGE_BUDGET = 30

badgeRoutes.post('/badges/:kind/context', rateLimit({ budget: BADGE_BUDGET }), async (c) => {
  c.header('cache-control', 'no-store')
  const verifier = verifierFor(c.req.param('kind'))
  if (verifier === null) {
    return errorResponse(c, 'not_found', 404)
  }
  if (!verifier.configured(c.env)) {
    return errorResponse(c, 'badges_not_configured', 501)
  }
  return jsonResponse(c, await verifier.context(c.env))
})

badgeRoutes.post('/badges/:kind', rateLimit({ budget: BADGE_BUDGET }), async (c) => {
  c.header('cache-control', 'no-store')
  const verifier = verifierFor(c.req.param('kind'))
  if (verifier === null) {
    return errorResponse(c, 'not_found', 404)
  }
  if (!verifier.configured(c.env)) {
    return errorResponse(c, 'badges_not_configured', 501)
  }
  const body: unknown = await c.req.json().catch(() => null)
  const uid = normalizeUid(String((body as { uid?: unknown })?.uid ?? ''))
  if (uid === null) {
    return errorResponse(c, 'bad_uid', 400)
  }
  // A badge on a revoked or unknown Right would be a record nobody can use.
  const right = await verifyUid(c, uid)
  if (right.decision !== 'ADMIT') {
    return errorResponse(c, 'not_found', 404)
  }
  const subject = await verifier.verify(c.env, { payload: (body as { payload?: unknown })?.payload, uid })
  if ('error' in subject) {
    return errorResponse(c, subject.error, 400)
  }
  const saved = await saveBadge(c.get('db'), {
    credential: subject.credential,
    expiresAt: subject.expiresAt,
    kind: verifier.kind,
    scope: subject.scope,
    subjectKey: subject.subjectKey,
    uid,
    verifiedAt: c.get('now')(),
    verifier: verifier.name,
  })
  if (!saved.ok) {
    return errorResponse(c, saved.conflict === 'subject' ? 'already_badged' : 'pass_already_badged', 409)
  }
  return jsonResponse(c, { badge: saved.badge })
})
```

> `verifyUid`'s exact signature is in `apps/api/src/verify/verify-uid.ts`; match it rather than the shape sketched here, and keep the "unknown or revoked Right" branch whatever its real return type is.

- [ ] **Step 4: Add the success and conflict tests**

Extend `badges-routes.test.ts` with: a seeded Right plus a stubbed portal answering `{ success: true, nullifier: '0xdead' }` → 200 and one row; the same call again → 200 with the same body; the same nullifier against a second seeded Right → 409 `already_badged`; a second nullifier against the first Right → 409 `pass_already_badged`.

- [ ] **Step 5: Mount the routes**

In `apps/api/src/app.ts`, import `badgeRoutes` from `./routes/badges.ts` and add `v1.route('/', badgeRoutes)` next to the other `v1.route` lines.

- [ ] **Step 6: Run the tests until green**

Run: `pnpm --filter api test badges`
Expected: all badge suites pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/badges.ts apps/api/test/badges-routes.test.ts apps/api/src/app.ts
git commit -m "feat(api): serve the badge context and accept a proof"
```

---

### Task 5: Badges in the verdict

**Files:**
- Modify: `apps/api/src/routes/verify.ts`
- Create/extend: `apps/api/test/badges-verdict.test.ts`

**Interfaces:**
- Consumes: `readBadges` (Task 2), `VerifyResponse.badges` (Task 2).
- Produces: every `/verify` and `/verify/:uid` response carries `badges` when the Right has any.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/badges-verdict.test.ts`: seed a Right, save a badge through `saveBadge`, scan it, and assert the verdict body contains `badges: [{ kind: 'human', verifier: 'world', at: NOW }]`. Add a second test asserting an unbadged Right's verdict has no `badges` key. Add a third: **drop the table** (`await env.DB.exec('DROP TABLE badges')`) and assert the scan still returns `decision: 'ADMIT'` with no `badges` key — a missing or broken badge store must never change a decision.

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter api test badges-verdict`
Expected: FAIL — no `badges` in the body.

- [ ] **Step 3: Fill the field**

In `apps/api/src/routes/verify.ts`, make `verdictBody` take the badges and include them only when non-empty, and give the callers an advisory read:

```ts
// Advisory: a badge is extra information about an existing decision, so a
// failed lookup omits the field rather than failing the scan.
export const badgesFor = async (c: Context<AppEnv>, uid: Hex): Promise<BadgeView[]> => {
  try {
    return await readBadges(c.get('db'), uid)
  } catch {
    return []
  }
}
```

and in `verdictBody`, append `...(badges.length === 0 ? {} : { badges })`.

- [ ] **Step 4: Run the tests until green**

Run: `pnpm --filter api test`
Expected: the whole api suite passes — the existing verdict tests must be untouched by this change.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/verify.ts apps/api/test/badges-verdict.test.ts
git commit -m "feat(api): carry badges in the gate verdict"
```

---

### Task 6: The member action

**Files:**
- Create: `apps/app/src/badges.ts`, `apps/app/src/badges.test.ts`
- Modify: `apps/app/src/venue/CardScreen.tsx`, `apps/app/src/venue/copy.ts`

**Interfaces:**
- Consumes: `POST /v1/badges/human/context` and `POST /v1/badges/human` (Task 4).
- Produces: `badgeState` transitions and `requestHumanBadge(io, uid)` used by `CardScreen`.

- [ ] **Step 1: Write the failing controller tests**

`apps/app/src/badges.test.ts` drives `requestHumanBadge` with a fake io (`context`, `open`, `submit`) and asserts the state sequence for: success (`idle → opening → waiting → done`), an `already_badged` 409 (`→ taken`), a user cancellation (`→ idle`, nothing submitted), and a 501 (`→ unavailable`). Assert the request body is `{ uid, payload }` and that the uid passed to the preset signal is the lowercase uid.

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter app test badges`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the controller**

`apps/app/src/badges.ts` holds the state union
`{ kind: 'idle' | 'opening' | 'waiting' | 'done' | 'taken' | 'unavailable' | 'error' }`,
and `requestHumanBadge` which: fetches the context; calls
`IDKit.request({ app_id, action, rp_context }).preset(<the preset Task 1 chose>({ signal: uid }))`;
opens World App; awaits `pollUntilCompletion()`; posts `{ uid, payload }` to `/v1/badges/human`; maps
409 `already_badged` → `taken`, 501 → `unavailable`, anything else → `error`. Keep every World import
inside this module so no other file knows the vendor.

If Task 1 Step 7 found the poll dies across the World App round-trip, resume it on
`document.addEventListener('visibilitychange', …)` and re-poll once on return.

- [ ] **Step 4: Run until green**

Run: `pnpm --filter app test badges`

- [ ] **Step 5: Wire it into the card screen**

In `CardScreen.tsx`'s `ready` state, below the wallet buttons, render a button labelled from
`copy.ts` (en: "Verify you're human", ja: "本人確認する") that calls `requestHumanBadge`. Render the
resulting state: `done` → a "Verified Human" chip, `taken` → "This person already has a verified
pass", `unavailable` → hide the control entirely. Add both locales to `venue/copy.ts` — en and ja
come from one structure, never two.

- [ ] **Step 6: Build and commit**

Run: `pnpm --filter app build && pnpm check`

```bash
git add apps/app/src/badges.ts apps/app/src/badges.test.ts apps/app/src/venue/CardScreen.tsx apps/app/src/venue/copy.ts
git commit -m "feat(app): let a member add a Verified Human badge to a pass"
```

---

### Task 7: The gate chip

**Files:**
- Modify: `apps/gate/src/verdict.ts`, `apps/gate/src/Verdict.tsx`
- Modify: `apps/gate/src/verdict.test.ts`

**Interfaces:**
- Consumes: `VerifyResponse.badges` (Task 2).

- [ ] **Step 1: Extend the verdict test**

Add a case to `apps/gate/src/verdict.test.ts`: a response carrying `badges: [{ kind: 'human', verifier: 'world', at: 1 }]` produces a `DisplayState` whose new `human` field is `true`; a response without badges produces `false`.

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter gate test`

- [ ] **Step 3: Implement**

Add `human: boolean` to `DisplayState`, set from `badges?.some((b) => b.kind === 'human') ?? false`. In
`Verdict.tsx`, when `state.human` is true, render `<div class="badge badge-neutral">verified human</div>`
above the title, alongside the existing network-error badge.

- [ ] **Step 4: Run until green and commit**

```bash
pnpm --filter gate test && pnpm check
git add apps/gate/src
git commit -m "feat(gate): show the verified-human badge in a verdict"
```

---

### Task 8: Deploy, demonstrate, document

- [ ] **Step 1: Apply the migration to production D1 first**

Run: `pnpm --filter api run migrate:remote`
Expected: `0015_badges.sql` applied. **Before** the Worker deploy — `verdictBody` reads `badges` on
every scan, and a deployed Worker against a missing table would rely on the advisory catch for every
request.

- [ ] **Step 2: Set the four secrets**

```bash
cd apps/api
wrangler secret put WORLD_RP_SIGNING_KEY
```

`WORLD_APP_ID`, `WORLD_RP_ID` and `WORLD_ACTION` go in `wrangler.jsonc` vars (they are not secrets);
the signing key is a secret and never enters the repo.

- [ ] **Step 3: Deploy and smoke-test**

```bash
pnpm --filter api run deploy
curl -sS -X POST https://<api-host>/v1/badges/human/context
```

Expected: a JSON context, not 501. A 501 means a binding is missing.

Deploy `apps/app` and `apps/gate` the way the runbook describes.

- [ ] **Step 4: Run every path on real devices and capture it**

1. Claim a Right on the phone; badge it with the Orb-verified World App; see the chip.
2. Scan it at the gate — `apps/gate` shows the badge; walletmate (pointed at the deployed API) shows GREEN.
3. Claim a second Right and try to badge it with the same human → the rejection.
4. Claim and admit a Right on a phone with no World App → works, no badge.

Capture each as a short clip as it starts working. Do not wait for the final edit.

- [ ] **Step 5: Update the documentation**

- `docs/CONTEXT.md` — add **Badge** next to Stamp and Qualification: a verified fact about the Member
  holding a Right, attached after issuance, naming the Verifier that attested it. _Avoid_: Stamp,
  Qualification (that is pre-issuance), credential.
- `docs/specs/pass-types-and-flows.md` — a short section on the badge flow and the two conflict rules.
- `README.md` — one line, if the badge is part of the headline story.
- Delete `apps/api/scripts/world-spike.ts`.

- [ ] **Step 6: Write the submission material**

A page separating pre-existing from event-period work (the table is in the spec), and the **integration
debrief** the prize requires: time to first successful verification (from the spike notes), the friction
actually hit (the v2→v4 documentation gap; the React-only widget against a hono/jsx/dom app; the
nullifier-stability contradiction between `concepts.md` and `4-0-migration.md`), the missing capability,
and the single highest-impact improvement.

If the uniqueness claim was withdrawn in Task 1 Step 6, say so here plainly.

- [ ] **Step 7: Final verification and commit**

```bash
pnpm test && pnpm check
git add -A
git commit -m "docs: record the badge model and the World ID integration debrief"
```

---

### Stretch S1 (only after Task 8): cards that require a badge

Add `requires_human INTEGER NOT NULL DEFAULT 0` to `cards` in a new migration; add `HUMAN_REQUIRED` to
`REASONS` in `packages/sdk/src/constants.ts`; in the admission path, when the Right's card requires it
and `readBadges` returns no `human` badge, return `REJECT` / `HUMAN_REQUIRED`. Test the four
combinations (required×badged, required×unbadged, not-required×badged, not-required×unbadged). For the
demo, set the column by SQL and **disclose that it is demo configuration**, not a shipped operator
workflow. This is what makes walletmate meaningful on its own: an unbadged pass turns the LED red.

### Stretch S2 (only after S1, or instead of it if time allows only one): the badge on chain

Add `badge: 'bytes32 rightUID,address holder,string kind,string verifier,uint64 verifiedAt'` to
`SCHEMA_STRINGS`, a codec beside `encodeAttendanceV1`, and a best-effort attest mirroring
`recordAttendance` — `refUID` = the Right, recipient = the holder, every failure swallowed. Register the
schema with `pnpm --filter api run register-schemas` and add the UID to `EAS_SCHEMAS`. **The subject key
is never published on chain**: it is fuda's dedupe key, not evidence anyone else needs.

---

## Self-review

**Spec coverage.** Trust moment and credential choice → Tasks 1 and 8 Step 6. Generalised data model →
Task 2. Privacy rule → Task 3 (`VerifiedSubject` contract) and Task 2 (no evidence column). Verifier seam
→ Task 3. Routes named after the claim → Task 4. Config gate → Tasks 3 and 4, tested. Verdict array →
Tasks 2 and 5. Alternative paths → Task 4 tests and Task 8 Step 4. walletmate → Task 8 Step 4 and S1.
Naming → Task 8 Step 5. Nullifier-stability risk → Task 1 Step 6. Stretches → S1, S2.

**Known looseness, deliberate.** Task 3's field names and Task 6's preset call are the plan's best guess
from published documentation; Task 1 replaces them with measured fact. Every such place says so inline.
Task 4 Step 4 and Task 6 Step 1 describe tests rather than printing them in full because their fixtures
must match `apps/api/test/fixtures.ts` and the io shape from Task 6 Step 3 — read those files first.
