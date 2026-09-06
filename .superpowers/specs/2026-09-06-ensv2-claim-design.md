# ENSv2 issuer claim and hybrid resolution design

**Status:** approved in chat on 2026-09-06; awaiting written-spec review

**Scope:** B1-independent ENSv2 claim contracts, hybrid resolution, and
hackathon deployment tooling

**Deployment:** dedicated ETHOnline 2026 ENSv2 deployment on Ethereum Sepolia
(`chainId = 11155111`)

## Context

The repository already has the B1-independent offchain naming foundation:

- canonical issuer and member names;
- the `ens_names` mirror and private-resolution ledger;
- a signed `POST /ens/gateway` CCIP-Read endpoint; and
- a dependency-free ENSIP-10 `FudaResolver` that sends every supported query
  to that gateway.

The remaining B1-independent work is the onchain issuer-name claim path and
the tooling needed to deploy it against the dedicated ETHOnline ENSv2
namespace. The current resolver alone is insufficient: after an issuer claims
its name, the issuer address must come from ENSv2 state without consulting the
gateway, while member names below that issuer must remain offchain and private
names must keep rotating.

The trusted deployment authority is the ENS-dev-provided address table in ENS
docs commit `825aca8a882b56557607fde7dc477bc9ca68e06d`. ENS did not publish a
matching `contracts-v2` source ref. The missing ref is a documented
reproducibility limitation, not an implementation blocker: fuda pins the
address namespace and runtime code hashes, defines only the ABI interface it
uses, simulates writes, and verifies real receipt events. The full deployment
research is in
`.superpowers/research/2026-09-06-ensv2-hackathon.md`.

## Decisions

1. The dedicated ETHOnline deployment is one indivisible namespace. Code must
   never combine its registries with normal Sepolia's Universal Resolver.
2. Issuer labels are ENSv2 `UserRegistry` entries owned by the issuer wallet.
   Member labels are never registry entries.
3. One hybrid `FudaResolver` serves both the parent and claimed issuer names.
   It resolves an active claimed issuer's ETH address from the `UserRegistry`
   and sends eligible descendant/member queries to the existing gateway.
4. A label that has ever been claimed never falls back to its old offchain
   issuer answer after unregister or expiry. Its entire claimed namespace is
   dark until it is validly registered again.
5. A custom `FudaSubnameRegistrar` is the only contract allowed to create and
   renew issuer entries. It accepts single-use EIP-712 vouchers from fuda and
   requires the issuer wallet itself to submit them.
6. Claimed issuer tokens are deliberately non-transferable and cannot change
   their resolver or attach a child registry. Their registration role bitmap
   is exactly zero.
7. Revocation authority stays separate from claim authority. The registrar
   receives root `REGISTRAR | RENEW`; the later lifecycle operator or sentinel
   receives only root `UNREGISTER`.
8. Live transactions and the `fuda.sh` DNS mutation are operational gates.
   The repository supplies validated tooling and instructions but does not
   send them without the required keys and explicit authorization.

## Deployment namespace

The committed manifest contains the complete dedicated address family and
identifies these critical entries by role:

| Role | Address |
| --- | --- |
| Universal Resolver client entrypoint | `0xd26f2040d083af1cd2962ba303f4bea0c4faf142` |
| `ETHRegistrar` | `0x7d1b7f586a62ac3f54b9a396849757814283270b` |
| `ETHRegistry` | `0x1d78834d97c1d7b1a38c1dedbd1a287cfed3971e` |
| `RootRegistry` | `0xe7f0d5724f8337e3aa9a9910540341ff4273fed9` |
| `VerifiableFactory` | `0x894bc9cc8ff1ad96b8a288c86a8c71d662c07780` |
| `UserRegistryImpl` | `0x47b442d0cf617c41cabaff5f02f44dd1e5f72546` |
| `MockUSDC` | `0xcbfd80f74375c54e545af34788ff465f96f66f05` |
| `DNSAliasResolver` | `0x005a3bf1d92ebe4b1e1641a0c6fa49f38e1762a6` |

The manifest also stores a runtime-code-hash baseline for every address used by
write tooling. Preflight fails on the wrong chain, empty code, a changed hash,
an address from the normal Sepolia family, or a failed read-call probe.
Application clients override Sepolia's built-in ENS Universal Resolver with
the dedicated `0xd26f...` proxy.

## Onchain topology and roles

