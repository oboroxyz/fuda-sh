# ENS naming

fuda names two things with ENS: the **issuer** that attests rights and the
**member number** printed on a pass. A name is a display and destination
layer. It never grants authority, never replaces the onchain right, and never
enters the admission decision.

> **ENS names the relationship. EAS proves the right.**

## Shipped implementation boundary

The repository ships the B1-independent naming implementation:

- canonical Issuer Handle and member-number validation, construction, and
  parsing;
- the D1 `ens_names` operational mirror and `stealth_resolutions` derivation
  ledger;
- active and expiry-aware stable lookup plus one-time +Private address
  allocation;
- the public signed EIP-3668 gateway at `POST /ens/gateway`;
- the hybrid ENSIP-10 `FudaResolver` and voucher-gated
  `FudaSubnameRegistrar` contracts;
- claim and renew EIP-712 typed-data builders and inclusive-to-exclusive
  expiry conversion;
- a pinned ENSv2 deployment manifest, runtime code hashes, and strict
  read-only preflight; and
- parent commit/reveal tooling, resumable topology deployment, and standalone
  read-only topology verification.

`fuda.eth` is registered and the topology is deployed and verified on Ethereum
Sepolia:

| Contract | Address |
| --- | --- |
| User Registry | `0xBf987666C8e4e78d3226aA86A9A7FE141F63C99D` |
| `FudaResolver` | `0x133e6eeb3eAf0F804FbB9c1536AcA090B36A93AB` |
| `FudaSubnameRegistrar` | `0x58AF04ff5e6DAB45ECD17bD38fC4f4BBa45778B9` |
| parent owner and registry root | `0x5A89D95Ad9f964C75F4Adc2122ADb70Cc6607Cd4` |
| voucher signer | `0x5c5DE7F78d90701066f5C52e8100B5e2c73845F9` |
| gateway signer | `0xf0D345D00fA513D92ACCbc10Db721792577FcF9f` |

Voucher issuance, the naming mirror and revoke lifecycle integration are
implemented (see below). Live `.eth` verification through a third-party client
and the `fuda.sh` DNS change remain external gates. No Gate or Entry path calls
ENS or the gateway.

## Claiming a name, and what writes the mirror

An operator claims their venue's name from the dashboard in one press. fuda
signs the voucher; the operator's own wallet submits it on Ethereum Sepolia,
sponsored, so a venue owner needs neither that chain's native token nor a second
wallet:

| Step | Route | What it does |
| --- | --- | --- |
| 1 | `POST /issuers/me/ens/claim-voucher` | reads the registrar nonce, signs a `ClaimVoucher` for the operator's address, and records the name as `voucher_issued` |
| 2 | — | the operator's wallet switches to Ethereum Sepolia and calls `claim`, sponsored through `POST /ens/paymaster` |
| 3 | `POST /issuers/me/ens/claimed` | verifies the receipt carries the registrar's own `IssuerClaimed` for that exact label and issuer, then records `claimed` |

A voucher that is signed and never used costs nothing: the nonce is unspent, so
the next press signs a fresh voucher at the same nonce. Step 3 records a claim
only when the chain agrees; anything else leaves the name pending, which is
recoverable, rather than recording a claim that did not happen. Every one of
these routes answers `503` until all five claim bindings are configured.

`POST /ens/paymaster` is fuda's own ERC-7677 endpoint, and it exists because no
paymaster vendor can restrict sponsorship by destination contract — their
allowlists are by sender, and a venue's account does not exist until it claims.
It decodes the user operation's call data and pays only for `claim` and `renew`
on the configured registrar, refusing anything else before the vendor is
contacted, since an operation that reverts still spends the sponsor's money. The
vendor key stays a Worker secret and the gas policy id is injected server-side.

The `ens_names` mirror is written in exactly three places:

| When | Row |
| --- | --- |
| a claim voucher is signed, and again when the claim is confirmed | the issuer's own name, `voucher_issued` then `claimed` |
| a right is issued under a venue | `<member-no>.<issuer>.fuda.eth`, `offchain`, holding the holder's address |
| a right is revoked | that member name moves to `unregistered`, and lookup stops answering on the same request |

Only a generated member number becomes a label. The admin path accepts free text
for `memberId`, and that text never reaches the ENS namespace. A mirror write
never fails the operation that triggered it: a name is a convenience attached to
a right, and the right is the product.

