# Connected apps: OAuth for browser-only apps (design snapshot)

Temporary artifact for SH-2. Deleted when the change lands; `docs/specs/connected-apps.md` is canonical.

## Goal

A browser-only app (Figma Make, no server, no secret) asks fuda for approval with a full-page
redirect, the operator signs in with the existing passkey, picks one of their issuers and approves,
and the app then creates and reads that issuer's cards with the access token it received. No ENS
claim is needed anywhere on the path.

## Decisions

- OAuth 2.0 authorization code + PKCE (S256 only), public clients, no client secret, no refresh token.
- Authorization endpoint is a dashboard page: `https://dash.fuda.sh/oauth/authorize`. The dashboard
  calls the api with the operator session; the api mints the code and builds the redirect.
- Only the operator address that registered the app may approve it (no third-party consent yet).
- Access tokens are bound to one issuer and a scope set (`cards:read`, `cards:write`), stored hashed,
  30-day TTL, revocable from the dashboard and by the app itself (RFC 7009 shape).
- The consent page lists issuers by owner address, so the shape holds when one account owns several
  issuers. Today `issuers.operator_address` is still unique; lifting it is separate work.
- No account creation from outside: the api never creates an issuer for an app; an operator without
  an issuer is told to create one in the dashboard first.
- CORS: `/v1/oauth/token`, `/v1/oauth/revoke`, `/v1/connect/*` also allow `https://*.figma.site` and
  every registered redirect-URI origin (D1 lookup). The token endpoint and resource routes further
  require a browser Origin to be one of the token's own app origins.
- Card creation is synchronous and reuses the dashboard's card rules (`CardBody`, `slug_taken`).

## Data (migration 0017)

- `connected_apps(client_id PK, owner_address, name, created_at)`
- `connected_app_redirects(client_id FK, redirect_uri, origin)`, PK (client_id, redirect_uri), index origin
- `oauth_codes(code_hash PK, client_id FK, issuer_id FK, address, redirect_uri, code_challenge, scope,
  created_at, expires_at, used_at)`
- `oauth_tokens(id PK, token_hash UNIQUE, client_id FK, issuer_id FK, address, scope, created_at,
  expires_at, revoked_at)`

## Surfaces

- api: `/v1/connected-apps` (list/create/delete, grants list/revoke), `/v1/oauth/authorize` (GET preview,
  POST approve), `/v1/oauth/token`, `/v1/oauth/revoke`, `/v1/connect/issuer`, `/v1/connect/cards`,
  `/v1/connect/cards/:cardId`.
- dash: standalone `/oauth/authorize` consent page; `/apps` page in the operator menu.
- docs: spec, glossary, runbook, `docs/integrations/figma-make.md`.
