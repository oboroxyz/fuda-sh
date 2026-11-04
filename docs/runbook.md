# Deploy runbook

Operator instructions for standing up fuda on Cloudflare and Base Sepolia, in order. The checked-in `develop` target of the api (`apps/api/targets.jsonc`) already contains the Sepolia schema UIDs, root delegation, database id, and Announcer start block. The bootstrap steps below are for a new deployment; verify and reuse the existing resources when operating this checkout.

For local setup, start at [Local development](#12-local-development). API paths in prose omit `/v1` except for the unversioned pass, asset, ENS gateway, and health routes; see [API versioning](./specs/attestation-model.md#api-versioning).

## 1. Prerequisites

- A Cloudflare account with the `fuda.sh` zone already added.
- A funded Base Sepolia EOA — this becomes the signer. Fund it with a small amount of Base Sepolia ETH before step 2.
- A Graph Studio account for the rights subgraph. A Graph Market token and two compatible Firehose endpoints are additionally required only for the Substreams verification in [`integrations/thegraph.md`](./integrations/thegraph.md).
- `pnpm install --frozen-lockfile` from the repo root.

## 2. One-time chain setup

Run these in order; each fills a placeholder the next step or the deploy depends on.

1. Fund the signer address (`privateKeyToAccount(SIGNER_PRIVATE_KEY).address`) with Base Sepolia ETH.
2. Register the three fuda schemas on the EAS SchemaRegistry:

   ```bash
   SIGNER_PRIVATE_KEY=0x… pnpm --filter api register-schemas
   ```

   Prints each schema's UID and a ready-to-paste `EAS_SCHEMAS` JSON blob. Paste it into `vars.EAS_SCHEMAS` of the `develop` target in `apps/api/targets.jsonc`.

3. Attest the root `IssuerDelegation` — the signer delegating issuance to itself:

   ```bash
   SIGNER_PRIVATE_KEY=0x… pnpm --filter api attest-root-delegation
   ```

   Prints `ISSUER_ADDRESS` (the signer) and `DELEGATION_UID` (the new attestation). Paste both into the `develop` target's `vars` in `targets.jsonc`. The script warns (but still proceeds) if `DELEGATION_UID` is already set in the environment, and it attests under the newest `issuerDelegation` uid in an exported `EAS_SCHEMAS` when present, falling back to the deterministic uid of the current schema string otherwise (`apps/api/scripts/attest-root-delegation.ts:22-39`). Idempotence is the operator's: run this once per deployment; a second run mints a second, equally valid delegation.

   Create the media bucket before the first deploy:

   ```bash
   cf r2 buckets create --name fuda-media-dev
   ```

   Its `MEDIA_BUCKET` binding is already in `targets.jsonc`. An absent `MEDIA_BUCKET` binding makes logo upload answer `501 media_not_configured`. A configured bucket must exist before deployment. Every environment owns its own bucket, because an R2 bucket cannot be renamed and develop must never read or overwrite a production venue's mark: `fuda-media-dev` here, `fuda-media` for mainnet, `fuda-media-local` for remote-binding local runs only (local dev simulates R2, so that one rarely needs creating). Nothing outside `targets.jsonc` sees a bucket name — the public URL is `/assets/:handle/logo/:variant` and D1 stores only the relative `logos/<uuid>` prefix — so a bucket can be swapped later by copying objects and editing one line.

   `PUBLIC_BASE_URL` (`develop` `vars`) is the member-facing origin the dashboard's published card links to, `https://fuda.sh`; the `local` value is the app dev port. It never needs regenerating.

4. Look up the `Announcer` contract's deployment block on the Base Sepolia explorer and set the `develop` target's `vars.ANNOUNCER_FROM_BLOCK` to it. The checked-in Sepolia value is `"7552655"`; a fresh deployment must verify its own value. This value is the start block used when generating both data sources in the rights-subgraph manifest; it is not an API binding or a D1 cache floor. `pnpm graph:prepare` rejects zero, missing, and malformed values.
5. Create the D1 database and paste its id into both `database_id` entries in `apps/api/targets.jsonc` (the `develop` and `local` targets):

   ```bash
   cf d1 create --name fuda-beta
   ```

6. Apply migrations to the remote database:

   ```bash
   pnpm --filter api migrate:remote
   ```

Apply migration `0009_session_audience.sql` before deploying the member-login API. It adds the member/operator audience to existing session storage, preserving old operator sessions. Member login uses the same API and signature-verification chain configuration as dashboard login; no new Worker, domain or member database is needed. The app's Base Account sign-in is separate from its dedicated +Private PRF passkey.

### ENSv2 parent and hybrid resolver topology

The D1 migrations create the `ens_names` mirror and `stealth_resolutions` ledger. The API exposes `POST /ens/gateway`, and `packages/ens-contracts` contains the matching hybrid ENSIP-10 resolver, issuer registrar, pinned ETHOnline 2026 Sepolia address family, and noninteractive deployment tools. The gateway route fails closed with 503 unless all four API-side ENS bindings are present, so the ordinary deployment above does not need placeholder ENS values.

Use only the dedicated deployment on Ethereum Sepolia (`11155111`). Every client must use its Universal Resolver override `0xd26f2040d083af1cd2962ba303f4bea0c4faf142`; do not substitute normal Sepolia ENS addresses. Keep the parent, voucher, gateway, allocation, and EAS issuer keys separate, and never paste real keys into a checked-in file.

Run the read-only preflight first:

```bash
ENS_RPC_URL=https://… pnpm --filter @fuda/ens-contracts ens:preflight
```

Register the parent with the two-step commit/reveal flow:

```bash
ENS_RPC_URL=https://… ENS_PARENT_ADDRESS=0x… ENS_PARENT_KEY=0x… ENS_COMMITMENT_SECRET=0x… ENS_PARENT_DURATION=31536000 pnpm --filter @fuda/ens-contracts ens:parent:commit
ENS_RPC_URL=https://… ENS_PARENT_ADDRESS=0x… ENS_PARENT_KEY=0x… ENS_COMMITMENT_SECRET=0x… ENS_PARENT_DURATION=31536000 pnpm --filter @fuda/ens-contracts ens:parent:reveal
```

After a fresh successful commit, rerun the commit command safely: it recognizes the existing commitment without sending and reports `readyAt` and `expiresAt`. Reveal is accepted when the confirmed commitment age is inclusively between the registrar's `MIN_COMMITMENT_AGE` and `MAX_COMMITMENT_AGE`. Before the minimum it stops without sending; after the maximum, submit a new commit. Reuse the same `ENS_COMMITMENT_SECRET`, owner, and duration for reveal.

Deploy and wire the fuda User Registry, shared resolver, and registrar:

```bash
ENS_RPC_URL=https://… ENS_PARENT_KEY=0x… ENS_VOUCHER_KEY=0x… ENS_GATEWAY_SIGNER_KEY=0x… pnpm --filter @fuda/ens-contracts ens:topology:deploy
```

Topology deployment is resumable. Set `ENS_PARENT_ADDRESS` as a public owner assertion, and set any already-created `ENS_USER_REGISTRY_ADDRESS`, `ENS_RESOLVER_ADDRESS`, and `ENS_REGISTRAR_ADDRESS` values before retrying. Every supplied or discovered address is checked for runtime code, owner, implementation, immutables, and compatible existing links before any later send. The command reports a newly confirmed address before subsequent reads, so retain that public progress output if a verification read interrupts the run.

Run standalone verification with public values only:

```bash
ENS_RPC_URL=https://… ENS_PARENT_ADDRESS=0x… ENS_VOUCHER_SIGNER_ADDRESS=0x… ENS_GATEWAY_SIGNER_ADDRESS=0x… ENS_USER_REGISTRY_ADDRESS=0x… ENS_RESOLVER_ADDRESS=0x… ENS_REGISTRAR_ADDRESS=0x… pnpm --filter @fuda/ens-contracts ens:verify
```

Preflight and standalone verification are read-only. The parent commit, parent reveal, and topology deployment commands mutate Sepolia.

**These steps have been run.** `fuda.eth` is registered and the topology is deployed and verified; the commands above are kept for a rebuild or a second environment. The addresses are in [`ens-naming.md`](./specs/ens-naming.md#shipped-implementation-boundary), and `ens:verify` re-checks them from public values alone. Live `.eth` resolution through a third-party client remains outstanding.

Keep the parent key. It is the User Registry's root principal and the only way to rotate the voucher or gateway signer, so losing it is unrecoverable — a password manager, not just `packages/ens-contracts/.env`.

After topology verification, configure the API with the five claim bindings in §3 alongside `ENS_PARENT_NAME=fuda.eth` and the shared resolver in `ENS_RESOLVER_ADDRESSES`. Every claim route answers `503 ens_not_configured` until all of them are present. A voucher is also signed only under the issuing bindings (`ISSUER_ADDRESS`, `DELEGATION_UID`, `EAS_SCHEMAS`) and the signer, and only while that delegation is live on Base and names the signer as its issuer; otherwise it answers `403 not_delegated`. Claiming is optional: a venue registers, creates cards and issues passes whether or not its ENS name is claimed, and whether or not these bindings are present. With them configured, `/profile` offers the claim; without them it says ENS names are unavailable and nothing else changes. An interrupted claim leaves the venue and its cards as they were and can be retried from `/profile`.

The DNSSEC TXT value required to expose the `.eth` tree through `fuda.sh` is:

```text
ENS1 0x005a3bf1d92ebe4b1e1641a0c6fa49f38e1762a6 sh eth
```

This value is documented only. The `fuda.sh` zone is DNSSEC-signed and currently carries a _production-ENS_ alias record (`ENS1 dnsalias.ens.eth sh eth`), which is not this resolver; the hackathon record above has not been set, so the alias must not be treated as live until it is set and scratch resolution is verified operationally.

## 3. Secrets

Set secrets from `apps/api/targets/develop` with `void secret put <NAME>` (use `targets/production` for mainnet). Run `void connect --platform cloudflare` once in a fresh checkout to select the Cloudflare account before remote commands. Void keeps the linked Worker's secrets. `void secret sync <file>` pushes a dotenv file in one go; file paths are relative to that target directory. Never commit a secrets file:

- `SIGNER_PRIVATE_KEY` — the issuer's EOA private key.
- `ADMIN_TOKEN` — **required whenever a chain binding is set.** With `SIGNER_PRIVATE_KEY` or `BASE_RPC_URL` configured and no `ADMIN_TOKEN`, the api locks every admin route (`401 unauthorized`) and every response carries `x-auth-mode: locked`. This is deliberate fail-closed behavior, not a misconfiguration to work around.
- `BASE_RPC_URL` is the preferred RPC endpoint for `CHAIN_ID`. The API tries that chain's public RPC after a provider failure, even while this secret is set. Leave it unset or set it to the selected public URL to use one transport.
- `ENS_GATEWAY_SIGNER_KEY` — dedicated 32-byte ECDSA private key that signs gateway responses. Do not reuse `SIGNER_PRIVATE_KEY` or the ENS parent key.
- `ENS_GATEWAY_SECRET` — separate 32-byte HMAC key used to derive deterministic one-time +Private destinations.
- `ENS_VOUCHER_KEY` — dedicated 32-byte ECDSA private key that signs claim and renew vouchers. It is the key the deployed registrar checks against, so it must be the same one `ens:topology:deploy` was given, and it must not be the gateway signer, the parent key, or `SIGNER_PRIVATE_KEY`.
- `ENS_SEPOLIA_RPC_URL` — Ethereum Sepolia RPC. A secret rather than a var, because an Alchemy endpoint carries its API key in the path.
- `ENS_PAYMASTER_UPSTREAM` — the vendor's ERC-7677 paymaster endpoint. With Alchemy this is the same URL as above; the bindings stay separate so the paymaster vendor can change without touching the chain reads.
- `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_ACTION`, `WORLD_RP_SIGNING_KEY` — World ID badge verification. All four or nothing: while any one is unset, `POST /badges/:kind` answers `501 badges_not_configured` and no verdict carries a badge. Only the signing key is sensitive — it is the relying party's 32-byte secp256k1 key as hex (`0x` optional), whose public half is registered in the Developer Portal — but all four are pushed as secrets rather than split between here and `targets.jsonc` vars, so there is one place to look. Do not also add these names to `vars`: a name defined twice silently resolves to the secret.
- `GOOGLE_ISSUER_ID`, `GOOGLE_CLASS_ID`, `GOOGLE_SA_EMAIL`, `GOOGLE_SA_KEY_PEM` — see §4.
- `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_CERT_PEM`, `APPLE_KEY_PEM`, `APPLE_WWDR_PEM` — see §5.

PEM secrets (`GOOGLE_SA_KEY_PEM`, `APPLE_CERT_PEM`, `APPLE_KEY_PEM`, `APPLE_WWDR_PEM`): paste the PEM block as-is. A PEM copied straight out of a service-account JSON keeps its literal `\n` escapes; the api normalizes either form, so there is no need to reformat it first.

See `apps/api/src/env.ts` for the full binding list and `apps/api/README.md` for what each secret gates at the route level.

### Base Sepolia provider outages

The preferred endpoint stays first on every request. Each endpoint has a 1 s timeout with no HTTP or fallback retries. A dead preferred endpoint adds at most one configured second per RPC request before the public endpoint is tried. Both endpoints timing out takes two configured seconds per request. Gate scans make several requests, and transaction receipts are polled separately. The public endpoint can also be rate limited or unavailable.

Contract reverts and rejected transactions stop immediately. Other provider errors try the next endpoint. If both providers fail, the existing gate failure rules still apply. Smart-account signature verification can report `BAD_SIGNATURE`; see [signature verification and RPC outages](specs/attestation-model.md#gate-verification-order-and-reasons).

Writes are signed locally once. Failover sends the same raw transaction, hash, and nonce to the public endpoint. If the first endpoint accepted it but lost the response, the second might report already-known or nonce-too-low. Before repeating an issuance after an uncertain result, reconcile the signer's transactions and EAS events with the member row. A repeated API issuance can sign a new transaction. Offchain revocation and root chores already read chain state before retrying.

Chain errors retain the viem error class name but omit provider messages, URLs, request details, and causes. Do not print `BASE_RPC_URL` in diagnostics or paste it into an issue. It can contain an API key. Admin lock behavior and local fake-chain selection still treat a configured `BASE_RPC_URL` as a chain binding. ENS uses its separate Ethereum Sepolia client.

After deploying, the owner must simulate the paid provider being unavailable on the deployed Worker. Check a gate scan and smart-account signature, restore the provider, and confirm it is preferred again. Also check a normal issuance or revocation, confirm a rejected contract call stays rejected, and inspect Worker logs for credential leaks. Local HTTP tests do not establish deployed-provider behavior.

## 4. Google Wallet setup

1. Create a Google Wallet issuer account.
2. Create a GenericClass whose id matches `GOOGLE_CLASS_ID`. `GOOGLE_CLASS_ID` is used verbatim as the object's `classId`, so it must be the fully-qualified `<issuerId>.<suffix>` id. `GET /pass/:uid/google` signs the save-link JWT locally (`packages/pass/src/google.ts`) and does not check the class against Google's API, so a missing or mismatched class is not caught there — it fails only when the holder opens the save link.
3. Request publishing approval — this can take time, so start it early.
4. While unapproved, add the demo phones' Google accounts as testers so `/pass/:uid` → "Add to Google Wallet" works for the demo before approval lands.

Set the four `GOOGLE_*` secrets (§3). All four must be set, or `GET /pass/:uid/google` answers `501 google_not_configured`.

## 5. Apple Wallet setup

Request the Pass Type ID certificate early — this has real lead time and is often the long pole. Export the certificate and its PKCS#8 private key as PEM, and download the WWDR intermediate certificate.

Set the five `APPLE_*` secrets (§3). If the certificate has not arrived yet, leave all five unset: `GET /pass/:uid/apple.pkpass` answers `501 apple_not_configured` and the browser pass (`GET /pass/:uid`) is the floor — the demo does not depend on Apple Wallet being ready.

## 6. Build env for the frontends

Each frontend's Worker calls `https://api.fuda.sh` by default, without requiring a Worker variable. An explicit `API_BASE_URL` in the dev or deploy shell is written as a Worker variable by `void.config.ts` and overrides that default ([ADR 0010](adr/0010-void-pages-and-frontend-workers.md)). The browser calls only its own Worker, so no frontend has a `VITE_API_BASE_URL`.

The remaining `VITE_*` values are baked into the bundle at build time, so they must be set in the shell of the deploy, which builds. Void refuses to build next to a `.env.production` or `.env.example`, and it ignores `.env` in builds, so there is no file to keep them in. A deploy without them bakes empty values in (the app then reports "rights discovery is not configured"). Values for the current hosted Sepolia deployment are:

```bash
VITE_GRAPH_RIGHTS_ENDPOINT=https://gateway.thegraph.com/api/<PUBLIC_KEY>/subgraphs/id/<SUBGRAPH_ID> # dash, app
VITE_ENS_PAYMASTER_URL=https://api.fuda.sh/v1/ens/paymaster  # dash only, and the one VITE_* that carries the version prefix: the wallet fetches this URL as given
VITE_APP_ORIGIN=https://app.fuda.sh     # app only; this is also its default
VITE_RP_ID=fuda.sh                      # app only; this is also its default
```

The Graph endpoint is browser-visible. Use a public gateway key restricted to the deployed subgraph, or a same-origin proxy; never put a Studio deploy key in a `VITE_*` value.

## 7. Build and deploy the rights subgraph

Install the independent package, then generate and verify the deployable manifest from the Sepolia `EAS_SCHEMAS` and `ANNOUNCER_FROM_BLOCK` values of the `develop` target in `apps/api/targets.jsonc`:

```bash
pnpm --ignore-workspace --dir packages/subgraphs/rights install --frozen-lockfile
pnpm graph:prepare
pnpm graph:codegen
pnpm graph:test
pnpm graph:build
```

`graph:prepare` rejects missing or placeholder values. Its CLI reads the `develop` target's vars and `config/base-sepolia.json`, not the `production` target. Create the subgraph in Graph Studio, then authenticate and deploy from its independently installed package:

```bash
cd packages/subgraphs/rights
pnpm --ignore-workspace exec graph auth --studio <DEPLOY_KEY>
pnpm --ignore-workspace exec graph deploy --studio <SUBGRAPH_SLUG>
```

Use the Studio query URL for the controlled event demo. Before building the browser clients, provision a public gateway endpoint (or same-origin proxy) and use it as `VITE_GRAPH_RIGHTS_ENDPOINT`. Deployment and receipt comparison are live gates; verify them with §9 below and [`integrations/thegraph.md`](./integrations/thegraph.md).

## 8. Deploy order

Deploy the rights subgraph first so its public query endpoint can be baked into the member app and dashboard. Then deploy the api and the three frontends:

```bash
pnpm --filter api run deploy

pnpm --filter gate run deploy
VITE_GRAPH_RIGHTS_ENDPOINT=<PUBLIC_GRAPH_ENDPOINT> \
  VITE_ENS_PAYMASTER_URL=https://api.fuda.sh/v1/ens/paymaster \
  pnpm --filter dash run deploy
VITE_GRAPH_RIGHTS_ENDPOINT=<PUBLIC_GRAPH_ENDPOINT> \
  pnpm --filter app run deploy
```

Everything deploys with Void ([ADR 0009](adr/0009-void-and-solid.md)). Wrangler is a direct dependency only of `packages/e2e`, whose isolated built-Worker harness still needs `--env-file` and its own persistence directory. Resource creation examples use the separately installed Cloudflare `cf` CLI.

The API uses Void server routing: add method exports under `apps/api/routes/`, backed by `src/handlers/`. All three target projects share that tree through `routes` links; keep their ordered middleware re-exports aligned. API request initialization and error handling live in `apps/api/src/middleware.ts`; `src/runtime.ts` supplies chain configuration. See [ADR 0012](adr/0012-void-api-routing.md).

The api's `deploy` script runs `void deploy --platform cloudflare` in `apps/api/targets/develop`, the Void project for the live Sepolia Worker `fuda-api`. Its config comes from the `develop` block of `apps/api/targets.jsonc`, which declares `api.fuda.sh` as a custom domain. The shared target config explicitly sets `inference.build` to `vp build`, because these nested Void projects have no package manifest of their own from which to infer the workspace build command. The zone must already be on the account. The `fuda.sh/@*` redirect is a zone-level Single Redirect and is not managed by Void. `void deploy` also applies pending D1 migrations before it uploads the Worker, and saves a D1 restore point first, because each target's `db/migrations` link makes them visible to Void. `pnpm --filter api migrate:remote` applies them without a deploy. Either way, run it from an up-to-date checkout: "up to date" only means nothing in this checkout is pending.

Run a deploy through its package script, from the repository root: `pnpm --filter api run deploy`, or `pnpm --filter <app> run deploy` for a frontend. `void deploy` runs `vp build`, and `vp` is on `PATH` only inside a package script, so calling the `void` binary directly stops with `vp: command not found`. For an api command with no script, such as `void secret list`, call the binary from the target directory: `../../node_modules/.bin/void secret list`. The targets have no `package.json`, so `pnpm exec void` fails there with `Command "void" not found`. A frontend has a `package.json`, so use `pnpm --filter <app> exec void <command>`.

The `migrate:*` scripts use `void db migrate` (with `--remote` for Cloudflare), and `d1:local` uses `void db execute`: pass SQL as a positional argument, for example `pnpm --filter api d1:local "SELECT name FROM sqlite_master"`. Each target’s `db/migrations` symlink points at the single hand-written `apps/api/migrations` history. Remote operations retain `d1_migrations`. Local databases track their history in `_void_migrations`; a local database with only Wrangler's history stops with an error, and `void db reset` recreates it. The local CLI materializes the target config before choosing the DB ID, so it uses the dev server’s existing `targets/local/.void` database even on a fresh checkout. `better-sqlite3` is built for these local commands. Existing destructive SQL has explicit Void approval pragmas; migration names and executable SQL are unchanged. If remote history contains migration names absent from this checkout, identify their deployment branch before applying new SQL; do not delete history rows or rename applied files to make the histories match.

To check the generated Worker config without shipping, run `pnpm --filter api exec sh -c 'cd targets/develop && vp build'` and read `targets/develop/dist/ssr/wrangler.json`.

The three frontends' `deploy` scripts run `void deploy --platform cloudflare`; their configs explicitly set `inference.build` to `vp build` so deployment uses the workspace toolchain. Void builds with `vp build` and deploys a Worker with the static assets ([ADR 0010](adr/0010-void-pages-and-frontend-workers.md)). Every Worker forwards the browser's `/api/*` calls to the api with the visitor's IP in `x-real-ip`, which the api's rate limits read as `CF-Connecting-IP` on a same-zone subrequest. The dashboard and the member app render their pages in it and keep their sessions in HttpOnly cookies; the gate stays a single-page app with only the forward. Each app's `void.config.ts` holds its Worker name (`fuda-gate`, `fuda-dash`, `fuda-app`) and its custom-domain route (`gate.fuda.sh`, `dash.fuda.sh`, `app.fuda.sh`). The build environment above is read by `vp build` inside `void deploy`.

`pnpm --filter <app> exec void info` checks a config offline. To run a frontend's built Worker before deploying it, build it (`pnpm --filter <app> build`), then from the app directory run `../../packages/e2e/node_modules/.bin/wrangler dev -c dist/ssr/wrangler.json --local-upstream localhost:<port> --port <port> --var API_BASE_URL:http://localhost:8787` against a local api. Without `--local-upstream`, wrangler presents every request under the configured custom domain. The app then sees `https://app.fuda.sh` and redirects to its baked-in `VITE_APP_ORIGIN`, which wrangler rewrites back to localhost: a redirect loop that only happens locally.

Every deploy script passes `--platform cloudflare`. Void otherwise reads the destination from the Git-ignored `.void/project.json`, and a checkout without that file offers to link the existing Worker. That handoff flow is only for adopting a Worker Void does not manage yet. All live Workers are already on Void, so decline it if it appears. A new Worker needs its first deploy to run interactively, from one machine. Void signs in to Cloudflare and writes the project's `void.lock.json` (`apps/api/targets/<target>/void.lock.json` for the api); commit that file before deploying from any other machine. `.void/`, `.cloudflare/`, `.void-wrangler.jsonc` and `dist/` are local state and are Git-ignored. Things to watch for:

- **Api secrets.** The api's `production` Worker has never been deployed, so its first deploy creates it. After any deploy, `void secret list` from the target directory must still list every name in §3.
- **Readiness.** Before sending traffic, Void checks the new version through a version metadata binding or a Version URL. If it stops at that check, enable Version URLs for that Worker, or add a version metadata binding under `cloudflare` in `void.config.ts`, then retry.
- **Venue URLs (app only).** The app Worker answers every path before the static assets, and its middleware serves `/@<handle>` from `pages/venue/`. After an app deploy that changes routing, confirm that `curl -sI 'https://app.fuda.sh/@<handle>/<card>?source=qr'` answers `200` with `content-type: text/html` and no `location` header. A redirect to `%40` means the asset layer saw the request first.
- **Visitor IPs.** Rate limits must still count each visitor. After a change to the `/api/*` forward, issue a few self-serve cards from one phone and check that the api's `rate_limits` rows carry that phone's address, not a Cloudflare one (`2a06:98c0:3600::103` is the Worker egress address a cross-zone subrequest would show).
- **Frontends go through their Workers.** The api answers no CORS for fuda's own hosts, so a self-hosted or local frontend must call it through its Worker.

## 9. Live smoke

```bash
curl -i https://api.fuda.sh/health
```

`x-auth-mode` is a response header, so `-i` is needed to see it. Expect the header to be **absent**. If it is present, the deploy is misconfigured: `locked` means `ADMIN_TOKEN` is unset while a chain binding — a signer (`SIGNER_PRIVATE_KEY`) or `BASE_RPC_URL` — is configured, so the admin routes are 401ing everything; `open` means no token and neither binding is set, so the admin routes are unauthenticated. Both are fail states in production, not acceptable resting states (see `apps/api/src/middleware/admin-auth.ts`).

`locked` stops the admin token, not a venue: `/members` and `/revoke` resolve a passkey session first, so a signed-in operator still reaches their own members either way. That is the point of the scoping — a venue's access does not depend on fuda's deployment secret.

```bash
API_URL=https://api.fuda.sh ADMIN_TOKEN=… SMOKE_OPERATOR_KEY=… \
  pnpm --filter api smoke:live --ladder bearer,signed,card
```

Runs the supported ladders end to end against the live API. The `card` ladder is the one that covers the venue's own front door — an operator signs in with their wallet, publishes a card, and a member claims it off the public page with no admin token — so it exercises what a phone in the queue does. Set `SMOKE_OPERATOR_KEY` to a dedicated operator key whose venue is already registered; its ENS name need not be claimed. The script checks this prerequisite before running the selected ladders, creates a card with a unique slug, and leaves that card behind in the venue. It does not acquire an ENS name or fund a wallet. Use `--ladder bearer,signed` when testing without an operator venue; the card ladder is not silently skipped. Fresh issuer registration and card creation for an unclaimed venue are also covered by the API test suite. There is no `private` ladder: discovery is a browser-to-Graph query and the script would have nothing to drive. Verify +Private discovery through the rights subgraph and member app, then enter through the ordinary Signed challenge-response flow, as documented in [`integrations/thegraph.md`](./integrations/thegraph.md). The Attendance attestation for the Bearer/Signed ladder's ADMIT verdicts appears on the Base Sepolia explorer within a few blocks.

Once ENS is configured, send one known ENSIP-10 request through the deployed resolver or directly to `POST /ens/gateway`. A successful direct response is `{"data":"0x…"}` with `Cache-Control: no-store`; malformed, unknown, and infrastructure failures use `{"message":"…"}` and are also never cached. The gateway is public, so do not send `ADMIN_TOKEN`.

Query the deployed rights subgraph with real right, delegation, and Attendance UIDs, and compare the returned holders, metadata, relations, announcement identity, and revocation timestamps with their transaction receipts. Export the identifiers from real receipts, never from fixture constants:

```bash
export GRAPH_RIGHTS_ENDPOINT="<STUDIO_OR_PUBLIC_QUERY_URL>"
export RIGHT_UID="<0x_32_BYTE_RIGHT_UID>"
export DELEGATION_UID="<0x_32_BYTE_DELEGATION_UID>"
export ATTENDANCE_UID="<0x_32_BYTE_ATTENDANCE_UID>"

jq -n \
  --rawfile query packages/subgraphs/rights/queries/smoke.graphql \
  --arg rightUID "$RIGHT_UID" \
  --arg delegationUID "$DELEGATION_UID" \
  --arg attendanceUID "$ATTENDANCE_UID" \
  '{query: $query, variables: {
    rightUID: $rightUID,
    delegationUID: $delegationUID,
    attendanceUID: $attendanceUID
  }}' \
  | curl --fail-with-body --silent --show-error \
      -H 'content-type: application/json' --data-binary @- \
      "$GRAPH_RIGHTS_ENDPOINT"
```

Every requested entity must be non-null, the holder and relations must agree with the receipts, the raw announcement bytes and transaction/log identity must match, and `right.revokedAt` must be `null` before a revoke and non-null after.

Use separate live rights for separate flows: a +Private right proves private discovery and Signed entry, a Bearer right with a QR pass proves the green scan and the red scan after revoke. A +Private right is not a scannable Bearer pass — presenting its UID to the QR verification path returns `LEVEL_REQUIRED`.

## 10. Manual checks that no script covers

- **WebAuthn PRF.** On a real phone, open `https://app.fuda.sh/private`, create a passkey, and confirm the derived meta-address renders.
- **ERC-6492 (undeployed smart wallet).** Issue a Signed right to a Base Account (passkey smart wallet) address, then enter it at `https://app.fuda.sh/signed` _before_ that account is deployed on chain — the api must still answer `ADMIT` through the ERC-6492 counterfactual path. This is the one path the fake chain cannot exercise, so it must be run once against Base Sepolia before the deploy is called done.
- **Google Wallet.** Open `/pass/<uid>` on an Android phone and tap "Add to Google Wallet".
- **Apple Wallet.** Open `/pass/<uid>/apple.pkpass` on an iPhone.

## 11. Reconciliation

Two writes are deliberately non-atomic across the chain and D1; check both after a deploy and periodically thereafter (see `docs/specs/attestation-model.md` for the full model):

- **Orphan attestations.** A `502 chain_error` on `/issue` after the uid was logged means the right was attested on chain but the announcement or the `members` row write failed. Revoke that uid from the dashboard, or re-issue (a re-run attests a second right, so the orphan becomes the duplicate to revoke).
- **Missing `attendance_uid` candidates.** Attendance attests best-effort after the verdict; a failed attest leaves the admission standing but the on-chain evidence missing. List them, from `apps/api/targets/develop`:

  ```bash
  void db execute --remote "SELECT id, uid, at FROM entry_log WHERE decision = 'ADMIT' AND attendance_uid IS NULL"
  ```

The query also includes +Private admissions, which intentionally have no Attendance. Check the right's level before treating a row as a failure; `members.level` can help when a matching operational row exists. For mainnet, run the same command from `apps/api/targets/production`.

## 12. Local development

Dependency resolution waits three days after a package version is published (`minimumReleaseAge: 4320` in `pnpm-workspace.yaml`). The specific versions listed in `minimumReleaseAgeExclude` are exempt.

```sh
pnpm install --frozen-lockfile
# Fresh checkout only; preserve existing local values when updating.
cp apps/api/.env.example apps/api/targets/local/.env
pnpm migrate:local
pnpm dev
```

Run checks separately:

```sh
pnpm check      # format + lint + type check (vp check)
pnpm typecheck  # types only (vp check --no-fmt --no-lint)
pnpm test       # workspace tests and API script tests; independent packages are separate
```

After the initial setup above, start dashboard development from the repository root:

```sh
pnpm dev:dash-api
```

Run `pnpm migrate:local` after pulling new database migrations. `dev:dash-api` starts the dashboard at http://localhost:5175 and its local API at http://localhost:8787 together. The example simulates chain state and writes. EOA sign-in works offline; Base Account passkey sign-in uses read-only Base Sepolia RPC verification and requires network access. FakeChain does not simulate the ENS claim, and nothing else in the dashboard needs it. Real acquisition requires the claim bindings documented above; for UI-only work on the claimed state, use the [local fixture](#ui-walkthrough-with-fakechain).

`pnpm dev` starts the whole local stack on the fixed ports below. A single surface starts with `pnpm dev:api`, `pnpm dev:app`, `pnpm dev:gate`, or `pnpm dev:dash`. Every frontend calls the api for its live data, so `pnpm dev:app+api`, `pnpm dev:gate+api`, and `pnpm dev:dash+api` start one frontend together with the api from a single terminal; a bare `dev:app`, `dev:gate`, or `dev:dash` needs `pnpm dev:api` running elsewhere.

Stop an existing API before starting a combined frontend/API command to avoid a port conflict.

For SSH previews, Dash binds explicitly to IPv4 loopback (`127.0.0.1:5175`) so a tunnel targeting that address works even when the host resolves `localhost` to IPv6. In Moshi, select port 5175 from the browser-preview picker and use the URL it opens. The browser sends every api call to `/api` on the preview origin, and the dashboard's own Worker forwards it to the api at `API_BASE_URL` (`http://localhost:8787` in `pnpm --filter dash dev`). Only port 5175 needs forwarding. The dev script also sets `VOID_INSPECTOR_PORT=false`, because the api's Void dev server already holds the inspector port.

In development mode, Dash also displays saved logos from `http://localhost:8787/assets/...` through `/api/assets/...`, preserving the query string, so they load over the preview connection. This is independent of FakeChain or whether the API reads a local or remote R2 bucket. Other asset URLs (including public R2, CDN and signed URLs) and production builds retain their original URLs.

### End-to-end tests

`pnpm e2e` runs the browser suite in `packages/e2e` against a real local stack. It runs gate, then dash, then app, and stops at the first surface that fails. `pnpm e2e gate` runs one surface. Flags after `--` go to `e2e run`, for example `pnpm e2e app -- --headed`. The first run downloads Chromium into the Playwright cache.

For each surface, the suite does four things:

1. It builds the api's `local` Void target, deletes its D1 state under `packages/e2e/.e2e/state/` and applies the migrations to a fresh copy.
2. It starts the build output with the E2E package’s `wrangler dev` on `127.0.0.1:8797`.
3. It starts the surface's Vite dev server: app on `127.0.0.1:6173`, gate on `6174`, dash on `6175`. These ports sit beside the `pnpm dev` ports, so both can run at once. Starting it is how the suite checks the api is up.
4. It seeds venues, cards and Rights through the public api routes.

The api reads only `packages/e2e/stack.env` (`USE_FAKE_CHAIN=1`). Void builds ignore `.env`, and passing an env file explicitly makes wrangler skip any other, so local secrets in `apps/api/targets/local/.env` never reach a run. Admin routes stay open, and the developer's local D1 under `apps/api/targets/local/.void/` is never touched.

The dashboard suite also covers connected-app registration, full-page PKCE approval, external-browser card creation/readback and revocation. Its external client runs on a real ephemeral loopback HTTP origin, so Chromium performs the api’s CORS checks. Operator fixtures authenticate throwaway EOAs through the real API and seed HttpOnly cookies; they do not bypass the API session checks. Two-store tests verify that drafts, issuance counts and Stamp totals reset on switching, that card edits still save, and that an actual second tab cannot cause a stale profile form to overwrite another store. Only the second tab uses DOM evaluation because the E2E SDK exposes one active screen; the main tab uses semantic screen locators.

What the suite does not cover:

- operator passkey sign-in in dash (through Base Account) and member passkey sign-in in app (a real authenticator);
- the camera scanner;
- anything that reads the Graph.

The tests assert on roles and visible English text only, so they keep passing when an app is rewritten. Results and traces land in `packages/e2e/.e2e/` (Git-ignored). The suite is not part of `pnpm test` or the pull request checks.

### Public Card UI preview

For a UI-only walkthrough without an API, start the member app with fictional Wassie Coffee data:

```sh
VITE_STORE_PREVIEW=1 pnpm dev:app
```

Open `http://localhost:5173/@wassie-coffee` (the app Worker redirects card pages to its configured origin, so use the default port); it opens the default Membership Card. `/@wassie-coffee/home` shows the store display. The normal Card view and shared Wallet buttons render with sample data. The claim action simulates a pending state and then opens the acquired Card; its `scene=ready` URL survives reload. This preview does not exercise the live controller, issue a Right, use saved member data, or save a Wallet pass. The Wassie Coffee logo is the unchanged image requested from the onboarding mockup, stored under `apps/app/src/venue/preview-assets/` and imported only by the development preview. Production logos continue to come from the API. The acquired Card QR encodes a preview notice rather than a valid admission payload; the store display QR links to a local Card preview. A notice remains visible stating that nothing is issued or saved.

Use the links below the page, or set `scene=landing|ready|choose|closed|error|loading`, `lang=en|ja`, and `theme=light|dark`. The fixture publishes two Cards with Membership as the default; `cards=single` reduces it to one. `default=none|tasting|closed|missing` exercises the default-selection branches. The bare Handle with `?cards=all` or `?scene=choose` always opens the chooser. `/@wassie-coffee/tasting` previews the Ticket; `/@wassie-coffee/membership` opens the Membership directly. Missing slugs keep the venue's recovery link. Card navigation retains the preview language, theme and card-count settings. Device detection uses the same existing user-agent classifier as the app: iPhone/iPad show Apple Wallet, Android shows Google Wallet, and desktop shows the browser action. Those actions open clearly labeled preview notices, not external Wallet services. Use browser device emulation to inspect both mobile badges. `/home` remains a store display on every device; `?card=tasting` selects the second Card initially. Print hides the preview notices and display controls.

The preview is opt-in and development-only; production builds exclude its entry and fixture even when the variable is set. Restart without `VITE_STORE_PREVIEW` to use the normal app. Do not use preview screenshots as evidence that issuance, scanning, Wallet delivery, Stamps or redemption work end to end.

### Default Card migration

Apply migrations through `0014_issuer_default_card.sql` before deploying the default-Card API. It adds nullable `issuers.default_card_slug`; existing issuers start unset. Use `pnpm migrate:local` for local development and the normal remote migration procedure for production. Deploy the API before the new Dash controls; the member app tolerates an omitted default field from an older API, but the new endpoint requires migration 0014. No default is backfilled automatically. In Dash, open Cards, set the desired default, and verify the bare public Handle opens that Card. Use “Open store display” for iPad or print; test that its QR links to the selected Card rather than the bare Handle.

### Shared issuer-wallet signature probe

Run the read-only MultiOwnable probe from the repository root:

```sh
pnpm --filter api probe:venue-wallet
```

It uses the public Base Sepolia RPC by default; `CHAIN_ID` selects the chain and an exported `BASE_RPC_URL` selects its provider. It does not load any local env file or require any private-key setting. The RPC chain ID must match the selected chain, `84532` by default or `8453` when configured for Base. The probe generates two throwaway EOA owners and an undeployed Coinbase Smart Wallet v1 using fuda's current factory, then checks both owners' dashboard-challenge signatures through the API's actual chain verifier. It also rejects a changed challenge, an unregistered owner's wallet proof, and a raw personal signature. No transaction is submitted, no account is funded, and no D1 state is changed. ERC-6492 verification simulates deployment only inside `eth_call`; the probe checks that the wallet remains undeployed afterward.

Success prints the public wallet/factory/owner addresses and six successful checks, and exits zero. A failed assertion or unavailable RPC exits nonzero. The probe allows only `eth_chainId`, `eth_call`, and `eth_getCode`, and records RPC failures even if the signature verifier would fold one into `false`. Any rejected RPC request, including an EVM revert, makes the run inconclusive and nonzero: these negative fixtures must produce completed validation responses. RPC URLs, keys and signatures are not printed. This verifies initial multiple-owner signing; it does not test adding owners to an existing wallet, Base Account popup discovery, passkey or nested-wallet owners, API sessions, or owner removal. See [ADR 0008](adr/0008-shared-issuer-wallet.md) for the future co-owner login and session-revocation requirements. The dashboard still has no owner-management UI.

### UI walkthrough with FakeChain

For Card creation, issuance and reception UI work, keep `USE_FAKE_CHAIN=1` with `SIGNER_PRIVATE_KEY` and `BASE_RPC_URL` absent. The local chain simulates entitlement writes. No step needs an ENS name.

Only the claimed look of `/profile` needs a fixture. With `ENS_PARENT_NAME=fuda.eth` in `apps/api/targets/local/.env`, mark a registered local venue (`fuda-coffee` here) as claimed in the local D1 mirror, then reload Dash. `d1:local` needs a prior `pnpm migrate:local`, which builds the config it reads. The insert never overwrites an existing row:

```sh
pnpm --filter api d1:local --command "INSERT INTO ens_names (issuer_handle, name, kind, owner_address, target_address, status, created_at, updated_at) SELECT handle, handle || '.fuda.eth', 'issuer', operator_address, operator_address, 'claimed', unixepoch(), unixepoch() FROM issuers WHERE handle = 'fuda-coffee' ON CONFLICT(name) DO NOTHING"
```

To undo it, delete only that synthetic row:

```sh
pnpm --filter api d1:local --command "DELETE FROM ens_names WHERE name = 'fuda-coffee.fuda.eth' AND kind = 'issuer' AND claim_tx_hash IS NULL AND voucher_issued_at IS NULL AND expiry IS NULL"
```

This is local display state only. It does not exercise wallet submission, sponsorship, ENS ownership or receipt verification; use the real testnets for those.

### Gate station with a USB QR reader

The gate accepts a keyboard-wedge QR reader on any device, with no configuration: it scans into the page, and the payload is read whether or not a field has focus, so a scan lands while a previous verdict is still displayed. Set the reader's terminator to CR, and set the **host's** hardware-keyboard layout to U.S. — the reader sends US-layout keystrokes, and a JIS layout turns the `:` in `fuda:v1:` into `+`, which the gate then reports as "not a fuda pass". A bare uid (`0x…`) contains no `:` and still resolves, but only as a preview: no slot consumed, no Entry logged.

`gate.fuda.sh/?camera=off` runs the gate as a reader-only station: no camera, no paste box, one waiting line. Use it on a device whose browser has no `BarcodeDetector` — every WebKit browser, so every iPad and iPhone — where the camera can only report failure. The parameter is per-device, so one deployment serves both a laptop that scans with its camera and a tablet that only reads the USB reader. Without the parameter the camera is used when available. The paste box is part of the camera view, so the reader-only station has no manual fallback: keep a plain `gate.fuda.sh` tab for that.

### Venue reception demo

Deploy the api, which applies `0021_connected_app_tracking.sql`, before the dashboard that shows connected-app activity: the Apps page reads `/v1/connected-apps/activity` and reports a load failure without it. Tokens issued before this migration have no recorded code, so replaying their code cannot end them; they age out within 30 days.

Apply migrations through `0016_card_integrations.sql` before deploying the Card integrations API (`/v1/issuers/me/cards/:cardId/integrations`); it adds an empty `card_integrations` table, so every existing Card starts with its integrations off and nothing is backfilled. The public venue lookup `GET /v1/issuers/:handle` reads that table for every venue that publishes a Card, so an API deployed ahead of the migration answers `500 {"error":"internal"}` for those venues while unknown handles still answer 404 and the health check stays green; applying the migration repairs it without a redeploy. After deploying, confirm `pnpm --filter api exec sh -c 'cd targets/develop && void db status'` has nothing left to apply and request a venue that has a Card, not only the health check. Deploy the member app first or together with the API: an older member app reads the venue-level badge list and would offer the badge action on every card, where the new API answers 404. Deploy the dashboard after the API, since its Integrations section reads the new endpoint. Apply migrations through `0011_card_stamp_settings.sql` before running the Card-scoped reception API. Use `pnpm migrate:local` for local development; apply the normal remote migration procedure before deploying the updated API. Migration `0010` adds credit records, request receipts and an optional reception ID on Entry logs. Migration `0011` adds Card Stamp policies and copies each existing venue policy to its existing Cards, preserving enabled state, limits and goals. It preserves all credits and receipts and does not award credits to existing Entries. Newly created Cards default to Stamps disabled. The legacy policy table remains for rollback compatibility but is not read by the new API. Deploy the API and dashboard together: settings now use `/v1/issuers/me/cards/:cardId/stamps`, and the old `/v1/issuers/me/stamps` endpoint is removed.

1. Sign in to dash as the demo venue operator. On `/cards`, open the membership Card’s settings and enable Stamps, set the daily limit to `1`, and set the goal to `10`.
2. Prepare an active Bearer Right issued from that membership Card. A ticket with SINGLE_USE is unsuitable for repeated-admission demos.
3. Open `/reception`. Configure the QR reader as a keyboard input device with an Enter suffix and scan the Wallet or browser Pass's QR. The same flow can be exercised by pasting `fuda:v1:<uid>` and pressing Enter.
4. The first scan shows ADMIT and a Stamp credit. A second scan on the same Japan calendar day also shows ADMIT, with the daily-limit result and no additional credit. A fresh day allows another credit; the total remains.
5. Open the browser Pass or refresh the member-app Pass list to see progress. Browser Pass summaries refresh every 30 seconds. With Google Wallet configured, reception also attempts to update the saved Google object.
6. Revoke the Right from dash and scan again: REVOKED, with no Stamp credit.

Changing the daily limit affects subsequent receptions, including the current day; lowering it does not remove credits. Disabling Stamps preserves totals and still permits valid admissions. The demo does not implement redemption, manual adjustment, per-person deduplication across Rights, or a clock override. The read-only summary endpoint and the public gate verification endpoints cannot award Stamps. An authenticated receipt retry returns the original result, not a new admission decision.

Reception records commit before the asynchronous Attendance and Google Wallet effects. Inspect Worker logs for Google sync failures and verify credentials and the saved object's ID. A receipt retry or later reception can attempt display synchronization again without re-awarding an existing receipt's Stamp. A saved Apple Pass has no push-refresh service in this implementation; a new download contains the current snapshot.

| Surface      | Path        | Dev                                                                       |
| ------------ | ----------- | ------------------------------------------------------------------------- |
| api          | `apps/api`  | `pnpm --filter api dev` — http://localhost:8787 (the `local` Void target) |
| member app   | `apps/app`  | `pnpm --filter app dev` — http://localhost:5173                           |
| gate scanner | `apps/gate` | `pnpm --filter gate dev` — http://localhost:5174                          |
| dashboard    | `apps/dash` | `pnpm --filter dash dev` — http://localhost:5175                          |

Each frontend's `dev` script sets what local development needs: `API_BASE_URL=http://localhost:8787` for its Worker, `VOID_INSPECTOR_PORT=false` so it does not collide with the api's dev server on the inspector port, and for the app `VITE_APP_ORIGIN=http://localhost:5173` and `VITE_RP_ID=localhost`. The `VITE_*` names of step 6 are baked in at build time, so changing one means restarting the dev server. A dev server may fail a page's first request with a 500 while Vite re-optimizes a dependency it had not seen; reload. The frequent ones are pre-bundled in each `vite.config.ts`.

- **`API_BASE_URL`** (all three, Worker var) — the dev scripts point it at the local api. Override it in the shell to use another.
- **`VITE_GRAPH_RIGHTS_ENDPOINT`** (dash, app) — the public Graph endpoint the on-chain status views read; the member app also loads raw announcements from it before matching them locally. There is no local substitute; point it at a deployed rights subgraph.
- **`VITE_APP_ORIGIN`** (app) — the dev script sets `http://localhost:5173`; otherwise the Worker redirects member and card pages to the production origin (`https://app.fuda.sh`). These routes render only on the configured app origin. The deployed app Worker owns `app.fuda.sh`; apex `/@*` redirects are managed separately at the zone.
- **`VITE_RP_ID`** (app) — the dev script sets `localhost`; the browser refuses the production default (`fuda.sh`), which is not a registrable suffix of the dev host.

See `apps/api/README.md` for the api side: `USE_FAKE_CHAIN=1` (set it in `apps/api/targets/local/.env` to run without a signer), `apps/api/.env.example`, and the deterministic `local` block in `apps/api/targets.jsonc`. Void reads only `targets/local/.env`; it ignores `.dev.vars`, and it refuses to build while a `.env.example` sits beside it, which is why the example lives one level up. Local D1 state under `apps/api/targets/local/.void/` persists across restarts; wipe it if the fake chain's world (schemas, delegation, seeded rows) changes shape. The workerd test pool reads neither file: `vp test` runs on the `develop` vars, and `apps/api/test/env.ts` strips every optional binding back out.

## 13. Rate-limit state

Five routes use the fixed hourly D1 counter and require `CF-Connecting-IP`:

| Route                                  | Requests per IP per hour |
| -------------------------------------- | ------------------------ |
| `POST /v1/issuers/:handle/:slug/issue` | 20                       |
| `POST /v1/ens/paymaster`               | 60                       |
| `POST /ens/gateway`                    | 120                      |
| `POST /v1/oauth/token`                 | 120                      |
| `POST /v1/oauth/revoke`                | 120                      |

The counter is keyed by IP and hour, not route: requests across these routes share a count, with each route applying its own threshold. Rejected requests also increment it. Announcement discovery is a browser-to-Graph query and does not pass through the API. The gate routes (`/verify`, `/challenge`, `/verify-signed`) and the admin routes (`/issue`, `/revoke`, `/members`) are never budgeted.

## Member passkeys

`WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGINS` in each api target name the domain member passkeys belong to and the origins allowed to use them. **A passkey cannot move to another domain**, so changing `WEBAUTHN_RP_ID` strands every member's passkey. At the mainnet cutover, `develop` moves to `*.dev.fuda.sh`: set its origin to `https://app.dev.fuda.sh` and leave its RP ID as `fuda.sh`, or accept that develop members start again.

To drive sign-in locally without a device, use Chromium's virtual authenticator through the DevTools protocol (`WebAuthn.addVirtualAuthenticator`).

## Offchain jobs

Two jobs in `apps/api/crons/` run on every api target: roots hourly, and failed revocations every 15 minutes. Each target links the directory the way it links `routes`. The first deploy that includes them adds a `scheduled` handler and cron triggers to the Worker; confirm both on the Worker's Triggers page in Cloudflare. Crons make Void republish every trigger, so each target must declare `routes`, `workers_dev` and `preview_urls` in `targets.jsonc`, matching what Cloudflare has, or the deploy stops with "dashboard-managed routes or visibility". The migrations run before that check, so a stopped deploy can leave them applied; they only add tables and columns, so the live version keeps working and no restore is needed.

Failures only reach the Worker logs, as `offchain root not anchored` and `offchain revocation retry failed`. Nothing alerts on them, and no pass stops working, so check when you can. The usual cause is the signer running out of ETH, because both jobs and on-chain issuance spend from it:

```sh
curl -s "$BASE_RPC_URL" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["<signer address>","latest"]}'
```

These show what is behind:

```sql
SELECT root, pass_count, created_at FROM offchain_roots WHERE anchored_at IS NULL;

SELECT COUNT(*) FROM offchain_attestations WHERE root IS NULL;

SELECT o.uid FROM offchain_attestations o JOIN members m ON m.attestation_uid = o.uid
WHERE m.status = 'revoked' AND o.revoke_tx IS NULL;
```

To run a job locally, start the api and use the `curl` command with the `x-void-dev-trigger` token that Void prints, setting `cron` to the job's expression. Local schedules never fire on their own.

## Mainnet configuration supplied by the owner

All checked-in targets currently select Base Sepolia because `CHAIN_ID` is absent, including the target named `production`. A target name does not select its chain. No mainnet resource is created by the code or these instructions.

Before a mainnet deployment, supply and verify all of the following:

- Set API `CHAIN_ID=8453` and app and dashboard build `VITE_CHAIN_ID=8453`. Use `84532` or leave them absent for Sepolia. Set each frontend Worker's `API_BASE_URL` to the same environment. An invalid value, including an empty string, fails instead of defaulting.
- Supply a new D1 database name and id, bind it as `DB`, and apply every migration. Supply a new R2 bucket name and bind it as `MEDIA_BUCKET`. Keep Sepolia resources separate.
- Provision the secrets in section 3 for the new Worker. `SIGNER_PRIVATE_KEY` must name the funded mainnet hot issuer, and `ADMIN_TOKEN` must protect admin routes. If supplied, `BASE_RPC_URL` must answer chain id `8453`. Its fallback is `https://mainnet.base.org`; Sepolia uses `https://sepolia.base.org`. Wallet platform credentials are required only for the enabled platforms. Leave ENS secrets unset until its mainnet plan exists.
- Confirm `EAS_ADDRESS=0x4200000000000000000000000000000000000021` and `SCHEMA_REGISTRY_ADDRESS=0x4200000000000000000000000000000000000020` against [EAS deployments](https://github.com/ethereum-attestation-service/eas-contracts#deployments). Read EAS `version()` and set `EAS_VERSION` to that exact value before signing. These addresses are the same on both supported chains. The current mainnet documentation lists version `1.0.1`; the checked-in Sepolia targets use `1.4.1-beta.3`.
- Register the current schemas on mainnet using `CHAIN_ID=8453` with `register-schemas`, then supply `EAS_SCHEMAS`. Offchain passes derive their schema UID locally and need no registration for signing.
- Supply the root Safe address as `ISSUER_ADDRESS` and a live root `IssuerDelegation` UID as `DELEGATION_UID`, attested by that Safe and naming the hot issuer. The `attest-root-delegation` script selects the configured chain but only creates an EOA self-delegation. It does not create or operate the required Safe root.
- Verify `FACTORY_ADDRESS`, `ANNOUNCER_ADDRESS`, and `ANNOUNCER_FROM_BLOCK` on mainnet. Supply a mainnet rights subgraph and build both apps with its `VITE_GRAPH_RIGHTS_ENDPOINT`. The checked-in subgraph manifests, the API ENS client, and `ENS_HACKATHON_CHAIN` still target testnets and require a separate mainnet plan.
- Supply the Worker names, public origins, custom domains, and passkey origins for the new environment. Keep the intended RP ID and map each frontend to its matching API.

The API does not expose its chain in `/health`, so there is no automatic browser/API mismatch check. A pass backup exported through the existing API includes `attestation.domain.chainId`, which can confirm the signing chain after issuance. Check the deployment vars before issuing the first pass.

The owner must verify RPC chain ids, deployed bytecode and EAS version, Safe authority and hot-issuer funding, schema registration and delegation, wallet sign-in through both Base Account and an injected wallet, offchain issuance and rejection on the other chain, revocation, root timestamping, on-chain issuance and Attendance, and subgraph indexing. These are real mainnet checks and are not covered by the offline suite.

## Mainnet cutover

Today's `develop` target in `apps/api/targets.jsonc` is the Base Sepolia deployment that owns `api.fuda.sh` and its sibling hostnames. At release it keeps the Sepolia chain and becomes the internal **develop** environment (branch `develop`), while the `production` target takes mainnet and the apex hostnames.

Nothing is migrated. A Sepolia Entitlement is meaningless on mainnet, so production starts with an empty database and an empty bucket, and every member re-claims. That is why each environment owns its own resources rather than sharing them:

| Resource | Develop (Sepolia) | Production (mainnet) |
| --- | --- | --- |
| D1 | `fuda-beta` — the existing database, kept under its name because D1 has no rename and `database_id` is what binds | `fuda`, created at cutover |
| R2 | `fuda-media-dev` | `fuda-media` |
| Worker | `fuda-api` | `fuda-api-production`, or rename in its target block |
| Hostnames | `*.dev.fuda.sh` after the cutover | `*.fuda.sh` |
| Chain id | `84532` | `8453` |

EAS and the SchemaRegistry are OP-stack predeploys at the same addresses on both networks, so those two `vars` do not change. Their versions differ, though: `EAS_VERSION` is `1.4.1-beta.3` on Base Sepolia and `1.0.1` on Base mainnet, and offchain signatures commit to it. Read `version()` on the contract before deploying. The ERC-5564 Announcer is a separate deployment: confirm the mainnet address before reusing the Sepolia one rather than assuming the singleton is at the same place.

The `production` target deliberately carries `routes: []`. Adding a custom domain there before the Sepolia deployment has moved off it would take a live hostname away from the running beta, so the order matters:

1. Register the mainnet EAS schemas and attest the root delegation, then fill the `production` target's `EAS_SCHEMAS`, `ISSUER_ADDRESS`, `DELEGATION_UID` and `ANNOUNCER_FROM_BLOCK`. Until then issuance answers `502 chain_error` rather than attesting under the wrong configuration.
2. `cf d1 create --name fuda` and paste the id; `cf r2 buckets create --name fuda-media`.
3. Set every secret again for the new Worker (`void secret put <NAME>` from `apps/api/targets/production`). Deploy first if the Worker does not exist yet. The mainnet root must be a Safe with a hot issuer, not the Sepolia EOA.
4. Apply migrations against the new database (`pnpm --filter api migrate:production`) and deploy with no routes (`pnpm --filter api run deploy:production`); smoke it on its `workers.dev` hostname.
5. Move the Sepolia deployment to `*.dev.fuda.sh`, then add the apex custom domains to the `production` target and redeploy both.
6. Redeploy the three frontends with the production `VITE_*` values. Each Worker's `API_BASE_URL` var decides which api it talks to, so a develop deployment must point at the develop api.
7. Set API `CHAIN_ID=8453` and rebuild both the member app and dashboard with `VITE_CHAIN_ID=8453`. Set each frontend Worker's `API_BASE_URL` to the matching API. Omitting either chain var selects Base Sepolia. Unknown values fail on first use. The browser wallet configuration and API clients need no source edit.
8. Decide what ENS means on mainnet. The `production` target carries no `ENS_*` values and nothing here changes that: today's names live on a dedicated ENSv2 deployment on Ethereum Sepolia, which has no mainnet counterpart. Until one exists, a mainnet api leaves every ENS binding unset, every claim route answers `503`, and the dashboard hides the section — the same fail-closed behaviour as an unconfigured develop deployment. Moving the tree means registering a new parent and deploying the topology again against whatever the mainnet addresses turn out to be; nothing migrates, exactly as with the attestations.

## Rolling back

Each surface is its own Worker, so a bad deploy is undone per surface with `void project rollback --platform cloudflare` from that frontend's directory (or `apps/api/targets/develop` for the api); it restores the previous deployment of that Worker and touches nothing else. Roll the api back first when a release changed both the api and a frontend, because a frontend bundle is built against an api contract and the older bundle is the one that matches the older api.

Three kinds of state do not roll back with the code, and each needs its own treatment.

**D1 migrations are forward-only.** A shipped migration is never edited: the migrations table records it as applied, so an edit changes what a fresh database gets while leaving every existing one untouched, and the two diverge silently. Fix by adding a migration. Keep a migration additive where the release it belongs to might be rolled back — an added column is invisible to the older code, whereas a dropped or renamed one takes the older code down with it.

**Chain state is append-only.** Schemas and attestations cannot be deleted. A root delegation attested by mistake is revoked, not removed, and revocation is what the gate reads: an Entitlement under a revoked delegation stops admitting without anything being rewritten. Because `EAS_SCHEMAS` accepts a set of versions, a schema registered in error is retired by removing it from that set rather than by touching the chain.

**R2 objects are immutable under their prefix.** Rolling the api back does not un-write a logo, and it does not need to: the issuer row names the prefix, so restoring the previous row restores the previous mark, and the version in the public URL keeps caches honest either way.

### Card description migration

Apply `0012_card_description.sql` before deploying the updated Card API and frontends. It joins existing nonempty Perk and Reward text with a newline into `cards.description`, then drops the old columns; Card identities and related records are preserved. The API, dashboard and member app must be deployed together because Card requests and responses now use `description` instead of `perk` and `reward`. Use `pnpm migrate:local` for local development and the usual remote migration procedure for deployment. Retain a database backup before migration; reverting to the previous API requires restoring the old schema, not only rolling back Worker code.

### Connected apps migration

Apply `0017_connected_apps.sql` before deploying the api and dashboard that carry connected apps ([Connected apps](./specs/connected-apps.md)). It only adds tables (`connected_apps`, `connected_app_redirects`, `oauth_codes`, `oauth_tokens`), so older api code keeps running against it. No binding or secret is new: approval reuses the operator session, and the consent page is the dashboard's `/oauth/authorize`. After deployment, smoke-check one app end to end — register it on `dash.fuda.sh/apps`, approve it, exchange the code, `POST /v1/connect/cards` — then revoke the approval and confirm the next call answers `401`.

### MCP server migration

`0019_oauth_resource.sql` adds a nullable `resource` to `oauth_codes` and `oauth_tokens`. Existing tokens stay connected-app tokens and keep working on `/v1/connect/*`. Apply it before deploying the api. `DASH_BASE_URL` is a plain `vars` entry in every target; the MCP metadata names the consent page from it.

### Card capacity and source migration

`0020_card_capacity_and_source.sql` adds `capacity` and `reserved` to `cards` and `source` to `members`, and fills `reserved` from the passes each card has issued. Apply it before deploying the api. Self-serve claims are counted by `reserved` from then on, so older api code running after this migration would leave the count behind; deploy straight after migrating.

### Several issuers per account migration

Apply `0018_issuers_per_account.sql` before deploying the api and dashboard that let one account own several issuers ([ADR 0011](./adr/0011-several-issuers-per-account.md)). It rebuilds `issuers` without the unique `operator_address`, copying every row and column through a side table inside the migration's transaction; card, stamp, reception, code and token rows keep their issuer ids. Take a D1 backup first (`cf d1 time-travel get-bookmark <database-id>` records the restore point), and confirm afterwards that `SELECT count(*) FROM issuers` is unchanged and `PRAGMA foreign_key_check` returns nothing. Older api code still runs against the rebuilt table, but it answers `issuer_exists` instead of creating a second issuer and its sign-in picks an arbitrary one of an address's issuers, so deploy the api right after the migration.

### Issuer Pass management migration

Apply `0013_member_issuance_metadata.sql` before deploying the Card management and Pass-list API. Use `pnpm migrate:local` for development and the normal remote migration procedure for deployment. Deploy the matching dashboard with the API routes for Card editing and issuer Pass queries.

The migration adds nullable issuance-time `valid_from`, `valid_until`, and `usage_model` fields to members, plus issuer lookup indexes. New issuance records all three values. Existing rows deliberately remain NULL because the current Card template cannot reconstruct historical entitlement settings. They appear as unconfirmed and are excluded from active counts; no backfill or reissuance is required. Never backfill these fields from current Card settings.

The migration is additive. Older API code can still run, but any issuance it writes lacks these snapshots and will appear unconfirmed after upgrading again. Card edits preserve existing issuance snapshots. Smoke-check an owner Card GET/PUT, a foreign Card 404, the paginated Pass list, Membership Stamp saving, and Ticket Stamp rejection after deployment.

## 14. Pull request checks and repository maintenance

`.github/workflows/ci.yml` runs on every pull request and supports manual full runs with `workflow_dispatch`. It never deploys or uses chain-write credentials. The fixed `CI` job reports the overall result, including when individual lanes have no affected packages. Requiring PRs and `CI` on `main` is deferred until after the hackathon; this workflow does not impose a Ruleset. A dependency-free `plan` job selects the lanes, then checks and tests run in parallel without waiting for each other.

Formatting runs across the repository. Lint and type checking receive the affected workspace directories; type analysis may also read their imports. Tests run for changed packages and their transitive consumers, using dependency declarations from both the base and proposed trees so removals do not hide affected consumers. API checks include operational script tests, frontend checks include builds, and ENS contract checks include Solidity tests.

Changes to root dependencies, lockfiles, common configuration, CI implementation, or unrecognized build inputs trigger all lanes. Markdown and files under documentation/agent-instruction directories do not select runtime tests. Subgraph changes and `apps/api/targets.jsonc` select manifest generation, codegen, build, and Matchstick tests. Shared Subgraph payload fixtures also select the API wire-compatibility tests. The two independent Substreams crates run Rust tests and WASM builds; changes to the ERC-5564 crate also select the pipeline that consumes its protobuf definition. Full checks also install the independent Subgraph dependencies, which its script type configuration requires. The Subgraph installation explicitly uses the same three-day release-age policy as the root workspace.

On pull requests, the `fallow` job runs `fallow audit` against the base commit and fails only on findings the pull request introduces, so existing findings do not block it. `.fallowrc.json` lists Void's file-routed entry points, which Fallow does not detect, and leaves out the independently built Subgraph and Substreams projects. Run `pnpm fallow:audit` to reproduce the job against `origin/main`, or `pnpm fallow` to see every existing finding.

Reproduce selection and checks from the repository root. For a full or Subgraph check, first install its dependencies with `pnpm --ignore-workspace --dir packages/subgraphs/rights install --frozen-lockfile --config.minimumReleaseAge=4320`:

```sh
pnpm --silent ci:plan origin/main > /tmp/fuda-ci-plan.json
pnpm ci:check /tmp/fuda-ci-plan.json
pnpm ci:package apps/dash
pnpm ci:test
```

Selection compares the supplied base with the current tracked/indexed tree. Stage new files before inspecting a local plan. Omit the base to select every lane. `ci:check` covers lint and types; run `pnpm format:check` separately. Workflow validation can be run with `actionlint -ignore 'invalid format because ref is missing' .github/workflows/ci.yml`; actionlint 1.7.12 does not yet recognize `$/` action references.

Action dependencies are locked in `.github/workflows/actions.lock`, which pins each `uses:` tag to a commit and repository identity; the runner enforces it and the CI `lockfile` job runs `gh actions-lock --verify`. Never edit or delete the lockfile by hand. After adding a workflow or changing a `uses:` line, install the extension with `gh extension install github/gh-actions-lock` and rerun `gh actions-lock`, then review the lockfile diff and commit it with the workflow. Reference this repository's own actions as `$/.github/actions/...`: a `./` path cannot be locked, and the lockfile check rejects one that uses other actions. The extension version pinned in `ci.yml` is updated manually.

The repository's `Require lockfile` Actions policy is active for `.github/workflows/*`, so a workflow without a lockfile entry does not run, including on a branch that predates the lockfile until it takes in `main`. The path condition leaves Dependabot's dynamic workflow out of the target. Manage the policy under **Settings → Actions → Policies**. The REST API can read it, but rejected `require_lockfile` when creating a policy. Set the enforcement status to **Disabled** to lift it during an incident.

Dependabot checks GitHub Actions weekly, with a three-day cooldown and grouped updates. Its pull requests update the matching lockfile entries for `uses:` lines in onboarded workflows. A bump inside `.github/actions/setup/action.yml` may still need `gh actions-lock` rerun before the `lockfile` job passes. npm updates remain manual until [Dependabot supports pnpm 11](https://github.com/dependabot/dependabot-core/issues/14794), including the independent Subgraph. Cargo updates for the Substreams crates are also manual so they can be reviewed against The Graph compatibility requirements. Upgrade Vite+, its core alias, lint/format overrides, Vitest, and Ultracite together following the alignment comments in `pnpm-workspace.yaml`, then verify with `pnpm check` and `pnpm test`. Dependency update PRs remain subject to CI; automatic merging is not configured.

GitHub Secret scanning and push protection are enabled in the repository's **Settings → Code security**. Keep them enabled independently of CI; they protect supported secret patterns and do not replace the `.gitignore` rules for local key material.
