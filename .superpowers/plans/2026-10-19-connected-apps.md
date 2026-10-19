# Connected apps plan (temporary)

1. sdk: error codes, schemas (app registration, authorize, token), response types.
2. api: migration 0017 + drizzle schema; `src/connected-apps/` store (clients, codes, tokens, PKCE).
3. api: routes — management, authorize, token, revoke, connect resources; CORS for external routes.
4. api tests: end-to-end flow, PKCE/replay/redirect failures, owner-only consent, issuer isolation, scope, revoke, CORS.
5. dash: consent page (standalone entry), `/apps` page, api client, copy (en/ja), tests.
6. docs: `docs/specs/connected-apps.md`, README index, CONTEXT glossary, runbook, integrations guide.
7. `pnpm check`, `pnpm test`; delete these artifacts.
