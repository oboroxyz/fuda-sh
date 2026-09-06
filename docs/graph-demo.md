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

The trap restores pre-existing manifest/constants even when a verification
command fails, and removes the fixture versions only when no originals existed.
Do not treat fixture-backed codegen, tests, or builds as proof that production
configuration or deployment succeeds.

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

Use separate live rights for separate product flows: a +Private right proves
private discovery and Signed entry, while a Bearer right with a QR pass proves
the initial green scan and red scan after revoke. A +Private right is not a
scannable Bearer pass: presenting its UID to the QR verification path returns
`LEVEL_REQUIRED`.

Export identifiers from real receipts, never from fixture constants. The smoke
query below follows the Bearer/QR right; `PRIVATE_RIGHT_UID` and
`PRIVATE_HOLDER` identify the separate discovery case:

```sh
export GRAPH_RIGHTS_ENDPOINT="<STUDIO_OR_PUBLIC_QUERY_URL>"
export RIGHT_UID="<0x_32_BYTE_RIGHT_UID>"
export PRIVATE_RIGHT_UID="<0x_32_BYTE_PRIVATE_RIGHT_UID>"
export PRIVATE_HOLDER="<0x_20_BYTE_STEALTH_HOLDER>"
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
2. **0:30–1:15 — discovery and query.** Discover the +Private right in
   `/private`; enter it through that screen's Signed challenge-response action,
   not the QR scanner. Then run the live Graph query for the separate Bearer
   right and show its `/rights` card and dashboard chain-truth record.
3. **1:15–1:40 — initial QR scan.** Present the Bearer right's QR pass to the
   gate and capture its green ADMIT verdict.
4. **1:40–2:30 — revoke.** Revoke that exact Bearer right through the deployed
   dashboard/API. Show the transaction receipt and the composed Substreams
   `Revoked` event with the same UID.
5. **2:30–3:20 — observe.** Wait for the rights subgraph to index the receipt,
   rerun the Graph query, and show a non-null `right.revokedAt` plus REVOKED card
   and dashboard states.
6. **3:20–4:00 — enforce.** Scan the same Bearer QR pass at the gate again.
   Capture the red REJECT verdict and reason.

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

1. Reload `/private`, use the same passkey, and discover the +Private right
   again.
2. Reload `/rights`, query the Bearer holder, and capture its REVOKED card.
3. Reload the dashboard, query the Bearer holder, and capture Right, Attendance,
   and IssuerDelegation results without selecting a D1 member row.
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
| user surfaces | +Private discovery/Signed entry; Bearer right card, dashboard chain truth, initial green QR result, and next red QR result |
| no-runner proof | stopped-process output plus the repeated query and surface captures |

Redact secrets, then hash the finished evidence files and note where the private
screen recording is stored. Do not commit live secrets or member key material.
