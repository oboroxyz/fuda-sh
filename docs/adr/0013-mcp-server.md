# ADR 0013: MCP server on the connected-app approval

- **Status**: Accepted 2026-11-01.
- **Scope**: `apps/api` MCP endpoint, its metadata and the `resource` of OAuth codes and tokens.

## Context

Agents should operate fuda directly. The MCP authorization specification expects an OAuth 2.1 server with discovery metadata and audience-bound tokens, and usually a client that registers itself. fuda already has PKCE approval for connected apps, with the rule that only the registering account may approve an app.

## Decision

- **MCP clients are connected apps.** The Operator registers the client in the dashboard and passes its client ID to the client. The owner-only rule stays. Clients that register themselves (Client ID Metadata Documents) need a client with no owning account, so they wait until that rule, the consent page and audit needs are decided together.
- **Tokens are bound by `resource`.** A token for the MCP server does not answer on `/v1/connect/*`, and a connected app's token does not answer on `/mcp`. An agent's token cannot be replayed from a browser page through the connected-app CORS allowance, and scopes can grow on one surface without widening the other.
- **Loopback redirects match on any port, and responses name the issuer.** Codex and OpenCode listen on a new port each login, so registering a port cannot work (RFC 8252). The consent page lives on the dashboard and the token endpoint on the api, and Codex refuses that split unless the response carries `iss` (RFC 9207).
- **A hand-written, stateless JSON-RPC endpoint.** Each POST stands alone, which suits a Worker. The official SDK brings Express, Ajv and Zod for what is a handful of methods here. The endpoint speaks revision `2025-11-25`, because Claude Code falls back to it when a server answers its `2026-07-28` probe with method-not-found.

## Consequences

A client without a manual client ID option cannot connect yet, which includes hosted chat products. There is no refresh token, so an agent is re-approved every 30 days. The endpoint must follow protocol revisions by hand, and a client that drops the `2025-11-25` fallback would need the later revision added.
