# Architecture

fuda treats membership and access as on-chain rights. The API coordinates issuance and operational state, while EAS on Base remains the authority for a right's contents, issuer delegation, and revocation. Passes and apps present or control those rights; they do not replace the chain as the source of validity.

```mermaid
flowchart LR
    D[Operator dashboard] -->|issue / revoke| API[API]
    API -->|attest / revoke| EAS[(EAS · Base)]
    API <--> D1[(D1 operational state)]
    API -->|build| P[Pass]
    P --> M[Member]
    M -->|present QR| G[Gate]
    M -->|uses| A[Member app]
    A -->|present signed proof| G
    EAS --> Q[Rights subgraph]
    A -->|query rights| Q
    D -->|query on-chain status| Q
    EAS -. raw events .-> S[Optional Substreams push lane]
    API -->|read right + delegation| EAS
    G -->|challenge / consume / log| API
    API -->|record Attendance when the card has it on, never +Private| EAS
```

## Components

| Component | Path | Responsibility |
| --- | --- | --- |
| API | `apps/api` | Coordinates issuance, revocation, gate operational state, and pass generation. Void discovers its server routes and runs shared request middleware ([ADR 0012](./adr/0012-void-api-routing.md)) |
| Operator dashboard | `apps/dash` | Gives authorized issuers routed Overview, Rights, and Issue views; derives operational summaries from D1 member rows, issues and revokes through the API, and queries chain status separately through the rights subgraph. Its Void Worker renders the pages, holds the session in HttpOnly cookies and forwards the browser's api calls ([ADR 0010](./adr/0010-void-pages-and-frontend-workers.md)) |
| Member app | `apps/app` | Holds member signing rails, answers Signed challenges, lists public member passes from holder addresses and device memory |
| Gate | `apps/gate` | Reads presented rights, requests proof when required, and renders an ADMIT or REJECT verdict |
| EAS on Base | External; `apps/api` | Records Entitlements, issuer delegation, revocation, and Attendance evidence |
| D1 (SQLite) | `apps/api/migrations` | Stores operational state such as challenges, SINGLE_USE consumption, entry logs, and member indexes |
| Passes | `packages/pass` | Builds the Google Wallet save link and the Apple `.pkpass`; the api renders the browser-based pass. Passes present a right and are never its source of truth |
| Rights subgraph | `packages/subgraphs/rights` | Indexes EAS directly for right cards and dashboard on-chain-status queries |
| Substreams | `packages/substreams` | Provides optional raw event push packages for reuse and live demonstration; fuda has no resident sink or product-read dependency |

## Browser query state

`@fuda/libs` exposes shared library integrations through separate subpaths, with no root barrel. Browser and backend integrations may coexist, provided that runtime-specific dependencies stay behind their own entry points.

The member app's public pass list uses `@fuda/libs/query`, a Solid adapter over TanStack Query Core. Each mounted scope owns an independent in-memory client and clears it when disposed. Reads become stale after 30 seconds and refresh on focus or reconnect; the public pass list also refreshes every 30 seconds while visible. Transient read failures retry once, HTTP 4xx failures do not, and writes have no automatic retry.

Public list keys identify API and graph deployments, holder addresses, and remembered public passes. Dashboard keys identify the API deployment and a session generation. Tokens remain in request closures, and session replacement clears protected cache entries. Restoring a saved token always requires a fresh server validation. Successful issuer mutations reconcile or invalidate cached reads, cancelling older reads so they cannot undo the update.

This cache supports presentation, not authorization or admission decisions. It is not persisted, and it never holds signing keys. Domain filtering, signing, and API write workflows remain in the applications.

## Authority and trust boundaries

