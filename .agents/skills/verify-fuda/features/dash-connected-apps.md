# Connected apps

An operator registers an outside app on the dashboard, approves it on the OAuth consent page for one of their venues, and later revokes it. After that, the app's token is refused. Agents connecting over MCP use the same consent page, where the option to allow revoking passes is off unless ticked.

## Sub-features

- `apps-register`: `/apps` registers an app by name and return addresses and shows its `app_<32 hex>` client ID.
- `apps-consent`: `/oauth/authorize?...` names the app, asks which venue to grant, and redirects with a code after `Approve`.
- `apps-revoke`: `Revoke` on the grant ends access. The page then shows `No app is approved right now.` and the app's next api call gets 401.
- `apps-agent-scope`: for an MCP `resource`, `Also allow revoking passes` stays unticked by default, and the token's scope leaves out `passes:revoke`.

## How to get to it (user POV)

- Sidebar, then the apps page at `/apps`.
- An outside app or agent sends the operator to `/oauth/authorize` with PKCE parameters.

## Driving it with fuda-verify

Preconditions:

- `fuda-verify up dash` is ready and `doctor` reports `"ok": true`.
- An operator with a venue: `const op = await seed.operator()` and a venue made with `apiRequest('/issuers', ..., { method: 'POST', token: op.token, body })`, or the `operatorWithTwoProfiles()` helper in `packages/e2e/tests/support/operator.ts`. Then call `signInOperator(token)`.
- For the full round trip, a loopback client. `startConnectedClient` in `packages/e2e/tests/support/connected-client.ts` serves one on a random `localhost` port.

- **Register.** `page.goto('/apps')`, `getByLabel('App name').fill(name)`, `getByLabel(/^Return addresses/).fill(origin + '/')`, then `getByRole('button', { name: 'Register', exact: true }).click()`. An `article` containing the name shows text matching `/^app_[0-9a-f]{32}$/`.
- **Consent.** `page.goto('/oauth/authorize?' + params)`, with `client_id`, `code_challenge` (S256), `redirect_uri`, `response_type=code` and `scope`. The app name is visible. Choose the venue `radio` and then `Approve`. The browser lands on `redirect_uri` with `?code=`.
- **Revoke.** `page.goto('/apps')`. In the `article` for the app and venue, choose `Revoke`. `No app is approved right now.` is visible.
- **Side effect.** Exchange the code at `POST /v1/oauth/token` before revoking, then call `GET /v1/connect/cards` with the bearer token. It answers 200 before revoking and 401 after.

## Gotchas

- Return addresses must match exactly, including the trailing slash.
- The client page must run on `localhost` or `127.0.0.1`. The api's CORS policy accepts loopback origins only.
- The operator cookie must never reach the outside app. The e2e test asserts the client server never saw `fuda_operator`.
- The consent page loads over the network. Wait for `networkidle` or for the app name before acting.
