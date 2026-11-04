# ADR 0014: Offchain rights by default, with on-chain rights as an option

- **Status**: Proposed 2026-11-04. Not implemented. The specs keep describing the current system until this is accepted and built.
- **Scope**: the pass types an Issuer can choose, how each is verified and recovered, which keys sign them, and what leaves the product.

## Context

Every Right is a public on-chain attestation today. A self-serve Bearer claim waits for a transaction, and the holder, issuance and Attendance are public and permanent. Signed and +Private are reachable only through the admin `POST /issue`. Activation, the Claim key and the Agent key have no code, and an unactivated Bearer holder is a fuda-owned account, so a member's own key cannot find it.

We have found no evidence that individual shops pay for public verifiability, and the public record costs them visit privacy and issuance speed. A plain database would remove those costs but would also make every validity check depend on fuda. EAS offchain attestations sit between the two: issuance is a signature with no transaction, revocation is still readable on chain by anyone holding the signed data, and a Merkle root can timestamp a batch without publishing its contents.

No pilot exists yet, so this design ignores already issued rights and needs no migration.

Assumptions: members and operators authenticate with passkeys, and email is used only for backup and recovery.

## Decisions

### 1. Four pass types and one setting

The Issuer chooses a type per Card, separately from the `membership | ticket` category. Moving a pass to another type means reissuing it under a new UID.

| Type | Verification level | Record | Member address | Presentation | Chain unreadable |
| --- | --- | --- | --- | --- | --- |
| **Standard** (default) | Bearer | signed attestation in D1, batched root | none | secret UID in a QR, Device wallet | membership admits as unconfirmed; ticket rejects |
| **Identified** | Signed | as Standard | none, public key checked directly | challenge answered in the app | as Standard |
| **On-chain** | Bearer | on-chain attestation | fuda-owned counterfactual account | public UID in a QR, Device wallet | rejects |
| **On-chain self-held** | Signed | on-chain attestation | the member's own, stable | challenge answered in the app | rejects |

**Sensitive use** is a Card setting on Identified, for employee badges and privacy-sensitive memberships. It adds per-pass keys (decision 4), rejects when the chain is unreadable, keeps the entry log to a minimum with a set retention period, turns Attendance and Stamps off, and disables email recovery and member names. It does not hide entry from the Issuer or the gate. That still needs U4.

### 2. Offchain rights

An offchain Right is an EAS offchain attestation (version 2). D1 stores the signed data, and the QR carries only its UID, so a 40 mm code stays readable (39 modules against 91 for the full attestation). A NETUM NT-5090 read a test code of this form. The 32-byte salt makes the UID unguessable, and in Standard the UID is the bearer secret.

Roots are timestamped in batches. A root records when a batch existed. It is not an admission condition, with the one exception in decision 5.

Merkle leaves use the double-hashed `StandardMerkleTree` form. Proofs may be handed to holders, but the tree dump contains the raw UIDs and must never be published.

Revocation is sent per pass and not batched, because one already revoked UID reverts a whole `multiRevokeOffchain`. D1 records the revocation first, so the gate rejects at once and while the chain cannot be read. A revocation made directly on chain, outside fuda, is not covered while the chain is unreadable.

### 3. Gate rules

The gate checks, in order: D1 revocation mirror, UID, signature domain, signature, pinned attester, schema, venue, expiry, on-chain revocation, slot.

- Verification uses viem, not the EAS SDK verifier, which recovers an EOA only and checks neither expiry nor revocation.
- `domain.chainId` is converted to `BigInt` after JSON. As a string, viem recovers a different address.
- `domain.version` is read per chain: Base mainnet runs EAS 1.0.1, while Base Sepolia and Soneium run 1.4.1-beta.3.
- The schema and venue are pinned. All venues share one attester in the first phase, so a signature alone would admit another venue's pass.
- `AlreadyTimestamped` counts as success, because anyone can timestamp a root first.

### 4. Identity and addresses

