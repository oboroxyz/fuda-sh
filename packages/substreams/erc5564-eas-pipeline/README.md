# ERC-5564 + EAS pipeline Substreams

This package composes the reusable raw ERC-5564 announcement module with raw
Ethereum Attestation Service events on Base Sepolia.

`map_eas_events` emits `Attested` and `Revoked` event identity and provenance.
It intentionally does not filter schema UIDs, decode attestation data, or call
RPC. `fuda_events` combines that output with the imported
`fuda.erc5564.v1.Announcements` output without changing either stream.

## Build and test

```sh
cargo test --manifest-path packages/substreams/erc5564-eas-pipeline/Cargo.toml
cargo build --release --target wasm32-unknown-unknown \
  --manifest-path packages/substreams/erc5564-eas-pipeline/Cargo.toml
substreams pack packages/substreams/erc5564-eas-pipeline/substreams.yaml
```

The imported ERC-5564 package must be packed first at
`packages/substreams/erc5564/fuda-erc5564-v0.1.0.spkg`.

## Stream

Set `SUBSTREAMS_API_TOKEN` to a The Graph Market token and use the Base Sepolia
endpoint shown by Market:

```sh
substreams run -e "$BASE_SEPOLIA_SUBSTREAMS_ENDPOINT" \
  packages/substreams/erc5564-eas-pipeline/substreams.yaml fuda_events \
  -s "$START_BLOCK" -t +100
```

The default EAS address is `0x4200000000000000000000000000000000000021`.
Pass a different 20-byte hex address as the `map_eas_events` parameter only for
another compatible deployment.
