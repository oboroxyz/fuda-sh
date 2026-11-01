# MCP server

The api is a remote [Model Context Protocol](https://modelcontextprotocol.io) server at `https://api.fuda.sh/mcp`, so a coding agent can act for one Issuer. An MCP client is a [connected app](./connected-apps.md): the Operator registers it in the dashboard, and only the account that registered it may approve it. The server is tested against Claude Code.

## Connecting

1. In the dashboard's Apps page, register an app with the return address `http://localhost:8080/callback`.
2. Add the server with the client ID that page shows:

   ```bash
   claude mcp add --transport http --client-id <client ID> --callback-port 8080 fuda https://api.fuda.sh/mcp
   ```

   The URL must be written exactly as here, with no trailing slash; it is the resource a token is approved for.

3. Run `/mcp` in Claude Code, or `claude mcp login fuda`, and approve on the consent page.

An approval names one Issuer and lasts 30 days; there are no refresh tokens. It is listed on the Apps page and can be revoked there.

## Transport

`POST /mcp` takes one JSON-RPC message and answers with one JSON object. The server speaks protocol revision `2025-11-25` and keeps no session and no stream: `GET` and `DELETE` answer `405`. A request naming a method the server does not implement answers `404` with JSON-RPC error `-32601`, which is how a client probing a later revision learns to fall back to `initialize`. A notification answers `202`.

Any request carrying an `Origin` header answers `403`: no browser page calls this server, and its path is outside the connected-app CORS allow-list.

## Authorization

| Route | Answer |
| --- | --- |
| `GET /.well-known/oauth-protected-resource/mcp` | RFC 9728 metadata: the resource and its authorization server |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata: the dashboard's consent page and the api's token endpoint |

Approval and token exchange are the [connected-app routes](./connected-apps.md#approval), with the `resource` parameter of RFC 8707 naming `https://api.fuda.sh/mcp`.

- A token is bound to what was approved. A token approved with that `resource` answers only on `/mcp`; a token approved without one answers only on `/v1/connect/*`. Each is refused on the other's routes.
- A missing or unusable token answers `401` with `WWW-Authenticate` carrying `resource_metadata` and `scope`.
- A tool the token's scope does not cover answers `403` with `error="insufficient_scope"`, the scope needed and `resource_metadata`.

## Tools

Each tool acts for the token's one Issuer. `tools/list` shows only the tools the token's scopes allow. A broken Card rule is a tool result with `isError: true` and the same error code the routes use, such as `slug_taken` or `bad_slug`.

| Tool | Scope | Result |
| --- | --- | --- |
| `list_cards` | `cards:read` | `{ issuer: { handle, name }, cards }`, oldest first |
| `create_card` | `cards:write` | `{ card }`; the Card is published at once, under the same rules as `POST /issuers/cards` |

A Card here also has `claimUrl`, the public page where a person gets a pass.
