# ADR 0012: Void owns API server routing

- **Status**: Accepted 2026-11-01. Supersedes the API middleware bridge in [ADR 0009](0009-void-and-solid.md).
- **Scope**: `apps/api` route discovery, request middleware and runtime tests.

## Context

The first Void migration retained the existing Hono app behind a catch-all middleware. That kept API behavior stable while deployment changed, but left two routing systems and an extra Worker entry. The frontends now use Void routing, and Void's server handlers and middleware use Hono contexts, so existing API processing can run directly in them.

## Decision

- Void discovers `routes/` files and their named HTTP method exports. Files re-export `defineHandler` values from `src/handlers/`, where related handlers share their domain helpers. No production code manually mounts Hono sub-apps or forwards every request to another Worker entry.
- The target projects link their `routes` directory to the same authored route tree. Package imports (`#api/*`) resolve shared handlers from either the canonical tree or a target link. Adding an endpoint changes one route file, not one registry per target.
- Ordered Void middleware supplies request-scoped chain, database, clock and admission dependencies, then CORS, auth-mode headers and cache policy. An outer error middleware preserves the API's internal-error envelope and the ENS gateway's separate EIP-3668 error envelope.
- URL paths, HTTP methods, validation, authentication, response bodies and caching contracts remain unchanged. Programmatic routes stay under `/v1`; pass, asset, ENS gateway and health routes remain unversioned.
- Workerd tests register the same route-file exports in a test-only Hono adapter so chain, time and admission dependencies remain injectable. Static paths precede parameter paths. Production route discovery is verified by the Void build and browser E2E against its built Worker.

## Consequences

Hono remains a direct dependency for middleware, response helpers and server-rendered wallet pages; adopting Void routes does not replace those Hono APIs. Its version is aligned across the workspace and Void so contexts share one type identity. The test configuration resolves `void` to its public `void/handler` runtime entry, matching the production build plugin without loading Node build tooling inside workerd.
