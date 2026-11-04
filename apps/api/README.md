# fuda-api

Cloudflare Worker (Hono) implementing the fuda endpoints: `GET /health`, `POST /issue`, `GET /verify/:uid`, `POST /verify`, `POST /revoke`, `GET /members`, `POST /challenge`, `POST /verify-signed`, `POST /ens/gateway`, and the passes (`GET /pass/:uid` plus the Google Wallet and Apple Wallet endpoints).

## Server routing

Void discovers HTTP method exports in `routes/`. Each file re-exports its `defineHandler` from `src/handlers/`; shared business logic stays outside the route tree. `targets/{local,develop,production}/routes` link to that same directory, and ordered target middleware loads `src/middleware.ts` for request dependencies, CORS, auth-mode headers, cache policy and error responses. There is no separate production Hono router or Worker entry.

Keep programmatic endpoints under `routes/v1/`. Pass, asset, ENS gateway and health URLs stay unversioned because deployed wallets and contracts retain them. Workerd tests discover those same files through `test/app.ts`, with injectable chain, time and admission hooks; browser E2E exercises Void's built Worker. See [ADR 0012](../../docs/adr/0012-void-api-routing.md).

## Run locally

```bash
cp .env.example targets/local/.env
pnpm --filter api migrate:local
pnpm --filter api dev
```

With `USE_FAKE_CHAIN=1` set in `targets/local/.env` (the default in the example file) and no `SIGNER_PRIVATE_KEY` / `BASE_RPC_URL`, the api runs against an in-memory `FakeChain` instead of Base Sepolia for chain state and writes — no signer or funds needed. EOA signatures verify offline. Local smart-wallet signatures (including Base Account passkeys) use read-only verification against the default Base Sepolia RPC; they still require network access and a valid signature. Tests that construct `FakeChain` without a verifier remain offline. `src/runtime.ts` seeds a root `IssuerDelegation` on first request and logs the `ISSUER_ADDRESS` / `DELEGATION_UID` it used; the `local` block of `targets.jsonc` already carries the matching (deterministic) values, and `pnpm --filter api dev` runs the `local` Void target, so the quick start above works as written. `migrate:local` applies migrations to the same local database (`targets/local/.void/`) that `pnpm --filter api dev` then serves, and `pnpm --filter api d1:local "…"` runs SQL against it after a `migrate:local`. Setting either `SIGNER_PRIVATE_KEY` or `BASE_RPC_URL` always wins over `USE_FAKE_CHAIN` — the fake chain is never constructed in production, only under this explicit local opt-in. Either binding also arms the admin lock: set `ADMIN_TOKEN` in `targets/local/.env` alongside it, or `/issue`, `/revoke` and `/members` answer `401` with `x-auth-mode: locked`.

## Targets

The api deploys with Void, which has no named environments, so each target is its own Void project under `targets/`: `local` (never deployed), `develop` (the live Base Sepolia Worker `fuda-api` on `api.fuda.sh`) and `production` (Base mainnet, deployed at the cutover). [`targets.jsonc`](targets.jsonc) holds each target's Worker name, routes, D1 and R2 bindings and `vars`; [`targets.ts`](targets.ts) turns one block into that project's `void.config.ts`. Each project's `routes` link shares the API route tree, and its ordered middleware files re-export [`src/middleware.ts`](src/middleware.ts). The tests run on the `develop` vars with D1 and R2 simulated (`vite.config.ts`).

| Script                                    | Target       |
| ----------------------------------------- | ------------ |
| `dev`, `migrate:local`, `d1:local`        | `local`      |
| `deploy`, `migrate:remote`                | `develop`    |
| `deploy:production`, `migrate:production` | `production` |

The `migrate:*` scripts use `void db migrate`, with `--remote` for deployed D1. Each target’s `db/migrations` symlink shares the hand-written SQL in `migrations/`. Schema inference stays off: deploy does not generate or apply migrations. Remote D1 keeps its `d1_migrations` history. Local databases track theirs in `_void_migrations`; a local database with only Wrangler's history stops with an error, and `void db reset` recreates it. Local SQL uses `void db execute` through `d1:local`, with SQL as a positional argument. Remote scripts select the Cloudflare account with `void connect --platform cloudflare` before migration.

## Attendance