A +Private right has no name yet. The mirror stores a stealth meta-address in
place of a holder — that column is what the gateway's one-time derivation reads
— but the only path that issues a level-2 right is the admin one, which belongs
to no venue and so has no issuer label to hang a member name under. Giving a
+Private right a name means issuing it under a venue with a generated member
number; nothing does that today.

## Deployment namespace

All ENS operations target the dedicated ETHOnline 2026 ENSv2 deployment on
Ethereum Sepolia (`chainId = 11155111`). It is one indivisible address family:
the package pins all 40 nonzero, unique deployment addresses and must not mix
them with normal Sepolia ENS addresses. In particular, every client must
override viem's normal Sepolia Universal Resolver with the dedicated proxy:

```text
0xd26f2040d083af1cd2962ba303f4bea0c4faf142
```

The manifest also pins nonzero runtime code hashes for every protocol contract
called by the tooling: `DNSAliasResolver`, `ETHRegistrar`, `ETHRegistry`,
`MockUSDC`, `RootRegistry`, `UpgradableUniversalResolverProxy`,
`UserRegistryImpl`, and `VerifiableFactory`. Preflight fails on a wrong chain
or Universal Resolver, absent or changed runtime code, a mixed address family,
unsupported or malformed ABI reads, an unavailable parent without its expected
owner, or a resumed fuda contract whose owner or implementation differs.

The address family comes from the
[ENS docs deployment table pinned at docs commit `825aca8a882b56557607fde7dc477bc9ca68e06d`](https://github.com/ensdomains/docs/blob/825aca8a882b56557607fde7dc477bc9ca68e06d/scripts/ensv2-deployments.ts#L84-L264).
There is no published matching `ensdomains/contracts-v2` source ref. fuda
therefore trusts the pinned addresses and observed runtime hashes, uses only
its minimal ABI surface, simulates every write, validates receipt events, and
verifies the resulting topology.

## Name hierarchy and ownership

```text
fuda.eth                              parent (Ethereum Sepolia, ENSv2)
└── <issuer>.fuda.eth                 issuer — a User Registry entry owned by the issuer wallet
    └── <member-no>.<issuer>.fuda.eth member number — offchain only, one per right
fuda.sh  ──alias──►  fuda.eth         planned DNS alias; the zone is not changed yet
```

- An **issuer label** is the issuer's public Handle (`/@<handle>`), restricted
  to lowercase ASCII `[a-z0-9-]`, 1–63 bytes, without a leading or trailing
  hyphen. A reserved set is refused on top of that rule: fuda's own hostnames,
  the api's route prefixes, and the static segments under `/issuers/` (`me`,
  `check`, `cards`), which a venue name would otherwise shadow. A claimed label
  is an ENSv2 User Registry entry owned onchain by the issuer wallet.
- A **member label** is the right's member number, exactly as printed on the
  pass after display formatting is removed. Member labels never become User
  Registry entries and members hold no ENS-side key; all member records remain
  offchain.
- One shared `FudaResolver` is configured on `fuda.eth` and on every claimed
  issuer entry. The User Registry owns claimed issuer state; D1 owns unclaimed
  and member answers.
- `fuda.sh` is intended to be a read-only alias of the `.eth` tree. The required
  DNSSEC record is documented in the runbook, but the DNS zone has not been
  mutated.

## Member number

Every right receives its own member number at issuance.

| Property | Rule |
| --- | --- |
| Alphabet | 28 characters `23456789acdefghjkmnpqrtuvwxy` — no `0 1 i l o`, and no `b s z` (read as `8 5 2` upper-cased) |
| Length | 13 characters: 12 random (~58 bits, no sequential counter) + 1 check character |
| Check character | Luhn mod 28 over the 12 random characters (weights 2,1,2,… from the right, digit-sum carry, complement to 0 mod 28); detects every single-character error and almost all adjacent transpositions |
| Canonical form | lowercase, no separators: `qj2yxphepdrka` — stored as-is, and this exact string is the ENS label |
| Display | display-only formatting on the pass and dashboard: upper-cased in `4-4-5` groups, `QJ2Y-XPHE-PDRKA` (the last character of the last group is the check). Any typed-in number is lower-cased and stripped of hyphens before lookup |
| Transport | passed by scan (QR / pass / link); the check character lets any receiver reject a corrupted or mistyped number before a lookup |
| Uniqueness | unique per issuer; regenerated on collision |
| Scope | one number per **right** — a `private + loyalty` member has two unrelated numbers |

Hyphens never enter storage, the API, or ENS; they are added by the pass and
dashboard renderers only.

