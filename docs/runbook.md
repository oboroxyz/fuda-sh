# Deploy runbook

Operator instructions for standing up fuda on Cloudflare and Base Sepolia, in
order.

## 1. Prerequisites

- A Cloudflare account with the `fuda.sh` zone already added.
- A funded Base Sepolia EOA — this becomes the signer. Fund it with a small
  amount of Base Sepolia ETH before step 2.
- A Graph Studio account for the rights subgraph. A Graph Market token and two
  compatible Firehose endpoints are additionally required only for the
  Substreams evidence run in [`graph-demo.md`](./graph-demo.md).
- `pnpm install --frozen-lockfile` from the repo root.

## 2. One-time chain setup

Run these in order; each fills a placeholder the next step or the deploy
depends on.

1. Fund the signer address (`privateKeyToAccount(SIGNER_PRIVATE_KEY).address`)
   with Base Sepolia ETH.
2. Register the three fuda schemas on the EAS SchemaRegistry:

   ```bash
   SIGNER_PRIVATE_KEY=0x… pnpm --filter api register-schemas
   ```

   Prints each schema's UID and a ready-to-paste `EAS_SCHEMAS` JSON blob.
   Paste it into `apps/api/wrangler.jsonc`'s top-level `vars.EAS_SCHEMAS`.

3. Attest the root `IssuerDelegation` — the signer delegating issuance to
   itself:

   ```bash
   SIGNER_PRIVATE_KEY=0x… pnpm --filter api attest-root-delegation
   ```

   Prints `ISSUER_ADDRESS` (the signer) and `DELEGATION_UID` (the new
   attestation). Paste both into `wrangler.jsonc`'s top-level `vars`. The
   script warns (but still proceeds) if `DELEGATION_UID` is already set in
   the environment, and it attests under the newest `issuerDelegation` uid in
   an exported `EAS_SCHEMAS` when present, falling back to the deterministic
   uid of the current schema string otherwise (`apps/api/scripts/attest-root-delegation.ts:22-39`).
   Idempotence is the operator's: run this once per deployment; a second run
   mints a second, equally valid delegation.

   Create the media bucket before the first deploy:

   ```bash
   wrangler r2 bucket create fuda-media-dev
   ```

   Its `MEDIA_BUCKET` binding is already in `wrangler.jsonc`. Until the bucket
   exists, logo upload answers `501 media_not_configured` and every other
   surface works unbranded. Every environment owns its own bucket, because an
   R2 bucket cannot be renamed and develop must never read or overwrite a
   production venue's mark: `fuda-media-dev` here, `fuda-media` for
   mainnet, `fuda-media-local` for `wrangler dev --remote` only (a plain
   `wrangler dev` simulates R2 locally, so that one rarely needs creating).
   Nothing outside `wrangler.jsonc` sees a bucket name — the public URL is
   `/assets/:handle/logo/:variant` and D1 stores only the relative
   `logos/<uuid>` prefix — so a bucket can be swapped later by copying objects
   and editing one line.

   `PUBLIC_BASE_URL` (top-level `vars`) is the member-facing origin the
   dashboard's published card links to, `https://fuda.sh`; the `env.local` value
   is the app dev port. It never needs regenerating.

4. Look up the `Announcer` contract's deployment block on the Base Sepolia
   explorer and set the top-level `vars.ANNOUNCER_FROM_BLOCK` to it. The
   checked-in placeholder is `"0"`. This value is the start block used when
   generating both data sources in the rights-subgraph manifest; it is not an
   API binding or a D1 cache floor. `pnpm graph:prepare` rejects zero, missing,
   and malformed values.
5. Create the D1 database and paste its id into both `database_id`
   placeholders in `apps/api/wrangler.jsonc` (the top-level `d1_databases`
   entry and the one repeated under `env.local`):

   ```bash
   wrangler d1 create fuda-beta
   ```

6. Apply migrations to the remote database:

   ```bash
   pnpm --filter api migrate:remote
   ```