```text
RootRegistry
└── ETHRegistry
    └── fuda.eth
        ├── resolver    -> FudaResolver
        └── subregistry -> fuda UserRegistry proxy
            └── <issuer>
                ├── owner    -> issuer wallet
                ├── resolver -> the same FudaResolver
                ├── expiry   -> IssuerDelegation validity bound
                └── roles    -> 0 (non-transferable, no mutation powers)
```

The User Registry initializer grants the parent/setup account the minimum
root capabilities needed to finish and administer the topology:

- regular `SET_PARENT` for the one-time canonical-parent call;
- `REGISTRAR_ADMIN`, `RENEW_ADMIN`, and `UNREGISTER_ADMIN` so operational
  roles can be granted or revoked;
- `UPGRADE` and `UPGRADE_ADMIN` for the beta User Registry proxy; and
- no runtime operational role that a separate contract or account owns after
  setup unless it is needed for recovery.

After initialization:

- `FudaSubnameRegistrar` receives root `REGISTRAR | RENEW`;
- the lifecycle account is not provisioned until B1 supplies the revoke path;
- the future sentinel receives root `UNREGISTER` only; and
- neither runtime principal receives an admin counterpart.

The parent owner retains the admin roles because it is the recovery and role
rotation seam. It is not the EAS issuer key, gateway signer, voucher signer, or
stealth-allocation key.

## `FudaSubnameRegistrar`

### Interface

The public mutation interface is intentionally small:

```solidity
function claim(
    string calldata label,
    address issuer,
    uint64 expiry,
    uint256 nonce,
    uint64 deadline,
    bytes calldata signature
) external returns (uint256 tokenId);

function renew(
    string calldata label,
    address issuer,
    uint64 expiry,
    uint256 nonce,
    uint64 deadline,
    bytes calldata signature
) external;

function setVoucherSigner(address nextSigner) external;
function nonces(address issuer) external view returns (uint256);
```

The constructor fixes the User Registry, hybrid resolver, voucher signer,
parent node, and immutable administrative owner. Zero addresses are rejected,
and deployment reverts unless `block.chainid == 11155111`. The owner can rotate
the voucher signer but cannot transfer the registrar administration role.

Successful mutations emit a small registrar-level interface in addition to the
underlying User Registry events:

```solidity
event IssuerClaimed(
    bytes32 indexed labelHash,
    address indexed issuer,
    uint256 indexed tokenId,
    uint64 expiry,
    uint256 nonce
);
event IssuerRenewed(
    bytes32 indexed labelHash,
    address indexed issuer,
    uint64 expiry,
    uint256 nonce
);
event VoucherSignerUpdated(address indexed previousSigner, address indexed nextSigner);
```

### Voucher contract

Claim and renewal use separate type hashes so a signature for one action can
never authorize the other:

```text
ClaimVoucher(
  bytes32 labelHash,
  address issuer,
  uint64 expiry,
  uint256 nonce,
  uint64 deadline
)

RenewVoucher(
  bytes32 labelHash,
  address issuer,
  uint64 expiry,
  uint256 nonce,
  uint64 deadline
)
```

The EIP-712 domain is:

```text
name              = FudaSubnameRegistrar
version           = 1
chainId           = 11155111
verifyingContract = deployed registrar address
```

For both actions the contract requires:

- `msg.sender == issuer`;
- `keccak256(bytes(label))` equals the signed `labelHash`;
- the label is 1–63 bytes of lowercase ASCII `[a-z0-9-]`, with neither a
  leading nor trailing hyphen;
- `block.timestamp <= deadline` and `block.timestamp < expiry`;
- `nonce == nonces[issuer]`, incremented before external calls; and
- a canonical low-s 65-byte ECDSA signature from the current voucher signer.

The signed `expiry` is the User Registry's exclusive upper bound. The later B1
adapter converts fuda's inclusive validity semantics before signing: a finite
inclusive upper bound `t` becomes `t + 1`, while the source value `0` meaning
unbounded becomes `type(uint64).max`. If multiple delegation bounds apply, the
helper ignores their zero values and converts the earliest finite one. A finite
bound at `type(uint64).max` is rejected rather than overflowed or confused with
the unbounded sentinel. This preserves fuda's `now <= t` rule even though
ENSv2 masks a name when `block.timestamp >= expiry`; the registrar itself only
enforces the already-converted signed value.

`claim` registers the label with `owner = issuer`, no child registry, the
hybrid resolver, role bitmap zero, and the voucher's absolute expiry. It then
marks the issuer label in the resolver. Both calls occur in one transaction;
any failure rolls back the registration, resolver marker, and nonce.