Identified attests the passkey's public key in the pass data and leaves `recipient` as the zero address. The gate checks the challenge, origin, RP ID hash, user-verification flag and signature with no chain read.

Sensitive use attests a key unique to the pass. Those keys derive by HKDF from a random member secret wrapped by each passkey's PRF. A second passkey can be added by wrapping the same secret, so losing one passkey does not change the keys. Smart wallets do not provide this separation: an undeployed wallet's signature contains the owner's public key, so per-venue wallets behind one passkey stay linkable.

A member address is not created at issuance. When an integration needs one, it derives from the member secret, per venue by default. A stable address is used only when the member chooses it. Stealth addresses stay available as a way to receive value, not as a pass type.

### 5. Issuing keys

The first phase uses fuda's common EOA, whose signatures verify with no chain read.

The next phase uses a delegated hot key, adopting [ADR 0001](0001-eas-native-target-architecture.md) decision 6. A shop's passkey wallet attests a delegation on chain to a hot EOA, which signs passes without a human present. Issuing from a passkey alone cannot work for self-serve claims, because each signature needs the owner's touch.

- **The delegation is on chain.** ERC-1271 checks current owners, so a delegation signed offchain fails once the shop replaces that passkey, and every dependent pass fails with it. An on-chain attestation keeps its attester.
- **The hot key is not a wallet owner.** Removing an owner invalidates what it signed. This drops the Agent key, which was to be a fuda-held owner on the Issuer's wallet.
- **The gate reads revocation under both addresses.** A shop revoking its hot key's pass records under the shop's address.
- **After a delegation is revoked,** a pass stays valid only if a root timestamped before the revocation contains it. `time` is chosen by the signer, so a stolen key can backdate. Passes outside such a root are reissued.

Delegated keys expose each shop's revocation count and timing on chain, which can reveal staff turnover. Sensitive use therefore stays able to use a shared key.

### 6. What leaves the product

- **+Private issuance, and with it the U2 and U3 templates.** Against a chain observer, an offchain right reveals less than a stealth attestation, and neither hides anything from the Issuer. Sensitive use replaces it. The `/private` discovery path and its Graph dependency go too.
- **Activation and the Claim key.** On-chain self-held rights are issued to the member's key from the start. An On-chain pass moves to self-held only by reissue.
- **The Agent key**, as decided above.

U4 stays deferred and unchanged.

### 7. Recovery and the member list

Offchain rights have no holder address to query, so fuda keeps a server-side link from a member account to their passes. This supersedes [ADR 0004](0004-member-pass-list-from-holder.md) decisions 1 to 3 for offchain rights. They still apply to on-chain rights.

| Type | Recovery |
| --- | --- |
| Standard | passkey account, or email as backup; reissue at the shop |
| Identified | passkey sync; otherwise reissue, because the pass names one passkey's public key |
| Sensitive use | passkey sync; a second passkey; reissue by the Issuer, never email |
| On-chain | as Standard; the record stays public |
| On-chain self-held | passkey sync, owner rotation or an external wallet |

Moving between iOS and Android does not carry a passkey across, so the new phone needs an existing device, a recovery code or a reissue.

### 8. Attendance and names

Attendance stays in D1 for offchain rights. On-chain types may also record it on chain, on by default for tickets and off for memberships.

Member ENS names resolve to a holder address, so only on-chain types get them.

## Relation to earlier decisions

- [ADR 0001](0001-eas-native-target-architecture.md): decision 1's offchain treatment of private rights becomes the default for all rights. Decision 2's "stealth templates stay" and decision 8's claim module are dropped. Decision 6 is adopted, on chain.
- [ADR 0002](0002-unfiltered-announcement-log.md) and [ADR 0003](0003-graph-push-query-lanes.md): the announcement log loses its product use. Graph queries remain only for on-chain rights, and the Graph fallback design waits for this decision.
- [ADR 0004](0004-member-pass-list-from-holder.md): superseded for offchain rights, as above.
- [ADR 0005](0005-hybrid-ensv2-resolver.md): one-time +Private resolution is no longer needed, and member names shrink to on-chain types.
- [ADR 0008](0008-shared-issuer-wallet.md): no conflict. It already keeps automated issuer keys out of wallet ownership.

