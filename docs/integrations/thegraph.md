# The Graph in fuda

**What fuda does.** A membership, a ticket or an event badge is normally a row in
some vendor's database. fuda makes it a revocable on-chain record instead: a venue
issues a right, the member keeps it in Apple Wallet, Google Wallet or a browser
pass, and a scanner at a real door decides admission by reading the chain — not by
asking fuda whether this person is a customer.

**Where The Graph sits.** On the read path of two of the four surfaces. The member
app queries a subgraph to discover rights it cannot see any other way; the operator
dashboard queries the same subgraph for on-chain status. When that landed, the
API's own cache was deleted, so there is no fuda-hosted fallback behind either
screen. The gate never touches it — admission reads EAS directly and fails closed.

**Why Substreams as well.** The events fuda cares about belong to two public
standards, not to fuda. Packaging the extraction as a reusable Substreams module
and composing fuda's own events on top makes that separation real: the standard's
half is importable by anyone, and stopping the whole lane changes nothing about the
product — which is what makes the claim checkable rather than rhetorical.

```mermaid
flowchart LR
    ANN[("ERC-5564 Announcer<br/>singleton, every EVM chain")]
    EAS[("EAS<br/>singleton, every OP Stack chain")]

    subgraph push["Push lane — Substreams · The Graph Market"]
        M1["fuda_erc5564<br/>map_announcements<br/>reusable .spkg"]
        M2["erc5564_eas_pipeline<br/>map_eas_events"]
        M3["fuda_events<br/>composed"]
        M1 --> M3
        M2 --> M3
    end

    subgraph query["Query lane — fuda-rights · Subgraph Studio"]
        SG["Right · Delegation<br/>Attendance · Announcement"]
    end

    ANN -. "optional" .-> M1
    EAS -. "optional" .-> M2
    ANN --> SG
    EAS --> SG

    SG ==> APP["Member app<br/>+Private discovery, right cards"]
    SG ==> DASH["Operator dashboard<br/>On-chain status"]
    M3 -. "evidence · reuse<br/>no product surface reads this" .-> ANYONE["Any importer"]

    EAS ==>|"eth_call, fail-closed"| GATE["Gate admission"]
```

Bold is required, dotted is optional: **stop the subgraph and the app and dashboard
fail explicitly**; **stop the Substreams lane and nothing in the product changes at
all**; **the gate never goes through The Graph** in either case.