### ENSv2 parent and hybrid resolver topology

The D1 migrations create the `ens_names` mirror and `stealth_resolutions`
ledger. The API exposes `POST /ens/gateway`, and `packages/ens-contracts`
contains the matching hybrid ENSIP-10 resolver, issuer registrar, pinned
ETHOnline 2026 Sepolia address family, and noninteractive deployment tools.
The gateway route fails closed with 503 unless all four API-side ENS bindings
are present, so the ordinary deployment above does not need placeholder ENS
values.

Use only the dedicated deployment on Ethereum Sepolia (`11155111`). Every
client must use its Universal Resolver override
`0xd26f2040d083af1cd2962ba303f4bea0c4faf142`; do not substitute normal
Sepolia ENS addresses. Keep the parent, voucher, gateway, allocation, and EAS
issuer keys separate, and never paste real keys into a checked-in file.

Run the read-only preflight first:

```bash
ENS_RPC_URL=https://… pnpm --filter @fuda/ens-contracts ens:preflight
```

Register the parent with the two-step commit/reveal flow:

```bash
ENS_RPC_URL=https://… ENS_PARENT_ADDRESS=0x… ENS_PARENT_KEY=0x… ENS_COMMITMENT_SECRET=0x… ENS_PARENT_DURATION=31536000 pnpm --filter @fuda/ens-contracts ens:parent:commit
ENS_RPC_URL=https://… ENS_PARENT_ADDRESS=0x… ENS_PARENT_KEY=0x… ENS_COMMITMENT_SECRET=0x… ENS_PARENT_DURATION=31536000 pnpm --filter @fuda/ens-contracts ens:parent:reveal
```

After a fresh successful commit, rerun the commit command safely: it recognizes
the existing commitment without sending and reports `readyAt` and `expiresAt`.
Reveal is accepted when the confirmed commitment age is inclusively between
the registrar's `MIN_COMMITMENT_AGE` and `MAX_COMMITMENT_AGE`. Before the
minimum it stops without sending; after the maximum, submit a new commit. Reuse
the same `ENS_COMMITMENT_SECRET`, owner, and duration for reveal.

Deploy and wire the fuda User Registry, shared resolver, and registrar:

```bash
ENS_RPC_URL=https://… ENS_PARENT_KEY=0x… ENS_VOUCHER_KEY=0x… ENS_GATEWAY_SIGNER_KEY=0x… pnpm --filter @fuda/ens-contracts ens:topology:deploy
```

Topology deployment is resumable. Set `ENS_PARENT_ADDRESS` as a public owner
assertion, and set any already-created `ENS_USER_REGISTRY_ADDRESS`,
`ENS_RESOLVER_ADDRESS`, and `ENS_REGISTRAR_ADDRESS` values before retrying.
Every supplied or discovered address is checked for runtime code, owner,
implementation, immutables, and compatible existing links before any later
send. The command reports a newly confirmed address before subsequent reads,
so retain that public progress output if a verification read interrupts the
run.

Run standalone verification with public values only:

```bash
ENS_RPC_URL=https://… ENS_PARENT_ADDRESS=0x… ENS_VOUCHER_SIGNER_ADDRESS=0x… ENS_GATEWAY_SIGNER_ADDRESS=0x… ENS_USER_REGISTRY_ADDRESS=0x… ENS_RESOLVER_ADDRESS=0x… ENS_REGISTRAR_ADDRESS=0x… pnpm --filter @fuda/ens-contracts ens:verify
```

Preflight and standalone verification are read-only. The parent commit,
parent reveal, and topology deployment commands mutate Sepolia.

