# fuda

Membership rights as on-chain attestations, verified at a physical gate.

| Surface | Path | Dev |
| --- | --- | --- |
| api | `apps/api` | `pnpm --filter api dev` (http://localhost:8787, `--env dev`; set `USE_FAKE_CHAIN=1` in `apps/api/.dev.vars` to run without a signer) |
| gate scanner | `apps/gate` | `pnpm --filter gate dev` (http://localhost:5174) |
| operator dash | `apps/dash` | `pnpm --filter dash dev` (http://localhost:5175) |
| member app | `apps/app` | `pnpm --filter app dev` (http://localhost:5173; apex landing plus the `/signed` challenge-response gate) |
| shared contract | `packages/sdk` | types, validators, `qrSvg` |
| shared web UI kit | `packages/web-kit` | `Scanner`, the fetch wrapper, `short` — shared by `apps/gate`, `apps/dash` and `apps/app` |

Frontends read the api origin from `VITE_API_BASE_URL` (default `http://localhost:8787`).

`apps/app` also reads `VITE_APP_ORIGIN`: set it to `http://localhost:5173` in
local dev, or the `/signed` gate bounces to the production origin
(`https://app.fuda.sh` by default) instead of running locally — the apex and
the app are one Worker, and `/signed` only renders on the app origin (the only
one the api's CORS list allows).

## Setup

```sh
pnpm install --frozen-lockfile
pnpm check      # format + lint + type check (vp check)
pnpm typecheck  # types only (vp check --no-fmt --no-lint)
pnpm test       # every package's tests (workerd for the api)
```
