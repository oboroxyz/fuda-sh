# Deploy runbook

Operator instructions for standing up fuda on Cloudflare and Base Sepolia, in
order. Vocabulary note: the four surfaces are Issuer-facing (api, dash) and
Venue-facing (gate) internally, but this document uses "Venue" the way copy
does, not "mode" for anything.

## 1. Prerequisites

- A Cloudflare account with the `fuda.sh` zone already added.
- A funded Base Sepolia EOA — this becomes the signer. Fund it with a small
  amount of Base Sepolia ETH before step 2.
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
   attestation). Paste both into `wrangler.jsonc`'s `vars`. Idempotence is the
   operator's: run this once per deployment; a second run mints a second,
   equally valid delegation.

4. Look up the `Announcer` contract's deployment block on the Base Sepolia
   explorer and set `vars.ANNOUNCER_FROM_BLOCK` to it. The checked-in
   placeholder is `"0"`; the api treats a missing, unparseable, or `"0"` value
   as unconfigured and answers `502 rpc_unavailable` on `/announcements`
   without touching the chain — this is the operator-visible fail-closed
   state, not a bug.
5. Create the D1 database and paste its id into both `database_id`
   placeholders in `apps/api/wrangler.jsonc` (the top-level `d1_databases`
   entry and the one repeated under `env.dev`):

   ```bash
   wrangler d1 create fuda
   ```

6. Apply migrations to the remote database:

   ```bash
   pnpm --filter api migrate:remote
   ```

## 3. Secrets

Set with `wrangler secret put <NAME>` from `apps/api`:

- `SIGNER_PRIVATE_KEY` — the issuer's EOA private key.
- `ADMIN_TOKEN` — **required whenever `SIGNER_PRIVATE_KEY` is set.** With a
  signer configured and no `ADMIN_TOKEN`, the api locks every admin route
  (`401 unauthorized`) and every response carries `x-auth-mode: locked`. This
  is deliberate fail-closed behavior, not a misconfiguration to work around.
- `BASE_RPC_URL` — Base Sepolia RPC endpoint.
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
2. Create a GenericClass whose id matches `GOOGLE_CLASS_ID`. An object that
   references a non-existent class fails, so this must exist before the
   first `GET /pass/:uid/google` call.
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
VITE_APP_ORIGIN=https://app.fuda.sh     # app only
VITE_RP_ID=fuda.sh                      # app only
```

## 7. Deploy order

api first, then the three frontends:

```bash
pnpm --filter api deploy

VITE_API_BASE_URL=https://api.fuda.sh pnpm --filter gate deploy
VITE_API_BASE_URL=https://api.fuda.sh pnpm --filter dash deploy
VITE_API_BASE_URL=https://api.fuda.sh VITE_APP_ORIGIN=https://app.fuda.sh VITE_RP_ID=fuda.sh \
  pnpm --filter app deploy
```

Each app's `deploy` script builds then runs `wrangler deploy`. Every
`wrangler.jsonc` declares its hostname(s) as custom domains — `api.fuda.sh`,
`gate.fuda.sh`, `dash.fuda.sh`, and both `app.fuda.sh` and the `fuda.sh` apex
on `apps/app` — so the first deploy of each Worker attaches them; the zone
must already be on the account. Add `--dry-run` to a `wrangler deploy` to
validate config without shipping.

## 8. Warm-up and live smoke

```bash
curl https://api.fuda.sh/health
```

Expect no `x-auth-mode: locked` header (its absence, or `x-auth-mode: open`,
means the admin lock is not stuck closed).

```bash
curl https://api.fuda.sh/announcements
```

One call is enough to warm the announcements cache — the sync is lazy and
runs on the first request that touches it.

```bash
API_URL=https://api.fuda.sh ADMIN_TOKEN=… pnpm --filter api smoke:live --ladder all
```

Runs the bearer, signed and private ladders end to end against the live api.
`--ladder` also accepts a comma-separated subset (`bearer`, `signed`,
`private`); `all` is the default. The Attendance attestation for the ladder's
ADMIT verdicts appears on the Base Sepolia explorer within a few blocks.

## 9. Manual checks that no script covers

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

## 10. Reconciliation

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
  evidence missing. List them:

  ```bash
  wrangler d1 execute fuda --remote --command "SELECT id, uid, at FROM entry_log WHERE decision = 'ADMIT' AND attendance_uid IS NULL"
  ```

## 11. Local development

See `apps/api/README.md` for local dev: `USE_FAKE_CHAIN=1` and
`.dev.vars.example`, the deterministic `env.dev` block in
`apps/api/wrangler.jsonc`, and the four dev ports (api 8787, gate 5174, dash
5175, app 5173). Local D1 state under `.wrangler/state` persists across
`wrangler dev` restarts; wipe it if the fake chain's world (schemas,
delegation, seeded rows) changes shape. `.dev.vars` is read by the workerd
test pool during local dev, but the test suite itself strips the dev vars, so
`vp test` never depends on `.dev.vars` being present.

## 12. Budget note

`GET /announcements` is the only budgeted route in the MVP: a fixed hourly
window of 120 requests per IP. A Discover walk of a large announcement log
can use up to ~50 of those on its own (see `apps/api/README.md`'s smoke-test
notes). The venue gate (`/verify`, `/challenge`, `/verify-signed`) and the
admin routes (`/issue`, `/revoke`, `/members`) are never budgeted.