`renew` additionally requires that `UserRegistry.getOwner(uint256(labelHash))`
equals the issuer. It calls registry `renew(uint256(labelHash), expiry)`, where
expiry is absolute and cannot reduce the current value. Because `getOwner`
returns zero at `block.timestamp >= currentExpiry`, an expired or unregistered
label uses `claim` to re-register rather than `renew` to revive its old token.
A new voucher and nonce are required for every renewal.

Voucher-signer rotation is owner-only, rejects the zero address, and
invalidates outstanding vouchers from the old signer. The registrar has no
unregister method and cannot grant roles.

## Hybrid `FudaResolver`

### Responsibilities

The resolver owns exactly three concerns:

1. return the onchain owner for supported address queries on an active claimed
   issuer name;
2. fail closed for a claimed issuer namespace after unregister or expiry; and
3. preserve the existing signed CCIP-Read path for unclaimed issuer names and
   eligible member names.

It does not store issuer target addresses, member records, delegation facts,
or private keys. The User Registry remains authoritative for claimed issuer
ownership and expiry; D1 remains authoritative for offchain/member answers.

### Claim marker

The resolver stores an append-only mapping from the full issuer namehash to the
User Registry labelhash. `markIssuer(label)` is callable only by the configured
registrar. It computes:

```text
labelHash = keccak256(bytes(label))
issuerNode = keccak256(parentNode || labelHash)
```

The marker deliberately survives unregister and expiry. Without it, an old D1
issuer row could become visible again as soon as the registry masks its owner
and resolver. A valid re-registration reuses the marker and becomes live again
when the registry returns a nonzero owner.

The resolver is deployed before the registrar, so `setRegistrar(address)` is a
one-time owner-only wiring call. It rejects zero and cannot replace an already
configured registrar.

### Resolution algorithm

For every call, the resolver validates the DNS-wire name and computes its
namehash. It determines the marked-issuer state before deciding whether a
selector can go offchain. For legacy `addr(bytes32)` and multicoin
`addr(bytes32,uint256)` with coin type 60, the record node must equal that
namehash.

```text
resolve(dnsName, record)
  parse and hash dnsName
  classify the record selector
  validate the record node if it is a supported ETH address selector
  locate an exact or nearest-ancestor marked issuer
  read that issuer's current owner when a marker exists

  if a marked issuer exists and its current owner is zero
    return selector-specific empty result  for a supported ETH address record
    revert InactiveIssuer                 for every other selector

  if full node is a marked issuer
    return encoded current owner          for a supported ETH address record
    revert OffchainLookup                 otherwise

  if name is below a marked issuer
    revert OffchainLookup

  revert OffchainLookup
```

The descendant check walks suffix nodes while decoding the DNS name. It can
therefore recognize the marked `issuer.fuda.eth` parent of
`member.issuer.fuda.eth` without storing member nodes. Malformed labels,
compression pointers, missing root terminators, extra bytes, labels over 63
bytes, and names over the DNS limit are rejected before any registry call or
gateway request.

For a marked issuer, a registry call failure propagates rather than falling
back offchain. `getOwner` defines the active boundary: it returns zero at and
after the stored expiry (`block.timestamp >= expiry`). Empty legacy address
answers encode `address(0)`; empty coin-type-60 answers encode `bytes("")`.
The exact active issuer path answers only those two ETH address record forms
locally. Other selectors use the gateway only while the marked issuer is
active and remain subject to its explicit unsupported-record response. An
inactive marked namespace never emits `OffchainLookup`, including for an
unsupported selector, so future gateway expansion cannot resurrect it.

### Result behavior

| Name state | Exact issuer `addr` | Member `addr` |
| --- | --- | --- |
| Never claimed | signed gateway answer | signed gateway answer |
| Claimed and active | User Registry owner, onchain | gateway, after onchain parent check |
| Claimed then expired/unregistered | zero/empty result | zero/empty result |
| Validly re-registered | new current registry owner | gateway, after onchain parent check |

The resolver keeps its existing gateway URL rotation, signer rotation, signed
response envelope, expiry checks, target binding, and low-s signature checks.
Local onchain answers never enter `resolveWithProof` and need no gateway
signature.

## Package seam and interface

`packages/ens-contracts` becomes the protocol module shared by deployment
tooling and the later API adapter. Its interface exports:

- the dedicated deployment manifest and minimal ABIs;
- claim/renew typed-data builders and types;
- the inclusive-validity to exclusive-registry-expiry conversion helper;
- the expected chain and Universal Resolver override; and
- contract artifacts produced from fuda's own Solidity sources.

