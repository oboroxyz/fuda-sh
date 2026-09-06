# fuda rights subgraph

This independently installed Graph package indexes fuda Entitlements, IssuerDelegations, Attendance records,
revocations, and raw ERC-5564 announcements on Base Sepolia.

Run its lifecycle from the repository root:

```sh
pnpm graph:prepare
pnpm graph:codegen
pnpm graph:test
pnpm graph:build
```

`graph:prepare` reads only the top-level production `EAS_SCHEMAS` and `ANNOUNCER_FROM_BLOCK` values from
`apps/api/wrangler.jsonc`. It deliberately fails while schema sets are empty or the start block is zero. Populate
those values from live deployment receipts before generating a deployable `subgraph.yaml`; fixture-generated
manifests and schema constants must not be committed.

After creating a subgraph in Graph Studio, authenticate and deploy from this directory with the slug Studio
provides:

```sh
pnpm --ignore-workspace exec graph auth --studio <DEPLOY_KEY>
pnpm --ignore-workspace exec graph deploy --studio <SUBGRAPH_SLUG>
```

Use [`queries/smoke.graphql`](queries/smoke.graphql) with real right, delegation, and attendance UIDs. Compare the
returned holders, metadata, relations, and revocation timestamps with their transaction receipts. The query also
returns recent raw announcements so their bytes and transaction/log identity can be checked directly.
