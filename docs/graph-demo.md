# Graph integration demo and evidence runbook

This runbook separates reproducible local verification from evidence that must
come from live networks. The repository does not contain production schema
UIDs, a positive production start block, a deployed Graph endpoint,
Substreams credentials, or event receipts. Values written as `<PLACEHOLDER>`
must be replaced with real values; an unfilled command or template is not
evidence.

## 1. Evidence prerequisites

Collect these before timing the demo:

- top-level production `EAS_SCHEMAS` values and a positive
  `ANNOUNCER_FROM_BLOCK` in `apps/api/wrangler.jsonc`, sourced from live
  registration and deployment receipts;
- a deployed and synced Base Sepolia rights subgraph, its Studio query URL for
  controlled checks, and a browser-safe public gateway URL (or same-origin
  proxy) for `VITE_GRAPH_RIGHTS_ENDPOINT`;
- `SUBSTREAMS_API_TOKEN`, the Base Sepolia Firehose endpoint, a second
  Firehose-supported EVM endpoint, and a known Announcement block on each
  chain;
- a funded issuer, live API URL, `ADMIN_TOKEN`, and real issue, Attendance,
  Announcement, and revoke transactions;
- a PRF-capable member passkey, its meta-address, the resulting stealth holder,
  and access to the member app, dashboard, and gate scanner built with the
  public Graph endpoint.

Create a private evidence directory outside the repository. Do not record
private keys, admin tokens, deploy keys, or the Substreams token in it:

```sh
export FUDA_GRAPH_EVIDENCE="/tmp/fuda-graph-evidence-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$FUDA_GRAPH_EVIDENCE"
date -u +%FT%TZ | tee "$FUDA_GRAPH_EVIDENCE/started-at.txt"
git rev-parse HEAD | tee "$FUDA_GRAPH_EVIDENCE/git-head.txt"
```

## 2. Repository-local verification

Run the two Rust suites and release WASM builds from the repository root:

```sh
cargo test --manifest-path packages/substreams/erc5564/Cargo.toml
cargo test --manifest-path packages/substreams/erc5564-eas-pipeline/Cargo.toml
cargo build --release --target wasm32-unknown-unknown \
  --manifest-path packages/substreams/erc5564/Cargo.toml
cargo build --release --target wasm32-unknown-unknown \
  --manifest-path packages/substreams/erc5564-eas-pipeline/Cargo.toml
```

If the `substreams` CLI is installed, pack the reusable package first because
the composed package imports it:

```sh
substreams pack packages/substreams/erc5564/substreams.yaml
substreams pack packages/substreams/erc5564-eas-pipeline/substreams.yaml
```

The production Graph prepare command must fail while checked-in placeholders
remain. For an offline build, use the exported fixture preparation seam to
create only ignored generated files from explicit non-production UIDs:

```sh
export FUDA_GRAPH_FIXTURE="$(mktemp -d /tmp/fuda-rights-fixture.XXXXXX)"
export FUDA_GRAPH_FIXTURE_CONFIG="$FUDA_GRAPH_FIXTURE/wrangler.jsonc"
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
```

Those UIDs are the repository's deterministic test fixtures, not deployable
configuration. On a host that the native Matchstick selector does not support,
use Graph CLI's pinned `--docker --version 0.6.0` runner and require the
container's final test count and exit status; the act of starting or building a
container alone is not a passing test.

Then run the workspace gates and browser builds:

```sh
pnpm test
pnpm check
pnpm format:check
pnpm --filter app build
pnpm --filter dash build
git diff --check
```

Delete only the two fixture-generated inputs if they did not exist before this
run: `packages/subgraphs/rights/subgraph.yaml` and
`packages/subgraphs/rights/src/schema-uids.ts`. Do not treat fixture-backed
codegen, tests, or builds as proof that production configuration or deployment
succeeds.

## 3. Reusable package on two chains

Pack once, hash once, and run that exact artifact on both endpoints. Do not
rebuild or modify it between streams:

```sh
export ERC5564_PACKAGE=packages/substreams/erc5564/fuda-erc5564-v0.1.0.spkg
sha256sum "$ERC5564_PACKAGE" | tee "$FUDA_GRAPH_EVIDENCE/erc5564-package.sha256"

substreams run -e "<BASE_SEPOLIA_FIREHOSE_ENDPOINT>" \
  "$ERC5564_PACKAGE" map_announcements \
  --start-block "<BASE_ANNOUNCEMENT_BLOCK>" --stop-block +1000 \
  2>&1 | tee "$FUDA_GRAPH_EVIDENCE/base-sepolia-announcements.txt"

substreams run -e "<SECOND_EVM_FIREHOSE_ENDPOINT>" \
  "$ERC5564_PACKAGE" map_announcements \
  --start-block "<SECOND_CHAIN_ANNOUNCEMENT_BLOCK>" --stop-block +1000 \
  2>&1 | tee "$FUDA_GRAPH_EVIDENCE/second-chain-announcements.txt"

sha256sum "$ERC5564_PACKAGE" | tee "$FUDA_GRAPH_EVIDENCE/erc5564-package-after-streams.sha256"
diff -u "$FUDA_GRAPH_EVIDENCE/erc5564-package.sha256" \
  "$FUDA_GRAPH_EVIDENCE/erc5564-package-after-streams.sha256"
```

