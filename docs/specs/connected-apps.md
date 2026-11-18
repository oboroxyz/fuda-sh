# Connected apps

A connected app is a program an Operator builds outside fuda that acts for one Issuer through fuda's api. It is typically a browser-only app made in Figma Make, with no server of its own. The Operator registers the app in the dashboard and approves it for one of their Issuers with a full-page redirect. The app then creates and reads that Issuer's Cards with the access token it received. Nothing on this path needs a claimed ENS name.

API paths below are under `/v1` unless shown otherwise. The [Figma Make guide](../integrations/figma-make.md) shows the calls from an app's side.

## Rules

- **Approval is OAuth 2.0 authorization code with PKCE**, for public clients only. An app has a client ID and no client secret, and every authorization must carry an `S256` code challenge. The api refuses `plain` and requests without a challenge. There are no refresh tokens. When an access token ends, the app sends the Operator through approval again.
- **Only the account that registered an app may approve it.** The account is the owner the Operator signed in as: a passkey account, or a wallet address. Approval by any other account answers `403 not_app_owner`. Third-party consent is not offered.
- **An approval names one Issuer.** The Operator chooses the Issuer on the consent page from those they own. The access token reaches only that Issuer's data. Another Issuer's Card answers `404 not_found`, never `403`, so a token cannot learn which ids exist elsewhere.
- **No account or Issuer is created from outside.** No connected-app route creates an Issuer or an Operator session. An Operator without an Issuer is sent to the dashboard to create one before approving.
- **Card creation is synchronous.** `POST /connect/cards` publishes the Card before it answers, under the same Card rules and errors as the dashboard's `POST /issuers/cards`.
- **Wallets are not required.** Approval uses the dashboard's sign-in, with a passkey or a wallet. The app never sees an Operator credential.

## Registering an app

From the dashboard's Apps page (`dash.fuda.sh/apps`), with an Operator session:

| Route | Answer |
| --- | --- |
| `GET /connected-apps` | `{ apps: ConnectedAppView[] }`, with this account's apps only |
| `POST /connected-apps` `{ name, redirectUris }` | `201 { app }`; `400 bad_redirect_uri`, `400 bad_input`, `409 app_limit` |
| `DELETE /connected-apps/:clientId` | `{ deleted: true }`. The route deletes the app with every code and token it holds. Another account's app answers `404` |
| `GET /connected-apps/grants` | `{ grants: ConnectedAppGrantView[] }`, the live tokens this account approved, with `lastUsedAt`, accurate to the hour and null until first use |
| `GET /connected-apps/activity` | `{ events: ConnectedAppEventView[] }`, the latest 50 writes this account's approved apps attempted, newest first. See [Activity](#activity) |
| `DELETE /connected-apps/grants/:id` | `{ revoked: true }`. The token stops working at once. Another account's grant answers `404` |

A name is 1–60 characters. An app has one to five redirect URIs and an account at most 20 apps. A redirect URI is an absolute `https` URL, or `http` on `localhost`, `127.0.0.1` or `[::1]`, with no fragment and no credentials. The api compares URIs exactly after URL normalization, so `https://a.example` and `https://a.example/` are one registration, while `/cb` and `/cb/` are two. On loopback `http`, the api does not compare the port, because a native client listens on whatever port is free (RFC 8252). It does compare the host, path and query, so `localhost` and `127.0.0.1` are two registrations. The client ID is `app_` followed by 32 hex characters and is not a secret.

## Approval