**These steps have been run.** `fuda.eth` is registered and the topology is
deployed and verified; the commands above are kept for a rebuild or a second
environment. The addresses are in
[`ens-naming.md`](./specs/ens-naming.md#shipped-implementation-boundary), and
`ens:verify` re-checks them from public values alone. Live `.eth` resolution
through a third-party client remains outstanding.

Keep the parent key. It is the User Registry's root principal and the only way
to rotate the voucher or gateway signer, so losing it is unrecoverable — a
password manager, not just `packages/ens-contracts/.env`.

After topology verification, configure the API with the five claim bindings in
§3 alongside `ENS_PARENT_NAME=fuda.eth` and the shared resolver in
`ENS_RESOLVER_ADDRESSES`. Every claim route answers `503 ens_not_configured`
until all of them are present, and the dashboard leaves the section out
entirely rather than offering a button that could only fail.

The DNSSEC TXT value required to expose the `.eth` tree through `fuda.sh` is:

```text
ENS1 0x005a3bf1d92ebe4b1e1641a0c6fa49f38e1762a6 sh eth
```

This value is documented only. The `fuda.sh` zone was not changed, and the
alias must not be treated as live until DNSSEC and scratch resolution are
verified operationally.

## 3. Secrets

Set with `wrangler secret put <NAME>` from `apps/api`:

- `SIGNER_PRIVATE_KEY` — the issuer's EOA private key.
- `ADMIN_TOKEN` — **required whenever a chain binding is set.** With
  `SIGNER_PRIVATE_KEY` or `BASE_RPC_URL` configured and no `ADMIN_TOKEN`, the
  api locks every admin route (`401 unauthorized`) and every response carries
  `x-auth-mode: locked`. This is deliberate fail-closed behavior, not a
  misconfiguration to work around.
- `BASE_RPC_URL` — Base Sepolia RPC endpoint.
- `ENS_GATEWAY_SIGNER_KEY` — dedicated 32-byte ECDSA private key that signs
  gateway responses. Do not reuse `SIGNER_PRIVATE_KEY` or the ENS parent key.
- `ENS_GATEWAY_SECRET` — separate 32-byte HMAC key used to derive deterministic
  one-time +Private destinations.
- `ENS_VOUCHER_KEY` — dedicated 32-byte ECDSA private key that signs claim and
  renew vouchers. It is the key the deployed registrar checks against, so it
  must be the same one `ens:topology:deploy` was given, and it must not be the
  gateway signer, the parent key, or `SIGNER_PRIVATE_KEY`.
- `ENS_SEPOLIA_RPC_URL` — Ethereum Sepolia RPC. A secret rather than a var,
  because an Alchemy endpoint carries its API key in the path.
- `ENS_PAYMASTER_UPSTREAM` — the vendor's ERC-7677 paymaster endpoint. With
  Alchemy this is the same URL as above; the bindings stay separate so the
  paymaster vendor can change without touching the chain reads.
- `GOOGLE_ISSUER_ID`, `GOOGLE_CLASS_ID`, `GOOGLE_SA_EMAIL`, `GOOGLE_SA_KEY_PEM`
  — see §4.
- `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_CERT_PEM`, `APPLE_KEY_PEM`,
  `APPLE_WWDR_PEM` — see §5.

PEM secrets (`GOOGLE_SA_KEY_PEM`, `APPLE_CERT_PEM`, `APPLE_KEY_PEM`,
`APPLE_WWDR_PEM`): paste the PEM block as-is. A PEM copied straight out of a
service-account JSON keeps its literal `\n` escapes; the api normalizes
either form, so there is no need to reformat it first.

See `apps/api/src/env.ts` for the full binding list and `apps/api/README.md`
for what each secret gates at the route level.

## 4. Google Wallet setup

1. Create a Google Wallet issuer account.
2. Create a GenericClass whose id matches `GOOGLE_CLASS_ID`. `GOOGLE_CLASS_ID`
   is used verbatim as the object's `classId`, so it must be the
   fully-qualified `<issuerId>.<suffix>` id. `GET /pass/:uid/google` signs the
   save-link JWT locally (`packages/pass/src/google.ts`) and does not check
   the class against Google's API, so a missing or mismatched class is not
   caught there — it fails only when the holder opens the save link.
3. Request publishing approval — this can take time, so start it early.
4. While unapproved, add the demo phones' Google accounts as testers so
   `/pass/:uid` → "Add to Google Wallet" works for the demo before approval
   lands.

Set the four `GOOGLE_*` secrets (§3). All four must be set, or
`GET /pass/:uid/google` answers `501 google_not_configured`.

## 5. Apple Wallet setup

Request the Pass Type ID certificate early — this has real lead time and is
often the long pole. Export the certificate and its PKCS#8 private key as
PEM, and download the WWDR intermediate certificate.

Set the five `APPLE_*` secrets (§3). If the certificate has not arrived yet,
leave all five unset: `GET /pass/:uid/apple.pkpass` answers
`501 apple_not_configured` and the browser pass (`GET /pass/:uid`) is the
floor — the demo does not depend on Apple Wallet being ready.

## 6. Build env for the frontends

`VITE_*` values are baked into the bundle at build time, so they must be set
in the environment of the build, not the deploy. Keep the production values in
each app's `.env.production` (gitignored; copy the keys from `.env.example`):
Vite reads it automatically on `vite build`, so a plain `pnpm --filter <app> run
deploy` from that machine ships the right bundle, and an environment variable
still overrides it. A deploy from a machine without that file silently bakes
empty values in (the app then reports "rights discovery is not configured"). Each app's `.env.example`
lists what it reads; the production values are:

```bash
VITE_API_BASE_URL=https://api.fuda.sh   # gate, dash, app
VITE_GRAPH_RIGHTS_ENDPOINT=https://gateway.thegraph.com/api/<PUBLIC_KEY>/subgraphs/id/<SUBGRAPH_ID> # dash, app
VITE_ENS_PAYMASTER_URL=https://api.fuda.sh/v1/ens/paymaster  # dash only, and the one VITE_* that carries the version prefix: the wallet fetches this URL as given
VITE_APP_ORIGIN=https://app.fuda.sh     # app only
VITE_RP_ID=fuda.sh                      # app only
```

The Graph endpoint is browser-visible. Use a public gateway key restricted to
the deployed subgraph, or a same-origin proxy; never put a Studio deploy key in
a `VITE_*` value.

## 7. Build and deploy the rights subgraph

After the top-level production `EAS_SCHEMAS` and `ANNOUNCER_FROM_BLOCK` values
are populated from live receipts, generate and verify the deployable manifest:

```bash
pnpm graph:prepare
pnpm graph:codegen
pnpm graph:test
pnpm graph:build
```

`graph:prepare` deliberately fails while the checked-in placeholders remain.
Create the subgraph in Graph Studio, then authenticate and deploy from its
independently installed package:

```bash
cd packages/subgraphs/rights
pnpm --ignore-workspace exec graph auth --studio <DEPLOY_KEY>
pnpm --ignore-workspace exec graph deploy --studio <SUBGRAPH_SLUG>
```

Use the Studio query URL for the controlled event demo. Before building the
browser clients, provision a public gateway endpoint (or same-origin proxy) and
use it as `VITE_GRAPH_RIGHTS_ENDPOINT`. Deployment and receipt comparison are
live gates; follow [`graph-demo.md`](./graph-demo.md) and retain its evidence.

## 8. Deploy order

Deploy the rights subgraph first so its public query endpoint can be baked into
the member app and dashboard. Then deploy the api and the three frontends:

```bash
pnpm --filter api run deploy

VITE_API_BASE_URL=https://api.fuda.sh pnpm --filter gate run deploy
VITE_API_BASE_URL=https://api.fuda.sh VITE_GRAPH_RIGHTS_ENDPOINT=<PUBLIC_GRAPH_ENDPOINT> \
  pnpm --filter dash run deploy
VITE_API_BASE_URL=https://api.fuda.sh VITE_GRAPH_RIGHTS_ENDPOINT=<PUBLIC_GRAPH_ENDPOINT> \
  VITE_APP_ORIGIN=https://app.fuda.sh VITE_RP_ID=fuda.sh \
  pnpm --filter app run deploy
```

Each app's `deploy` script builds then runs `wrangler deploy`. Every
`wrangler.jsonc` declares its hostname as a custom domain — `api.fuda.sh`,
`gate.fuda.sh`, `dash.fuda.sh`, and `app.fuda.sh` — so the first deploy of each
Worker attaches it; the zone must already be on the account. The `fuda.sh/@*`
redirect is a zone-level Single Redirect and is not managed by Wrangler.
Validate config without shipping with
`pnpm --filter api run deploy -- --dry-run` (or `pnpm --filter <app> run deploy --
--dry-run` for a frontend).

## 9. Live smoke

```bash
curl -i https://api.fuda.sh/health
```

`x-auth-mode` is a response header, so `-i` is needed to see it. Expect the
header to be **absent**. If it is present, the deploy is misconfigured:
`locked` means `ADMIN_TOKEN` is unset while a chain binding — a signer
(`SIGNER_PRIVATE_KEY`) or `BASE_RPC_URL` — is configured, so the admin routes
are 401ing everything; `open` means no token and neither binding is set, so the
admin routes are unauthenticated. Both are fail states in production, not
acceptable resting states (see `apps/api/src/middleware/admin-auth.ts`).

`locked` stops the admin token, not a venue: `/members` and `/revoke` resolve a
passkey session first, so a signed-in operator still reaches their own members
either way. That is the point of the scoping — a venue's access does not depend
on fuda's deployment secret.

```bash
API_URL=https://api.fuda.sh ADMIN_TOKEN=… \
  pnpm --filter api smoke:live --ladder bearer,signed,card
```

Runs the supported ladders end to end against the live API. The `card` ladder
is the one that covers the venue's own front door — an operator signs in with
their wallet, publishes a card, and a member claims it off the public page with
no admin token — so it exercises what a phone in the queue does. It mints a
fresh operator key and a fresh handle each run and leaves both behind in the
database; that is deliberate, since one address may own only one venue.
There is no `private` ladder: discovery is a browser-to-Graph query and the
script would have nothing to drive. Verify +Private discovery through the rights subgraph
and member app, then enter through the ordinary Signed challenge-response flow,
as documented in [`graph-demo.md`](./graph-demo.md). The Attendance attestation
for the Bearer/Signed ladder's ADMIT verdicts appears on the Base Sepolia
explorer within a few blocks.

Once ENS is configured, send one known ENSIP-10 request through the deployed
resolver or directly to `POST /ens/gateway`. A successful direct response is
`{"data":"0x…"}` with `Cache-Control: no-store`; malformed, unknown, and
infrastructure failures use `{"message":"…"}` and are also never cached. The
gateway is public, so do not send `ADMIN_TOKEN`.

Query the deployed rights subgraph with real right, delegation, and Attendance
UIDs using `packages/subgraphs/rights/queries/smoke.graphql`, and compare the
returned holders, metadata, relations, announcement identity, and revocation
timestamps with their transaction receipts. The complete command and evidence
template are in [`graph-demo.md`](./graph-demo.md).

## 10. Manual checks that no script covers

- **WebAuthn PRF.** On a real phone, open `https://app.fuda.sh/private`,
  create a passkey, and confirm the derived meta-address renders.
- **ERC-6492 (undeployed smart wallet).** Issue a Signed right to a Base
  Account (passkey smart wallet) address, then enter it at
  `https://app.fuda.sh/signed` *before* that account is deployed on chain —
  the api must still answer `ADMIT` through the ERC-6492 counterfactual
  path. This is the one path the fake chain cannot exercise, so it must be
  run once against Base Sepolia before the deploy is called done.
- **Google Wallet.** Open `/pass/<uid>` on an Android phone and tap "Add to
  Google Wallet".
- **Apple Wallet.** Open `/pass/<uid>/apple.pkpass` on an iPhone.

## 11. Reconciliation

Two writes are deliberately non-atomic across the chain and D1; check both
after a deploy and periodically thereafter (see
`docs/specs/attestation-model.md` for the full model):

- **Orphan attestations.** A `502 chain_error` on `/issue` after the uid was
  logged means the right was attested on chain but the announcement or the
  `members` row write failed. Revoke that uid from the dashboard, or re-issue
  (a re-run attests a second right, so the orphan becomes the duplicate to
  revoke).
- **Lost `attendance_uid`.** Attendance attests best-effort after the
  verdict; a failed attest leaves the admission standing but the on-chain
  evidence missing. List them, from `apps/api`:

  ```bash
  wrangler d1 execute fuda --remote --command "SELECT id, uid, at FROM entry_log WHERE decision = 'ADMIT' AND attendance_uid IS NULL"
  ```

## 12. Local development

```sh
pnpm install --frozen-lockfile
pnpm check      # format + lint + type check (vp check)
pnpm typecheck  # types only (vp check --no-fmt --no-lint)
pnpm test       # every package's tests (workerd for the api)
```

`pnpm dev` starts the whole local stack on the fixed ports below. A single
surface starts with `pnpm dev:api`, `pnpm dev:app`, `pnpm dev:gate`, or
`pnpm dev:dash`; a frontend on its own still needs `pnpm dev:api` running in
another terminal for live api calls.

| Surface | Path | Dev |
| --- | --- | --- |
| api | `apps/api` | `pnpm --filter api dev` — http://localhost:8787 (`wrangler dev --env local`) |
| member app | `apps/app` | `pnpm --filter app dev` — http://localhost:5173 |
| gate scanner | `apps/gate` | `pnpm --filter gate dev` — http://localhost:5174 |
| dashboard | `apps/dash` | `pnpm --filter dash dev` — http://localhost:5175 |

The frontends read the same `VITE_*` names as step 6, with different local
values. They are baked in at build time, so changing one means restarting the
dev server.

- **`VITE_API_BASE_URL`** (gate, dash, app) — defaults to
  `http://localhost:8787`, so a local api needs no override.
- **`VITE_GRAPH_RIGHTS_ENDPOINT`** (dash, app) — the public Graph endpoint the
  on-chain status views read; the member app also loads raw announcements from
  it before matching them locally. There is no local substitute; point it at a
  deployed rights subgraph.
- **`VITE_APP_ORIGIN`** (app) — set it to `http://localhost:5173`, or the
  `/signed` gate bounces to the production origin (`https://app.fuda.sh`)
  instead of running locally. The apex and the app are one Worker, and
  `/signed`, `/private`, and `/rights` render only on the app origin, which is
  the only one the api's CORS list allows.
- **`VITE_RP_ID`** (app) — set it to `localhost`, or the browser refuses the
  production default (`fuda.sh`), which is not a registrable suffix of the dev
  host.

See `apps/api/README.md` for the api side: `USE_FAKE_CHAIN=1` (set it in
`apps/api/.dev.vars` to run without a signer), `.dev.vars.example`, and the
deterministic `env.local` block in `apps/api/wrangler.jsonc`. Local D1 state
under `.wrangler/state` persists across `wrangler dev` restarts; wipe it if the
fake chain's world (schemas,
delegation, seeded rows) changes shape. `.dev.vars` is read both by
`wrangler dev` during local dev and by the workerd test pool during `vp
test`; `apps/api/test/env.ts` strips it back out for every test, so `vp test`
never depends on `.dev.vars` being present or on what it contains.

