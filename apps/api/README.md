# fuda-api

Cloudflare Worker (Hono) implementing the fuda endpoints: `GET /health`,
`POST /issue`, `GET /verify/:uid`, `POST /verify`, `POST /revoke`,
`GET /members`, `POST /challenge`, `POST /verify-signed`, `GET /announcements`,
and the browser-based pass (`GET /pass/:uid` and its two wallet stubs).

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
      TTL) — the spec's single conditional `UPDATE`; the write is the lock. A
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
it to render. `GET /pass/:uid/google` and
`GET /pass/:uid/apple.pkpass` are stubs that answer `501` until Plan 5 adds
the real wallet-pass builders.

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

## One-time chain setup

Before the first real deploy, the EAS schemas must be registered and a root
`IssuerDelegation` attested on Base Sepolia:

1. Fund the signer address (`privateKeyToAccount(SIGNER_PRIVATE_KEY).address`)
   with a small amount of Base Sepolia ETH.
2. Register the three fuda schemas on the EAS SchemaRegistry:

   ```bash
   SIGNER_PRIVATE_KEY=0x… pnpm --filter api register-schemas
   ```

   Prints each schema's UID and a ready-to-paste `EAS_SCHEMAS` JSON blob.

3. Attest the root `IssuerDelegation` — the signer delegating issuance rights
   to itself. There's no script for this (it runs once); a short `tsx`
   snippet:

   ```ts
   import { http, isHex } from 'viem'
   import { createWalletClient } from 'viem'
   import { privateKeyToAccount } from 'viem/accounts'
   import { baseSepolia } from 'viem/chains'
   import { EAS_ABI } from './src/eas/abi.ts'
   import { encodeDelegationV1 } from './src/eas/codecs.ts'
   import { SCHEMA_STRINGS, schemaUid } from './src/eas/schemas.ts'

   const key = process.env.SIGNER_PRIVATE_KEY
   if (key === undefined || !isHex(key)) throw new Error('SIGNER_PRIVATE_KEY required')
   const account = privateKeyToAccount(key)
   const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(process.env.BASE_RPC_URL) })
   const data = encodeDelegationV1({ issuer: account.address, active: true, name: 'fuda root' })
   const zero = `0x${'0'.repeat(64)}` as const
   const hash = await wallet.writeContract({
     abi: EAS_ABI,
     address: '0x4200000000000000000000000000000000000021',
     args: [{ data: { data, expirationTime: 0n, recipient: account.address, refUID: zero, revocable: true, value: 0n }, schema: schemaUid(SCHEMA_STRINGS.issuerDelegation) }],
     functionName: 'attest',
   })
   console.log('tx', hash)
   ```

   The returned attestation UID is `DELEGATION_UID`; `account.address` is
   `ISSUER_ADDRESS`.

4. Paste `EAS_SCHEMAS`, `DELEGATION_UID` and `ISSUER_ADDRESS` into
   `wrangler.jsonc`'s top-level `vars`.
5. Create the D1 database and paste its id into `wrangler.jsonc`:

   ```bash
   wrangler d1 create fuda
   ```

6. Apply migrations to the remote database:

   ```bash
   pnpm --filter api migrate:remote
   ```

7. Set secrets and deploy:

   ```bash
   wrangler secret put SIGNER_PRIVATE_KEY
   wrangler secret put ADMIN_TOKEN
   wrangler secret put BASE_RPC_URL
   pnpm --filter api deploy
   ```

## Secrets and vars

Secrets (`wrangler secret put`, never committed):

- `SIGNER_PRIVATE_KEY` — the issuer's EOA private key.
- `ADMIN_TOKEN` — bearer token required by `/issue`, `/revoke` and `/members`.
  Required whenever `SIGNER_PRIVATE_KEY` is set: with a signer and no token the
  api locks every admin route (`401 unauthorized`, `x-auth-mode: locked` on
  every response) and logs the reason once per isolate. With `ADMIN_TOKEN`
  unset **and no signer configured** the admin routes are open and every
  response carries `x-auth-mode: open`; local dev on the fake chain has no
  signer and so stays open.
- `BASE_RPC_URL` — Base Sepolia RPC endpoint.

Vars (`wrangler.jsonc` `vars`):

- `EAS_ADDRESS`, `SCHEMA_REGISTRY_ADDRESS`, `FACTORY_ADDRESS` — deployed
  contract addresses.
- `EAS_SCHEMAS` — JSON map of schema kind to accepted `{ uid, version }`
  entries, produced by `register-schemas`.
- `ISSUER_ADDRESS`, `DELEGATION_UID` — the root `IssuerDelegation`.
- `API_BASE_URL` — used to build absolute `passUrls` in `/issue` responses.
- `ANNOUNCER_ADDRESS` — the ERC-5564 `Announcer` contract `/issue` writes
  scheme-1 announcements to and `GET /announcements` reads them back from.
- `ANNOUNCER_FROM_BLOCK` — the floor `GET /announcements` syncs from; must be
  set to this announcer contract's actual deployment block on a live chain.
  Missing, unparseable or `0` (the checked-in placeholder) counts as
  unconfigured: the route answers `502 rpc_unavailable` without touching the
  chain rather than walking from genesis. The fake-chain dev path ignores the
  binding and floors the sync at the fake chain's head at boot.

## Smoke test

`scripts/smoke-live.ts` runs issue → verify → revoke → verify against a live
api and exits non-zero on the first unexpected verdict:

```bash
API_URL=https://api.fuda.sh ADMIN_TOKEN=… pnpm --filter api smoke:live
```

Defaults to `http://localhost:8787` when `API_URL` is unset, so it also works
against a locally running `wrangler dev` (with or without `USE_FAKE_CHAIN=1`,
as long as a signer is available to `/issue`/`/revoke`).

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
| GET | `/pass/:uid/google` | none | wallet-pass stub; `501 google_not_configured` until Plan 5 |
| GET | `/pass/:uid/apple.pkpass` | none | wallet-pass stub; `501 apple_not_configured` until Plan 5 |
| GET | `/announcements` | none, per-IP budget (120/h) | the cached ERC-5564 announcement log, lazily synced from chain; `502 rpc_unavailable` only with an empty cache |

## Error codes

`bad_input`, `bad_uid`, `bad_qr`, `bad_meta_address`, `not_found`,
`unauthorized`, `no_signer`, `chain_error`, `rpc_unavailable`,
`rate_limited`, `client_ip_required`, `internal`, `google_not_configured`,
`apple_not_configured`.
