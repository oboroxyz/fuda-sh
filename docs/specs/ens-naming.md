# ENS naming

fuda names two things with ENS: the **issuer** that attests rights and the
**member number** printed on a pass. A name is a display and destination
layer. It never grants authority, never replaces the on-chain right, and never
enters the admission decision.

> **ENS names the relationship. EAS proves the right.**

## Current implementation boundary

The repository implements the B1-independent naming and resolution transport:

- canonical Issuer Handle and member-number validation, construction, and parsing;
- the D1 `ens_names` operational mirror and `stealth_resolutions` derivation ledger;
- active and expiry-aware stable lookup plus one-time +Private address allocation;
- a public EIP-3668 gateway at `POST /ens/gateway`; and
- a dependency-free ENSIP-10 resolver contract in `packages/ens-contracts` that
  verifies the gateway's signed responses.

The transport is disabled unless all gateway bindings are configured, and the
resolver contract is not deployed by this repository. Issuer onboarding and
confirmed Right evidence do not write naming rows yet, so normal application
flows do not populate the gateway's data source. Issuer lifecycle wiring,
onchain vouchers and claims, unregister/renew flows, live Sepolia setup, and the
`fuda.sh` DNS alias remain unshipped. No Gate or Entry path calls ENS lookup or
the gateway.

This boundary avoids pinning the application to a moving ENSv2 beta deployment.
Live setup must first pin one `ensdomains/contracts-v2` commit and its matching
Sepolia deployment manifest.

## Target hierarchy

```text
fuda.eth                              parent (Ethereum Sepolia, ENSv2)
└── <issuer>.fuda.eth                 issuer — resolves to the address that attests rights under that handle
    └── <member-no>.<issuer>.fuda.eth member number — one per right
fuda.sh  ──alias──►  fuda.eth         DNS alias: <x>.fuda.sh resolves as <x>.fuda.eth
```

- An **issuer label** is the issuer's public handle (`/@<handle>`), already
  restricted to `[a-z0-9-]`. In member-facing copy the organization behind a
  handle is a venue; the ENS layer, like the data model and EAS, names it by
  its role and calls it the issuer (see the glossary in `docs/CONTEXT.md`).
- A **member label** is the right's member number, exactly as printed on the
  pass (see below). Members never type a name; fuda has no personal-identity
  names (`alice`-style handles are out of scope by design).
- `fuda.sh` is a read-only alias of the `.eth` tree. Nothing is registered
  under the DNS name; every rule below applies once, on the `.eth` side, and
  shows through the alias.

## Member number

Every right receives its own member number at issuance.

| Property        | Rule                                                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alphabet        | 28 characters `23456789acdefghjkmnpqrtuvwxy` — no `0 1 i l o`, and no `b s z` (read as `8 5 2` upper-cased)                                                                                                                       |
| Length          | 13 characters: 12 random (~58 bits, no sequential counter) + 1 check character                                                                                                                                                    |
| Check character | Luhn mod 28 over the 12 random characters (weights 2,1,2,… from the right, digit-sum carry, complement to 0 mod 28); detects every single-character error and almost all adjacent transpositions                                  |
| Canonical form  | lowercase, no separators: `qj2yxphepdrka` — stored as-is, and this exact string is the ENS label                                                                                                                                  |
| Display         | display-only formatting on the pass and dashboard: upper-cased in `4-4-5` groups, `QJ2Y-XPHE-PDRKA` (the last character of the last group is the check). Any typed-in number is lower-cased and stripped of hyphens before lookup |
| Transport       | passed by scan (QR / pass / link); the check character lets any receiver reject a corrupted or mistyped number before a lookup                                                                                                    |
| Uniqueness      | unique per issuer; regenerated on collision                                                                                                                                                                                        |
| Scope           | one number per **right** — a `private + loyalty` member has two unrelated numbers                                                                                                                                                 |

Hyphens never enter storage, the API, or ENS; they are added by the pass and
dashboard renderers only.

Why random, not sequential: a counter would make member names enumerable,
reveal issue order and issuer size, and correlate with the order of fuda's
issuance announcements on chain. Randomness costs nothing and removes all
three.

**Member number and the admin `memberId`.** The member number above is the
identifier the self-serve issuance path generates for a right. The admin path
(`POST /issue` from the dashboard) accepts `memberId` as free-text — any
non-empty string the operator chooses — and stores it as-is in
`members.member_id`; it is neither validated against nor converted to the
member number format. The two coexist: an admin-issued right has whatever id
the operator typed, a self-serve right has a generated member number. No
route in the api generates member numbers.

## Target resolution

| Right                 | `addr()` result                                                                     |
| --------------------- | ----------------------------------------------------------------------------------- |
| Issuer                | the address that attests rights under that handle (the EAS `attester`)              |
| `standard` (Bearer)   | the right's claimable smart-account address — stable, unchanged by later activation |
| `standard` (Signed)   | the same holder address                                                             |
| `private` / U3 access | **a fresh one-time stealth address on every query** — never the same address twice  |

A +Private name therefore exists and is usable as a destination, but it never
exposes a stable address, so it creates no durable on-chain link to the member.
The label itself is random and reveals nothing about the person.

### CCIP-Read transport

