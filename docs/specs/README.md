# Specifications

The canonical description of what fuda does now: externally observable behavior, product rules, invariants, wire contracts and security constraints. Code comments cite these files by section, and tests are checked against them. The system overview, component map and trust boundaries live in the [architecture overview](../architecture.md).

- [Attestation model](./attestation-model.md) — Entitlement, IssuerDelegation, Attendance, lifecycle, the EAS/D1 authority boundary, and rights-subgraph query behavior
- [Pass types and flows](./pass-types-and-flows.md) — use-case templates, wallet roles, standard activation, privacy-first issuance, the gate protocol, the pass contracts, and the deployed surfaces
- [ENS naming](./ens-naming.md) — ENS hierarchy, the member number, what a name resolves to (rotating stealth addresses for +Private), name lifecycle
- [Substreams packages](./substreams.md) — the optional push lane: reusable ERC-5564 extraction, raw EAS event composition, protobuf interfaces, and compatibility guarantees; product queries use the independent rights subgraph