1. The app sends the browser to `https://dash.fuda.sh/oauth/authorize` with `response_type=code`, `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, optional `scope`, optional `state` and, for an [MCP client](./mcp.md), `resource`.
2. The consent page signs the Operator in with their passkey if needed, then asks the api `GET /oauth/authorize` with the same parameters. The answer names the app, the OAuth issuer, the redirect URI, the scopes, and the Issuers this account owns.
3. Approval posts `POST /oauth/authorize` `{ clientId, redirectUri, codeChallenge, codeChallengeMethod: 'S256', issuerId, resource, scope, state }`. The api mints a code and answers `{ redirectTo }`, the redirect URI with `code`, `iss` (RFC 9207, the api's origin) and `state` added. The page then leaves with a full-page redirect.
4. Cancelling sends the browser to the redirect URI with `error=access_denied`, `iss` and the `state`.

The api checks in this order, and the consent page shows the first two failures without redirecting, because the redirect URI is not yet trusted:

| Failure                                                       | Answer                 |
| ------------------------------------------------------------- | ---------------------- |
| unknown client ID                                             | `400 invalid_client`   |
| redirect URI not registered for the app                       | `400 bad_redirect_uri` |
| signed-in account is not the app's owner                      | `403 not_app_owner`    |
| unknown or repeated scope                                     | `400 invalid_scope`    |
| `resource` other than this api's MCP server                   | `400 invalid_target`   |
| `response_type` not `code`, or method not `S256`              | `400 invalid_request`  |
| `issuerId` not owned by the signed-in account (approval only) | `404 not_found`        |

Both routes require an Operator session. The admin token and an access token answer `401`. No other site may frame a dashboard page (`frame-ancestors 'none'`), so a page elsewhere cannot steer a signed-in Operator's click on the approval button.

## Token exchange

The app calls `POST /oauth/token` as `application/x-www-form-urlencoded` (RFC 6749) or JSON, with `grant_type=authorization_code`, `code`, `client_id`, `redirect_uri`, `code_verifier` and, for an MCP client, `resource`. The api rate-limits it with the shared hourly D1 counter.

The answer is `{ access_token, token_type: 'Bearer', expires_in, scope, issuer: { id, handle, name, logoUrl } }`, with `cache-control: no-store`. A code is single-use. The api spends it before checking it, so a wrong verifier also burns it. Errors use RFC 6749 codes:

| Failure | Answer |
| --- | --- |
| missing or malformed parameters | `400 invalid_request` |
| `grant_type` other than `authorization_code` | `400 unsupported_grant_type` |
| `resource` other than this api's MCP server | `400 invalid_target` |
| unknown client ID, or a browser `Origin` that is not one of the app's redirect-URI origins | `401 invalid_client` |
| unknown, spent or expired code; another client's code; a different redirect URI; a `resource` other than the one approved; a wrong verifier; an Issuer whose owner changed since approval | `400 invalid_grant` |

Presenting a spent code again also ends the token that code issued, because one of the two callers should not have had it. A new token replaces any live token for the same app, Issuer and resource, so logging in again leaves one approval. A client ID used from two devices therefore keeps only the latest. Register one app per device to keep both.

`POST /oauth/revoke` (RFC 7009) takes `token` and `client_id` and answers `200 {}` whether or not the token was live.

## Resource routes

Every route takes `Authorization: Bearer <access_token>` and answers `cache-control: no-store`. A missing, unknown, revoked or expired token answers `401 unauthorized` with `WWW-Authenticate: Bearer error="invalid_token"`. A browser `Origin` outside the token's own app origins is refused the same way, so a token copied into another site's page fails there. A token lacking the route's scope answers `403 insufficient_scope`.

| Route | Scope | Answer |
| --- | --- | --- |
| `GET /connect/issuer` | any | `{ issuer: IssuerView, publicUrl, scope }` |
| `GET /connect/cards` | `cards:read` | `{ cards: CardView[], publicUrl }`, oldest first |
| `POST /connect/cards` | `cards:write` | `201 { card, issuer, publicUrl }`; `400 bad_slug`, `400 bad_input`, `409 slug_taken` |
| `GET /connect/cards/:cardId` | `cards:read` | `{ card: CardView, url }`, where `url` is the Card's public page |

A token approved with a `resource` answers on [`/mcp`](./mcp.md) and not on these routes. A token stops working when it is revoked, when its app is deleted, when it expires, when its code is presented again, when a newer approval replaces it, or when its Issuer's owner address no longer matches the address that approved it.

## Scopes

| Scope | Allows |
| --- | --- |
| `cards:read` | reading the approved Issuer's Cards |
| `cards:write` | creating Cards for the approved Issuer |
| `passes:read` | the [MCP server](./mcp.md)'s pass list for the approved Issuer |
| `passes:issue` | the MCP server's pass issuing for the approved Issuer |
| `passes:revoke` | the MCP server's pass revoking for the approved Issuer. The Operator opts in on the consent page |

An empty `scope` requests `cards:read` and `cards:write`. A client asks for pass scopes by name. The token carries exactly the scopes approved. The consent page lists them, and the routes here use only the card scopes.

## Activity

The api records every write an approved app attempts: `create_card`, `update_card_limits`, `issue_pass` and `revoke_pass`. Each record has the app's name, the Issuer, what the write acted on (`subject`, a Card id or a Right's uid where known) and the error if it failed. Reads are not recorded, and neither are request bodies. A record outlives the app and its tokens, and is visible only to the account that approved them. Failing to write a record does not fail the write it describes, which may already be on chain.

## Lifetimes

| Item               | Lifetime               |
| ------------------ | ---------------------- |
| authorization code | 10 minutes, single-use |
| access token       | 30 days                |

A daily job deletes access tokens once their expiry or revocation is at least 24 hours old. The grace period exceeds the ten-minute code lifetime. Live tokens remain available for code replay detection even after their code expires or is deleted. Deleting a dead token cannot make its code redeemable again. Expired code rows are already deleted when a new code is minted.

Codes and access tokens are random 32-byte values. The api stores only their SHA-256 hashes. An access token is shown once, in the token response, and starts with `fuda_at_` so it is recognisable in logs and secret scanners.

## CORS

`/oauth/token`, `/oauth/revoke` and `/connect/*` answer CORS for:

- any `https://<name>.figma.site` origin, where Figma Make publishes sites;
- the origin of any registered redirect URI.

No other route answers CORS for these origins, so a connected app's page cannot call the dashboard routes from a browser. A CORS answer lets a page read the response and nothing more. The token endpoint and the resource routes still require a browser `Origin` to be one of the app's own redirect-URI origins. An app whose page runs at another origin, such as Figma Make's editor preview, must register a redirect URI on that origin.

## Multiple Issuers per account

An account may own several Issuers ([Several issuers per account](pass-types-and-flows.md#issuer-onboarding-and-the-handle-route)). The consent page lists every Issuer the signed-in owner holds, oldest first, and the Operator approves an app for one of them. Approving the same app for another Issuer is a second approval with its own token. Codes and tokens are keyed by Issuer, so a token approved for one Issuer answers `404` for another Issuer's Card even when the same account owns both. The Issuer the dashboard session is currently acting for plays no part. Only the choice on the consent page binds the token.