An `ADMIT` verdict from `POST /verify` and `POST /verify-signed` schedules an on-chain `Attendance` attestation via `waitUntil` when the right's card has `attendance` on (a ticket's default; a membership's is off) — both paths run it from the shared admission spine (`src/verify/admit.ts`), which reads the card once per on-chain admission. A right with no card, which is what admin `POST /issue` makes, records unless it is +Private; an offchain right never does. The attest needs a signer (real or `FakeChain`) and an `attendance` entry in `EAS_SCHEMAS`; if either is missing the hook is a no-op. A failed attest is caught and logged (`console.warn`) but never fails the admission that triggered it — attendance is best-effort evidence, not a gate. On success the attestation UID is written back to `entry_log.attendance_uid` for the admitting `entry_log` row. +Private (level 2) rights are never attested; why, and what that leaves behind, is in the [entitlement lifecycle](../../docs/specs/attestation-model.md#entitlement-lifecycle).

## Signed level: challenge/response

`POST /issue` with a `holder` address (and no `memberId`) issues a Signed right: `member_id` is set to the same address, EIP-55-checksummed, and the response's `level` is `'signed'`.

Entry at the Signed level is two calls, never a QR scan:

1. `POST /challenge` — body `{ uid }`. Open endpoint, no chain lookup (a challenge for a nonexistent or revoked uid is minted anyway; `/verify-signed` rejects it at step 1). A malformed or missing `uid` answers `400 bad_uid`. Mints a 16-random-byte nonce, stores it in `challenges` and answers:

   ```json
   { "challenge": "fuda-gate:<uid>:<nonce>", "nonce": "<nonce>" }
   ```

   The member signs `challenge` verbatim (EIP-191 `personal_sign`) with the holder key. The nonce is single-use and expires 300 s after minting.

