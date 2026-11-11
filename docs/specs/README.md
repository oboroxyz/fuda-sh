# Specifications

The canonical description of what fuda does now: externally observable behavior, product rules, invariants, wire contracts and security constraints. Code comments cite these files by section, and tests are checked against them. The system overview, component map and trust boundaries live in the [architecture overview](../architecture.md).

- [Attestation model](./attestation-model.md) — Entitlement, IssuerDelegation, Attendance, lifecycle, the EAS/D1 authority boundary, and rights-subgraph query behavior
- [Pass types and flows](./pass-types-and-flows.md) — use-case templates, wallet roles, standard issuance, the gate protocol, the pass contracts, and the deployed surfaces
- [Connected apps](./connected-apps.md) — browser-only apps (Figma Make) approved by an Operator for one Issuer: PKCE approval, access tokens, the card routes they reach, CORS
- [MCP server](./mcp.md) — the remote MCP endpoint agents use for one Issuer: connecting Claude Code, discovery metadata, tokens bound to the server, the tools
- [Card requirements](./card-requirements.md) — proposed: records outside fuda that a member must hold, checked at claim and at presentation; the ERC-8432 agreement kind and the licence key
- [ENS naming](./ens-naming.md) — ENS hierarchy, the member number, what a name resolves to, name lifecycle
