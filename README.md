# fuda

Membership rights as on-chain attestations, verified at a physical gate.

| Surface | Path | Dev |
| --- | --- | --- |
| api | `apps/api` | `pnpm --filter api dev` (http://localhost:8787, `--env dev`; set `USE_FAKE_CHAIN=1` in `apps/api/.dev.vars` to run without a signer) |
| gate scanner | `apps/gate` | `pnpm --filter gate dev` (http://localhost:5174) |
| operator dash | `apps/dash` | `pnpm --filter dash dev` (http://localhost:5175) |
| shared contract | `packages/sdk` | types, validators, `qrSvg` |

Frontends read the api origin from `VITE_API_BASE_URL` (default `http://localhost:8787`).

## Setup

```sh
pnpm install --frozen-lockfile
pnpm check      # format + lint + type check (vp check)
pnpm typecheck  # types only (vp check --no-fmt --no-lint)
pnpm test       # every package's tests (workerd for the api)
```