- **Right validity is on-chain.** The API reads the Entitlement and its IssuerDelegation from EAS on the scanner’s behalf. The hosted scanner trusts the API verdict; an independent verifier can read those records directly.
- **Admission also has operational state.** D1 tracks one-time challenges, SINGLE_USE consumption, and entry logs. Failure to read required chain or delegation state fails closed.
- **Passes are presentation surfaces.** Revoking an Entitlement changes the next gate verdict without replacing its Apple, Google, web, or QR pass.
- **Push and query lanes are independent.** The rights subgraph reads EAS directly. Stopping the optional Substreams push lane does not stop right cards, dashboard on-chain status, issuance, or gate checks.
- **Admin routes fail closed.** Issue, revoke and member listing require `ADMIN_TOKEN` wherever a signer or `BASE_RPC_URL` is configured; a deployment with either binding and no token locks them rather than opening them.
- **A connected app reaches one Issuer.** Its access token names the Issuer chosen at approval and the routes it reaches read only that Issuer; it cannot create an Issuer or act as the Operator. Only the account that registered the app can approve it.
- **The public verify endpoints are unauthenticated by design.** `GET /verify/:uid` and `POST /verify` take a uid that is public on chain, so anyone who learns one can preview it. `GET /verify/:uid` is a read-only preview and never consumes a slot; a bare `POST /verify` is an admission, so it burns a SINGLE_USE right's slot. What that buys an attacker, and why Signed is the answer for rights that must resist it, is in the attestation model's [threat model of the public verify endpoints](./specs/attestation-model.md#api-payloads-that-touch-attestations).

## UX and decentralization

fuda's core is decentralized and ownable: a right is an on-chain attestation that anyone can verify and the member can come to own. For UX, fuda surfaces that core through Apple, Google, and its own hosted backend. The design principle: **decentralized at the core, on rails only for UX.** The core carries the guarantees and a right's validity never leaves it; the rails add convenience on top. Strip a rail away and every function keeps working — with somewhat worse UX — because the fallback is the core itself.

| Function | Best UX (platform / fuda-hosted) | Decentralized fallback (self-runnable) | What survives without fuda or the platform |
| --- | --- | --- | --- |
| Right validity | — (never on a rail) | the on-chain EAS attestation itself | everything — this is the substrate |
| Pass presentation | Apple Wallet / Google Wallet | browser-based pass; ultimately the QR and holder address | the right is untouched; only the presentation surface degrades |
| Gate verification | fuda gate app + API | anyone reads the Entitlement and delegation from EAS via `eth_call` | permissionless verification; no fuda account needed |
| Issuance | fuda API with the backend included | the issuer attests directly with its own key; IssuerDelegation is an on-chain record | proof of issuing authority stays on-chain |
| Signing keys | passkey with OS sync | bring-your-own EOA or compatible smart wallet | open signature rails: ECDSA, ERC-1271, ERC-6492 |
| Sign-up (first mile) | self-serve card mint to a fuda-owned smart account | direct Signed issuance to a member wallet | issuance still works; the instant, frictionless path is fuda's added value |
| Restore | pass re-download, saved link or backup file | reissue by the issuer under a new uid | points and history persist on-chain at the stable holder |

In most rows the UX layer only carries presentation, delivery, or assistance, and validity never leaves the chain. In the signing-key rows the UX layer holds authority: a Standard right sits at a fuda-owned account, and the exit is to be issued a Signed right directly to the member's own wallet.

## Models

- [Attestation model](./specs/attestation-model.md) — Entitlement, IssuerDelegation, Attendance, lifecycle, and the EAS/D1 authority boundary
- [Pass types and flows](./specs/pass-types-and-flows.md) — use-case templates, wallet roles, standard issuance, the gate protocol, the pass contracts, and the deployed surfaces
- [ENS naming](./specs/ens-naming.md) — ENS hierarchy, the member number, what a name resolves to, name lifecycle

## Environments

fuda runs one deployment per chain, and they never share state. Each owns its own D1 database, its own R2 bucket, its own Worker secrets and its own EAS schema and delegation UIDs, because a schema UID is per chain and an attestation on one chain means nothing on another.

|  | Chain | D1 | R2 | Hostnames | Branch |
| --- | --- | --- | --- | --- | --- |
| local | in-memory fake (`USE_FAKE_CHAIN`) | the local simulated database | simulated; `fuda-media-local` only for remote-binding runs | none | any |
| develop | Base Sepolia | `fuda-beta` | `fuda-media-dev` | `*.fuda.sh` today, `*.dev.fuda.sh` after the mainnet cutover | `develop` |
| production | Base mainnet | `fuda` | `fuda-media` | `*.fuda.sh` from the cutover | `main` |

The Sepolia deployment is live on the apex hostnames today and keeps them until the cutover; the `production` target therefore carries no `routes`, so deploying it early cannot take a hostname from the running one. The local environment is named `local`, not `dev`, so it is never confused with the deployed develop one. Each environment is a target of the api in `apps/api/targets.jsonc`, deployed as its own Void project ([ADR 0009](./adr/0009-void-and-solid.md)). Nothing is migrated at the cutover — see [ADR 0006](./adr/0006-per-chain-environments.md) — so production begins with an empty database and bucket.

Because each frontend's Worker uses `https://api.fuda.sh` unless its optional `API_BASE_URL` var overrides it, a deployment belongs to exactly one environment: a develop deployment must point at the develop api. The deploy order and the one-time chain setup per environment are in the [runbook](./runbook.md).

## Configuration

The deployment's configured values, and what fails when one is missing, are tabulated once in the attestation model's [chain fixtures](./specs/attestation-model.md#chain-fixtures) and [configured values](./specs/attestation-model.md#configured-values). In outline:

- **`apps/api/targets.jsonc` `vars`**, one set per target — the chain addresses and the api's own base: `EAS_ADDRESS`, `SCHEMA_REGISTRY_ADDRESS`, `EAS_SCHEMAS`, `ISSUER_ADDRESS`, `DELEGATION_UID`, `GRAPH_START_BLOCK` (the rights-subgraph manifest's generated start block; it is not read by the API), `FACTORY_ADDRESS` (the smart-wallet factory the Bearer holder address is derived from), and `API_BASE_URL` (the absolute base of the `passUrls` in an `/issue` response, and the api entry in the Google Wallet `origins` claim).
- **Worker secrets** — `SIGNER_PRIVATE_KEY`, `ADMIN_TOKEN`, `BASE_RPC_URL`, the four `GOOGLE_*` names and the five `APPLE_*` names. A wallet platform is all-or-nothing: a missing name answers `501`, never a broken pass.
- **`USE_FAKE_CHAIN`** — local development only (`apps/api/targets/local/.env`); it swaps in an in-memory chain and is never set in a deployed environment.
- **Frontend environment** — each Worker's optional `API_BASE_URL` var, emitted by `void.config.ts` only when explicitly set in the shell (otherwise the Worker defaults to `https://api.fuda.sh`); `VITE_GRAPH_RIGHTS_ENDPOINT` in the member app and dashboard; `VITE_ENS_PAYMASTER_URL` in the dashboard; `VITE_APP_ORIGIN` and `VITE_RP_ID` in the member app. Vite bakes the `VITE_*` values in at build time, so changing one means redeploying that app.

## Member app responsibility

`apps/app` serves two journeys from one Worker and origin. Public `/@handle/*` venue pages own their navigation and issuance flow without a member session. The public member top and `/signin` lead to server-verified passkey login; `/rights`, `/signed`, and `/settings` share a session and Dock. Member and operator credentials have separate server audiences and browser token stores; neither is authority for the other's endpoints. The shared `@fuda/libs/wallet` and `@fuda/libs/auth` modules own wallet validation, the challenge/signature sequence, token storage and stale-work generations. Product controllers own restoration, navigation and domain data. `@fuda/ui` shares the native confirmation dialog and appearance controls.

`apps/app` is also the member-owned public pass surface. Its `/rights` list unions public Graph rights for the authenticated Holder or a manually entered public address with pass UIDs remembered by that browser, then treats `GET /verify/:uid` as the live source for each row's status and entitlement metadata. It can display degraded device-only rows when the public index is unavailable, but it never writes a member record to the API.

The strings a client and the api must agree on byte-for-byte — the QR payload, the challenge string, the nonce shape and the passkey `rp.id` — are pinned in the attestation model's [wire constants](./specs/attestation-model.md#wire-constants). Changing any of them is a protocol version bump.

## Related documentation

- [Runbook](./runbook.md) — one-time chain setup, secrets and vars, deploy order, smoke ladders, reconciliation
- [ADR 0001 — EAS-native target architecture](./adr/0001-eas-native-target-architecture.md)
- [ADR 0002 — unfiltered announcement log](./adr/0002-unfiltered-announcement-log.md)
- [ADR 0003 — separate Graph push and query lanes](./adr/0003-graph-push-query-lanes.md)
- [ADR 0004 — member pass list derived from holder addresses](./adr/0004-member-pass-list-from-holder.md)
- [ADR 0005 — one hybrid resolver for the claimed and offchain ENS tree](./adr/0005-hybrid-ensv2-resolver.md)
- [ADR 0006 — one deployment per chain, nothing migrated at the cutover](./adr/0006-per-chain-environments.md)
- [ADR 0007 — fuda keeps root custody of the issuer registry](./adr/0007-root-custody-of-the-issuer-registry.md)
- [ADR 0014 — offchain rights by default](./adr/0014-offchain-default-pass-types.md)
- [api README](../apps/api/README.md) — running the api locally, endpoints, error codes
- [Glossary](./CONTEXT.md)
