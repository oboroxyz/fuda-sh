# fuda rights subgraph

This independently installed Graph package indexes fuda Entitlements, IssuerDelegations, Attendance records,
revocations, and raw ERC-5564 announcements on Base Sepolia.

Install this package independently with its committed lockfile, then run its
lifecycle from the repository root (the root workspace install does not install it):

```sh
pnpm --ignore-workspace --dir packages/subgraphs/rights install --frozen-lockfile
pnpm graph:prepare
pnpm graph:codegen
pnpm graph:test
pnpm graph:build
```

`graph:prepare` reads only the top-level production `EAS_SCHEMAS` and `ANNOUNCER_FROM_BLOCK` values from
`apps/api/wrangler.jsonc`. It deliberately fails while schema sets are empty or the start block is zero. Populate
those values from live deployment receipts before generating a deployable `subgraph.yaml`; fixture-generated
manifests and schema constants must not be committed.

Generation retains every configured UID/version. The current Entitlement,
IssuerDelegation, and Attendance wire codecs support version 1, matching the
API. A future wire version requires a decoder/upcast before its events can
index; configuring a positive version does not reinterpret it as v1.

`Right.refUID` preserves the raw EAS reference. `Right.delegation` is nullable
and resolves only when that reference names an already indexed, accepted
Delegation. Zero, missing, and unaccepted references remain visible as Rights
with `delegation: null`; they do not break nested rights queries. An unresolved
reference requires reindexing if its Delegation was outside the indexed history.
Deploy and reindex this schema before using SDK clients that require `refUID`.

After creating a subgraph in Graph Studio, authenticate and deploy from this directory with the slug Studio
provides:

```sh
pnpm --ignore-workspace exec graph auth --studio <DEPLOY_KEY>
pnpm --ignore-workspace exec graph deploy --studio <SUBGRAPH_SLUG>
```

Use [`queries/smoke.graphql`](queries/smoke.graphql) with real right, delegation, and attendance UIDs. Compare the
returned holders, metadata, relations, and revocation timestamps with their transaction receipts. The query also
returns recent raw announcements so their bytes and transaction/log identity can be checked directly.