## 13. Rate-limit state

`POST /ens/gateway` is the only currently budgeted product route. It uses a
fixed hourly D1 budget of 120 requests per IP. Announcement discovery is a
browser-to-Graph query and does not pass through the API. The gate routes
(`/verify`, `/challenge`, `/verify-signed`) and the admin routes (`/issue`,
`/revoke`, `/members`) are never budgeted.

## Mainnet cutover

Today's top-level `wrangler.jsonc` is the Base Sepolia deployment that owns
`api.fuda.sh` and its sibling hostnames. At release it keeps the Sepolia chain
and becomes the internal **develop** environment (branch `develop`), while
`env.production` takes mainnet and the apex hostnames.

Nothing is migrated. A Sepolia Entitlement is meaningless on mainnet, so
production starts with an empty database and an empty bucket, and every member
re-claims. That is why each environment owns its own resources rather than
sharing them:

| Resource | Develop (Sepolia) | Production (mainnet) |
| --- | --- | --- |
| D1 | `fuda-beta` — the existing database, kept under its name because D1 has no rename and `database_id` is what binds | `fuda`, created at cutover |
| R2 | `fuda-media-dev` | `fuda-media` |
| Worker | `fuda-api` | `fuda-api-production`, or rename in the env block |
| Hostnames | `*.dev.fuda.sh` after the cutover | `*.fuda.sh` |
| Chain id | `84532` | `8453` |

