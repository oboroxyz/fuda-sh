# Connected apps

A connected app is a program an Operator builds outside fuda — typically a browser-only app made in Figma Make, with no server of its own — that acts for one Issuer through fuda's api. The Operator registers the app in the dashboard, approves it for one of their Issuers with a full-page redirect, and the app then creates and reads that Issuer's Cards with the access token it received. Nothing on this path needs a claimed ENS name.

API paths below are under `/v1` unless shown otherwise. The [Figma Make guide](../integrations/figma-make.md) shows the calls from an app's side.

## Rules

- **Approval is OAuth 2.0 authorization code with PKCE**, for public clients only: an app has a client ID and no client secret, and every authorization must carry an `S256` code challenge. `plain` and requests without a challenge are refused. There are no refresh tokens; when an access token ends, the app sends the Operator through approval again.
- **Only the account that registered an app may approve it.** The account is the Operator's signed-in passkey address. Approval by any other account answers `403 not_app_owner`; third-party consent is not offered.
- **An approval names one Issuer.** The Operator chooses the Issuer on the consent page from those their address owns. The access token reaches that Issuer's data only; another Issuer's Card answers `404 not_found`, never `403`, so a token cannot learn which ids exist elsewhere.
- **No account or Issuer is created from outside.** No connected-app route creates an Issuer or an Operator session. An Operator without an Issuer is sent to the dashboard to create one before approving.
- **Card creation is synchronous.** `POST /connect/cards` publishes the Card before it answers, under the same Card rules and errors as the dashboard's `POST /issuers/cards`.
- **Wallets are not required.** Approval uses the dashboard's existing passkey sign-in; the app never sees an Operator credential.

## Registering an app

From the dashboard's Apps page (`dash.fuda.sh/apps`), with an Operator session:

| Route | Answer |
| --- | --- |
| `GET /connected-apps` | `{ apps: ConnectedAppView[] }` — this account's apps only |
| `POST /connected-apps` `{ name, redirectUris }` | `201 { app }`; `400 bad_redirect_uri`, `400 bad_input`, `409 app_limit` |
| `DELETE /connected-apps/:clientId` | `{ deleted: true }`; deletes the app with every code and token it holds; another account's app is `404` |
| `GET /connected-apps/grants` | `{ grants: ConnectedAppGrantView[] }` — live tokens this account approved |
| `DELETE /connected-apps/grants/:id` | `{ revoked: true }`; the token stops working at once; another account's grant is `404` |

A name is 1–60 characters. An app has one to five redirect URIs and an account at most 20 apps. A redirect URI is an absolute `https` URL, or `http` on `localhost`, `127.0.0.1` or `[::1]`, with no fragment and no credentials. URIs are compared exactly after URL normalization, so `https://a.example` and `https://a.example/` are one registration while `/cb` and `/cb/` are two. The client ID is `app_` followed by 32 hex characters and is not a secret.

## Approval