Why random, not sequential: a counter would make member names enumerable,
reveal issue order and issuer size, and correlate with the order of fuda's
issuance announcements onchain. Randomness costs nothing and removes all
three.

**Member number and the admin `memberId`.** The member number above is the
identifier the self-serve issuance path generates for a right. The admin path
(`POST /issue` from the dashboard) accepts `memberId` as free-text—any
non-empty string the operator chooses—and stores it as-is in
`members.member_id`; it is neither validated against nor converted to the
member-number format. The two coexist: an admin-issued right has whatever id
the operator typed, a self-serve right has a generated member number.
`POST /issuers/:handle/issue` is the route that generates them: the generator
and validator are `generateMemberNumber` / `isMemberNumber` in `@fuda/sdk`,
and `formatMemberNumber` renders the `4-4-5` display form on passes. The
number is stored in `members.member_id`. Uniqueness is scoped to the **issuer**
— a partial unique index on `(issuer_id, member_id)`, with `members.issuer_id`
denormalized from the card because SQLite cannot constrain across the join —
because the number is a label under the issuer. Two cards of one venue
therefore never mint the same number, and a member who claims both holds two
unrelated numbers, exactly as a `private + loyalty` member does.

A card's slug (`fuda.sh/@<handle>/<slug>`) is a product path and never an ENS
label: the hierarchy stays `<member-no>.<issuer>.fuda.eth` with no card level.

## Hybrid resolution

Member address answers keep their existing destination semantics:

| Right | Member `addr()` result |
| --- | --- |
| `standard` (Bearer) | the right's stable claimable smart-account address, unchanged by later Activation |
| `standard` (Signed) | the same stable Holder address |
| `private` / U3 access | a fresh one-time stealth address on every query |

A +Private name is therefore usable as a destination without exposing a
stable address or creating a durable onchain link to the member. The member
label itself is random and reveals nothing about the person.

`FudaResolver` first parses and hashes the complete DNS-wire name, validates a
supported ETH address record's node against that namehash, and locates an exact
or nearest-ancestor claimed issuer marker. When a marker exists, it reads the
issuer's current owner from the User Registry before deciding whether the
query may go offchain.

For legacy `addr(bytes32)`, an empty local answer encodes `address(0)`. For
multicoin `addr(bytes32,uint256)` with coin type 60, it encodes `bytes("")`.
Selectors eligible for offchain handling emit `OffchainLookup`; the gateway
still decides which record types it supports. The current gateway answers the
two ETH address forms.

| Issuer state | Exact issuer ETH `addr` | Other exact issuer records | Member ETH `addr` | Other member records |
| --- | --- | --- | --- | --- |
| Never claimed | signed gateway answer | gateway | signed gateway answer | gateway |
| Claimed and active | current User Registry owner, onchain | gateway after the onchain owner read | gateway after the onchain parent-owner read | gateway after the onchain parent-owner read |
| Claimed then expired or unregistered | selector-specific zero/empty local result | local `InactiveIssuer` revert | selector-specific zero/empty local result | local `InactiveIssuer` revert |
| Validly re-registered | new current User Registry owner, onchain | gateway after the onchain owner read | gateway after the onchain parent-owner read | gateway after the onchain parent-owner read |

The active boundary is exclusive: the User Registry masks the owner when
`block.timestamp >= expiry`. A registry read failure propagates and never
falls back to D1. Malformed DNS names and address record/namehash mismatches
fail before a registry read or gateway request.

### Append-only claim marker

The resolver stores an append-only mapping from each full claimed issuer
namehash to its User Registry label hash. Only the configured registrar may
mark a label. The marker deliberately survives expiry and unregister.

This creates the **no-offchain-resurrection invariant**: once an issuer label
has been claimed, neither its exact name nor any member descendant may fall
back to stale offchain data while that claimed namespace is inactive. It stays
dark until a valid re-registration makes the User Registry return a nonzero
owner again.

### Signed gateway transport

For queries that hybrid routing finds eligible for offchain resolution, the
CCIP-Read exchange is:

```mermaid
sequenceDiagram
    participant Client as ENS client
    participant Resolver as FudaResolver<br/>packages/ens-contracts
    participant Gateway as POST /ens/gateway<br/>apps/api
    participant DB as D1 naming data

    Client->>Resolver: resolve(name, record)
    Resolver->>Resolver: Parse name and check<br/>claim marker + registry
    Resolver-->>Client: OffchainLookup only when<br/>currently gateway-eligible

    Client->>Gateway: sender + original request
    Gateway->>DB: Look up ENS name
    DB-->>Gateway: Stable address or one-time stealth allocation
    Gateway->>Gateway: Sign resolver + expiry<br/>+ request + result
    Gateway-->>Client: Signed response envelope

    Client->>Resolver: resolveWithProof(response)
    Resolver->>Resolver: Verify target, expiry,<br/>signer, request, and result
    Resolver->>Resolver: Re-run the exact request;<br/>require the current exact OffchainLookup
    Resolver-->>Client: Verified result
```

`POST /ens/gateway` accepts `{"sender":"0x…","data":"0x…"}`. `sender` must
match a configured resolver address, case-insensitively, and `data` must encode
the complete ENSIP-10 `resolve(bytes,bytes)` call. Unsupported senders or names
answer 404, malformed requests answer 400, incomplete configuration answers
503, and unexpected failures answer 500. Success is `{"data":"0x…"}`; every
error is `{"message":"…"}`. All responses use `Cache-Control: no-store`.

The endpoint is public and does not use `ADMIN_TOKEN`. It uses one fixed hourly
D1 counter that admits 120 requests per client IP and requires
`CF-Connecting-IP`. The resolver allowlist prevents the service from signing
responses for arbitrary verifier contracts.

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
expiry. The callback binds the signature to the resolver, request, result, and
expiry; rejects expired, malformed, invalid-recovery-id, high-s, and
wrong-signer responses; then re-executes the exact signed request against the
resolver. It returns the signed result only if the request still produces the
current exact `OffchainLookup` envelope. Local routing, an inactive issuer,
registry failure, malformed input, or any other outcome fails closed with a
callback-state error. Onchain issuer answers never enter this callback and
require no gateway signature.

The endpoint requires all four bindings before it resolves anything:

| Binding | Kind | Meaning |
| --- | --- | --- |
| `ENS_PARENT_NAME` | plain binding | canonical two-label parent, `fuda.eth` |
| `ENS_RESOLVER_ADDRESSES` | plain binding | comma-separated allowlist of deployed resolver addresses |
| `ENS_GATEWAY_SIGNER_KEY` | Worker secret | 32-byte ECDSA private key for response signatures |
| `ENS_GATEWAY_SECRET` | Worker secret | separate 32-byte HMAC key for +Private derivation |

The gateway signer, voucher signer, allocation key, parent owner, and EAS
issuer key are separate roles and must not reuse keys.

### +Private member resolution

- A +Private lookup derives a fresh ERC-5564 stealth address from the member's
  stealth meta-address and a deterministic per-name nonce. The counter and
  derived `(stealthAddress, ephemeralPublicKey, viewTag)` are persisted only
  after the request and both gateway secrets validate. Private answers are
  never cached.
- A lookup is never announced. An ERC-5564 announcement marks an onchain use,
  not the creation of an address. Announcing lookups would reveal query volume
  and inflate the member's scan set.
- fuda announces when it issues a right to a resolved name; an ERC-5564-aware
  sender announces its own transfer. A watcher may announce a previously
  resolved address after observing activity there.
- Members discover rights by scanning announcements with their passkey-derived
  viewing key. The name adds no second discovery path.

## Issuer claim and renewal

`FudaSubnameRegistrar` is the sole issuer-name claim and renewal module.
`ClaimVoucher` and `RenewVoucher` are separate EIP-712 primary types, so one
action's signature cannot authorize the other, but they use the same fields:

```text
bytes32 labelHash
address issuer
uint64 expiry
uint256 nonce
uint64 deadline
```

The domain is exact:

```text
name              = FudaSubnameRegistrar
version           = 1
chainId           = 11155111
verifyingContract = deployed registrar address
```

For both actions the sender is unconstrained: the voucher signature is the
whole authorization. A venue owner holds no gas on Ethereum Sepolia, so the
claim is submitted by the owner's own wallet under a sponsored transaction, or
relayed by fuda; whoever sends it, the name lands on the signed `issuer` and
the nonce it spends is that issuer's, so front-running a voucher gains
nothing. The registrar requires the signed label hash to
match the canonical label, the per-issuer nonce to equal the next stored
nonce, `block.timestamp <= deadline`, `block.timestamp < expiry`, and a
canonical 65-byte low-s ECDSA signature from the current voucher signer. It
consumes the nonce before external registry calls; a reverted transaction
rolls the nonce and all registry/marker effects back.

