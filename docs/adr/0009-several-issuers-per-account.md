# ADR 0009: One account, several issuers

- **Status**: Accepted 2026-10-19. Supersedes the "one issuer per wallet" rule of [ADR 0008](0008-shared-issuer-wallet.md); the rest of ADR 0008 stands.
- **Scope**: how an operator account relates to the issuers it runs, in the api, D1 and the dashboard.

An operator who runs two shops, or a shop and an event, signs in with one passkey wallet. Requiring a second wallet per shop made the second shop impossible for anyone without a second passkey account, and connected apps ([Connected apps](../specs/connected-apps.md)) need the operator to choose which shop an approval is for. So an account — the signed-in operator address — may own several issuers, and everything that belongs to a shop stays scoped to that issuer.

## Decision

- `issuers.operator_address` is no longer unique (`0018_issuers_per_account.sql`). An address may own up to ten issuers; the cap keeps one account from reserving handles in bulk. Handles stay globally unique.
- A session token is bound to one issuer for its whole life: `sessions.issuer_id`, set at sign-in to the oldest issuer the address owns, or once from empty when the account's first issuer is created. Acting for another issuer takes another token — `POST /auth/switch`, or the token `POST /issuers` answers for an account's additional issuer — and the token that asked keeps its issuer. Every route that reads or writes shop data reads the token's one issuer, so two issuers' cards, passes, stamps and members never mix in one answer.
- The binding is never moved in place because tabs share a token. If switching changed the issuer behind a live token, a second tab still showing the first issuer would write its edits into the second; with one issuer per token, each tab writes to the issuer it was showing. A switch therefore leaves an extra session row until it expires, and signing out ends only the tab's own token.
- The account routes live under `/auth` (`GET /auth/issuers`, `POST /auth/switch`): a static segment under `/issuers` would shadow the public `GET /issuers/:handle` of a venue whose handle matched it.
- Permissions, connected-app approvals and tokens, and ENS names are per issuer. A connected-app token names the issuer chosen on the consent page and reaches no other, even another issuer of the same account.
- Creating an issuer is still done only in the dashboard; nothing outside fuda can create one.

## Consequences

- Every issuer of an account currently resolves its ENS name to the same operator wallet, and every attestation is still made by the fuda signer. Separate per-issuer wallets, keys and on-chain delegation remain the B1 direction of [ADR 0001](0001-eas-native-target-architecture.md); this decision does not add them.
- ADR 0008's co-owner model is unchanged: an issuer wallet may still gain co-owner credentials, and a co-owner signs in as the wallet, which may own several issuers.
- The rebuild in `0018` copies through a side table and back under the same name, because D1 counts the rows orphaned by dropping `issuers` as deferred foreign-key violations and only re-inserting the parent rows clears that count.
