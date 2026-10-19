# ADR 0009: One account, several issuers

- **Status**: Accepted 2026-10-19. Supersedes the "one issuer per wallet" rule of [ADR 0008](0008-shared-issuer-wallet.md); the rest of ADR 0008 stands.
- **Scope**: how an operator account relates to the issuers it runs, in the api, D1 and the dashboard.

An operator who runs two shops, or a shop and an event, signs in with one passkey wallet. Requiring a second wallet per shop made the second shop impossible for anyone without a second passkey account, and connected apps ([Connected apps](../specs/connected-apps.md)) need the operator to choose which shop an approval is for. So an account — the signed-in operator address — may own several issuers, and everything that belongs to a shop stays scoped to that issuer.

## Decision

- `issuers.operator_address` is no longer unique (`0018_issuers_per_account.sql`). An address may own up to ten issuers; the cap keeps one account from reserving handles in bulk. Handles stay globally unique.
- A dashboard session acts for one issuer at a time: `sessions.issuer_id`, set at sign-in to the oldest issuer the address owns and changed only through `POST /issuers/switch`, which checks ownership. Every route that reads or writes shop data keeps reading the session's one issuer, so two issuers' cards, passes, stamps and members never mix in one answer.
- Permissions, connected-app approvals and tokens, and ENS names are per issuer. A connected-app token names the issuer chosen on the consent page and reaches no other, even another issuer of the same account.
- Creating an issuer is still done only in the dashboard; nothing outside fuda can create one.

## Consequences

- Every issuer of an account currently resolves its ENS name to the same operator wallet, and every attestation is still made by the fuda signer. Separate per-issuer wallets, keys and on-chain delegation remain the B1 direction of [ADR 0001](0001-eas-native-target-architecture.md); this decision does not add them.
- ADR 0008's co-owner model is unchanged: an issuer wallet may still gain co-owner credentials, and a co-owner signs in as the wallet, which may own several issuers.
- The rebuild in `0018` copies through a side table and back under the same name, because D1 counts the rows orphaned by dropping `issuers` as deferred foreign-key violations and only re-inserting the parent rows clears that count.
