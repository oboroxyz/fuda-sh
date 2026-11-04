# References

External standards, prior art, and platform documentation that informed the design. Each entry notes what it informed and links the spec that applies it.

## Standards

| Reference | What it informs |
| --- | --- |
| [EAS — Ethereum Attestation Service](https://attest.org) | Rights as revocable on-chain attestations; schema registry, refUID, revocation semantics — see [Attestation model](./specs/attestation-model.md) |
| [ERC-5564 — Stealth Addresses](https://eips.ethereum.org/EIPS/eip-5564) | The removed +Private level: meta-address, one-time stealth addresses, view tags, the canonical announcer. Dropped by [ADR 0014](./adr/0014-offchain-default-pass-types.md); the reusable Substreams package still extracts these events |
| [ERC-6538 — Stealth Meta-Address Registry](https://eips.ethereum.org/EIPS/eip-6538) | An on-chain meta-address directory — deliberately NOT used (registering under an identity address would publicly link the privacy and continuity sleeves); noted as a linkability-caveated future rail |
| [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271) / [ERC-6492](https://eips.ethereum.org/EIPS/eip-6492) / [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) | One `verifyMessage` call covering EOA, deployed, and counterfactual smart-account signatures; any-wallet member app — see [Pass types and flows "Supporting verification concepts"](./specs/pass-types-and-flows.md#supporting-verification-concepts) |
| [RFC 6979 — Deterministic ECDSA](https://datatracker.ietf.org/doc/html/rfc6979) | Why an EOA signature over a pinned message is a reproducible entropy source for stealth-key derivation (and why ERC-1271/MPC signers are excluded from that path) |
| [WebAuthn PRF extension](https://w3c.github.io/webauthn/#prf-extension) | Passkey-derived deterministic secrets: one passkey + one pinned eval input → one member secret on every device — prior art for [ADR 0014](./adr/0014-offchain-default-pass-types.md) decision 4 (Sensitive use), not built |
| [EIP-3668 — CCIP Read](https://eips.ethereum.org/EIPS/eip-3668) | Offchain ENS resolution — transport for the implemented hybrid resolver and gateway; see [ENS naming](./specs/ens-naming.md#signed-gateway-transport) |

## Prior art

| Reference | What it informs |
| --- | --- |
| [Coinbase Smart Wallet](https://www.smartwallet.dev/) (factory + passkey owners) | Counterfactual holder addresses for Bearer rights; a fuda-owned account at a stable address (an ownership swap was designed and then dropped by [ADR 0014](./adr/0014-offchain-default-pass-types.md)) — see [Pass types and flows "Standard issuance"](./specs/pass-types-and-flows.md#standard-issuance) |
| [Fluidkey — technical walkthrough](https://docs.fluidkey.com/technical-documentation/technical-walkthrough/) | Signature-derived stealth keys (EOA root); a public human-readable name that resolves to a fresh stealth address per query (rotating offchain resolver), avoiding the "public directory = durable link" trap |
| [Fluidkey stealth-account-kit](https://github.com/fluidkey/fluidkey-stealth-account-kit) (OSS) | Deterministic-replay recovery: a member can re-enumerate every stealth address from the root secret without the operator's server — prior art for the removed +Private level |

## Platform documentation

| Reference | What it informs |
| --- | --- |
| [Apple Wallet — PassKit package format](https://developer.apple.com/documentation/walletpasses) | `.pkpass` structure: pass.json, manifest hashing, detached CMS signature — see [Architecture "Components"](./architecture.md#components) |
| [Apple Wallet: Adding a web service to update passes](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes) | The update flow, the two shared secrets, the empty push: see [Apple Wallet updates](./specs/pass-types-and-flows.md#apple-wallet-updates) |
| [Apple: Sending notification requests to APNs](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns) | HTTP/2, the production host and the push headers |
| [Apple DTS: pass update pushes](https://developer.apple.com/forums/thread/758991) | The pass certificate authenticates the push, production only, and the rules for the topic |
| [Cloudflare: mTLS bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/mtls/) | How a Worker presents a client certificate |
| [Google Wallet — Generic pass](https://developers.google.com/wallet/generic) | GenericObject shape and the `savetowallet` RS256 JWT — see [Architecture "Components"](./architecture.md#components) |
| [ENSv2 docs](https://docs.ens.domains/ensv2/overview) | v2 registry hierarchy, EAC, and per-account resolvers — venue names on the Sepolia beta |
| [ENSv2 Permissioned Registry](https://docs.ens.domains/ensv2/permissioned-registry/) | Per-name expiry and registration lifecycle — venue names that follow an issuer delegation |
| [ENSv2 DNS resolvers](https://docs.ens.domains/ensv2/dns-resolvers) | DNSSEC-backed DNS resolution and a DNSAliasResolver suffix rewrite for the `fuda.sh` → `fuda.eth` display alias, without registering the DNS name in v2 |
| [ENS deployments](https://docs.ens.domains/learn/deployments/) | The current ENSv2 Sepolia contract addresses and Universal Resolver endpoint the ENS integration must select explicitly |
| [ENS Name Wrapper](https://docs.ens.domains/wrappedname) | v1 wrapped subnames — fallback only |
| [Substreams — packages](https://docs.substreams.dev/documentation/consume/packages) | Reusable `.spkg` packages and manifest imports that compose raw ERC-5564 and EAS events — see [Substreams packages](./specs/substreams.md) |
| [The Graph — Subgraphs](https://thegraph.com/docs/en/subgraphs/overview/) | The event manifest, AssemblyScript mappings, and GraphQL query model for the rights index |
| [The Graph Market](https://thegraph.com/docs/en/substreams/providers/the-graph-market/) | The authenticated provider endpoint for live Substreams consumption |
| [ETHOnline 2026 prize requirements](https://ethglobal.com/events/ethonline2026/prizes) | The requirement that the ENSv2 and Graph integrations be functional, central, and backed by live provider data — see [ENS naming](./specs/ens-naming.md) and [Substreams packages](./specs/substreams.md) |