Both stream logs must contain a real decoded Announcement. Save the chain names,
blocks, and transaction hashes in the evidence log. The empty output from an
inactive range does not prove cross-chain reuse.

## 4. Prepare the live query

Export identifiers from real receipts, never from fixture constants:

```sh
export GRAPH_RIGHTS_ENDPOINT="<STUDIO_OR_PUBLIC_QUERY_URL>"
export RIGHT_UID="<0x_32_BYTE_RIGHT_UID>"
export DELEGATION_UID="<0x_32_BYTE_DELEGATION_UID>"
export ATTENDANCE_UID="<0x_32_BYTE_ATTENDANCE_UID>"

jq -n \
  --rawfile query packages/subgraphs/rights/queries/smoke.graphql \
  --arg rightUID "$RIGHT_UID" \
  --arg delegationUID "$DELEGATION_UID" \
  --arg attendanceUID "$ATTENDANCE_UID" \
  '{query: $query, variables: {
    rightUID: $rightUID,
    delegationUID: $delegationUID,
    attendanceUID: $attendanceUID
  }}' \
  | curl --fail-with-body --silent --show-error \
      -H 'content-type: application/json' --data-binary @- \
      "$GRAPH_RIGHTS_ENDPOINT" \
  | tee "$FUDA_GRAPH_EVIDENCE/graph-before-revoke.json"
```

Check the response against the receipts: all requested entities are non-null,
the holder and relations agree, the raw announcement bytes and transaction/log
identity agree, and `right.revokedAt` is initially `null`.

## 5. Timed 2–4 minute demo

Start a screen recording and a timer. Open the member app `/private` and
`/rights` pages, the dashboard's Chain truth section, and the gate scanner.
Also keep a terminal streaming the composed module from the issue block:

```sh
substreams run -e "<BASE_SEPOLIA_FIREHOSE_ENDPOINT>" \
  packages/substreams/erc5564-eas-pipeline/substreams.yaml fuda_events \
  -s "<ISSUE_BLOCK>" \
  2>&1 | tee "$FUDA_GRAPH_EVIDENCE/composed-live-events.txt"
```

Use this sequence:

1. **0:00–0:30 — reuse.** Show the matching package hashes and one real
   Announcement in each chain's captured stream.
2. **0:30–1:10 — query.** Run the live Graph query, then show the member's
   discovered +Private right, its `/rights` card, and the dashboard chain-truth
   record. Show the initial gate admission.
3. **1:10–2:10 — revoke.** Revoke that exact right through the deployed
   dashboard/API. Show the transaction receipt and the composed Substreams
   `Revoked` event with the same UID.
4. **2:10–3:00 — observe.** Wait for the rights subgraph to index the receipt,
   rerun the Graph query, and show a non-null `right.revokedAt` plus REVOKED card
   and dashboard states.
5. **3:00–4:00 — enforce.** Scan the same pass at the gate again. Capture the
   red REJECT verdict and reason.

Record the final elapsed time in `timing.txt`. A result outside 2–4 minutes is a
practice result, not completion of the timing gate.

## 6. Prove product reads do not use Substreams

Stop every `substreams run` process and capture the absence of a runner:

```sh
if pgrep -af '[s]ubstreams run' >"$FUDA_GRAPH_EVIDENCE/substreams-stopped.txt"; then
  cat "$FUDA_GRAPH_EVIDENCE/substreams-stopped.txt"
  echo 'FAIL: a Substreams runner is still active'
  exit 1
fi
echo 'PASS: no Substreams runner is active' \
  | tee "$FUDA_GRAPH_EVIDENCE/substreams-stopped.txt"
```

With Substreams still stopped:

1. Reload `/private`, use the same passkey, and discover the right again.
2. Reload `/rights`, query the stealth holder, and capture its REVOKED card.
3. Reload the dashboard, query the holder, and capture Right, Attendance, and
   IssuerDelegation results without selecting a D1 member row.
4. Rerun the query from section 4 and save it as
   `graph-after-substreams-stop.json`; confirm `revokedAt` remains non-null.
5. Scan the revoked right once more and capture the same red verdict.

These checks prove only the documented dependency split when performed against
a deployed, synced subgraph. Fixture tests or an unconfigured-screen message do
not substitute for this live evidence.

## 7. Evidence index

Keep the following together with the screen recording:

| Evidence | Required contents |
| --- | --- |
| commit and time | Git commit, UTC start/end, 2–4 minute elapsed time |
| package reuse | identical before/after SHA-256 plus two non-empty chain stream logs |
| composed push lane | live Attested/Announcement context and Revoked event with the demonstrated UID |
| receipts | issue, Attendance, Announcement, and revoke transaction hashes and blocks |
| query lane | Graph response before and after revoke, with entity/receipt comparison |
| user surfaces | discovery, right card, dashboard chain truth, initial gate result, next red gate result |
| no-runner proof | stopped-process output plus the repeated query and surface captures |

Redact secrets, then hash the finished evidence files and note where the private
screen recording is stored. Do not commit live secrets or member key material.
