# ADR 0008: One issuer wallet, multiple owner credentials

- **Status**: Accepted 2026-09-09. The signature foundation is verified; co-owner onboarding and owner management are deferred beyond the current MVP. The "one issuer per wallet" rule below is superseded by [ADR 0011](0011-several-issuers-per-account.md): a wallet may own several issuers. Since 2026-11-05 a wallet is no longer how every operator signs in: see [Operator accounts](#operator-accounts). The rest applies to an issuer a wallet owns.
- **Scope**: shared control of one issuer, without adding a multiple-venue workspace model to the dashboard.

An issuer's wallet is its durable dashboard and ENS identity. The credentials controlling that wallet can change without changing the issuer, handle, cards, or ENS owner. Preserve one issuer per wallet and use Coinbase Smart Wallet's MultiOwnable mechanism for full co-owners. Do not reinterpret each owner credential as a separate issuer or add an offchain owner allowlist as the authority for the wallet.

## Operator accounts

The owner decided on 2026-09-28 that operators sign in with fuda's own WebAuthn passkeys on `fuda.sh`, with connecting a wallet optional, because Base Account sign-up asks for an email and makes a wallet the identity. So an issuer now belongs to an account, or to an address for one made through a wallet sign-in, and `issuers` holds exactly one of the two.

- **Accounts are shared with members.** A person who runs a shop and holds passes is one person with one passkey, so operator and member sessions name the same `accounts` row and only the session audience differs.
- **There is no linking.** An issuer stays with the owner that made it. Wallet sign-in remains because ENS claims are bound to a wallet and vouchers need an address, and it reaches only what that address owns. An account's issuer therefore cannot claim an ENS name. A way to attach a wallet to an account is a later decision, and the requirements below would apply to it.
- **Connected-app and stamp rows name the owner in their existing columns.** `connected_apps.owner_address`, `oauth_codes.address`, `oauth_tokens.address`, `connected_app_events.address` and `stamp_credits.operator_address` hold an address, or `account:<id>` for an account. Renaming the columns would break the previous Worker if a deploy were rolled back, and rebuilding them means four more table copies for no change in behavior. The prefix keeps the two kinds of value apart.

## Authentication and ownership

The dashboard must prove control of the **issuer wallet**, even when a different owner credential signs. The existing API already verifies EOA/ERC-1271/ERC-6492 signatures against the submitted address and looks up the issuer by that same address. Its legacy `issuers.operator_address` and operator-session `address` represent this wallet identity; they are not a reliable identifier of the individual person or owner key. Keep those field names and the current API contract for the MVP. This section describes wallet sign-in.

An owner's ordinary personal signature against its own address does not authenticate the issuer wallet. A future co-owner flow needs the target issuer wallet, a supported signer, and a correctly encoded wallet proof. In Coinbase Smart Wallet, the proof selects an owner index and contains the signature over the wallet's replay-safe digest. Verifying only that an arbitrary supplied address appears in a local list is insufficient. The Base Account popup's ability to discover and sign for an externally owned wallet remains a separate integration requirement.

ENS vouchers and claim confirmation remain bound to the issuer wallet. Adding a co-owner must not make a subname belong to the co-owner's personal wallet. Reception records the authenticated wallet address or account; it does not distinguish multiple humans using either. A future audit trail must retain verified signer evidence separately from the issuer identity, including support for public-key and contract-wallet owners rather than assuming every credential is an EOA address.

## Full co-owners and restricted operators

MultiOwnable grants full wallet control to each owner independently; it is not a threshold multisig or an application role system. A co-owner can execute calls and add or remove other owners. The future dashboard section should be labelled **Wallet owners**, with owner listing, addition and removal. It must explain the full authority being granted.

Reception-only operators and automated issuer keys are outside this mechanism. Their limited capabilities need a separate authorization design. This preserves [ADR 0001](0001-eas-native-target-architecture.md)'s decision to delegate issuer hot keys rather than make them full wallet owners.

## Conditions before co-owner management ships

- **Credential removal must end access.** Current bearer sessions last 30 days and are not revalidated against onchain owner state. Removing an owner does not currently invalidate its sessions. Co-owner login must retain enough verified credential/proof evidence to revalidate authority and revoke sessions when it disappears, including removal performed outside fuda. A locally stored owner index alone is not enough for nested contract-wallet owners whose own credentials can change. Define and test the revocation boundary before exposing owner management; a successful login must not become a 30-day authorization after removal.
- **Chain scope must be explicit.** Current dashboard signature verification uses Base Sepolia (84532); ENS transactions use Ethereum Sepolia (11155111). Equal wallet addresses do not imply equal owner state. Coinbase provides replayable owner-management operations, but propagation must be performed and verified; it is not automatic. Login authority and ENS execution must each be checked on their intended chain.
- **Signer discovery must be usable.** Full co-owners need a way to select or open the shared issuer wallet and produce its proof. Contract support for multiple owners alone does not supply this UI. No wallet switcher, owner invitation flow, or co-owner transaction adapter is shipped by this foundation.

## Verified foundation and its limits

`pnpm --filter api probe:venue-wallet` constructs one undeployed Coinbase Smart Wallet v1 with two generated EOA owner credentials. On Base Sepolia, both owner signatures pass the API's real `ChainClient.verifyMessage`; a changed challenge, a proof by an unregistered owner, and a raw owner's personal signature are rejected. The account has no code before or after the run: ERC-6492 factory deployment happens only within the RPC simulation. The probe requires no issuer record, private key configuration, funds, or transactions. Its transport allows only the three read methods it needs and retains RPC failure evidence independently of the verifier; a rejected RPC request is inconclusive, not a successful negative check.

This verifies the shared-wallet signature premise using **initial** multiple owners. It does not exercise `addOwnerAddress` on a deployed account, Base Account popup discovery, passkey owners, nested smart-wallet owners, HTTP session creation, session revocation, or cross-chain propagation. These are release requirements for the later feature, not implied successes of the probe. No MVP database migration or change to the dashboard is needed for this decision.

## Sources

- [Coinbase MultiOwnable implementation](https://github.com/coinbase/smart-wallet/blob/main/src/MultiOwnable.sol): owner types, addition, removal and independent full authority.
- [Coinbase Smart Wallet implementation](https://github.com/coinbase/smart-wallet/blob/main/src/CoinbaseSmartWallet.sol): owner-index signature wrapper and replayable owner-management calls.
- [Coinbase ERC-1271 implementation](https://github.com/coinbase/smart-wallet/blob/main/src/ERC1271.sol): replay-safe signature digest.
- [Viem Coinbase Smart Account](https://viem.sh/account-abstraction/accounts/smart/toCoinbaseSmartAccount): owner selection and account signing. The probe uses the repository's installed viem, not copied wallet contracts.