The package does not export ENS's complete beta ABIs. This limits the interface
affected by unpublished upstream drift.

The B1-independent change includes the typed-data builder and cross-language
vectors, but it does not expose `POST /ens/claim-voucher` yet. That route must
check the real active `IssuerDelegation`, authenticated issuer wallet, D1
claim state, and delegation validity window from B1. Adding a route that signs
without those facts would violate the product trust invariant.

Likewise, the change does not synthesize issuer/member rows from guessed B1
tables. Existing lookup and allocation behavior stays intact until B1's
onboarding, confirmed issuance, and revoke seams are available.

## Deployment tooling

The package supplies explicit, non-interactive scripts with no default private
key or silent network fallback:

1. **Preflight** validates chain ID, the dedicated address family, committed
   runtime code hashes, Universal Resolver override, read selectors, parent
   availability, and configured account addresses.
2. **Parent commit** mints/approves test USDC as needed and submits the exact
   commitment for `fuda`. The secret is supplied through an environment
   variable and is never written to disk or printed.
3. **Parent reveal** refuses to run before `MIN_COMMITMENT_AGE`, re-simulates
   the exact registration, and registers `fuda.eth` with the setup account.
4. **Topology deploy** creates the User Registry proxy through
   `VerifiableFactory`, calls its canonical parent setup, deploys the resolver
   with that registry, deploys the registrar with that registry and resolver,
   completes the resolver's one-time registrar wiring, attaches the registry
   to `fuda.eth`, configures the same resolver on the parent, and grants the
   registrar its root roles. Each dependency therefore exists before the next
   contract constructor or wiring call consumes its address.
5. **Verify** reads every resulting pointer, role, owner, expiry, interface,
   and event receipt. It prints public addresses and transaction hashes only.

Each mutating script simulates its transaction immediately before sending,
waits for a successful receipt, validates the expected event, and aborts on the
first mismatch. Re-running a completed step verifies and reports it rather than
blindly sending a duplicate transaction. Nothing uses the normal Sepolia ENS
proxy implicitly.

The tooling reads these secrets only when their step needs them:

| Input | Purpose |
| --- | --- |
| `ENS_RPC_URL` | dedicated Sepolia RPC transport |
| `ENS_PARENT_KEY` | parent registration and one-time topology administration |
| `ENS_COMMITMENT_SECRET` | commit/reveal binding; distinct random 32-byte value |
| `ENS_VOUCHER_KEY` | API voucher signatures; not used for topology ownership |
| `ENS_GATEWAY_SIGNER_KEY` | resolver-response signatures |

The stealth-allocation key remains an API-only secret and is never passed to
deployment tooling.

## DNS display alias

The accepted dedicated deployment provides `DNSAliasResolver` at
`0x005a3bf1d92ebe4b1e1641a0c6fa49f38e1762a6`. With DNSSEC enabled, the zone
record is:

```dns
fuda.sh. TXT "ENS1 0x005a3bf1d92ebe4b1e1641a0c6fa49f38e1762a6 sh eth"
```

It rewrites the whole suffix:

- `fuda.sh` to `fuda.eth`;
- `<issuer>.fuda.sh` to `<issuer>.fuda.eth`; and
- `<member>.<issuer>.fuda.sh` to `<member>.<issuer>.fuda.eth`.

The record is a DNSSEC-authorized routing statement, not an onchain claim and
not a protocol restriction that prevents the zone owner from changing the
target. The live change and scratch resolution check require control of the
Cloudflare DNS zone and are not performed by repository tests.

## Failure handling and security properties

- A name is never authority. Neither the registrar nor resolver can make an
  invalid EAS delegation valid.
- Claim, renewal, resolver marking, and registry mutation fail atomically.
- Voucher replay, cross-chain replay, cross-contract replay, cross-action use,
  wrong-wallet submission, stale submission, and signature malleability are
  rejected.
- Claimed-name expiry and unregister fail closed. A stale D1 row cannot revive
  the exact issuer name or its descendants.
- Registry read failures do not trigger offchain fallback.
- Issuer tokens omit transfer authority and every settings role. The issuer
  cannot redirect its fuda name after claiming it.
- Claim/renew and unregister are separate principals. Compromise of the voucher
  signer does not grant parent ownership or revocation administration.
- Gateway and voucher signatures use different domain constructions and
  different keys.
- The resolver allowlist continues to bind gateway signatures to deployed fuda
  resolver addresses.