## Consequences

- fuda holds a link between members and their passes, which the earlier design avoided. Sensitive use limits what that link can reveal, but fuda and the Issuer can still join them.
- Without fuda, a holder of the exported signed data can check validity, but nobody can admit Standard or Identified passes through fuda's gate, and single-use tickets lose their only slot record.
- The "validity never leaves the chain" rule no longer holds in general: validity is a signature plus an on-chain revocation read. The README, architecture overview, glossary and specs change when this is built.
- Offchain Rights need a new schema that carries the venue and, for Identified, the key. This is a new cut, not a change to the current Entitlement.
- fuda pays for roots and revocations, and on-chain types keep paying per issuance.

## Measurements

Local anvil forks of Base Sepolia, Base mainnet and Soneium, with Chromium's virtual authenticator. Gas excludes the L1 data fee. The P-256 precompile answers a valid vector on all of these chains, so the passkey figures do not rely on a software fallback.

| Operation | Gas |
| --- | --- |
| On-chain attestation (estimate) | 354,422 |
| Root timestamp | 50,834 |
| Offchain revocation | 51,391 |
| Passkey wallet deployment, one owner | 213,853 |
| Revocation from a passkey wallet, through EntryPoint | 174,780 |
| Adding a passkey owner | 227,175 |
| On-chain delegation from a wallet with an EOA owner | 393,061 |

## Conditions before acceptance

- **Real devices.** So far one iPhone (Safari 27) has created and used a synced P-256 passkey in two providers. Apple Passwords returned a stable 32-byte PRF result and wrapped and unwrapped a secret. Bitwarden returned no PRF result in any request form. PRF therefore depends on the passkey provider, and enrollment must detect its absence and decide what to do without it. The Apple Passwords passkey, synced through iCloud Keychain to a Mac and used in Chrome there, returned the same PRF result as on the iPhone, so keys derived from it can be recovered on a synced device. A Google Password Manager passkey created in Chrome on a Mac also returned a stable PRF result. Still open: Android, and server-side verification of a real device's signature. Reports on Apple's developer forums describe PRF failing or returning different values over the cross-device flow, and we have not confirmed this ourselves.
- **Recovery path for the wrapped secret.** Where the wrapped copies live, and what a member does when moving between iOS and Android.
- **Sponsored wallet operations.** A user operation through a public bundler and paymaster on testnet. Only EntryPoint 0.6 support has been read from one public endpoint so far.
- **Soneium.** The Coinbase Smart Wallet factory has no code at its usual address on Soneium mainnet, though it does on Minato. On-chain self-held and delegated keys need another path there.
- **Demand.** Shop conversations on whether the default type and its recovery are acceptable, and whether Sensitive use has real customers. It does not cover door control or company identity systems.

## Sources

- [EAS offchain attestations](https://docs.attest.org/docs/core--concepts/onchain-vs-offchain)
- [EAS contract](https://github.com/ethereum-attestation-service/eas-contracts/blob/master/contracts/EAS.sol): `timestamp`, `revokeOffchain` and `getRevokeOffchain`.
- [Coinbase Smart Wallet](https://github.com/coinbase/smart-wallet/blob/main/src/CoinbaseSmartWallet.sol) and [its ERC-1271 implementation](https://github.com/coinbase/smart-wallet/blob/main/src/ERC1271.sol).
- [ERC-6492](https://eips.ethereum.org/EIPS/eip-6492) and [RIP-7212](https://github.com/ethereum/RIPs/blob/master/RIPS/rip-7212.md).
- [WebAuthn PRF extension](https://www.w3.org/TR/webauthn-3/#prf-extension) and [passkeys.dev device support](https://passkeys.dev/device-support/).
- [Apple developer forum report on PRF over the cross-device flow](https://developer.apple.com/forums/thread/774112).
