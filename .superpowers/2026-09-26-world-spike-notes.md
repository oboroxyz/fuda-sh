# World ID spike notes — 2026-09-26

Temporary Superpowers artifact for Task 1 of the World ID Verified Human badge plan (`.superpowers/sdd/2026-09-26-world-id-human-badge/`). Delete this file once its durable findings have been folded into `docs/specs/` per the lifecycle policy in `.agents/rules/superpowers-policy.md`.

## Status of this file

This spike covered only **Steps 2, 3, 4 and 8** of the Task 1 brief. Steps 1, 5, 6 and 7 require a Developer Portal account and an Orb-verified physical phone, which are the user's job. Sections below are marked:

- **MEASURED** — established by inspecting the installed package, npm metadata, and running the spike script locally (Node) and under `@cloudflare/vitest-pool-workers` (workerd). Reproducible, not guessed.
- **TODO (user)** — requires the Portal and/or the phone. Not attempted here. Do not treat as fact until filled in.

---

## 1. Package versions (MEASURED)

```
$ npm view @worldcoin/idkit-core versions --json   # tail
... "4.1.0" ... "4.2.4", "4.3.0"
$ npm view @worldcoin/idkit versions --json         # tail
... "4.1.1" ... "4.2.4", "4.3.0"
```

Both packages exist under those exact names. The current major line is **4.x** (latest `4.3.0` for both), confirming the plan's assumption. Installed: `@worldcoin/idkit-core@4.3.0` in `apps/app`, `@worldcoin/idkit-server@1.1.1` in `apps/api` (see below for why `idkit-server` and not `idkit-core` in the API).

## 2. Step 2 — client package install and build (MEASURED)

```
pnpm --filter app add @worldcoin/idkit-core
pnpm --filter app build
```

Both succeeded. Build output (`vp build`) produced a normal bundle (`dist/assets/*`), no errors. One pre-existing, unrelated warning (`INEFFECTIVE_DYNAMIC_IMPORT` for `src/base-account.ts`) is not caused by this change. `@worldcoin/idkit-core` adds no bundle-breaking transitive dependency — its own `package.json` lists only `@noble/hashes` and `@worldcoin/idkit-server` as dependencies (no React).

## 3. Step 3 — the server-side signing path (MEASURED)

**Which package/subpath actually exports the signing helper.** The brief's guess was `@worldcoin/idkit/signing`. By inspection of the installed `@worldcoin/idkit-core@4.3.0` package:

- `node_modules/@worldcoin/idkit-core/package.json` `exports` map has a `"./signing"` subpath → `dist/signing.d.ts` / `dist/signing.js`.
- That file is a pure re-export: `export { computeRpSignatureMessage, signRequest } from '@worldcoin/idkit-server';` (`dist/signing.js`, confirmed by reading the file directly).
- So the real, canonical home of `signRequest` is the separate package **`@worldcoin/idkit-server`** (currently pinned to `1.1.1` as `idkit-core`'s own dependency). `@worldcoin/idkit-core/signing` and (per the published docs) `@worldcoin/idkit/signing` are just re-exports of the same function.
- **Doc vs. reality:** the published doc at `https://docs.world.org/world-id/idkit/signatures.md` shows `import { signRequest } from "@worldcoin/idkit-server"` as the primary example and separately notes it is _also_ available from `@worldcoin/idkit/signing` and `@worldcoin/idkit-core/signing`. This matches what the installed package shows — no disagreement here, just confirmation that the brief's guessed path is a valid _alias_, not the canonical source.

**Chosen import for this repo:** `import { signRequest } from '@worldcoin/idkit-server'`, installed directly as a dependency of `apps/api` (not through `idkit-core`, which would be an unnecessary indirection for a Worker that never touches the React widget).

**Does it need React?** No, checked two ways:

- `@worldcoin/idkit-core@4.3.0`'s own `package.json` `dependencies`: `@noble/hashes`, `@worldcoin/idkit-server` only.
- The actual React-widget package, `@worldcoin/idkit@4.3.0` (checked via `npm view @worldcoin/idkit@4.3.0 dependencies peerDependencies --json` without installing it), has `dependencies: { qrcode, @worldcoin/idkit-core }` and `peerDependencies: { react: >=18, react-dom: >=18 }`. React is a peer dependency of the _widget_ package only. Importing `signRequest` from `@worldcoin/idkit-server` (or `@worldcoin/idkit-core/signing`) never touches `@worldcoin/idkit` or React. **Answer: importing the signing helper into `apps/api` does not drag React in.**

**Does it need Node built-ins?** Read `node_modules/@worldcoin/idkit-server@1.1.1/dist/index.js` directly:

- Dependencies are `@noble/hashes` and `@noble/secp256k1` — both pure JS, designed to be runtime-agnostic.
- There is exactly one conditional Node reference:
  ```js
  if (typeof globalThis.crypto === 'undefined') {
    globalThis.crypto = __require('crypto').webcrypto
  }
  ```
  This only fires when `globalThis.crypto` is missing. Workers (like modern Node) always have `globalThis.crypto` (WebCrypto), so this branch never executes there.
- **The real gate is not a Node built-in, it's a runtime sniff:**
  ```js
  var isServerEnvironment = () => {
    if (typeof process !== 'undefined' && process.versions?.node) return true
    if (typeof globalThis.Deno !== 'undefined') return true
    if (typeof globalThis.Bun !== 'undefined') return true
    return false
  }
  ```
  `signRequest()` throws `"signRequest can only be used in Node.js environments..."` unless `isServerEnvironment()` returns `true`.

**Runs on Workers? MEASURED, not guessed: yes.** `apps/api`'s `wrangler.jsonc` already has `compatibility_flags: ["nodejs_compat"]`. I wrote a throwaway probe test (`apps/api/test/_spike-worldid-probe.test.ts`, deleted before this commit — not part of the diff) and ran it under `@cloudflare/vitest-pool-workers` (real workerd, not a Node fallback):

```
process.versions {"node":"22.19.0", ...}
SUCCEEDED {"sig":"0x88d20fcc...","nonce":"0x0056be66...","createdAt":1790403623,"expiresAt":1790403923}
```

So under `nodejs_compat`, workerd's `process.versions.node` is populated (`"22.19.0"`), `isServerEnvironment()` returns `true`, and `signRequest()` runs and returns a real signature — no throw, no WebCrypto reimplementation needed. I also ran the same call locally under `tsx` (real Node) with a dummy 32-byte key and got a structurally identical result. **Conclusion: sign with `@worldcoin/idkit-server`'s `signRequest` directly in `world.ts`; a manual WebCrypto reimplementation is not required.**

Recorded anyway, in case a future compatibility-flag change removes `process.versions.node` from the Worker: `signRequest` computes `msg = version(1) || nonce(32) || createdAt_u64_be(8) || expiresAt_u64_be(8) || action_field_element(32, optional)` (see `computeRpSignatureMessage` in `dist/index.d.ts`/`.js`), hashes it as an EIP-191 personal-sign message (`"\x19Ethereum Signed Message:\n" + len(msg)` prefix, then `keccak256`), and signs the resulting hash with secp256k1 (`@noble/secp256k1`'s `sign`), producing a 65-byte `r(32) || s(32) || v(1, recovery+27)` signature encoded as `0x`-prefixed hex. The nonce is 32 random bytes reduced into a field element via the same `keccak256`-based `hashToField`. `crypto.subtle` + a WebCrypto secp256k1/ECDSA path (or `@noble/secp256k1`, which is what the package already uses and which runs fine in Workers unmodified) can reproduce this exactly if ever needed.

**RpContext field mapping (MEASURED, from `idkit-core`'s shipped `dist/index.d.ts`):** `signRequest()`'s output (`{ sig, nonce, createdAt, expiresAt }`) is **not** shaped like `RpContext`. The caller must rename: `sig` → `signature`, `createdAt` → `created_at`, `expiresAt` → `expires_at`, and add `rp_id` (not produced by `signRequest` — this is the RP ID recorded in the Portal, Step 1's job). `apps/api/scripts/world-spike.ts` does this mapping explicitly.

**Presets shipped (MEASURED, from `@worldcoin/idkit-core@4.3.0`'s `dist/index.d.ts`):** exported preset-factory functions are `orbLegacy`, `secureDocumentLegacy`, `documentLegacy`, `selfieCheckLegacy`, `selfieCheck`, `deviceLegacy`, `proofOfHuman`, `passport`, `mnc`, `identityCheck`. Each returns a discriminated `Preset` union member (`{ type: "OrbLegacy" | ... , signal?: string }`, except `IdentityCheckPreset` which takes `attributes`). For the plan's "4.0 Orb preset vs. legacy Orb preset" choice:

- **Legacy Orb preset:** `orbLegacy({ signal })` → `{ type: "OrbLegacy", signal }`. Doc comment: "This preset only returns World ID 3.0 proofs."
- **4.0-equivalent preset:** there is no preset literally named "Orb" for 4.0 — the 4.0 credential is **`proofOfHuman({ signal })`** → `{ type: "ProofOfHuman", signal }`. Doc comment: "Requests a World ID 4.0 proof-of-human credential with legacy Orb fallback." This is the preset Task 6's decision (Step 6 of the brief) needs to pick between, alongside `allow_legacy_proofs` on the request config (see next point).
- `allow_legacy_proofs: boolean` (required on `IDKitRequestConfig`, optional on the internal `BuilderConfig`) lives on `IDKit.request({ ..., allow_legacy_proofs })`, not on the preset object — the plan's phrasing ("4.0 preset, `allow_legacy_proofs: false`") matches this shape exactly.

**Call shape (MEASURED):** `IDKit.request(config: IDKitRequestConfig)` returns an `IDKitBuilder` synchronously; `.preset(preset: Preset)` on it is **async** and returns `Promise<IDKitRequest>`. So the correct call is `const request = await IDKit.request({ app_id, action, rp_context, allow_legacy_proofs }).preset(proofOfHuman({ signal }))`, matching the brief's shape (module docs use exactly this pattern). `pollUntilCompletion(options?: WaitOptions): Promise<IDKitCompletionResult>` exists as a named method on `IDKitRequest`, exactly as the brief assumed. It "never throws" (its own doc comment) — it resolves to `{ success: true, result: IDKitResult } | { success: false, error: IDKitErrorCodes }`.

**Verify endpoint types: NOT shipped by the package.** Neither `@worldcoin/idkit-core` nor `@worldcoin/idkit-server` exports a `VerifyRequest`/`VerifyResponse` type — the verify call is a plain `fetch`/`curl` against the Portal's HTTP API, described only in prose docs. The client-side proof result type, `IDKitResultV4` (in `idkit-core`'s `dist/index.d.ts`), does carry a `nullifier: string` field per `ResponseItemV4`/`SelfieCheckResponseItemV4` (`"RP-scoped nullifier (hex)"`), and the public doc at `https://docs.world.org/world-id/idkit/integrate.md` shows the verify response echoing a `"nullifier": "0x...rp_scoped_nullifier"` field, and states the proof payload is forwarded to `POST https://developer.world.org/api/v4/verify/{rp_id}` "as-is." But the **exact verify-response body shape** (is it the same `IDKitResultV4` shape, or wrapped?) is not confirmed by any shipped type — this stays a TODO for the user's real Step 5 call.

## 4. `.dev.vars` check (MEASURED)

```
$ git check-ignore apps/api/.dev.vars
apps/api/.dev.vars
```

Exit code 0 — the file is gitignored. Not created, read, or modified in this task.

## 5. Step 4 — the spike script (MEASURED)

`apps/api/scripts/world-spike.ts` imports `signRequest` from `@worldcoin/idkit-server` directly (the real import from Step 3, not the brief's guessed `@worldcoin/idkit/signing`), reads `WORLD_RP_SIGNING_KEY`/`WORLD_ACTION`/`WORLD_APP_ID`/`WORLD_RP_ID` from `process.env`, calls `signRequest({ signingKeyHex, action })`, maps its output onto `RpContext` field names, and prints `{ action, app_id, rp_context }` as JSON.

- Type-checks: `npx tsc --noEmit --project apps/api/tsconfig.json` reports no errors for this file (one pre-existing, unrelated error in `packages/sdk/src/http.ts` is not caused by this change).
- Run with no env vars (`pnpm --filter api exec tsx scripts/world-spike.ts`): fails fast with a clear message — `Missing one of WORLD_RP_SIGNING_KEY, WORLD_ACTION, WORLD_APP_ID, WORLD_RP_ID in the environment.` (exit code 1). This is the expected, useful failure without real credentials.
- Run with a dummy 32-byte hex key and placeholder IDs (not real Portal values): produced a real, structurally correct signed context — `{ action, app_id, rp_context: { rp_id, nonce, created_at, expires_at, signature } }` — confirming the script's logic end-to-end short of talking to the Portal or a phone.

## 6. Step 5 — one real verification

**TODO (user):** Requires a Developer Portal `app_id`/`rp_id`/RP signing key (Step 1) and a physical Orb-verified phone with World App installed. To produce it:

1. Put the four values from Step 1 into `apps/api/.dev.vars` (`WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_ACTION=ethtokyo2026-human`, `WORLD_RP_SIGNING_KEY`).
2. Run the script **with that file loaded** — `.dev.vars` is read by `wrangler dev` and the workerd test pool, never by `tsx`, so the plain command fails with the "Missing one of …" message even when all four values are sitting in the file. Measured working form, and it needs no shell-specific dotenv syntax (`set -a; source …` is bash/zsh only):

   ```bash
   pnpm --filter api exec tsx --env-file=.dev.vars scripts/world-spike.ts
   ```

   `pnpm --filter api exec` runs in `apps/api`, so the relative path resolves there. Copy the printed `{ action, app_id, rp_context }` JSON.

   **The context expires in 300 seconds** (`DEFAULT_TTL_SEC` in `@worldcoin/idkit-server`; `ttl` is an option on `signRequest`). Generate it immediately before the phone flow, not in advance.

3. Build the smallest possible page (scratch HTML outside the repo, or a temporary route) that calls `IDKit.request({ app_id, action, rp_context, allow_legacy_proofs: <your Step 6 choice> }).preset(proofOfHuman({ signal: '0x' + '11'.repeat(32) }))` (or `orbLegacy(...)` if Step 6 lands on the legacy preset) and opens World App from your phone.
4. After the phone completes the flow and the page's `pollUntilCompletion()` resolves, save the full result object as `proof.json`, then run:
   ```bash
   curl -sS -X POST "https://developer.world.org/api/v4/verify/$WORLD_RP_ID" \
     -H 'content-type: application/json' -d @proof.json | tee verify-response.json
   ```
5. Paste back into this section, verbatim:
   - The exact `proof.json` request body shape you sent (field names only, redact the actual signature/proof bytes if you want, but keep every key name).
   - The exact `verify-response.json` body shape (again, field names, keep the real value of whichever field carries the nullifier/subject key).
   - Which field name carries the nullifier/subject key in the verify response (confirm or correct the `nullifier` guess above).
   - Whether the `signal` you supplied is echoed back in the response, or whether the verify call itself requires you to pass `signal` again as a body field (check the doc's request shape against what actually worked).

## 7. Step 6 — nullifier stability

**TODO (user):** Repeat Step 5 on the _same phone, same action, same preset_, and compare the two nullifier values.

- Record both nullifier values here, verbatim.
- Identical → decision: use the 4.0 preset (`proofOfHuman`) with `allow_legacy_proofs: false`.
- Different → switch `.preset(...)` to `orbLegacy(...)` (the legacy Orb preset) and repeat until you find a stable value; record which preset gave a stable value and how many attempts it took.
- Neither stable after a reasonable number of attempts → record that plainly here. In that case the uniqueness claim is withdrawn per the plan — the feature ships as "verified by a human," not "verified as one unique human," and the submission says so.

**Chosen preset and why:** TODO (user) — fill in once the above is measured.

## 8. Step 7 — round-trip through the browser

**TODO (user):** On the phone, open the scratch page in Safari, complete a verification, background/return from World App, and confirm the page still receives the result (i.e. `pollUntilCompletion()` resolves) after returning. Record:

- Did it resolve normally?
- If the tab was suspended and the poll died, note that here — Task 6 will then need a resume-on-`visibilitychange` retry around `pollUntilCompletion()`.

## 9. Wall-clock time

**TODO (user):** Record the wall-clock time from starting Task 1 (Step 1, Portal registration) to the first successful verification response from `https://developer.world.org/api/v4/verify/$WORLD_RP_ID`. This is a debrief number needed later — measured in whatever units make sense (e.g. "38 minutes", "2h 10m").

---

## Summary for Tasks 3 and 6 (MEASURED unless noted)

- **Signing import:** `import { signRequest } from '@worldcoin/idkit-server'` (also reachable via `@worldcoin/idkit-core/signing`, and per the docs via `@worldcoin/idkit/signing` — all three re-export the same function; use the direct package in `apps/api` to avoid any risk of pulling in the widget).
- **Runs on Workers:** yes, confirmed under `@cloudflare/vitest-pool-workers` with `nodejs_compat` — no WebCrypto reimplementation needed. (Fallback algorithm recorded above in case that ever changes.)
- **Preset export names:** `orbLegacy`, `secureDocumentLegacy`, `documentLegacy`, `selfieCheckLegacy`, `selfieCheck`, `deviceLegacy`, `proofOfHuman`, `passport`, `mnc`, `identityCheck`. The 4.0/legacy Orb choice is between `proofOfHuman` (4.0, with `allow_legacy_proofs` controlling legacy fallback) and `orbLegacy` (3.0-only).
- **Verify request/response types:** not shipped by the package — TODO (user), see section 6 above.
