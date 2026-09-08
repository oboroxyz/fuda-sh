# ENS issuer claim and name resolution — design

**Status:** active. Temporary artifact for the work it describes; delete it
when the change is implemented, verified, and reflected in
`docs/specs/ens-naming.md`.

## Goal

Let a venue operator claim `<handle>.fuda.eth` from the dashboard without
holding a second wallet, a second chain's native token, or any knowledge of
Ethereum Sepolia — and make the member names under that issuer resolve.

Three outcomes, in dependency order:

1. **Issuer claim.** The operator presses one button, signs one wallet prompt,
   and owns `<handle>.fuda.eth` onchain in the ENSv2 User Registry.
2. **Member name resolution.** `<member-no>.<handle>.fuda.eth` resolves to the
   right's holder address through the existing signed CCIP-Read gateway.
3. **+Private resolution.** The same name for a level-2 right returns a fresh
   one-time stealth address on every query.

## What already exists

The repository ships the whole naming apparatus, untouched by any live
network:

- `FudaResolver` and `FudaSubnameRegistrar` with Solidity tests.
- `claimVoucherTypedData` / `renewVoucherTypedData` / `toRegistryExpiry` in
  `packages/ens-contracts/src/vouchers.ts`.
- Preflight, parent commit/reveal, resumable topology deployment, and
  standalone verification scripts.
- `POST /ens/gateway` with the full EIP-3668 signing path
  (`apps/api/src/ens/{gateway,lookup,resolution,names}.ts`).
- The `ens_names` mirror and `stealth_resolutions` ledger (migration
  `0002_ens_foundation.sql`).

## What is missing

- Every live artifact: `fuda.eth` is unregistered, no fuda contract is
  deployed, and `packages/ens-contracts/.env` does not exist.
- A voucher-signing API surface and its bindings. `apps/api/src/env.ts`
  declares the four gateway bindings and nothing about vouchers or the
  registrar.
- **Any writer for `ens_names`.** Every reference in `apps/api/src` reads. The
  gateway therefore answers nothing, for issuers and members alike.
- A claim UI in the dashboard.
- A gas-sponsorship path for the operator's transaction.

## Decisions

### D1 — The operator signs; fuda sponsors the gas

The venue owner keeps the Base Account they already sign in with, adds
Ethereum Sepolia to it, and submits the claim themselves. fuda pays through an
ERC-7677 paymaster.

Verified by spike on 2026-09-07: the Base Account popup accepts a
`wallet_switchEthereumChain` to `0xaa36a7` and proceeds to gas estimation on
Ethereum Sepolia, failing only on an empty balance (`You have $0.00 in ETH,
but you need $1.95 due to gas fees`). The Coinbase Smart Wallet factory
(`0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a`) has runtime code on Sepolia, so
the account address is the same one the operator already holds on Base
Sepolia.

Rejected alternatives: an injected wallet (a venue owner does not have one); a
direct ETH transfer to the operator before each claim (same money, but it
leaves a per-venue funding trail and needs a hot relayer key); Privy (a new
vendor, a rewrite of a working sign-in rail, and per-member cost as the
venue base grows).

### D2 — The registrar drops its `msg.sender` guard

`FudaSubnameRegistrar._authorize` currently contains
`if (msg.sender != issuer) revert Unauthorized();`. Remove it.

The removal is subtractive: the operator-submitted flow of D1 still works,
because the operator *is* the issuer. What it adds is the ability for fuda to
submit the same voucher on the operator's behalf, unchanged, if the sponsored
path fails on the day.

It costs no authority. The voucher signature already binds label, issuer,
expiry, nonce, and deadline, and only fuda's voucher signer can produce one.
A third party who submits someone else's voucher produces the identical
effect — `owner = voucher.issuer` — and consumes the nonce that voucher was
already the only valid use of. `renew` keeps its own
`userRegistry.getOwner(labelHash) == issuer` check, so relaying a renewal is
equally inert.

Nothing is deployed yet, so this is a source edit rather than a migration.
It must land **before** `ens:topology:deploy`.

### D3 — The paymaster is proxied through the api

Neither Alchemy nor Pimlico can restrict sponsorship by destination contract
or function selector; both offer only spend caps, count caps, sender
allowlists, and a webhook. A sender allowlist cannot help here, because the
senders are venue accounts that do not exist until they claim.

