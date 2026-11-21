# MCP server

The api is a remote [Model Context Protocol](https://modelcontextprotocol.io) server at `https://api.fuda.sh/mcp`, so a coding agent can act for one Issuer. An MCP client is a [connected app](./connected-apps.md): the Operator registers it in the dashboard, and only the account that registered it may approve it. The server is tested against Claude Code, Codex and OpenCode.

## Connecting

The [`fuda-mcp-setup` skill](../../skills/fuda-mcp-setup/SKILL.md) walks an agent through these steps, with the configuration for each client.

1. In the dashboard's Apps page, register an app with the client's return address. Leave the port out. The api accepts any port on a loopback address.

   | Client          | Return address              |
   | --------------- | --------------------------- |
   | Claude Code     | `http://localhost/callback` |
   | Codex, OpenCode | `http://127.0.0.1/callback` |

2. Give the client the client ID that page shows and the server's URL, `https://api.fuda.sh/mcp`. Write the URL exactly so, with no trailing slash. It is the resource a token is approved for.
3. Approve on the consent page, from the client's own login command.

An approval names one Issuer and lasts 30 days. There are no refresh tokens. Logging in again replaces it. The Apps page lists the approval with when it was last used, and the Operator can revoke it there. The same page shows the writes each client attempted, as [Activity](./connected-apps.md#activity) describes.

## Transport

`POST /mcp` takes one JSON-RPC message and answers with one JSON object. The server speaks protocol revision `2025-11-25` and keeps no session and no stream. `GET` and `DELETE` answer `405`. A request naming a method the server does not implement answers `404` with JSON-RPC error `-32601`. From that error, a client probing a later revision learns to fall back to `initialize`. A notification answers `202`.

Any request carrying an `Origin` header answers `403`. No browser page calls this server, and its path is outside the connected-app CORS allow-list.

## Authorization

| Route | Answer |
| --- | --- |
| `GET /.well-known/oauth-protected-resource/mcp` | RFC 9728 metadata: the resource and its authorization server |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata: the dashboard's consent page and the api's token endpoint |

Approval and token exchange are the [connected-app routes](./connected-apps.md#approval), with the `resource` parameter of RFC 8707 naming `https://api.fuda.sh/mcp`. Because the consent page and the token endpoint are on different origins, the authorization response carries `iss` (RFC 9207). Codex refuses to log in without it.

- A token is bound to what was approved. A token approved with that `resource` answers only on `/mcp`; a token approved without one answers only on `/v1/connect/*`. Each is refused on the other's routes.
- A missing or unusable token answers `401` with `WWW-Authenticate` carrying `resource_metadata` and `scope`.
- A tool the token's scope does not cover answers `403` with `error="insufficient_scope"`, the scope needed and `resource_metadata`.

## Tools

Each tool acts for the token's one Issuer. `tools/list` shows only the tools the token's scopes allow. A broken Card rule is a tool result with `isError: true` and the same error code the routes use, such as `slug_taken` or `bad_slug`.

| Tool | Scope | Result |
| --- | --- | --- |
| `list_cards` | `cards:read` | `{ issuer: { handle, name }, cards }`, oldest first |
| `create_card` | `cards:write` | `{ card }`. The tool publishes the Card at once, under the same rules as `POST /issuers/cards`, and may set a `capacity`, a `record` (`offchain` by default, fixed once created) and an `identity` (`none` by default, `passkey`, `sensitive` or `address`, also fixed), and one fixed entry in `requirements`. `address` needs at least one requirement and `record: offchain`. `none` also accepts a requirement with `record: offchain`. `passkey` and `sensitive` accept none. Registries must be allowlisted |
| `update_card_limits` | `cards:write` | `{ card }`. The tool changes only the `capacity`, `claimFrom` and `claimUntil` it is given |
| `list_passes` | `passes:read` | `{ passes, page, summary, cardStats }`, as `GET /issuers/me/passes`; filters by `cardId`, `source` and `status` |
| `issue_pass` | `passes:issue` | `{ uid, memberNumber, passUrl }` for one Bearer Pass under a Card, with an optional `source`. The tool answers `card_sold_out` at capacity, and `holder_must_claim` on a Card with requirements or `identity: passkey`, `sensitive` or `address`, whose holder has to claim the pass at its `claimUrl` |
| `revoke_pass` | `passes:revoke` | `{ revoked: true, uid }`. The tool revokes one Pass on chain, and the revocation cannot be undone |

A Card here also has `claimUrl`, the public page where a person gets a pass, `capacity`, and `issued`, the places its passes hold. A revoked pass frees its place. See [capacity and source](./pass-types-and-flows.md#capacity-and-source). There are two ways to hand out passes:

- **Share `claimUrl`**, with `?source=<label>` added, for a flyer, a post or a newsletter. A pass is issued only when someone opens it and asks for one, inside the Card's claim window.
- **Call `issue_pass`** for a person being arranged for, and give them `passUrl`. It ignores the claim window, so a Card whose window is closed takes invited guests only. The result leaves out the QR and the wallet links.

An Issuer's budget is 100 `issue_pass` and 20 `revoke_pass` calls an hour. Beyond that budget, the tool answers `rate_limited`. `issue_pass` has no idempotency key. Each call issues a new Pass, so a client checks `list_passes` after an unclear failure. `revoke_pass` can be repeated safely.

## Approving passes

The server's challenge asks for every scope. The consent page lists them and leaves `passes:revoke` out of the approval unless the Operator ticks a separate box, so a token can revoke only when the Operator chose that.

## Design choices

- **MCP clients are connected apps.** The Operator registers the client in the dashboard, and only the registering account may approve it. Support for clients that register themselves waits until that rule, the consent page and audit needs are decided together.
- **Tokens are bound by `resource`.** A token for the MCP server does not answer on `/v1/connect/*`, and the reverse. An agent's token cannot be replayed from a browser page.
- **Loopback redirects match on any port, and responses name the issuer.** Codex and OpenCode listen on a new port each login (RFC 8252), and Codex refuses a split consent page and token endpoint without `iss` (RFC 9207).
- **A hand-written, stateless JSON-RPC endpoint.** Each POST stands alone, which suits a Worker. The official SDK brings Express, Ajv and Zod for a handful of methods. It speaks revision `2025-11-25`.

A client with no manual client ID option cannot connect yet. There is no refresh token, so the Operator re-approves an agent every 30 days.
