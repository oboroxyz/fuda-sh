# Substreams packages

fuda ships two Substreams packages under `packages/substreams`. They expose raw
chain events for reuse and live push consumption. They are not part of the
product read path: the current member app still discovers +Private rights
through the API announcement cache, and stopping Substreams does not change
issuance, discovery, or gate verification.

## Package roles

`fuda_erc5564` is the reusable module. It extracts ERC-5564 `Announcement`
events without applying fuda-specific policy. `erc5564_eas_pipeline` imports
that package and combines its output with raw EAS `Attested` and `Revoked` events.
The composition is an optional push lane for consumers that need block-time
event delivery; it has no permanent sink or resident consumer.

Both manifests target Base Sepolia by default. The ERC-5564 module remains
chain-reusable because its contract address is a parameter and its
implementation has no Base-specific behavior.

## ERC-5564 interface

`map_announcements` consumes an `sf.ethereum.type.v2.Block` and the string
parameter `announcer_address`. An empty parameter selects the canonical
ERC-5564 Announcer:

```text
0x55649E01B5Df198D18D95b5cc5051630cfD45564
```

A non-empty parameter must be `0x` followed by exactly 40 hexadecimal digits;
letter case is insignificant. An invalid value fails the module with
`announcer_address must be a 20-byte hex address`.

The output type is `fuda.erc5564.v1.Announcements`. Each `Announcement` has the
following protobuf interface:

| Field | Representation |
| --- | --- |
| `scheme_id` | exactly 32 bytes, big-endian, preserving the event's full `uint256` topic |
| `stealth_address` | 20 raw address bytes |
| `caller` | 20 raw address bytes |
| `ephemeral_pub_key` | variable-length event bytes |
| `metadata` | variable-length event bytes |
| `tx_hash` | 32 transaction-hash bytes |
| `log_index` | unsigned 32-bit receipt log index |
| `block_number` | unsigned 64-bit block number |
| `timestamp` | unsigned 64-bit block timestamp in seconds |

The module emits only successfully decoded `Announcement` logs from successful
transactions at the configured address. It does not restrict the scheme ID,
interpret metadata, match a viewing key, call RPC, or mutate any event bytes.
Malformed, unrelated, and wrong-address logs produce no item.

## ERC-5564 + EAS pipeline interfaces

`map_eas_events` consumes an `sf.ethereum.type.v2.Block` and the string
parameter `eas_address`. An empty parameter selects the Base Sepolia EAS
deployment:

```text
0x4200000000000000000000000000000000000021
```

The override uses the same 20-byte hexadecimal validation as the Announcer
parameter. An invalid value fails the module with
`eas_address must be a 20-byte hex address`.

The output type is `fuda.pipeline.v1.EasEvents`. It contains successfully
decoded `Attested` and `Revoked` events from successful transactions at the
configured EAS address:

| Field | Representation |
| --- | --- |
| `kind` | `EAS_EVENT_KIND_ATTESTED` or `EAS_EVENT_KIND_REVOKED` |
| `uid` | 32 raw attestation UID bytes |
| `attester` | 20 raw address bytes |
| `recipient` | 20 raw address bytes |
| `schema_uid` | 32 raw schema UID bytes |
| `tx_hash` | 32 transaction-hash bytes |
| `log_index` | unsigned 32-bit receipt log index |
| `block_number` | unsigned 64-bit block number |
| `timestamp` | unsigned 64-bit block timestamp in seconds |

Events are ordered by `log_index` within each block. The module does not filter
schema UIDs, fetch or decode attestation data, call RPC, or infer revocation
state beyond the event kind.

`fuda_events` consumes the imported `fuda.erc5564.v1.Announcements` output and
the local `EasEvents` output. It returns
`fuda.pipeline.v1.FudaEvents`, copying the two item lists into `announcements`
and `eas_events` without transforming them. Consumers must not infer a total
order across those two lists; transaction hash and log index are the event
identity and correlation fields.

## Compatibility contract

The protobuf package names, message names, field numbers, wire types, byte
representations, enum numbers, parameter behavior, and ordering guarantees are
public compatibility contracts. Before the first public `v0.1.0` release they
may change together with fixtures and importers. After publication, an
incompatible change requires a new package/protobuf version rather than
reinterpreting an existing field.

Build commands, tool versions, package assembly, endpoint authentication, and
manual streaming examples are operational details documented in each package
README rather than canonical behavior.
