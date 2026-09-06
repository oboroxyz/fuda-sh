# fuda-api

Cloudflare Worker (Hono) implementing the fuda endpoints: `GET /health`,
`POST /issue`, `GET /verify/:uid`, `POST /verify`, `POST /revoke`,
`GET /members`, `POST /challenge`, `POST /verify-signed`, `GET /announcements`,
and the passes (`GET /pass/:uid` plus the Google Wallet and Apple Wallet
endpoints).

## Run locally

```bash
cp .dev.vars.example .dev.vars
pnpm --filter api migrate:local
pnpm --filter api dev
```

With `USE_FAKE_CHAIN=1` set in `.dev.vars` (the default in the example file)
and no `SIGNER_PRIVATE_KEY` / `BASE_RPC_URL`, the api runs against an
in-memory `FakeChain` instead of Base Sepolia — no signer, no RPC, no funds
needed. `src/index.ts` seeds a root `IssuerDelegation` on first request and
logs the `ISSUER_ADDRESS` / `DELEGATION_UID` it used; `wrangler.jsonc`'s
`env.dev.vars` block already carries the matching (deterministic) values, and
`pnpm --filter api dev` runs `wrangler dev --env dev`, so the quick start above
works as written. Both the top-level and the `env.dev` D1 block name the same
database, so `migrate:local` targets the same local database that `--env dev`
then serves; `--env dev` reads `.dev.vars.dev` when present and falls back to
`.dev.vars` otherwise. Setting either `SIGNER_PRIVATE_KEY` or `BASE_RPC_URL`
always wins over `USE_FAKE_CHAIN` — the fake chain is never constructed in
production, only under this explicit local opt-in.

## Attendance

Every `ADMIT` verdict from `POST /verify` schedules an on-chain `Attendance`
attestation via `waitUntil` — it is always on, not opt-in. The attest needs a
signer (real or `FakeChain`) and an `attendance` entry in `EAS_SCHEMAS`; if
either is missing the hook is a no-op. A failed attest is caught and logged
(`console.warn`) but never fails the admission that triggered it — attendance
is best-effort evidence, not a gate. On success the attestation UID is
written back to `entry_log.attendance_uid` for the admitting `entry_log` row.
+Private (level 2) rights are never attested; their entries live only in
`entry_log`.

## Signed level: challenge/response

`POST /issue` with a `holder` address (and no `memberId`) issues a Signed
right: `member_id` is set to the same address, EIP-55-checksummed, and the
response's `level` is `'signed'`.

Entry at the Signed level is two calls, never a QR scan:

1. `POST /challenge` — body `{ uid }`. Open endpoint, no chain lookup (a
   challenge for a nonexistent or revoked uid is minted anyway; `/verify-signed`
   rejects it at step 1). A malformed or missing `uid` answers `400 bad_uid`.
   Mints a 16-random-byte nonce, stores it in `challenges` and answers:

   ```json
   { "challenge": "fuda-gate:<uid>:<nonce>", "nonce": "<nonce>" }
   ```

   The member signs `challenge` verbatim (EIP-191 `personal_sign`) with the
   holder key. The nonce is single-use and expires 300 s after minting.

