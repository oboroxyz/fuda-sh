# fuda

Membership rights as on-chain attestations, verified at a physical gate.

| Surface | Path | Dev |
| --- | --- | --- |
| api | `apps/api` | `pnpm --filter api dev` (http://localhost:8787, `--env dev`; set `USE_FAKE_CHAIN=1` in `apps/api/.dev.vars` to run without a signer) |
| gate scanner | `apps/gate` | `pnpm --filter gate dev` (http://localhost:5174) |
| dashboard | `apps/dash` | `pnpm --filter dash dev` (http://localhost:5175) |
| member app | `apps/app` | `pnpm --filter app dev` (http://localhost:5173; apex landing plus the app-only `/signed`, `/private`, and `/rights` screens) |
| shared contract | `packages/sdk` | types, validators, `qrSvg` |
| stealth crypto | `packages/stealth-address` | ERC-5564 scheme-1 stealth address math: meta-address derivation, generation, and announcement matching — shared by the api and `apps/app`'s `/private` screens |
| wallet passes | `packages/pass` | Google Wallet save-link JWT and Apple `.pkpass` builders (WebCrypto; no platform SDKs) |
| shared web UI kit | `packages/ui` | `Scanner`, the fetch wrapper, `short` — shared by `apps/gate`, `apps/dash` and `apps/app` |
| rights subgraph | `packages/subgraphs/rights` | self-contained Base Sepolia query lane for rights, delegations, Attendance, revocations, and raw announcements |
| ERC-5564 Substreams | `packages/substreams/erc5564` | reusable raw `Announcement` extraction with a parameterized Announcer address |
| ERC-5564 + EAS pipeline | `packages/substreams/erc5564-eas-pipeline` | composes the ERC-5564 package with raw EAS `Attested` and `Revoked` events |

Run `pnpm dev` for the complete local stack through Portless, or start one
surface with `pnpm dev:api`, `pnpm dev:app`, `pnpm dev:gate`, or
`pnpm dev:dash`. The named HTTPS routes are `https://api.localhost`,
`https://app.localhost`, `https://gate.localhost`, and
`https://dash.localhost`. In a linked worktree, Portless prepends its normalized
branch label to every route, for example
`https://portless-local-dev.app.localhost` for a
`feat/portless-local-dev` branch. A selective frontend command
needs the matching `pnpm dev:api` running in another terminal for live api
calls. Portless may ask to trust its local CA on first use;
`pnpm exec portless doctor` checks route, DNS, and trust setup.

In Portless mode, frontends use same-origin `/api`; Vite removes that prefix
and proxies to the matching named api route. The member app also receives its
named public origin and exact hostname as `VITE_APP_ORIGIN` and `VITE_RP_ID`.

The per-package `pnpm --filter <name> dev` commands remain the direct fallback
shown in the table. They retain their fixed ports and existing environment
defaults. In direct mode, frontends read the api origin from
`VITE_API_BASE_URL` (default `http://localhost:8787`).

`apps/app` also reads `VITE_APP_ORIGIN`: set it to `http://localhost:5173` in
direct local dev, or the `/signed` gate bounces to the production origin
(`https://app.fuda.sh` by default) instead of running locally — the apex and
the app are one Worker, and `/signed`, `/private`, and `/rights` only render on the app
origin (the only one the api's CORS list allows).

`apps/app` also reads `VITE_RP_ID`, the relying-party id of every passkey
ceremony: set it to `localhost` in local dev, or the browser refuses the
production default (`fuda.sh`), which is not a registrable suffix of the dev
host. In production it stays `fuda.sh` so the apex and `app.fuda.sh` share one
passkey. Portless supplies both member-app values automatically; these manual
overrides apply only to the direct fixed-port command.

`apps/app` and `apps/dash` read on-chain status views from the public Graph endpoint
in `VITE_GRAPH_RIGHTS_ENDPOINT`. The member app also uses that endpoint to load
raw announcements before matching them locally. The Substreams packages are an
optional live push lane with no resident sink; product reads use the rights
subgraph directly and do not depend on a running Substreams process.

See [`docs/runbook.md`](docs/runbook.md) for the one-time Cloudflare/Base
Sepolia setup and deploy runbook. See [`docs/graph-demo.md`](docs/graph-demo.md)
for the executable Graph/Substreams demo and evidence checklist.

## Setup

```sh
pnpm install --frozen-lockfile
pnpm check      # format + lint + type check (vp check)
pnpm typecheck  # types only (vp check --no-fmt --no-lint)
pnpm test       # every package's tests (workerd for the api)
```