| | |
| --- | --- |
| [The two standards underneath](#the-two-standards-underneath) | What ERC-5564 and EAS are, and why being singletons decided the design |
| [What was built](#what-was-built) | The reusable module, the composition, the subgraph |
| [On the product's read path](#on-the-products-read-path) | Which screens query it, and the constraint that keeps the indexer dumb |
| [Evidence](#evidence) | Identifiers, live captures, and how to check all of it without trusting this page |
| [Reproduce it](#reproduce-it) | What runs from a clean clone, and the two proofs that need credentials |
| [Source map](#source-map) | Every file, one hop |

Deeper background: [module contracts](../specs/substreams.md) ·
[why two independent lanes (ADR 0003)](../adr/0003-graph-push-query-lanes.md) ·
[why nothing is filtered server-side (ADR 0002)](../adr/0002-unfiltered-announcement-log.md) ·
[deploying and smoke-testing the subgraph](../runbook.md)

## The two standards underneath

Everything here reads two contracts, and both are **singletons deployed at the same
address on every chain**. That is the fact the whole design leans on.

| Contract | Address | Scope |
| --- | --- | --- |
| [ERC-5564](https://eips.ethereum.org/EIPS/eip-5564) Announcer | `0x55649E01B5Df198D18D95b5cc5051630cfD45564` | same on every EVM chain |
| [EAS](https://attest.org) | `0x4200000000000000000000000000000000000021` | same on every OP Stack chain |

**ERC-5564 — stealth addresses.** A stealth address is a one-time address that only
the intended recipient can recognise and spend from, and that nobody else can link
back to them. The sender derives it from the recipient's published *meta-address*,
sends to it, and posts an `Announcement` to a single canonical contract — the
**Announcer** — carrying the ephemeral public key and a one-byte view tag. The
recipient scans announcements with a private viewing key to find the ones meant for
them. The Announcer holds no index and takes no position on who anything belongs
to; it is a public log, and that is the entire design. fuda uses it for **+Private**
rights, so a member's rights are not linkable to each other or to them on-chain.

The standard is in production use beyond fuda:
[**Fluidkey**](https://docs.fluidkey.com/technical-documentation/technical-walkthrough/)
is a stealth-address wallet built on it, and fuda borrowed two ideas from their
published design — deriving stealth keys deterministically from a root secret so a
user can re-enumerate their own addresses without the operator's server (their
[stealth-account-kit](https://github.com/fluidkey/fluidkey-stealth-account-kit) is
open source), and letting a stable public name resolve to a *fresh* stealth address
per query rather than a durable one.

**EAS — attestations as the source of truth.** [EAS](https://attest.org) is a public
contract for signed, schema-typed, revocable statements on-chain. Register a
*schema* — a field list — once, and anyone can attest against it; each attestation
gets a UID, records its attester and recipient, and can be revoked later by the
attester. No application logic, no permission system: a neutral place to put a claim
so anyone can check it. fuda puts three kinds there — a right (`Entitlement`), a
venue's authority to issue rights (`IssuerDelegation`), and a visit (`Attendance`).
The gate resolves the first two by `eth_call` and fails closed, which is what makes
"revoke on-chain and the same QR turns red on the next scan" true without fuda being
in the loop. Live UIDs and schemas are in [Evidence](#evidence); the model is
specified in [`attestation-model.md`](../specs/attestation-model.md).

## What was built

### 1. `fuda_erc5564` — a reusable Substreams module

[`packages/substreams/erc5564/`](../../packages/substreams/erc5564)

One map module, `map_announcements`, extracting raw ERC-5564 `Announcement` events
from a **parameterized** Announcer address with the canonical singleton as default.
No fuda policy at all: it does not restrict the scheme id, decode metadata, match a
viewing key, or make an RPC call. The protobuf package `fuda.erc5564.v1` is the
public compatibility contract, pinned in [the spec](../specs/substreams.md).

Because there is no application logic in it, any other ERC-5564 consumer — a
stealth-address wallet, a payroll tool, a donation page — can take the same package
and get announcements without writing Rust.

### 2. `erc5564_eas_pipeline` — the composition

[`packages/substreams/erc5564-eas-pipeline/`](../../packages/substreams/erc5564-eas-pipeline)

This package **imports the first one by `.spkg`** and composes it with an EAS module
into a single stream:

```yaml
imports:
  erc5564: ../erc5564/fuda-erc5564-v0.1.0.spkg

modules:
  - name: fuda_events
    inputs:
      - map: erc5564:map_announcements   # imported, unchanged
      - map: map_eas_events              # this package's own
```

```mermaid
flowchart LR
    BLK[("sf.ethereum.type.v2.Block")]

    subgraph pkg1["fuda_erc5564 — imported by .spkg"]
        MA["map_announcements<br/>param: announcer_address<br/>default: canonical Announcer"]
    end

    subgraph pkg2["erc5564_eas_pipeline — this package"]
        ME["map_eas_events<br/>param: eas_address<br/>default: Base EAS"]
        FE["fuda_events"]
    end

    BLK --> MA
    BLK --> ME
    MA -->|"fuda.erc5564.v1.Announcements<br/>unchanged"| FE
    ME -->|"fuda.pipeline.v1.EasEvents"| FE
    FE --> OUT["fuda.pipeline.v1.FudaEvents<br/>{ announcements[], eas_events[] }"]
```

The package boundary is the point: everything inside `fuda_erc5564` is the standard,
everything inside `erc5564_eas_pipeline` is fuda, and the seam is a `.spkg` file plus
a protobuf package name — not a shared repository or a shared opinion. `fuda_events`
places both lists side by side and deliberately defines **no total order** across
them; `tx_hash` + `log_index` are the identity and correlation keys.

### 3. `fuda-rights` — the subgraph

[`packages/subgraphs/rights/`](../../packages/subgraphs/rights)

An AssemblyScript subgraph with two `ethereum/events` sources (EAS
`Attested`/`Revoked`, Announcer `Announcement`) producing `Right`, `Delegation`,
`Attendance` and `Announcement` entities. Deployed to Subgraph Studio, and the
subject of the next section.

## On the product's read path

The subgraph is not a side exhibit. When it landed, the API's own D1 announcement
crawl and its `GET /announcements` route were **deleted** (migration
[`0001_drop_announcement_cache.sql`](../../apps/api/migrations/0001_drop_announcement_cache.sql)),
so there is no fuda-hosted fallback behind these screens.

| Surface | What it reads from the Graph | Code |
| --- | --- | --- |
| Member app `/private` | Every raw `Announcement`, paged by a `(blockNumber, id)` cursor, matched locally against the passkey-derived viewing key. | [`PrivateScreen.tsx`](../../apps/app/src/PrivateScreen.tsx) → [`private-member.ts`](../../apps/app/src/private-member.ts) |
| Member app `/rights` | Public rights by holder, combined with device memory and live API status checks. | [`RightsList.tsx`](../../apps/app/src/RightsList.tsx) |
| Operator dashboard, "On-chain status" | Rights by holder, Attendance by right, IssuerDelegation by issuer — shown next to the operator's own rows, never merged with them. | [`on-chain-status.ts`](../../apps/dash/src/on-chain-status.ts), [`OnChainStatus.tsx`](../../apps/dash/src/OnChainStatus.tsx) |
| Shared SDK | The only Graph client: four typed fetchers with full response validation, GraphQL errors taking precedence, integer scalars kept as `bigint`. | [`graph.ts`](../../packages/sdk/src/graph.ts) |
| Config | `VITE_GRAPH_RIGHTS_ENDPOINT`, baked in at build time for both apps. Empty → private discovery and on-chain status report missing configuration; `/rights` explicitly falls back to device-remembered passes. | [`app/config.ts`](../../apps/app/src/config.ts), [`dash/config.ts`](../../apps/dash/src/config.ts) |

Gate admission and issuance are deliberately absent from that table: the gate reads
EAS directly, and issuance writes EAS and D1.

The most demanding path is +Private discovery, and it is the one that explains why
the indexer stays dumb:

```mermaid
sequenceDiagram
    participant App as Member app (browser)
    participant SG as fuda-rights subgraph
    participant API as fuda API
    participant EAS as EAS (Base)

    App->>SG: fetchAnnouncements (every announcement, paged)
    SG-->>App: raw ERC-5564 announcements
    Note over App: matchAnnouncements with the passkey-derived<br/>viewing key — on the device, never sent anywhere
    App->>API: signed challenge for a matched right
    API->>EAS: eth_call to verify, fail-closed
```

The indexer is asked for *everything* and told nothing. Filtering per issuer or per
member would let it learn which announcements belong to whom, shrinking the
anonymity set to whatever it indexed for you — which is why
[ADR 0003](../adr/0003-graph-push-query-lanes.md) preserves this privacy invariant
from the superseded API-cache decision in ADR 0002. Anything that
looks like *matching* belongs to the member's device; anything that looks like
*state* ("is this right valid right now?") belongs to the gate reading EAS directly.

## Evidence

The identifiers and results below record prior captures. They are not a fresh
health check; rerun the verification steps to establish current deployment state.

### Identifiers

| Item | Value |
| --- | --- |
| Subgraph | `fuda-rights` v0.1.0 on Subgraph Studio — `https://api.studio.thegraph.com/query/87336/fuda-rights/v0.1.0` |
| Deployment | `QmRGTZM5fsiCqh15aQAKwnEG2fzs1h8gymKAHzddf6LZgP` |
| Network / start block | Base Sepolia, from block `7552655` |
| Substreams provider | The Graph Market (Pinax) |
| `fuda-erc5564-v0.1.0.spkg` sha256 | `c5aa6056b885d3144da5014afda5eb46f69b64ed51cb51109443c942aa531ff9` |
| `erc5564-eas-pipeline-v0.1.0.spkg` sha256 | `408a25bc9be646f7e84ccfbd3f1b024aaaf0509bed5a93f9a89e1b50a4829dba` |
| Attester for every capture below | `0xAA64E3814A88f4bA4588787EB04e5eACBabcd77E` |

The `.spkg` files are built locally and not committed — build and pack them with the
commands in each package's README. The checksums identify the artifacts used for
every capture here; see [Reproduce it](#reproduce-it) for what they do and do not
guarantee.

### Captured from the live stream

From The Graph Market on Base Sepolia. All three events belong to one +Private
right, `0xe5c5a670…dacf7bf` — one right's whole life read out of a single composed
stream, with the announcement arriving through the imported package unchanged:

| Event | Block | Stream |
| --- | --- | --- |
| EAS `Attested` | 46468810 | `fuda_events` (composed) |
| ERC-5564 `Announcement` | 46468812 | `fuda_events`, via the imported module |
| EAS `Revoked` | 46468842 | `fuda_events` (composed) |

On the query side, [`queries/smoke.graphql`](../../packages/subgraphs/rights/queries/smoke.graphql)
answered from Studio with the Bearer right `0x2211134e…b966`, its delegation
`0x7bb324ad…6155`, attendance `0x0e92458a…00d9`, and a non-null `revokedAt` after a
revoke — matching the transaction receipts.

The second chain is [The cross-chain proof](#the-cross-chain-proof).

### Verify it independently

None of this requires trusting this page, this repository, or any fuda service. The
same attestations check out three ways: on a third-party EAS explorer, in the
subgraph, and in the composed stream above.

| What | UID on the Base Sepolia EAS explorer | Schema |
| --- | --- | --- |
| +Private right (revoked) | [`0xe5c5a670…dacf7bf`](https://base-sepolia.easscan.org/attestation/view/0xe5c5a670df22a5978125885a95d27863c283b66ef47bd49b95d03d580dacf7bf) | Entitlement |
| Bearer right (revoked) | [`0x2211134e…57abb966`](https://base-sepolia.easscan.org/attestation/view/0x2211134ef501c67828d03fd12fadc2b36937e9924a3f96cfa75ee61557abb966) | Entitlement |
| Root delegation (active) | [`0x7bb324ad…1a6e155`](https://base-sepolia.easscan.org/attestation/view/0x7bb324ad1ec399488f18178153a046d7bcca44bb9688e72e0ce9581a61a6e155) | IssuerDelegation |
| Attendance | [`0x0e92458a…3800d9`](https://base-sepolia.easscan.org/attestation/view/0x0e92458a6f8bb9a8053eaad0d52658f6125683198dce30e3ae9d1aca943800d9) | Attendance |

The +Private right's recipient is `0x000A9A88…75431`, a one-time stealth address.
The Bearer right and the Attendance share recipient `0xb682824e…e4B4` — which is how
"this holder attended" is expressed without a database.

Those UIDs point at three registered schemas. The field lists are what the
subgraph's `handleAttested` decodes, and they are also the values in
[`wrangler.jsonc`](../../apps/api/wrangler.jsonc)'s `EAS_SCHEMAS` — so the explorer,
the Worker and the indexer can be compared directly:

| Schema | UID | Fields |
| --- | --- | --- |
| Entitlement | [`0x42ffdba9…d86d616`](https://base-sepolia.easscan.org/schema/view/0x42ffdba952267e373cb33ecf9fdc190fb27b30140d0695dabb8383bbed86d616) | `address holder, address issuer, uint8 usageModel, uint8 tier, uint8 level, bytes32 serial, uint64 validFrom, uint64 validUntil, string metaURI` |
| IssuerDelegation | [`0x62c93e6e…3895f327`](https://base-sepolia.easscan.org/schema/view/0x62c93e6e95f3956ba5937fc8454203ba781af5e455657952e915e71c3895f327) | `address issuer, bool active, string name` |
| Attendance | [`0x22a41470…6e10241`](https://base-sepolia.easscan.org/schema/view/0x22a41470aabe3a0edec1f9948975a887f21adddd6cf009e865e267cac6e10241) | `bytes32 rightUID, address holder, uint64 enteredAt, bytes32 slotId` |

The same UIDs come back from the subgraph, with `revokedAt` non-null for the two
revoked ones and `hasIndexingErrors` false:

```sh
curl -s -X POST -H 'content-type: application/json' \
  -d '{"query":"{ _meta { block { number } hasIndexingErrors } rights(first:10){ id revokedAt delegation { name active } } attendances(first:10){ id } }"}' \
  https://api.studio.thegraph.com/query/87336/fuda-rights/v0.1.0
```

And the deployed surfaces carry what this page claims they carry. The Graph endpoint
is compiled into each bundle at build time, so it is visible in the shipped
JavaScript for <https://app.fuda.sh> and <https://dash.fuda.sh>, and absent from
<https://gate.fuda.sh>:

```sh
curl -s https://app.fuda.sh/ | grep -o '/assets/index-[^"]*\.js' | head -1
curl -s https://app.fuda.sh/assets/index-<hash>.js | grep -o 'api\.studio\.thegraph\.com[^"]*'
```

## Reproduce it

### From a clean clone, no credentials

```sh
pnpm install --frozen-lockfile
pnpm --ignore-workspace --dir packages/subgraphs/rights install --frozen-lockfile

# the two Substreams modules
cargo test --manifest-path packages/substreams/erc5564/Cargo.toml               # 6 tests
cargo test --manifest-path packages/substreams/erc5564-eas-pipeline/Cargo.toml  # 4 tests

# the wasm both packages actually ship
cargo build --release --target wasm32-unknown-unknown \
  --manifest-path packages/substreams/erc5564/Cargo.toml
cargo build --release --target wasm32-unknown-unknown \
  --manifest-path packages/substreams/erc5564-eas-pipeline/Cargo.toml

# the subgraph mappings. `subgraph.yaml`, `src/schema-uids.ts` and `generated/`
# are gitignored, so they have to be produced before the mappings will compile —
# prepare reads top-level Sepolia vars from apps/api/wrangler.jsonc.
pnpm graph:prepare
pnpm graph:codegen
pnpm graph:test                                                                 # 12 Matchstick tests
# Matchstick ships no binary for some kernels; if it fails to start,
# run the same suite in Docker with `graph test -d`.
```

Built with `substreams` CLI 1.22.0, crates `substreams` 0.7.6, `substreams-ethereum`
0.11.1, `prost` 0.13. A rebuild reproduces the checksums above only under the same
toolchain, so they are stated as the identity of those artifacts rather than as a
promise of byte-reproducibility. What the cross-chain proof relies on is narrower and
does hold: **one artifact, unmodified between two runs.**

### The cross-chain proof

"It runs on other chains too" is not a checkable claim. Anyone can say it after
quietly swapping an address constant and recompiling for the second network.

A `.spkg` makes it checkable, because the package is a **single binary file** —
wasm, manifest and protobuf in one artifact. So: hash the file, run it against one
chain, run **that same file** against another, hash it again. If both hashes match,
nothing was rebuilt, no manifest was edited and no address was changed in between.
The only thing that differed was the `-e` endpoint.

That this is even possible is the singleton property from
[the two standards](#the-two-standards-underneath) paying off: the Announcer is at
the same address on every EVM chain, so there is no address to change, so there is
nothing to rebuild.

```sh
export ERC5564_PACKAGE=packages/substreams/erc5564/fuda-erc5564-v0.1.0.spkg
sha256sum "$ERC5564_PACKAGE"

substreams run -e "<BASE_SEPOLIA_FIREHOSE_ENDPOINT>" \
  "$ERC5564_PACKAGE" map_announcements \
  --start-block "<KNOWN_ANNOUNCEMENT_BLOCK>" --stop-block +1000

substreams run -e "<SECOND_EVM_FIREHOSE_ENDPOINT>" \
  "$ERC5564_PACKAGE" map_announcements \
  --start-block "<KNOWN_ANNOUNCEMENT_BLOCK>" --stop-block +1000

sha256sum "$ERC5564_PACKAGE"   # must be identical to the first
```

**What moves is the endpoint; what does not move is the artifact.**

**What was actually run.** The identical `erc5564_eas_pipeline`, same checksum,
streamed a 2,000-block range on **Base mainnet** through the same provider with no
change to the package, the manifest or the modules. It processed successfully, and
that range contained no `Announcement`. So this proves the *artifact* is portable;
it does not prove fuda decoded third-party events on a second chain. Two different
claims, and only the first one is demonstrated here.

Running it yourself needs a Graph Market token and two Firehose endpoints, so this
is the one procedure on the page that a clean clone cannot execute.

### That the push lane is not plumbing

```sh
pkill -f 'substreams run'
pgrep -af '[s]ubstreams run' && echo 'FAIL: a runner is still active'
```

With no runner alive: +Private discovery still finds the right, the right cards still
render, the dashboard's on-chain status still answers, and a revoked pass still scans
red. Note precisely what that shows — the **Substreams lane** is not on the read
path. It does **not** show the product works without The Graph: remove the subgraph
and private discovery and on-chain lookups become unavailable. Public `/rights`
can still show device-remembered passes with API status checks. This is the boundary in
[On the product's read path](#on-the-products-read-path).

Deploying and operating the subgraph is a different document —
[`docs/runbook.md`](../runbook.md) §7 for the deploy, §9 for the parameterized
smoke query against real UIDs.

## Source map

One anti-drift detail first, because it is the kind of thing that silently
invalidates an indexer: the subgraph's `subgraph.yaml` and its schema-UID map are
**generated from the API's top-level Sepolia schema/start-block configuration**
([`scripts/prepare.ts`](../../packages/subgraphs/rights/scripts/prepare.ts)), and
generation fails loudly while `EAS_SCHEMAS` or `ANNOUNCER_FROM_BLOCK` are unset. The
generated indexer uses the same accepted schema UIDs as that API configuration.
The network and contract addresses come from `config/base-sepolia.json`; the
CLI does not select `env.production`. Rebuild and deploy both after changing
those inputs.

**`packages/substreams/erc5564/`** — `fuda_erc5564` v0.1.0

| File | What |
| --- | --- |
| [`substreams.yaml`](../../packages/substreams/erc5564/substreams.yaml) | one map module; `params` default = the canonical Announcer |
| [`src/lib.rs`](../../packages/substreams/erc5564/src/lib.rs) | `map_announcements` handler; `extract_announcements`; full 32-byte `scheme_id` |
| [`proto/`](../../packages/substreams/erc5564/proto) | `fuda.erc5564.v1.Announcement` / `Announcements` — the public contract |
| [`tests/map_announcements.rs`](../../packages/substreams/erc5564/tests/map_announcements.rs) | address parsing, decoding, wrong address, failed tx, malformed logs |

**`packages/substreams/erc5564-eas-pipeline/`** — `erc5564_eas_pipeline` v0.1.0

| File | What |
| --- | --- |
| [`substreams.yaml`](../../packages/substreams/erc5564-eas-pipeline/substreams.yaml) | the `imports:` line and `fuda_events` inputs |
| [`src/lib.rs`](../../packages/substreams/erc5564-eas-pipeline/src/lib.rs) | `fuda_events`; `map_eas_events`; `merge_events` |
| [`proto/fuda.proto`](../../packages/substreams/erc5564-eas-pipeline/proto) | imports the ERC-5564 proto rather than redefining it |

**`packages/subgraphs/rights/`** — the `fuda-rights` subgraph

| File | What |
| --- | --- |
| [`schema.graphql`](../../packages/subgraphs/rights/schema.graphql) | `Right`, `Delegation` (mutable), `Attendance`, `Announcement` (immutable) |
| [`src/eas.ts`](../../packages/subgraphs/rights/src/eas.ts) | `handleAttested` decodes by schema UID + version; `handleRevoked` |
| [`src/announcer.ts`](../../packages/subgraphs/rights/src/announcer.ts) | `handleAnnouncement` — stores every announcement, unfiltered |
| [`src/codecs.ts`](../../packages/subgraphs/rights/src/codecs.ts) | ABI decoders for the three EAS schema payloads |
| [`scripts/prepare.ts`](../../packages/subgraphs/rights/scripts/prepare.ts) | generates the manifest and UID map from top-level Sepolia vars and network config; refuses placeholders |

`packages/substreams/*` and `packages/subgraphs/*` build independently and are not
pnpm workspace members — see the repository layout notes in
[`AGENTS.md`](../../AGENTS.md).