2. `POST /verify-signed` — body `{ uid, nonce, signature }`. A missing/malformed
   `uid` answers `400 bad_uid`; a well-formed `uid` with anything else wrong
   (nonce, signature) answers `400 bad_input`. Otherwise every verdict is `200`
   in one shape:

   ```json
   { "decision": "ADMIT" | "REJECT", "reason": "<Reason>", "path": "signature", "holder"?: "0x…", "stage"?: "entitlement" | "challenge" }
   ```

   Steps, in order (this order is the contract):
   1. Decode and validate the entitlement for `uid` (same rules as `/verify`:
      `NOT_FOUND`, `WRONG_SCHEMA`, `REVOKED`, delegation/timing reasons). The
      level check is `/verify`'s alone — this path accepts every level, so a
      Bearer right entered by signature is admitted, never `LEVEL_REQUIRED`.
      A rejection here answers `stage: 'entitlement'`, and carries `holder`
      only once the attestation decoded far enough to know it.
   2. Consume the challenge (`nonce` bound to `uid`, unused, inside the 300 s
      TTL) — a single conditional `UPDATE`; the write is the lock. A
      miss (replayed or expired nonce) answers `reason: 'BAD_CHALLENGE'`,
      `stage: 'challenge'`. Consuming the challenge *before* checking the
      signature is deliberate: it is the replay protection — a wrong signature
      still burns its nonce.
   3. Verify the signature (`ChainClient.verifyMessage`) against the
      challenge message and the entitlement's `holder`. A mismatch answers
      `reason: 'BAD_SIGNATURE'` (no `stage`).
   4. `SINGLE_USE` rights admit atomically via `admitSingleUse`; an
      already-consumed slot answers `reason: 'ALREADY_USED'`.
   5. Log the entry (`path: 'signature'`) and run the `onAdmit` attendance hook
      on every `ADMIT`, exactly as `/verify` does.

   **A chain failure during step 3 answers `502 chain_error` — after the
   challenge was already consumed in step 2.** This is not a decision, so it
   is not logged; the member simply fetches a new challenge (nonces are free
   and cost nothing to mint). In production, `ChainClient.verifyMessage`
   (`src/chain/viem-chain.ts`) only reaches this `502` for transport-level
   throws (`HttpRequestError`, `TimeoutError`, `RpcRequestError`) — the kind
   `FakeChain.failReads` raises for tests. Under viem 2.56.3, `publicClient
   .verifyMessage`'s own ERC-6492 deployless-call path swallows an RPC error
   internally and falls back to a pure ECDSA recover instead of throwing, so
   a live RPC outage today reads as `BAD_SIGNATURE`, not `502` — see the
   comment above `verifyMessage` in `src/chain/viem-chain.ts` for the full
   accounting.

Every REJECT and ADMIT on this path is logged with `path: 'signature'` (never
`'qr'`); a bare QR scan against a Signed-only right still answers
`LEVEL_REQUIRED` on `/verify`, unconsumed.

## +Private: stealth issuance and announcements

+Private is an extension of Signed (never a separate "third level" or "mode"):
the right still enters through `/verify-signed`, but its holder is a one-time
stealth address the member derives from a passkey rather than a wallet, and it
is never printed as a QR — there is no pass to hand over. `@fuda/stealth`
(`packages/stealth`) implements the ERC-5564 scheme-1 math: derivation from a
passkey PRF output, stealth-address generation, and announcement matching.
Every shared secret hashes the **compressed** ECDH point
(`keccak256(secp256k1.getSharedSecret(priv, pub, true))`) — an interop caveat
against other ERC-5564 implementations that hash the uncompressed point.

`POST /issue` with a `stealthMetaAddress` (and no `holder`/`memberId` pair for
Bearer/Signed) issues a +Private right:

1. The meta-address is checked before the general body parse, so a malformed
   shape or an off-curve half answers `400 bad_meta_address` rather than
   folding into the generic `bad_input`.
2. `generateStealthAddress` derives a fresh ephemeral key, the stealth
   address and a view tag from the meta-address.
3. The entitlement is attested to the derived stealth address (never the
   meta-address, never stored).
4. The api announces on-chain (`ChainClient.announce`, ERC-5564
   `Announcer.announce(1, stealthAddress, ephemeralPubKey, metadata)`) so the
   member can discover the right client-side; `metadata` carries the view tag
   and the attestation uid (`buildAnnouncementMetadata`).
5. Only after both chain writes land is the `members` row written, with
   `holder` `NULL` and `member_id` set to the supplied `memberId`.

**If the announce call fails after the attest already landed, the route
answers `502 chain_error` and persists nothing.** The right exists on chain
but no announcement points at it, so it is undiscoverable by design; the uid
is logged (`console.error`) as the only handle on it, and an operator revokes
this orphaned attestation from the dash.

On success the response carries no `passUrls` and no address — discovery is
the member's path, not the operator's:

```json
{ "uid": "0x…", "level": "private", "announced": true, "announceTx": "0x…" }
```

