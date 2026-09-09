# fuda rights subgraph

This independently installed Graph package indexes fuda Entitlements, IssuerDelegations, Attendance records, revocations, and raw ERC-5564 announcements on Base Sepolia.

Install this package independently with its committed lockfile, then run its lifecycle from the repository root (the root workspace install does not install it):

```sh
pnpm --ignore-workspace --dir packages/subgraphs/rights install --frozen-lockfile
pnpm graph:prepare
pnpm graph:codegen
pnpm graph:test
pnpm graph:build
```

`graph:prepare` reads only the top-level production `EAS_SCHEMAS` and `ANNOUNCER_FROM_BLOCK` values from `apps/api/wrangler.jsonc`. It deliberately fails while schema sets are empty or the start block is zero. Populate those values from live deployment receipts before generating a deployable `subgraph.yaml`; fixture-generated manifests and schema constants must not be committed.

`subgraph.yaml`, `src/schema-uids.ts` and `generated/` are gitignored, so a fresh clone must run `graph:prepare` and `graph:codegen` before the mappings will compile.

Generation retains every configured UID/version. The current Entitlement, IssuerDelegation, and Attendance wire codecs support version 1, matching the API. A future wire version requires a decoder/upcast before its events can index; configuring a positive version does not reinterpret it as v1.

`Right.refUID` preserves the raw EAS reference. `Right.delegation` is nullable and resolves only when that reference names an already indexed, accepted Delegation. Zero, missing, and unaccepted references remain visible as Rights with `delegation: null`; they do not break nested rights queries. An unresolved reference requires reindexing if its Delegation was outside the indexed history. Deploy and reindex this schema before using SDK clients that require `refUID`.

After creating a subgraph in Graph Studio, authenticate and deploy from this directory with the slug Studio provides:

```sh
pnpm --ignore-workspace exec graph auth --studio <DEPLOY_KEY>
pnpm --ignore-workspace exec graph deploy --studio <SUBGRAPH_SLUG>
```

Use [`queries/smoke.graphql`](queries/smoke.graphql) with real right, delegation, and attendance UIDs. Compare the returned holders, metadata, relations, and revocation timestamps with their transaction receipts. The query also returns recent raw announcements so their bytes and transaction/log identity can be checked directly.

## Building without production configuration

Normally `graph:prepare` succeeds, because the production values are committed. When you deliberately want to build against explicit non-production UIDs — to prove the build does not depend on production configuration — use the exported preparation seam. It writes only ignored files and restores anything that was already there, even if a later command fails:

```sh
export FUDA_GRAPH_FIXTURE="$(mktemp -d /tmp/fuda-rights-fixture.XXXXXX)"
export FUDA_GRAPH_FIXTURE_CONFIG="$FUDA_GRAPH_FIXTURE/wrangler.jsonc"
export FUDA_GRAPH_PACKAGE=packages/subgraphs/rights
if test -f "$FUDA_GRAPH_PACKAGE/subgraph.yaml"; then
  cp "$FUDA_GRAPH_PACKAGE/subgraph.yaml" "$FUDA_GRAPH_FIXTURE/original-subgraph.yaml"
  touch "$FUDA_GRAPH_FIXTURE/had-subgraph"
fi
if test -f "$FUDA_GRAPH_PACKAGE/src/schema-uids.ts"; then
  cp "$FUDA_GRAPH_PACKAGE/src/schema-uids.ts" "$FUDA_GRAPH_FIXTURE/original-schema-uids.ts"
  touch "$FUDA_GRAPH_FIXTURE/had-schema-uids"
fi
restore_graph_inputs() {
  if test -f "$FUDA_GRAPH_FIXTURE/had-subgraph"; then
    cp "$FUDA_GRAPH_FIXTURE/original-subgraph.yaml" "$FUDA_GRAPH_PACKAGE/subgraph.yaml"
  else
    rm -f "$FUDA_GRAPH_PACKAGE/subgraph.yaml"
  fi
  if test -f "$FUDA_GRAPH_FIXTURE/had-schema-uids"; then
    cp "$FUDA_GRAPH_FIXTURE/original-schema-uids.ts" "$FUDA_GRAPH_PACKAGE/src/schema-uids.ts"
  else
    rm -f "$FUDA_GRAPH_PACKAGE/src/schema-uids.ts"
  fi
}
trap restore_graph_inputs EXIT INT TERM
node --input-type=module -e '
  import { writeFile } from "node:fs/promises";
  import path from "node:path";
  import { prepareRightsSubgraph } from "./packages/subgraphs/rights/scripts/prepare.mjs";
  const schemas = {
    entitlement: [{
      uid: "0x42ffdba952267e373cb33ecf9fdc190fb27b30140d0695dabb8383bbed86d616",
      version: 1,
    }],
    issuerDelegation: [{
      uid: "0x62c93e6e95f3956ba5937fc8454203ba781af5e455657952e915e71c3895f327",
      version: 1,
    }],
    attendance: [{
      uid: "0x22a41470aabe3a0edec1f9948975a887f21adddd6cf009e865e267cac6e10241",
      version: 1,
    }],
  };
  await writeFile(process.env.FUDA_GRAPH_FIXTURE_CONFIG, JSON.stringify({
    vars: { ANNOUNCER_FROM_BLOCK: "1", EAS_SCHEMAS: JSON.stringify(schemas) },
  }));
  const rootDir = path.resolve("packages/subgraphs/rights");
  await prepareRightsSubgraph({
    rootDir,
    wranglerPath: process.env.FUDA_GRAPH_FIXTURE_CONFIG,
    networkConfigPath: path.join(rootDir, "config/base-sepolia.json"),
    templatePath: path.join(rootDir, "subgraph.template.yaml"),
  });
'
pnpm graph:codegen
pnpm graph:test
pnpm graph:build
restore_graph_inputs
trap - EXIT INT TERM
```

Those UIDs are the repository's deterministic test fixtures, not deployable configuration. Do not treat fixture-backed codegen, tests, or builds as proof that production configuration or deployment succeeds.