1. The app sends the browser to `https://dash.fuda.sh/oauth/authorize` with `response_type=code`, `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, optional `scope` and optional `state`.
2. The consent page signs the Operator in with their passkey if needed, then asks the api `GET /oauth/authorize` with the same parameters. The answer names the app, the redirect URI, the scopes, and the Issuers this account owns.
3. Approval posts `POST /oauth/authorize` `{ clientId, redirectUri, codeChallenge, codeChallengeMethod: 'S256', issuerId, scope, state }`. The api mints a code and answers `{ redirectTo }`, the redirect URI with `code` and `state` added; the page leaves with a full-page redirect.
4. Cancelling sends the browser to the redirect URI with `error=access_denied` and the `state`.

The api checks in this order, and the consent page shows the first two failures without redirecting, because the redirect URI is not yet trusted:

| Failure                                                       | Answer                 |
| ------------------------------------------------------------- | ---------------------- |
| unknown client ID                                             | `400 invalid_client`   |
| redirect URI not registered for the app                       | `400 bad_redirect_uri` |
| signed-in account is not the app's owner                      | `403 not_app_owner`    |
| unknown or repeated scope                                     | `400 invalid_scope`    |
| `response_type` not `code`, or method not `S256`              | `400 invalid_request`  |
| `issuerId` not owned by the signed-in account (approval only) | `404 not_found`        |

Both routes require an Operator session; the admin token and an access token answer `401`.

## Token exchange

`POST /oauth/token`, called by the app, as `application/x-www-form-urlencoded` (RFC 6749) or JSON, with `grant_type=authorization_code`, `code`, `client_id`, `redirect_uri` and `code_verifier`. It is rate-limited with the shared hourly D1 counter.

The answer is `{ access_token, token_type: 'Bearer', expires_in, scope, issuer: { id, handle, name, logoUrl } }`, with `cache-control: no-store`. A code is single-use: it is spent before it is checked, so a wrong verifier also burns it. Errors use RFC 6749 codes:

| Failure | Answer |
| --- | --- |
| missing or malformed parameters | `400 invalid_request` |
| `grant_type` other than `authorization_code` | `400 unsupported_grant_type` |
| unknown client ID, or a browser `Origin` that is not one of the app's redirect-URI origins | `401 invalid_client` |
| unknown, spent or expired code; another client's code; a different redirect URI; a wrong verifier; an Issuer whose owner changed since approval | `400 invalid_grant` |

`POST /oauth/revoke` (RFC 7009) takes `token` and `client_id` and answers `200 {}` whether or not the token was live.

## Resource routes

Every route takes `Authorization: Bearer <access_token>` and answers `cache-control: no-store`. A missing, unknown, revoked or expired token answers `401 unauthorized` with `WWW-Authenticate: Bearer error="invalid_token"`. A browser `Origin` outside the token's own app origins is refused the same way, so a token copied into another site's page fails there. A token lacking the route's scope answers `403 insufficient_scope`.

| Route | Scope | Answer |
| --- | --- | --- |
| `GET /connect/issuer` | any | `{ issuer: IssuerView, publicUrl, scope }` |
| `GET /connect/cards` | `cards:read` | `{ cards: CardView[], publicUrl }`, oldest first |
| `POST /connect/cards` | `cards:write` | `201 { card, issuer, publicUrl }`; `400 bad_slug`, `400 bad_input`, `409 slug_taken` |
| `GET /connect/cards/:cardId` | `cards:read` | `{ card: CardView, url }`, where `url` is the Card's public page |

A token stops working when it is revoked, when its app is deleted, when it expires, or when its Issuer's owner address no longer matches the address that approved it.

## Scopes

| Scope         | Allows                                 |
| ------------- | -------------------------------------- |
| `cards:read`  | reading the approved Issuer's Cards    |
| `cards:write` | creating Cards for the approved Issuer |

An empty `scope` requests both. The token carries exactly the scopes approved; the consent page lists them.

## Lifetimes

| Item               | Lifetime               |
| ------------------ | ---------------------- |
| authorization code | 10 minutes, single-use |
| access token       | 30 days                |

Codes and access tokens are random 32-byte values; only their SHA-256 hashes are stored. An access token is shown once, in the token response, and starts with `fuda_at_` so it is recognisable in logs and secret scanners.

## CORS

`/oauth/token`, `/oauth/revoke` and `/connect/*` answer CORS for fuda's own origins and also for:

- any `https://<name>.figma.site` origin, where Figma Make publishes sites;
- the origin of any registered redirect URI.

Every other route keeps fuda's own allow-list, so a connected app's page cannot call the dashboard routes from a browser. A CORS answer only lets a page read the response: the token endpoint and the resource routes still require a browser `Origin` to be one of the app's own redirect-URI origins. An app whose page runs at another origin, such as Figma Make's editor preview, must register a redirect URI on that origin.

## Multiple Issuers per account

Approvals, codes and tokens are keyed by Issuer, and the consent page lists every Issuer the signed-in address owns. Today an address owns at most one Issuer (`issuers.operator_address` is unique), so the list has zero or one entries; the contract does not change when an account can own several.
