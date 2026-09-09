# ERC-5564 Announcements Substreams

This package extracts raw `Announcement` events from the canonical ERC-5564 Announcer. It does not decode announcement metadata or attempt viewing-key matching.

`scheme_id` is emitted as the event topic's 32-byte big-endian `uint256` representation. No narrowing conversion is applied.

The Announcer address is a module parameter. Its default is the canonical singleton address used across EVM chains:

```text
0x55649E01B5Df198D18D95b5cc5051630cfD45564
```

## Build and test

```bash
cargo test
cargo build --release --target wasm32-unknown-unknown
substreams pack substreams.yaml
```

## Run

Set `SUBSTREAMS_API_TOKEN` to the JWT issued by The Graph Market, then select the endpoint for the target network:

```bash
substreams run \
  -e "$SUBSTREAMS_ENDPOINT" \
  fuda-erc5564-v0.1.0.spkg \
  map_announcements \
  --start-block "$START_BLOCK" \
  --stop-block +1000
```

Override the address only for a non-canonical deployment:

```bash
substreams run package.spkg map_announcements \
  -p map_announcements=0x1111111111111111111111111111111111111111
```

The same package can run against any compatible EVM Firehose endpoint. Changing the endpoint does not require rebuilding the package.