EAS and the SchemaRegistry are OP-stack predeploys at the same addresses on
both networks, so those two `vars` do not change. The ERC-5564 Announcer is a
separate deployment: confirm the mainnet address before reusing the Sepolia
one rather than assuming the singleton is at the same place.

`env.production` deliberately carries `routes: []`. Adding a custom domain
there before the Sepolia deployment has moved off it would take a live
hostname away from the running beta, so the order matters:

1. Register the mainnet EAS schemas and attest the root delegation, then fill
   `env.production`'s `EAS_SCHEMAS`, `ISSUER_ADDRESS`, `DELEGATION_UID` and
   `ANNOUNCER_FROM_BLOCK`. Until then issuance answers `502 chain_error`
   rather than attesting under the wrong configuration.
2. `wrangler d1 create fuda` and paste the id; `wrangler r2 bucket create fuda-media`.
3. Set every secret again for the environment (`wrangler secret put … --env production`).
   The mainnet root must be a Safe with a hot issuer, not the Sepolia EOA.
4. Apply migrations against the new database and deploy `--env production`
   with no routes; smoke it on its `workers.dev` hostname.
5. Move the Sepolia deployment to `*.dev.fuda.sh`, then add the apex custom
   domains to `env.production` and redeploy both.
6. Rebuild the three frontends with the production `VITE_*` values; their
   `VITE_API_BASE_URL` decides which api a bundle talks to, so a develop build
   must point at the develop api.