`expiry` is the registry's absolute, exclusive upper bound. The typed-data
helper converts fuda's inclusive validity: the earliest nonzero finite bound
`t` becomes `t + 1`; all-zero/unbounded bounds become `type(uint64).max`; and
a finite `type(uint64).max` bound is rejected. Claim writes exactly
`owner = issuer`, `subregistry = address(0)`, the shared resolver, and child
role bitmap exactly `0`. The zero bitmap makes claimed issuer entries
non-transferable and prevents the issuer from redirecting resolver or registry
settings.

Renew requires the active User Registry owner to equal the issuer and cannot
reduce expiry. An expired or unregistered label is re-registered with a fresh
claim voucher instead of renewed. Signer rotation is owner-only, and the
registrar exposes no unregister operation or role-granting surface.

The registrar receives only root `REGISTRAR | RENEW`. It holds no
`UNREGISTER` role and exposes no operation that would use one, so claim power
does not imply revocation power.

### Root role custody

`UNREGISTER` is not unowned. The User Registry is initialized with the parent
owner as its root principal, and that principal holds:

| Power | Form | Meaning |
| --- | --- | --- |
| `SET_PARENT` | held directly | `setParent(address,string)` — repoint the registry's parent |
| `UPGRADE` | held directly, and its admin bit | the registry proxy's upgrade role |
| `REGISTRAR`, `RENEW`, `UNREGISTER` | admin bit only | `grantRootRoles` may assign them to any address |

The parent owner therefore does not itself unregister an issuer entry. It can
give itself that power: `grantRootRoles` assigns `UNREGISTER` to any account,
its own included. What the repository verifies stops there — the pinned
minimal ABI surface has no unregister call, and the matching
`ensdomains/contracts-v2` source is unpublished, so the steps after the grant
are the deployment's, not this repository's. The guarantee is the separation
of roles, not an absence of custody. fuda holds the root of its own issuer
namespace, and
[ADR 0007](../adr/0007-root-custody-of-the-issuer-registry.md) records why.

The exact root bitmap is asserted at deployment and re-checked by the
standalone verifier, so a drift in root custody fails topology verification
rather than passing silently.

## Remaining lifecycle integration

The intended lifecycle remains evidence-driven, but the B1 seams are not yet
shipped:

```text
confirmed right or delegation evidence -> naming mirror write -> resolvable name
revoked or expired evidence             -> mirror/lifecycle update -> dark name
```

B1 must supply authenticated voucher issuance from a real active
`IssuerDelegation`, issuer onboarding and confirmed member mirror writes, and
revoke lifecycle integration for the mirror. Until those exist, normal
application flows do not populate the gateway mirror or mutate claimed issuer
state.

Revoking an issuer's delegation does not take its claimed name dark. The name
keeps resolving to the issuer's wallet, and its member descendants keep
resolving, until the registry expiry passes. This is deliberate and is not a
missing B1 seam: a name is a destination, the delegation check is a separate
fact every surface performs, and tying revocation to an onchain unregister
would require handing revocation power to a live principal. Member answers do
go dark on revocation, because they come from the mirror.

Bearer-to-Signed Activation changes the claimable account's owners, not its
address, so the member name, right, and history remain unchanged.

## Invariants

- **Not authority.** A resolving name never makes an issuer legitimate or a
  right valid. Surfaces show the name and the delegation/right check as
  separate facts and fall back to the raw address when resolution fails.
- **Revocation does not dark a claimed name.** A revoked delegation leaves the
  issuer's claimed name resolving until expiry. The mirror-backed member
  answers are the only ones a revocation can stop.
- **Not in the Gate path.** Admission never waits on ENS. Member names are
  never shown at the Gate, written to Entry logs, or included in
  announcements.
- **No offchain resurrection.** Once claimed, an inactive issuer namespace
  cannot fall back to stale gateway data.
- **No self-identifying labels.** Labels are Issuer Handles or random member
  numbers. No email, member database id, attestation UID, or proof material is
  published in an ENS record.
- **No stable address for +Private.** A +Private name must never resolve to the
  same address twice or to any address that appears elsewhere with the member.
- **Two numbers in `private + loyalty`.** The access and loyalty rights carry
  unrelated member numbers, so names do not link them.
- **Offchain member layer.** Members never own subnames; only issuer labels are
  User Registry entries.

## Related specs

- [Architecture overview](../architecture.md)
- [Attestation model](./attestation-model.md)
- [Pass types and flows](./pass-types-and-flows.md)
