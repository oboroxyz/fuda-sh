# MCP server

The api is a remote [Model Context Protocol](https://modelcontextprotocol.io) server at `https://api.fuda.sh/mcp`, so a coding agent can act for one Issuer. An MCP client is a [connected app](./connected-apps.md): the Operator registers it in the dashboard, and only the account that registered it may approve it. The server is tested against Claude Code, Codex and OpenCode.

## Connecting

The [`fuda-mcp-setup` skill](../../skills/fuda-mcp-setup/SKILL.md) walks an agent through these steps, with the configuration for each client.

1. In the dashboard's Apps page, register an app with the client's return address. Leave the port out: any port is accepted on a loopback address.

   | Client          | Return address              |
   | --------------- | --------------------------- |
   | Claude Code     | `http://localhost/callback` |
   | Codex, OpenCode | `http://127.0.0.1/callback` |

2. Give the client the client ID that page shows and the server's URL, `https://api.fuda.sh/mcp`, written exactly so, with no trailing slash. It is the resource a token is approved for.
3. Approve on the consent page, from the client's own login command.

An approval names one Issuer and lasts 30 days; there are no refresh tokens. Logging in again replaces it. It is listed on the Apps page, with when it was last used, and can be revoked there. The same page shows the writes each client attempted ([Activity](./connected-apps.md#activity)).

## Transport

`POST /mcp` takes one JSON-RPC message and answers with one JSON object. The server speaks protocol revision `2025-11-25` and keeps no session and no stream: `GET` and `DELETE` answer `405`. A request naming a method the server does not implement answers `404` with JSON-RPC error `-32601`, which is how a client probing a later revision learns to fall back to `initialize`. A notification answers `202`.

Any request carrying an `Origin` header answers `403`: no browser page calls this server, and its path is outside the connected-app CORS allow-list.

## Authorization

| Route | Answer |
| --- | --- |
| `GET /.well-known/oauth-protected-resource/mcp` | RFC 9728 metadata: the resource and its authorization server |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata: the dashboard's consent page and the api's token endpoint |

Approval and token exchange are the [connected-app routes](./connected-apps.md#approval), with the `resource` parameter of RFC 8707 naming `https://api.fuda.sh/mcp`. Because the consent page and the token endpoint are on different origins, the authorization response carries `iss` (RFC 9207), and Codex refuses to log in without it.

- A token is bound to what was approved. A token approved with that `resource` answers only on `/mcp`; a token approved without one answers only on `/v1/connect/*`. Each is refused on the other's routes.
- A missing or unusable token answers `401` with `WWW-Authenticate` carrying `resource_metadata` and `scope`.
- A tool the token's scope does not cover answers `403` with `error="insufficient_scope"`, the scope needed and `resource_metadata`.

## Tools

Each tool acts for the token's one Issuer. `tools/list` shows only the tools the token's scopes allow. A broken Card rule is a tool result with `isError: true` and the same error code the routes use, such as `slug_taken` or `bad_slug`.

| Tool | Scope | Result |
| --- | --- | --- |
| `list_cards` | `cards:read` | `{ issuer: { handle, name }, cards }`, oldest first |
| `create_card` | `cards:write` | `{ card }`; the Card is published at once, under the same rules as `POST /issuers/cards`, and may set a `capacity`, a `record` (`offchain` by default, fixed once created) and, for an `onchain` Card, `attendance` (whether each scan writes a public Attendance; on for a ticket and off for a membership unless set, refused on an offchain Card). The returned Card carries `attendance` |
| `update_card_limits` | `cards:write` | `{ card }`; changes only the `capacity`, `claimFrom` and `claimUntil` it is given |
| `list_passes` | `passes:read` | `{ passes, page, summary, cardStats }`, as `GET /issuers/me/passes`; filters by `cardId`, `source` and `status` |
| `issue_pass` | `passes:issue` | `{ uid, memberNumber, passUrl }` for one Bearer Pass under a Card, with an optional `source`; `card_sold_out` at capacity |
| `revoke_pass` | `passes:revoke` | `{ revoked: true, uid }`; revokes one Pass on chain, and cannot be undone |

A Card here also has `claimUrl`, the public page where a person gets a pass, `capacity`, and `issued`, the passes it has issued. See [capacity and source](./pass-types-and-flows.md#capacity-and-source). There are two ways to hand out passes:

- **Share `claimUrl`**, with `?source=<label>` added, for a flyer, a post or a newsletter. A pass is issued only when someone opens it and asks for one, inside the Card's claim window.
- **Call `issue_pass`** for a person being arranged for, and give them `passUrl`. It ignores the claim window, so a Card whose window is closed takes invited guests only. The result leaves out the QR and the wallet links.

An Issuer's budget is 100 `issue_pass` and 20 `revoke_pass` calls an hour, beyond which the tool answers `rate_limited`. `issue_pass` has no idempotency key: each call issues a new Pass, so a client checks `list_passes` after an unclear failure. `revoke_pass` can be repeated safely.

## Approving passes

The server's challenge asks for every scope. The consent page lists them and leaves `passes:revoke` out of the approval unless the Operator ticks a separate box, so a token can only revoke when they chose that.