2. `POST /verify-signed` — body `{ uid, nonce, signature }`. Entitlement → challenge → signature → slot, in that order, every verdict `200` in one shape. The step order, the response fields and the error codes are the [gate protocol](../../docs/specs/pass-types-and-flows.md#gate-protocol).

   App-local: the signature check goes through the `ChainClient.verifyMessage` wrapper in `src/chain/viem-chain.ts`, whose comment accounts for which failures surface as `502 chain_error` and which viem's own ERC-6492 deployless-call path swallows into a plain `BAD_SIGNATURE`.

Every REJECT and ADMIT on this path is logged with `path: 'signature'` (never `'qr'`); a bare QR scan against a Signed-only right still answers `LEVEL_REQUIRED` on `/verify`, unconsumed.

## +Private: stealth issuance and announcements

+Private is an extension of Signed (never a separate "third level" or "mode"): the right still enters through `/verify-signed`, but its holder is a one-time stealth address the member derives from a passkey rather than a wallet, and it is never printed as a QR — there is no pass to hand over. `@fuda/stealth-address` (`packages/stealth-address`) implements the ERC-5564 scheme-1 math: derivation from a passkey PRF output, stealth-address generation, and announcement matching. Every shared secret hashes the **compressed** ECDH point (`keccak256(secp256k1.getSharedSecret(priv, pub, true))`) — an interop caveat against other ERC-5564 implementations that hash the uncompressed point.

`POST /issue` with a `stealthMetaAddress` (and no `holder`/`memberId` pair for Bearer/Signed) issues a +Private right:

1. The meta-address is checked before the general body parse, so a malformed shape or an off-curve half answers `400 bad_meta_address` rather than folding into the generic `bad_input`.
2. `generateStealthAddress` derives a fresh ephemeral key, the stealth address and a view tag from the meta-address.
3. The entitlement is attested to the derived stealth address (never the meta-address, never stored).
4. The api announces on-chain (`ChainClient.announce`, ERC-5564 `Announcer.announce(1, stealthAddress, ephemeralPubKey, metadata)`) so the member can discover the right client-side; `metadata` carries the view tag and the attestation uid (`buildAnnouncementMetadata`).
5. Only after both chain writes land is the `members` row written, with `holder` `NULL` and `member_id` set to the supplied `memberId`.

**If the announce call fails after the attest already landed, the route answers `502 chain_error` and persists nothing.** The right exists on chain but no announcement points at it, so it is undiscoverable by design; the uid is logged (`console.error`) as the only handle on it, and an operator revokes this orphaned attestation from the dash.

On success the response carries no `passUrls` and no address — discovery is the member's path, not the operator's:

```json
{ "uid": "0x…", "level": "private", "announced": true, "announceTx": "0x…" }
```

Announcement discovery is not an api route. The member app pages the rights subgraph through its public Graph endpoint and performs viewing-key matching locally. The api persists neither announcement rows nor a sync cursor.

Entry for a discovered +Private right is the unchanged `/verify-signed` flow, signing the challenge with the recovered stealth private key — no wallet prompt, no separate admission path.

## Browser-based pass

`GET /pass/:uid` renders a self-contained HTML page (inline SVG QR, tier, holder, live status) for any uid a `members` row exists for; a uid fuda never issued answers `404 not_found`. A +Private row also answers `404 not_found` — its holder is a one-time stealth address only the member can recover, and the `/issue` response for it carries no `passUrls`, so there is no pass page for it to render. `GET /pass/:uid/google` answers `{ saveUrl }` (a signed Google Wallet save link) when the four `GOOGLE_*` secrets are set and `501 google_not_configured` otherwise; `GET /pass/:uid/apple.pkpass` streams a `.pkpass` when the five `APPLE_*` secrets are set and `501 apple_not_configured` otherwise. Both answer `404 not_found` for an unknown uid and for a +Private row before any platform check. The pass page carries an "Add to Google Wallet" button that stays hidden unless the Google endpoint answers `200`. Open the downloaded `.pkpass` on an iPhone, or run `openssl smime -verify -in signature -inform DER -content manifest.json -noverify` after unzipping.

The `apps/gate`, `apps/dash` and `apps/app` frontends call the api from their own Workers at `API_BASE_URL` (`http://localhost:8787` in their dev scripts), never from the browser ([ADR 0010](../../docs/adr/0010-void-pages-and-frontend-workers.md)). Each Worker sends the visitor's address in `x-real-ip`, which Cloudflare turns into `CF-Connecting-IP` on a same-zone subrequest, so the rate limits still count visitors. `corsPolicy()` in `src/middleware/cors.ts` answers no CORS for those hosts, only for the connected-app routes and the wallet's paymaster requests.

## Tests

```bash
./node_modules/.bin/vp -C apps/api test
```

Tests run inside workerd via `@cloudflare/vitest-pool-workers`, with a real D1 binding (migrations applied from `migrations/` by `test/setup.ts`) and the in-memory `FakeChain` — no network calls.

Type checking: `pnpm typecheck` (types only, run from the repo root) or `vp check` from the repo root (format + lint + type-aware type check).

## Migrations

Migrations under `migrations/` are hand-written SQL for the MVP — there is no `drizzle-kit` snapshot (`migrations/meta/`) yet. Before ever running `drizzle-kit generate` for a schema change, bootstrap that baseline snapshot first; otherwise `generate` has no prior state to diff against and re-emits every table as a new migration instead of just the change.

## One-time chain setup, secrets and deploy

Covered in [`docs/runbook.md`](../../docs/runbook.md) — chain setup order, `void secret put` names, wallet-platform setup, deploy order and the live smoke/manual checks. `apps/api/src/env.ts` is the source of truth for every deployed binding name; the local-only `USE_FAKE_CHAIN` opt-in lives in `DevBindings` in `apps/api/src/runtime.ts` instead.

## Smoke test

`scripts/smoke-live.ts` drives a live api through two ladders and exits non-zero on the first unexpected verdict:

- **bearer** — issue → preview → scan → re-scan (`ALREADY_USED`) → revoke → verify (`REVOKED`).
- **signed** — issue to a holder key, then the challenge/response gate: a QR scan answers `LEVEL_REQUIRED`, a signature from the wrong key answers `BAD_SIGNATURE` (and burns its nonce, so replaying that nonce answers `BAD_CHALLENGE`), a fresh challenge signed by the holder admits with `path: 'signature'`, replaying it answers `BAD_CHALLENGE`, and a third challenge answers `ALREADY_USED` because the right is `SINGLE_USE`. The script then revokes it and verifies `REVOKED`.

```bash
SMOKE_LADDERS=bearer,signed API_URL=https://api.fuda.sh ADMIN_TOKEN=… pnpm --filter api smoke:live
API_URL=https://api.fuda.sh ADMIN_TOKEN=… pnpm --filter api smoke:live --ladder signed
pnpm --filter api smoke:live
```

`--ladder` (or `SMOKE_LADDERS`) takes a comma-separated list of `bearer`, `signed`, or `all`; the default runs both supported ladders. `private` is rejected before any issuance, including in a mixed list. `API_URL` defaults to `http://localhost:8787`, so the script also works against a locally running `pnpm --filter api dev` (with or without `USE_FAKE_CHAIN=1`, as long as a signer is available to `/issue`/`/revoke`).

Every returned issue UID is revoked in `finally`, including when an assertion or later request fails. Signed holder keys are generated afresh per run. If the revoke request fails, the script exits non-zero; use the logged issue UID to retry `/revoke`. An interrupted process or an issue response lost after on-chain issuance still requires operational reconciliation.

Use the rights-subgraph smoke query and member app for private discovery after Graph deployment; see [The Graph in fuda](../../docs/integrations/thegraph.md).

## Endpoints

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/` | none | plain text: `fuda. api` and `health: ok` on separate lines |
| GET | `/health` | none | liveness |
| POST | `/issue` | Bearer (`ADMIN_TOKEN`) | `holder` → Signed; `memberId` → Bearer; `stealthMetaAddress` → +Private (`400 bad_meta_address` for a malformed or off-curve one) |
| GET | `/verify/:uid` | none | read-only preview, no slot consumption |
| POST | `/verify` | none | QR scan; consumes a slot per `usageModel`; a Signed-only right answers `LEVEL_REQUIRED` here; an optional `venue` (a Handle) rejects another venue's pass as `WRONG_VENUE` before any slot is used |
| POST | `/challenge` | none | mints a one-time nonce for the Signed gate; no chain lookup; sweeps expired nonces |
| POST | `/verify-signed` | none | challenge-response admission at every level, including a discovered +Private right; consumes a slot per `usageModel`, path `signature` |
| POST | `/revoke` | Bearer (`ADMIN_TOKEN`) | revokes the entitlement attestation |
| GET | `/members` | Bearer (`ADMIN_TOKEN`) | lists issued entitlements |
| GET | `/pass/:uid` | none | browser-based pass page; `404 not_found` if fuda never issued that uid, or if the row is +Private |
| GET | `/pass/:uid/card` | none | `{ card }`: the venue card behind the pass (`issuerName`, `cardTitle`, `category`, `brandColor`, `logoUrl`, `memberNumber`) for a client drawing it in the venue's look, or `card: null` for an admin-issued right; `404 not_found` for an unknown uid or a +Private row |
| GET | `/pass/:uid/google` | none | `{ saveUrl }`, a signed Google Wallet save link; `501 google_not_configured` unless all four `GOOGLE_*` secrets are set; `404 not_found` first for an unknown uid or a +Private row |
| GET | `/pass/:uid/apple.pkpass` | none | the `.pkpass` bundle; `501 apple_not_configured` unless all five `APPLE_*` secrets are set; `404 not_found` first for an unknown uid or a +Private row |
| POST, DELETE | `/apple/v1/devices/:deviceId/registrations/:passTypeId/:serial` | `ApplePass` pass token | Wallet registers or unregisters a device for a pass; `501 apple_not_configured` without `APPLE_WEB_SERVICE_SECRET` |
| GET | `/apple/v1/devices/:deviceId/registrations/:passTypeId` | the device id | serials changed since `passesUpdatedSince`, or `204` |
| GET | `/apple/v1/passes/:passTypeId/:serial` | `ApplePass` pass token | the latest `.pkpass`, or `304` on `If-Modified-Since`; a revoked pass still answers |
| POST | `/apple/v1/log` | none, per-IP budget (120/h) | Wallet's own error report, written to the Worker log |
| POST | `/ens/gateway` | none, per-IP budget (120/h) | EIP-3668 `{ sender, data }`; disabled with 503 until all four `ENS_*` bindings are configured; success `{ data }`, errors `{ message }`, always `Cache-Control: no-store` |

## Error codes

`bad_input`, `bad_uid`, `bad_qr`, `bad_meta_address`, `not_found`, `unauthorized`, `no_signer`, `chain_error`, `rpc_unavailable`, `rate_limited`, `client_ip_required`, `internal`, `google_not_configured`, `apple_not_configured`.