`POST /ens/gateway` accepts the standard JSON request
`{"sender":"0x…","data":"0x…"}`. `sender` must match a configured resolver
address (case-insensitively), and `data` must encode the complete ENSIP-10
`resolve(bytes,bytes)` call. The gateway currently answers only the legacy
`addr(bytes32)` record and multicoin `addr(bytes32,uint256)` with coin type 60.
The record node must equal `namehash(name)`. Unsupported senders or names answer
404, malformed requests answer 400, incomplete configuration answers 503, and
unexpected failures answer 500. Success is `{"data":"0x…"}`; every error is
`{"message":"…"}`. All responses use `Cache-Control: no-store`.

The endpoint is public and does not use `ADMIN_TOKEN`. It and `/announcements`
share one fixed hourly D1 counter: together they admit 120 requests per client
IP and require `CF-Connecting-IP`. The resolver allowlist prevents the service
from signing responses for arbitrary verifier contracts.

The signed response is ABI-encoded as `(bytes result, uint64 expires, bytes
signature)`. Its raw ECDSA digest is:

```text
keccak256(
  0x1900
  || resolverAddress
  || uint64(expires)
  || keccak256(fullResolveRequest)
  || keccak256(result)
)
```

`expires` is the earlier of five minutes after the request and the name's own
expiry. The Solidity callback requires its own address as the signed resolver,
rejects expired responses, accepts only the configured signer, and rejects
malformed, invalid-recovery-id, and high-s signatures. It returns only the
signed result bytes.

The endpoint requires all four bindings before it resolves anything:

| Binding                  | Kind          | Meaning                                                   |
| ------------------------ | ------------- | --------------------------------------------------------- |
| `ENS_PARENT_NAME`        | plain binding | canonical two-label parent, for example `fuda.eth`        |
| `ENS_RESOLVER_ADDRESSES` | plain binding | comma-separated allowlist of deployed resolver addresses |
| `ENS_GATEWAY_SIGNER_KEY` | Worker secret | 32-byte ECDSA private key for response signatures         |
| `ENS_GATEWAY_SECRET`     | Worker secret | separate 32-byte HMAC key for +Private derivation         |

The signer and allocation keys must be distinct operational secrets and must not
be reused for ENS parent ownership, EAS issuance, or any other role.

### Gateway resolution for +Private rights

- Resolution is served by an offchain CCIP-Read gateway. For a +Private
  right it derives a new stealth address (ERC-5564) from the member's stealth
  meta-address with a deterministic per-name nonce, so every address it has
  ever returned can be re-derived from the counter. The counter reservation and
  derived `(stealthAddress, ephemeralPublicKey, viewTag)` are persisted only
  after the full request and both gateway secrets validate. Private answers are
  never cached.
- **A lookup is never announced.** ERC-5564 announcements mark an on-chain
  _use_ (a right attested to, or value sent to, a stealth address), not the
  creation of an address. Announcing per lookup would put the name's query
  volume on chain and inflate the member's scan set.
- Who announces: fuda, when it issues a right to a name (attest and announce
  in one step); an ERC-5564-aware sender, for its own transfer. _Tokyo:_ a
  fuda watcher announces a previously resolved address once it sees on-chain
  activity there, so ordinary wallets sending to a name are covered too.
- Members discover rights by scanning announcements with their
  passkey-derived viewing key (see [Pass types and flows](./pass-types-and-flows.md),
  U2). The name adds no second discovery path.

## Planned name lifecycle

A name is created by on-chain evidence and dies with the right it names.

```text
issue right ──► on-chain evidence confirmed ──► name exists ──► right revoked ──► name stops resolving
                 +Private: issuance announcement
                 Bearer/Signed: EAS Attested receipt
```

- A member name is written only **after** the right's on-chain evidence is
  confirmed. No name exists for a right that has not landed; a failed issue
  has no name until its retry succeeds.
- Revoking the right makes its name stop resolving.
- An issuer name follows the issuer's `IssuerDelegation`: its validity mirrors
  the delegation window, and revoking the delegation removes the name.
- Bearer → Signed activation changes the smart account's owners, not its
  address, so the member's name, right, and history all survive unchanged.

## Invariants

- **Not authority.** A resolving name never makes an issuer legitimate or a
  right valid; surfaces show the name and the delegation / right check as two
  separate facts, and fall back to the raw address when resolution fails.
- **Not in the gate path.** Admission never waits on ENS. Member names are
  never shown at the gate, never written to entry logs, and never included
  in announcements.
- **No self-identifying labels.** Labels are issuer handles or random member
  numbers. No handle, email, member-database id, attestation UID, or proof
  material is published in any ENS record. The only required record is the
  EVM address (or, for +Private, the rotating answer described above).
- **No stable address for +Private.** A +Private name must never resolve to
  the same address twice or to any address that appears elsewhere with the
  member.
- **Two numbers in `private + loyalty`.** The access right and the loyalty
  right carry unrelated member numbers, so no name links the unlinkable
  access right to the loyalty holder.
- **Offchain member layer.** Member names live in the offchain gateway;
  members own no subname and hold no ENS-side key. Issuer names may be
  claimed on chain by the issuer's wallet and are non-transferable.

## Related specs

- [Architecture overview](../architecture.md)
- [Attestation model](./attestation-model.md)
- [Pass types and flows](./pass-types-and-flows.md)