- ENS remains outside the Gate and Entry decision path. Any ENS outage affects
  display/destination lookup, never admission.

Naming failures never roll back EAS-side issuance or revocation. Once B1 lands,
the mirror records a failed ENS operation for retry; the EAS fact remains the
source of truth.

## Verification strategy

### Solidity unit and integration tests

- exact issuer resolution before claim, while claimed, at exact expiry, after
  expiry, after unregister, and after re-registration;
- active member resolution still emits the exact `OffchainLookup` envelope;
- supported member address resolution under an inactive claimed issuer returns
  empty locally;
- unsupported selectors under an inactive claimed issuer revert locally and
  never emit `OffchainLookup`;
- malformed DNS names and record/namehash mismatches fail before lookup;
- legacy and coin-type-60 result encoding; unsupported records remain offchain;
- registrar one-time wiring and unauthorized marker rejection;
- valid self-claim and renewal with exact registry arguments;
- wrong signer, caller, label, action, chain, contract, nonce, deadline, expiry,
  high-s signature, malformed signature, replay, and reduced renewal expiry;
- registration and marker atomicity;
- zero issuer role bitmap and failed ERC-1155 transfer;
- root-role separation for registrar and unregister operator; and
- all existing EIP-3668 response-verification and TypeScript conformance tests.

### TypeScript tests

- address manifest completeness, uniqueness, chain ID, code-hash parsing, and
  rejection of normal Sepolia addresses;
- exact claim/renew EIP-712 payloads, signatures, nonce handling, and Solidity
  digest vectors;
- inclusive fuda validity-to-exclusive registry-expiry conversion, including
  finite and unbounded bounds;
- Universal Resolver chain override;
- preflight read failures and simulated-write failures are actionable and do
  not send transactions; and
- deployment verification catches wrong pointers, roles, owners, and events.

### Repository and live gates

- focused Solidity and TypeScript suites;
- the serialized API suite used for the known Cloudflare pool shutdown issue;
- all other workspace tests;
- `pnpm check`, `pnpm format:check`, and a frozen install;
- read-only Sepolia preflight against the dedicated namespace; and
- after credentials are supplied: successful commit/reveal, topology receipts,
  live `.eth` resolution, non-transferability, unregister darkness, member
  wildcard resolution, and DNS alias resolution.

## Canonical documentation after implementation

`docs/specs/ens-naming.md` will be updated to describe the shipped hybrid
resolution states, dedicated deployment selection, EIP-712 claim contract,
role separation, and the remaining B1/live boundaries. It will no longer say
that a matching `contracts-v2` source commit exists or that every issuer query
uses the gateway.

An ADR will record why fuda uses one hybrid resolver instead of the stock
Permissioned Resolver or a resolver per issuer, and why an append-only claim
marker prevents offchain resurrection. The completed temporary design and
implementation plan will be deleted after the code, tests, and canonical docs
are verified.

## Alternatives rejected

### Stock Permissioned Resolver for claimed issuers

It can store the issuer address onchain, but its documented interface does not
provide fuda's signed rotating gateway. Because Universal Resolver selects the
deepest resolver, member names below a claimed issuer would stop reaching the
parent wildcard resolver.

### One resolver instance per issuer

It can combine an onchain issuer record and wildcard gateway, but adds one
deployment and configuration lifecycle per claim. A shared resolver can read
the authoritative User Registry directly and has one signer/URL rotation seam.

### Parent-only offchain resolver after claim

It preserves member resolution but continues serving the issuer address from
D1. The claim would become cosmetic and fail the requirement that the claimed
issuer entry and expiry control resolution onchain.

### Normal tagged Sepolia deployment

It has a reproducible source tag, but it is a different address namespace,
uses another Universal Resolver entrypoint, and lacks the dedicated DNS suite.
Mixing it with the ENS-dev-provided hackathon deployment would be invalid.

## Completion scope

This design is complete when all B1-independent contracts, shared typed data,
manifest, deployment/preflight tooling, tests, ADR, and canonical documentation
are implemented and verified. The following remain explicitly gated rather
than simulated:

- issuer-onboarding writes and `POST /ens/claim-voucher` until B1 provides the
  real delegation and authentication seams;
- issuer/member lifecycle adapters until B1 provides confirmed issuance and
  revoke hooks;
- sentinel identity and retry execution until c1's sentinel exists; and
- live Sepolia transactions and Cloudflare DNS changes until their credentials
  and explicit mutation authorization are provided.
