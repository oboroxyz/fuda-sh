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

4. Look up the `Announcer` contract's deployment block on the Base Sepolia
   explorer and set the top-level `vars.ANNOUNCER_FROM_BLOCK` to it. The
   checked-in placeholder is `"0"`. This value is the start block used when
   generating both data sources in the rights-subgraph manifest; it is not an
   API binding or a D1 cache floor. `pnpm graph:prepare` rejects zero, missing,
   and malformed values.
5. Create the D1 database and paste its id into both `database_id`
   placeholders in `apps/api/wrangler.jsonc` (the top-level `d1_databases`
   entry and the one repeated under `env.dev`):

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
parent reveal, and topology deployment commands mutate Sepolia. All three
mutation commands are prepared but were not executed as part of repository
implementation; running them requires credentials and explicit operational
authorization. Live `.eth` resolution checks also remain outstanding.

After topology verification, configure the API with
`ENS_PARENT_NAME=fuda.eth` and the shared resolver in
`ENS_RESOLVER_ADDRESSES`, plus independent `ENS_GATEWAY_SIGNER_KEY` and
`ENS_GATEWAY_SECRET` secrets. B1 issuer onboarding, voucher issuance,
naming-mirror writes, and lifecycle/unregister integration must land before
normal product flows populate and maintain these names.

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
in the environment of the build, not the deploy. Each app's `.env.example`
lists what it reads; the production values are:

```bash
VITE_API_BASE_URL=https://api.fuda.sh   # gate, dash, app
VITE_GRAPH_RIGHTS_ENDPOINT=https://gateway.thegraph.com/api/<PUBLIC_KEY>/subgraphs/id/<SUBGRAPH_ID> # dash, app
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

```bash
API_URL=https://api.fuda.sh ADMIN_TOKEN=… \
  pnpm --filter api smoke:live --ladder bearer,signed
```

Runs the supported bearer and signed ladders end to end against the live API.
Do not select the script's legacy `private` ladder: it still expects the removed
API announcement route. Verify +Private discovery through the rights subgraph
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

See `apps/api/README.md` for local dev: `USE_FAKE_CHAIN=1` and
`.dev.vars.example`, the deterministic `env.dev` block in
`apps/api/wrangler.jsonc`, and the four dev ports (api 8787, gate 5174, dash
5175, app 5173). Local D1 state under `.wrangler/state` persists across
`wrangler dev` restarts; wipe it if the fake chain's world (schemas,
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