7. Change the passkey wallet's chain id. `apps/app/src/base-account.ts` and
   `apps/dash/src/wallet.ts` construct the Base Account SDK with
   `appChainIds: [84_532]`; a mainnet build must pass `8453` or the operator
   signs against the wrong network. This is source, not a `VITE_*` value, so a
   rebuild alone does not fix it.

## Rolling back

Each surface is its own Worker, so a bad deploy is undone per surface with
`wrangler rollback` from that app's directory; it restores the previous
deployment of that Worker and touches nothing else. Roll the api back first
when a release changed both the api and a frontend, because a frontend bundle
is built against an api contract and the older bundle is the one that matches
the older api.

Three kinds of state do not roll back with the code, and each needs its own
treatment.

**D1 migrations are forward-only.** A shipped migration is never edited: the
migrations table records it as applied, so an edit changes what a fresh
database gets while leaving every existing one untouched, and the two diverge
silently. Fix by adding a migration. Keep a migration additive where the
release it belongs to might be rolled back — an added column is invisible to
the older code, whereas a dropped or renamed one takes the older code down
with it.

**Chain state is append-only.** Schemas and attestations cannot be deleted. A
root delegation attested by mistake is revoked, not removed, and revocation is
what the gate reads: an Entitlement under a revoked delegation stops admitting
without anything being rewritten. Because `EAS_SCHEMAS` accepts a set of
versions, a schema registered in error is retired by removing it from that set
rather than by touching the chain.

**R2 objects are immutable under their prefix.** Rolling the api back does not
un-write a logo, and it does not need to: the issuer row names the prefix, so
restoring the previous row restores the previous mark, and the version in the
public URL keeps caches honest either way.