`GET /announcements?fromBlock=N` serves the cached ERC-5564 log to every
caller identically; the api never learns which rows are a given caller's —
matching happens client-side with the viewing key. Each call lazily syncs new
chain history into D1 first: from the persisted cursor (or
`ANNOUNCER_FROM_BLOCK`, which must be set to this deployment's actual
announcer-contract deployment block) in chunks of at most 1000 blocks
(`eth_getLogs` range cap on public Base Sepolia RPCs), stopping 5 blocks short
of the head so a re-org cannot strand a row behind the cursor, up to 5 chunks per
request so a cold deployment warms up over a few requests instead of spending
one request's whole CPU budget. Each chunk's rows and its new cursor are
applied to D1 in a single batch, so the cursor never advances past rows that
did not land; a batch insert slices its rows into groups of 12 to stay under
D1's 100-bound-parameter-per-statement limit.

The response is `{ announcements, syncedTo }`: up to 1000 rows, ascending by
block number then log index, starting from `fromBlock` (a non-integer or
negative `fromBlock` clamps to `0`). If the chain RPC is unreachable, the
route serves the stale cache with the last-known `syncedTo` rather than
failing; it answers `502 rpc_unavailable` when no cursor has ever been
persisted (nothing to serve at all), and likewise when `ANNOUNCER_FROM_BLOCK`
is unset (see Vars below).

This is the only budgeted route in the MVP: a per-IP fixed hourly window of
120 requests, tracked in D1. A missing `CF-Connecting-IP` header answers
`400 client_ip_required`; exceeding the budget answers `429 rate_limited`.
`/verify-signed` carries no such budget.

Entry for a discovered +Private right is the unchanged `/verify-signed` flow,
signing the challenge with the recovered stealth private key — no wallet
prompt, no separate admission path.

## Browser-based pass

`GET /pass/:uid` renders a self-contained HTML page (inline SVG QR, tier,
holder, live status) for any uid a `members` row exists for; a uid fuda never
issued answers `404 not_found`. A +Private row also answers `404 not_found` —
its holder is a one-time stealth address only the member can recover, and the
`/issue` response for it carries no `passUrls`, so there is no pass page for
it to render. `GET /pass/:uid/google` answers `{ saveUrl }` (a signed Google
Wallet save link) when the four `GOOGLE_*` secrets are set and
`501 google_not_configured` otherwise; `GET /pass/:uid/apple.pkpass` streams a
`.pkpass` when the five `APPLE_*` secrets are set and `501 apple_not_configured`
otherwise. Both answer `404 not_found` for an unknown uid and for a +Private row
before any platform check. The pass page carries an "Add to Google Wallet"
button that stays hidden unless the Google endpoint answers `200`. Open the
downloaded `.pkpass` on an iPhone, or run `openssl smime -verify -in
signature -inform DER -content manifest.json -noverify` after unzipping.

The `apps/gate`, `apps/dash` and `apps/app` frontends call the api at
`VITE_API_BASE_URL` (baked in at build time; defaults to
`http://localhost:8787` for local dev). `corsPolicy()` in
`src/middleware/cors.ts` allows any `http://localhost:<port>` or
`http://127.0.0.1:<port>` origin in addition to the fixed production origins,
so all three frontends' dev servers (ports 5174, 5175 and 5173) work against a
locally running api without further configuration.

## Tests

```bash
./node_modules/.bin/vp -C apps/api test
```

Tests run inside workerd via `@cloudflare/vitest-pool-workers`, with a real D1
binding (migrations applied from `migrations/` by `test/setup.ts`) and the
in-memory `FakeChain` — no network calls.

Type checking: `pnpm typecheck` (types only, run from the repo root) or
`vp check` from the repo root (format + lint + type-aware type check).

## Migrations

Migrations under `migrations/` are hand-written SQL for the MVP — there is no
`drizzle-kit` snapshot (`migrations/meta/`) yet. Before ever running
`drizzle-kit generate` for a schema change, bootstrap that baseline snapshot
first; otherwise `generate` has no prior state to diff against and re-emits
every table as a new migration instead of just the change.

## One-time chain setup, secrets and deploy

Covered in [`docs/runbook.md`](../../docs/runbook.md) — chain setup order,
`wrangler secret put` names, wallet-platform setup, deploy order and the live
smoke/manual checks. `apps/api/src/env.ts` is the source of truth for every
binding name.

## Smoke test

`scripts/smoke-live.ts` drives a live api through three ladders and exits
non-zero on the first unexpected verdict:

- **bearer** — issue → preview → scan → re-scan (`ALREADY_USED`) → revoke →
  verify (`REVOKED`).
- **signed** — issue to a holder key, then the challenge/response gate: a QR
  scan answers `LEVEL_REQUIRED`, a signature from the wrong key answers
  `BAD_SIGNATURE` (and burns its nonce, so replaying that nonce answers
  `BAD_CHALLENGE`), a fresh challenge signed by the holder admits with
  `path: 'signature'`, replaying it answers `BAD_CHALLENGE`, and a third
  challenge answers `ALREADY_USED` because the right is `SINGLE_USE`.
- **private** — issue to a stealth meta-address derived from a fixed PRF
  output, assert the response carries no `passUrls` and `/pass/:uid` answers
  `404`, page `/announcements` client-side until `matchAnnouncements` finds the
  uid, check the QR path still answers `LEVEL_REQUIRED`, admit by signing the
  challenge with the recovered stealth private key, then revoke. The revoke is
  not optional cleanup: the right is `MULTI_USE` and its stealth key is
  derivable from the script's fixed PRF bytes, so leaving it live would leave a
  usable door into a production gate.

```bash
API_URL=https://api.fuda.sh ADMIN_TOKEN=… pnpm --filter api smoke:live
API_URL=https://api.fuda.sh ADMIN_TOKEN=… pnpm --filter api smoke:live --ladder signed
SMOKE_LADDERS=bearer,private pnpm --filter api smoke:live
```

`--ladder` (or `SMOKE_LADDERS`) takes a comma-separated list of `bearer`,
`signed`, `private`, or `all`; the default is all three. `API_URL` defaults to
`http://localhost:8787`, so the script also works against a locally running
`wrangler dev` (with or without `USE_FAKE_CHAIN=1`, as long as a signer is
available to `/issue`/`/revoke`).

On a real chain the +Private announcement is only served once the sync has
passed the 5-block confirmation depth, so the private ladder polls
`/announcements` every 5 s for up to 2 minutes before failing — which doubles
as a cold deployment's sync warm-up. That poll spends at most ~24 of the
per-IP 120/h `/announcements` budget.

## Endpoints

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/health` | none | liveness |
| POST | `/issue` | Bearer (`ADMIN_TOKEN`) | `holder` → Signed; `memberId` → Bearer; `stealthMetaAddress` → +Private (`400 bad_meta_address` for a malformed or off-curve one) |
| GET | `/verify/:uid` | none | read-only preview, no slot consumption |
| POST | `/verify` | none | QR scan; consumes a slot per `usageModel`; a Signed-only right answers `LEVEL_REQUIRED` here |
| POST | `/challenge` | none | mints a one-time nonce for the Signed gate; no chain lookup; sweeps expired nonces |
| POST | `/verify-signed` | none | challenge-response admission at every level, including a discovered +Private right; consumes a slot per `usageModel`, path `signature` |
| POST | `/revoke` | Bearer (`ADMIN_TOKEN`) | revokes the entitlement attestation |
| GET | `/members` | Bearer (`ADMIN_TOKEN`) | lists issued entitlements |
| GET | `/pass/:uid` | none | browser-based pass page; `404 not_found` if fuda never issued that uid, or if the row is +Private |
| GET | `/pass/:uid/google` | none | `{ saveUrl }`, a signed Google Wallet save link; `501 google_not_configured` unless all four `GOOGLE_*` secrets are set; `404 not_found` first for an unknown uid or a +Private row |
| GET | `/pass/:uid/apple.pkpass` | none | the `.pkpass` bundle; `501 apple_not_configured` unless all five `APPLE_*` secrets are set; `404 not_found` first for an unknown uid or a +Private row |
| GET | `/announcements` | none, per-IP budget (120/h) | the cached ERC-5564 announcement log, lazily synced from chain; `502 rpc_unavailable` only with an empty cache |

## Error codes

`bad_input`, `bad_uid`, `bad_qr`, `bad_meta_address`, `not_found`,
`unauthorized`, `no_signer`, `chain_error`, `rpc_unavailable`,
`rate_limited`, `client_ip_required`, `internal`, `google_not_configured`,
`apple_not_configured`.
