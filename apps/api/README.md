# fuda-api

Cloudflare Worker (Hono) implementing the fuda MVP-1 endpoints: `GET /health`,
`POST /issue`, `GET /verify/:uid`, `POST /verify`, `POST /revoke`, `GET /members`.
`/challenge`, `/verify-signed`, `/pass/*` and `/announcements` are not
implemented yet — see Endpoints below.

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
`env.dev.vars` block already carries the matching (deterministic) values, so
`wrangler dev --env dev` works out of the box. Setting either
`SIGNER_PRIVATE_KEY` or `BASE_RPC_URL` always wins over `USE_FAKE_CHAIN` — the
fake chain is never constructed in production, only under this explicit local
opt-in.

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
- `ADMIN_TOKEN` — bearer token required by `/issue` and `/revoke`.
- `BASE_RPC_URL` — Base Sepolia RPC endpoint.

Vars (`wrangler.jsonc` `vars`):

- `EAS_ADDRESS`, `SCHEMA_REGISTRY_ADDRESS`, `FACTORY_ADDRESS` — deployed
  contract addresses.
- `EAS_SCHEMAS` — JSON map of schema kind to accepted `{ uid, version }`
  entries, produced by `register-schemas`.
- `ISSUER_ADDRESS`, `DELEGATION_UID` — the root `IssuerDelegation`.
- `API_BASE_URL` — used to build absolute `passUrls` in `/issue` responses.
- `ANNOUNCER_ADDRESS`, `ANNOUNCER_FROM_BLOCK` — reserved for the stealth
  announcer (Plan 4); unused by this plan's routes.

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
| POST | `/issue` | Bearer (`ADMIN_TOKEN`) | bearer-level entitlement only; `signed`/`private` answer `bad_input` until Plans 3–4 |
| GET | `/verify/:uid` | none | read-only preview, no slot consumption |
| POST | `/verify` | none | QR scan; consumes a slot per `usageModel` |
| POST | `/revoke` | Bearer (`ADMIN_TOKEN`) | revokes the entitlement attestation |
| GET | `/members` | Bearer (`ADMIN_TOKEN`) | lists issued entitlements |

`/challenge`, `/verify-signed`, `/pass/*` and `/announcements` arrive in
Plans 2–4.

## Error codes

`bad_input`, `bad_uid`, `bad_qr`, `unauthorized`, `no_signer`, `chain_error`,
`internal`.