`POST /ens/paymaster` in `apps/api` therefore performs the restriction fuda
actually needs, and the browser sees only that URL:

- the upstream URL (which embeds the vendor key) stays a Worker secret;
- the Gas Manager policy id is injected server-side, which also resolves
  Alchemy's requirement that `context` carry a policy id — the Base Account
  SDK sends `paymasterService: { url }` with no context of its own;
- the destination and selector check lives in tested code rather than a
  vendor dashboard;
- the existing `rateLimit` middleware and `rate_limits` table apply.

Vendor: **Alchemy Free**. Gas sponsorship on testnets is included at $0 with
no card, and the same account provides the Sepolia RPC the api needs for
reading nonces and verifying receipts. Swapping vendors changes one secret and
one module.

### D4 — Only generated member numbers become ENS labels

`members.member_id` holds a generated 13-character member number for
self-serve issuance and **arbitrary operator free text** for admin issuance
(`docs/specs/ens-naming.md`, "Member number and the admin `memberId`"). Only
the former is a valid ENS label.

The mirror writer therefore writes a member row only when
`isMemberNumber(memberId)` holds. An admin-issued right with a free-text id
gets no name and no row, which is the existing documented split rather than a
new limitation.

## Components

### Contract

`packages/ens-contracts/contracts/FudaSubnameRegistrar.sol` — remove the
`msg.sender` line from `_authorize`. Update
`test/FudaSubnameRegistrar.t.sol`: an existing test asserting that a
non-issuer sender reverts becomes a test asserting that a relayed claim
succeeds and still writes `owner = issuer`.

### API

New bindings in `apps/api/src/env.ts`:

| Binding | Kind | Meaning |
| --- | --- | --- |
| `ENS_REGISTRAR_ADDRESS` | var | the deployed `FudaSubnameRegistrar` |
| `ENS_GAS_POLICY_ID` | var | Gas Manager policy id injected into `context`; useless without the upstream URL |
| `ENS_SEPOLIA_RPC_URL` | secret | Ethereum Sepolia RPC for nonce reads and receipt checks |
| `ENS_PAYMASTER_UPSTREAM` | secret | vendor paymaster endpoint |
| `ENS_VOUCHER_KEY` | secret | signs `ClaimVoucher` / `RenewVoucher`; distinct from every other key |

The two URLs are secrets rather than vars because an Alchemy endpoint embeds
its API key in the path, and `wrangler.jsonc` is checked in. With Alchemy they
hold the same value today — the `pm_*` methods are served from the app's own
RPC URL — but they stay separate bindings so the paymaster vendor can change
without touching the chain reads.

Every ENS claim route answers `503` unless all of them are present, matching
the gateway's existing fail-closed rule.

New routes:

| Route | Auth | Behaviour |
| --- | --- | --- |
| `POST /issuers/me/ens/claim-voucher` | operator session | Reject if the issuer already holds a `claimed` row. Read `registrar.nonces(operator)`. Build and sign a `ClaimVoucher` with a short deadline. Upsert the `ens_names` issuer row as `voucher_issued`. Return the voucher fields, the signature, the registrar address, and the chain id. |
| `POST /issuers/me/ens/claimed` | operator session | Take a transaction hash, fetch the receipt from Sepolia, require an `IssuerClaimed` log from the configured registrar whose `labelHash` and `issuer` match this operator's pending row, then set `claimed`, `claim_tx_hash`, and `expiry`. Any mismatch leaves the row at `voucher_issued`. |
| `POST /ens/paymaster` | public, rate-limited | ERC-7677 proxy. See below. |

`GET /issuers/me` gains the issuer's ENS state (`name`, `status`,
`claim_tx_hash`, `expiry`) so the dashboard can render without a second call.

**Paymaster proxy.** Accept only `pm_getPaymasterStubData` and
`pm_getPaymasterData`. Decode the user operation's `callData`, which for a
Coinbase Smart Wallet is `execute(address,uint256,bytes)` or
`executeBatch(...)`, and require every inner call to target
`ENS_REGISTRAR_ADDRESS` with a selector of `claim` or `renew`. Reject anything
else as a JSON-RPC error without contacting the vendor. On success, set
`context` to `{ policyId: ENS_GAS_POLICY_ID }` and forward to
`ENS_PAYMASTER_UPSTREAM`, returning the vendor's response unchanged.

**Mirror writer.** A new `apps/api/src/ens/mirror.ts` owns every write:

| Trigger | Row |
| --- | --- |
| voucher issued | `kind='issuer'`, `<handle>.<parent>`, owner and target both the operator address, `status='voucher_issued'` → `claimed` on confirmation |
| self-serve issuance, and admin issuance whose `memberId` is a member number | `kind='member'`, `<member-no>.<handle>.<parent>`, `right_uid`, `level`, target the holder for bearer/signed, `stealth_meta_address` for private, `status='offchain'` |
| revoke | the member row moves to `status='unregistered'`; `lookup` answers only `offchain` and `claimed`, so the name goes dark on the same request |

Member rows are written in the same D1 batch as the issuance row. A mirror
write that fails must not fail the issuance: the right is the product, the
name is a convenience, and an unwritten row is recoverable while a lost right
is not.

+Private needs no further work beyond writing `stealth_meta_address`:
`apps/api/src/ens/resolution.ts` already allocates a fresh stealth address per
query from that column.

### Dashboard

`createBaseAccountSDK` gains `appChainIds: [84_532, 11_155_111]` and
`paymasterUrls: { 11_155_111: ENS_PAYMASTER_URL }`, where the URL is the
build-time `VITE_ENS_PAYMASTER_URL` pointing at `POST /ens/paymaster`.

A section on the overview page shows one of four states — not claimed,
voucher issued, claimed (with the name and an explorer link), or failed — and
drives:

```
press → POST /issuers/me/ens/claim-voucher
      → wallet_switchEthereumChain(0xaa36a7)
      → wallet_sendCalls(registrar.claim(...))      SDK injects paymasterService
      → waitForCallsStatus → receipt
      → POST /issuers/me/ens/claimed { txHash }
      → render the claimed state
```

The state machine lives in a testable module beside the view, following
`operator-sign-in.ts`.

## Failure behaviour

| Situation | Result |
| --- | --- |
| any ENS binding missing | `503`; the dashboard hides the claim section |
| operator already claimed | `409`; no second voucher |
| Sepolia RPC unreachable | `502`; no row is written |
| operator abandons the wallet prompt | the row stays `voucher_issued`; pressing again reads the nonce afresh and re-signs |
| sponsored call rejected by the proxy | JSON-RPC error; the wallet reports an unsponsored transaction; nothing onchain |
| receipt does not match the pending row | the row stays `voucher_issued`; the api never records an unverified claim |
| mirror write fails during issuance | the right is still issued and returned; the name is absent |

## Testing

- **Solidity.** Relayed claim succeeds and writes `owner = issuer`; renewal
  still requires the current registry owner; the voucher remains one-shot.
- **API.** Voucher route: session required, ownership enforced, deterministic
  signature for fixed inputs, fail-closed without bindings. Claimed route:
  matching receipt accepted, wrong contract, wrong label, and wrong issuer all
  rejected. Paymaster proxy: allowed target and selector forwarded with the
  injected policy id, foreign target rejected, foreign selector rejected,
  batch calls checked per call, rate limit enforced, upstream failure
  surfaced. Mirror: self-serve write, admin write with a member number, admin
  free-text id writes nothing, private row carries the meta-address and no
  target, revoke darkens the name, a failing mirror write leaves issuance
  intact.
- **Dashboard.** The claim state machine across every transition, including
  an abandoned prompt and a rejected sponsorship.
- **Live.** One real claim on Ethereum Sepolia, then one real member-name
  resolution through an ENS client, then one +Private resolution twice over
  to show two different addresses.

## Deployment order

```
generate parent / voucher / gateway-signer keys      (relayer key optional, for D2's fallback)
fund the parent key with Sepolia ETH                 ← blocking, unrelated to the paymaster
ens:preflight
ens:parent:commit → wait ≥60s → ens:parent:reveal    fuda is available; 1y ≈ 160 MockUSDC, minted by the tooling
remove the msg.sender guard (D2)
ens:topology:deploy → ens:verify
set the five new bindings, deploy the api
build and deploy the dashboard with VITE_ENS_PAYMASTER_URL
claim once on Sepolia and verify the name resolves
```

The api, mirror, dashboard, and every test can be written before any of this.
Only deployment and live verification wait on funding.

## Out of scope

Renewal UI (the contract and voucher builder already support it; nothing
expires within the demo horizon), the `fuda.sh` DNSSEC alias, granting
`UNREGISTER` to any principal, and Base mainnet.
