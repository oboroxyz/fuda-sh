# ADR 0003: separate Graph push and query lanes

- **Status**: Accepted 2026-09-06.
- **Scope**: how Substreams and the rights subgraph divide event delivery and
  product reads.

## Context

fuda has two Graph integrations with different lifecycles. The reusable
Substreams package extracts raw ERC-5564 announcements, and the composed package
adds raw EAS events. The member and operator products need durable, queryable
entities and revocation state even when no live stream consumer is running.

## Decision

Substreams is an optional push lane for reusable event delivery, submission,
and live demonstration. fuda does not operate a permanent Substreams sink or
resident consumer.

The rights subgraph is the self-contained product query lane. It indexes EAS
and the ERC-5564 Announcer directly, and serves announcement discovery, member
right cards, and dashboard on-chain-status lookups. Browser clients depend on its
configured public Graph endpoint, not on the Substreams packages. The API no
longer serves or stores an announcement cache; its top-level
`ANNOUNCER_FROM_BLOCK` value remains only as the source used to generate the
subgraph manifest.

The rights subgraph is not advertised as a Graph composition source. Its
`Right` and `Delegation` entities change when revocations arrive, while source
entities eligible for Graph composition must be immutable. Claiming composition
support would therefore misstate the current schema.

## Consequences

- Stopping Substreams does not interrupt discovery, right cards, on-chain-status
  lookups, revocation queries, issuance, or gate verification.
- The browser query surfaces fail explicitly when no public rights-subgraph
  endpoint is configured; they do not fall back to the API or D1.
- ADR 0002's unfiltered API announcement-log decision is superseded. Its privacy
  invariant survives in the query lane: every raw announcement is fetched from
  Graph and viewing-key matching remains exclusively on the member device.
