# ENSv2 ETHOnline 2026 deployment research

**Researched:** 2026-09-06

**Network:** Ethereum Sepolia (`chainId = 11155111`)

**Purpose:** Resolve the deployment, ABI, registry-role, resolver, and DNS-alias questions that affect fuda's ENS integration.

## Executive conclusion

The dedicated ETHOnline deployment exists on Sepolia and its addresses are documented by ENS, but it does **not** have a published `contracts-v2` source ref or artifact set. The only ENS document that explicitly identifies the dedicated deployment is unmerged docs commit [`825aca8a882b56557607fde7dc477bc9ca68e06d`](https://github.com/ensdomains/docs/commit/825aca8a882b56557607fde7dc477bc9ca68e06d) on `feature/permres-inode-refactor`. Its deployment generator says, verbatim in source, that the 2026-09-03 hackathon deployment has no `contracts-v2` ref and therefore no ABI/source links ([pinned source](https://github.com/ensdomains/docs/blob/825aca8a882b56557607fde7dc477bc9ca68e06d/scripts/ensv2-deployments.ts#L84-L89)).

That creates a documented reproducibility limitation, not a blocker to implementation: an exact, auditable upstream Solidity/ABI pin for the hackathon contracts cannot be supplied from official published material. The `97a5729...` commit visible earlier in the same docs script belongs to the normal Sepolia deployment fetch path, which the hackathon override bypasses. It must not be presented as the hackathon source.

The user has accepted the ENS-dev-provided docs commit/address table as the authoritative hackathon address source. The practical path is therefore:

1. Use the dedicated addresses below as a single namespace, including the hackathon Universal Resolver proxy override.
2. Use the official hackathon docs' interface snippets as minimal ABIs and preflight every selector against Sepolia. This is sufficient to proceed with the trusted addresses, but it is not an exact upstream source pin.
3. Ask ENS for the exact `contracts-v2` SHA plus generated deployment artifacts if reproducible upstream source/ABI provenance is required.
4. Keep fuda's custom ENSIP-10/CCIP-Read resolver. The protocol `PermissionedResolverImpl` is an on-chain record resolver; neither the last tagged source nor the newer ENS docs expose a configurable CCIP-Read gateway/signing interface for arbitrary rotating answers.
5. Publish the DNSSEC TXT record `ENS1 0x005a3bf1d92ebe4b1e1641a0c6fa49f38e1762a6 sh eth` at `fuda.sh`. This maps the whole suffix (`fuda.sh` to `fuda.eth`, `x.fuda.sh` to `x.fuda.eth`) but does not cryptographically constrain the destination to `fuda.eth`; DNS control and DNSSEC are the trust boundary.

This design is aligned with the ETHOnline prize: ENSv2 must be central, functional, on Sepolia, and not a hard-coded cosmetic display. The prize text specifically calls out hierarchical registries, wildcard resolution, subname registries, EAC, expiring/revocable/non-transferable names, record/namespace aliasing, and working demos ([ETHOnline prizes](https://ethglobal.com/events/ethonline2026/prizes)).

## 1. Which official material applies

### Deployment sources conflict unless they are treated as separate namespaces

There are two different Sepolia deployments in official ENS material:

| Source | What it shows | Correct use |
| --- | --- | --- |
| [Live deployment page](https://docs.ens.domains/learn/deployments/) and `contracts-v2` tag [`sepolia-deployment-2026-07-31`](https://github.com/ensdomains/contracts-v2/tree/a399be8e8bcff572a56613c66aca7d4528437665/contracts/deployments/sepolia) | Normal ENSv2 Beta deployment. Universal Resolver proxy is `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`; its other addresses differ from the hackathon set. | Normal Sepolia ENSv2 applications. Do not mix with dedicated hackathon addresses. |
| ENS docs commit [`825aca8...`](https://github.com/ensdomains/docs/blob/825aca8a882b56557607fde7dc477bc9ca68e06d/src/pages/learn/deployments.mdx#L43-L92) | Dedicated **ETHOnline 2026** deployment and required client override to `0xd26f...`. | The only official source that explicitly says to build the hackathon project against a dedicated namespace. |

As of this research date, `825aca8...` is not an ancestor of the ENS docs `master` branch. The live page consequently shows the normal set and contains neither “ETHOnline 2026” nor `0xd26f...`. This does not weaken the user-approved address authority: both hackathon web applications returned HTTP 200 on 2026-09-06, and all sampled addresses below returned deployed code on Sepolia. It does mean fuda must document the selection as an explicit hackathon-only namespace so a future maintainer does not replace it with the normal live-page addresses.

- Hackathon ENS App: <https://hackathon-deployment-manager-app-v4.ens-cf.workers.dev/>
- Hackathon ENS Explorer: <https://hackathon-deployment-portal-app.ens-cf.workers.dev/>

### The apparent source pin is not the hackathon pin

The docs generator declares `CONTRACTS_V2_COMMIT = 97a57293f3b4279d94b571e678edb53ce62638f4` for the normal generated table ([source](https://github.com/ensdomains/docs/blob/825aca8a882b56557607fde7dc477bc9ca68e06d/scripts/ensv2-deployments.ts#L7-L18)). Later, however, it writes the static `HACKATHON_CONTRACTS` list and returns before that fetch path ([source](https://github.com/ensdomains/docs/blob/825aca8a882b56557607fde7dc477bc9ca68e06d/scripts/ensv2-deployments.ts#L269-L281)). Therefore:

- `97a5729...` is useful for understanding the last normal Sepolia implementation family.
- `97a5729...` is an ancestor of tag commit `a399be8e8bcff572a56613c66aca7d4528437665` (`sepolia-deployment-2026-07-31`).
- The tag's generated address file says it was deployed on 2026-07-30 ([pinned address file](https://github.com/ensdomains/contracts-v2/blob/a399be8e8bcff572a56613c66aca7d4528437665/contracts/docs/addresses/sepolia.md)).
- Those addresses and bytecode do not match the 2026-09-03 hackathon deployment.

### Alignment with `main:docs/references.md`

The repository's reference list is directionally correct, with these qualifications:

| Repository reference | How to use it here |
| --- | --- |
| [ENSv2 overview](https://docs.ens.domains/ensv2/overview) | Architectural background: hierarchical registries, EAC, per-account resolvers. The beta interfaces are explicitly not final. |
| [Permissioned Registry](https://docs.ens.domains/ensv2/permissioned-registry/) | Lifecycle, `anyId`, roles, and non-transferability model. Use the hackathon docs' minimal interface subject to Sepolia simulation/receipt checks. |
| [DNS resolvers](https://docs.ens.domains/ensv2/dns-resolvers) | Authoritative description of DNSSEC TXT dispatch and DNSAlias suffix rewriting. Exact `fuda.sh` record is derived below. |
| [Deployments](https://docs.ens.domains/learn/deployments/) | Currently shows the **normal** Sepolia set, not the dedicated ETHOnline set. Do not copy its current addresses into hackathon config. |
| [Name Wrapper](https://docs.ens.domains/wrappedname) | ENSv1 fallback only. ENSv2 Permissioned Registry replaces the v1 Registry/BaseRegistrar/Name Wrapper split; fuda's v2 design should use roles, not wrapper fuses. |
| [ETHOnline prize page](https://ethglobal.com/events/ethonline2026/prizes) | Product/qualification requirement, not deployment provenance. It requires a functional, central ENSv2 integration on Sepolia and open-source/live-demo evidence. |

## 2. Exact dedicated hackathon addresses

Source: the static `HACKATHON_CONTRACTS` list in ENS docs commit `825aca8...` ([pinned list](https://github.com/ensdomains/docs/blob/825aca8a882b56557607fde7dc477bc9ca68e06d/scripts/ensv2-deployments.ts#L84-L264)). Preserve the contract names because implementation, proxy, helper, and migration addresses are not interchangeable.

| Contract | Address |
| --- | --- |
| `BatchRegistrar` | `0xc8efa80d9f645b26bacd1bae8638492df3bae8ca` |
| `ContractNamer` | `0x21a2b577709727119f1901314e0ba0150eafa15e` |
| `DefaultReverseRegistrarAdapter` | `0x0a8d7ed4061548fb3cb192d0cbe9e1a57b3b1ae9` |
| `DNSAliasResolver` | `0x005a3bf1d92ebe4b1e1641a0c6fa49f38e1762a6` |
| `DNSSECGatewayProvider` | `0xfedb5c2fea17cef8547d534c3125f7601d3e30bd` |
| `DNSTLDResolver` | `0x10107255fda20ab6c37a0efca1e9465f25066a00` |
| `DNSTXTResolver` | `0x0ebc944ac29f91cc24ee507a2d46aa4901bbc748` |
| `ENSV1Resolver` | `0x1f11e5b8bca2ccfe13bd8431853db159c4e9849c` |
| `ENSV2Resolver` | `0xb1b2d8c4d4886d0d567b6a6b8a4b885229fafae4` |
| `ETHRegistrar` | `0x7d1b7f586a62ac3f54b9a396849757814283270b` |
| `ETHRegistry` | `0x1d78834d97c1d7b1a38c1dedbd1a287cfed3971e` |
| `ETHRenewerV1` | `0x47bc0ab8f87db01383255e564cce92956ecc7c70` |
| `Graveyard` | `0x2c29661b216717650ba6d4836b2bd37a0fe19adb` |
| `HCAOwnerAndSessionValidator` | `0xeb099163a41912a94e56b2143feb6eb7979a51f0` |
| `HCAUpgradeSet` | `0xde59f9285edbe391fc32d3cba8909ea047cc0fc3` |
| `LabelStore` | `0xd7351f76866123a7e49381f38a30a96adba7e855` |
| `LockedMigrationController` | `0x7fa65c83dd80cca2fbd91e16a6dc4f66b64efe22` |
| `ManagedUniversalResolverProxy` | `0x1abed09f1f36383f27cf0b3a5e0ea1738e1fd921` |
| `MigrationHelper` | `0x540f222a6fd9a54e77989556f366940d1ad81aec` |
| `MockDAI` | `0x93403a98c3a6be906585cd0d68447c0fc600fb38` |
| `MockRegistrationIntentExecutor` | `0x9675de20abf0216d07e3f5782dd92d0c7d3bb2cb` |
| `MockUSDC` | `0xcbfd80f74375c54e545af34788ff465f96f66f05` |
| `PermissionedResolverImpl` | `0xa9d3814ab151bf6e37a427432795371a8361614e` |
| `PublicResolverSet` | `0x3866e84b54a78d1e3778421e0fbf3607fa9c402f` |
| `PublicResolverV2` | `0xf9de4979ddb290baf5b760d0e788125017bc33f6` |
| `RegistryUpgradeSet` | `0x658c43979721b6d30d173ea09622f2475761b382` |
| `ReverseRegistrarAdapter` | `0x67ee68067c74cb3ab595fb793860f98c8a0283f7` |
| `RootBatchRegistrar` | `0x9b30da91c1a3fb972d5a7d102390598d5ca70376` |
| `RootRegistry` | `0xe7f0d5724f8337e3aa9a9910540341ff4273fed9` |
| `StandaloneHCAFactory` | `0xb85152a8ef4db5caf37af6bffce66b559a9c0b58` |
| `StandaloneHCAImplementation` | `0x7328a1926b45f0339913ab654fb98d1a0f5ec894` |
| `StandardRentPriceOracle` | `0xfeba6589b5c1b35875c0389ccedf83148b6ee71b` |
| `TestnetV1PremigrationRegistrar` | `0x1a8c627dc167bcf6b991e9d6e0a76e2dfab7ee88` |
| `UniversalHelper` | `0x1d4cd7545d456f3b6a7e4380182279afcfa887b6` |
| `UniversalResolverV2` (implementation) | `0xfea8d4b7fcce0b8765c793d6695eac384aaa458f` |
| `UnlockedMigrationController` | `0x97494264ad5437611cc2f43987c21f6f352d786a` |
| `UpgradableUniversalResolverProxy` (client entrypoint) | `0xd26f2040d083af1cd2962ba303f4bea0c4faf142` |
| `UserRegistryImpl` | `0x47b442d0cf617c41cabaff5f02f44dd1e5f72546` |
| `VerifiableFactory` | `0x894bc9cc8ff1ad96b8a288c86a8c71d662c07780` |
| `WrapperRegistryImpl` | `0x7c53b9dcef516662e9e8a229448cac30b90673cd` |

### Mandatory client override

Viem and ethers' built-in Sepolia ENS address does not select this namespace. Override `ensUniversalResolver` to:

```text
0xd26f2040d083af1cd2962ba303f4bea0c4faf142
```

The official branch includes both viem and ethers examples ([pinned instructions](https://github.com/ensdomains/docs/blob/825aca8a882b56557607fde7dc477bc9ca68e06d/src/pages/learn/deployments.mdx#L49-L92)). Do not use the implementation address `0xfea8...` as the application entrypoint, and do not leave viem/ethers on the normal Sepolia proxy.

## 3. Bounded on-chain provenance check

To test whether the missing ref could safely be inferred, runtime bytecode was fetched with `eth_getCode` from Sepolia and its Solidity CBOR trailer compared with official deployment artifacts from:

- `sepolia-deployment-2026-07-31` / `a399be8...` (contains `97a5729...`), and
- `sepolia-deployment-2026-06-29` / `48b3e2d...`.

There were no exact matches in the sampled core contracts. The hackathon contracts were compiled with Solidity 0.8.25; the July standard artifacts were compiled with Solidity 0.8.27, and every sampled bytecode length and IPFS metadata digest differed. The June artifacts use 0.8.25 but also differ in every sampled length/digest.

| Contract | Hackathon runtime bytes | Hackathon CBOR IPFS CID | July runtime bytes | Result |
| --- | ---: | --- | ---: | --- |
| `UserRegistryImpl` | 17,753 | `QmZ562MJPBMZLLZxVouryX9ByMqqESAEsKKzuVwLcaPRUe` | 17,159 | Different |
| `PermissionedResolverImpl` | 15,511 | `QmaxxW3cgEgTGH8b6gT9XuAao7krzpSTwcf1YHj59qtzia` | 17,597 | Different |
| `ETHRegistrar` | 8,037 | `QmVUkvRHJ25dZ1vR1y2ajNXHPpHcch1yw5aarxztsiXQgh` | 7,497 | Different |
| `ETHRegistry` | 14,960 | `QmdxEgbD1USEEbQSscbSDBs6brVjmcxfDYWowg44Zhz96R` | 14,730 | Different |
| `RootRegistry` | 14,960 | same metadata CID as `ETHRegistry` | 14,730 | Different |
| `UniversalResolverV2` | 15,679 | `QmYZvyfnc2PgZ2EgnNZgsTWwzmgSooE13uiYKYY25k6Q5m` | 18,495 | Different |
| `DNSAliasResolver` | 12,317 | `QmdXn6hDC8wLaN45G7hBbqnASYxZmZLvSrj6AVkXYJ3L2Z` | no July artifact | No tagged comparison |
| `DNSTLDResolver` | 17,697 | `QmWu6Tmf9NYyUjToLrmCUqxRznTDtaywtQ3mFeSjoUYpMn` | no July artifact | No tagged comparison |
| `DNSTXTResolver` | 7,989 | `QmX7kSPDPx3yhytAnZaUhVKWEnMHosNtfKRvdS1GMvqqBX` | no July artifact | No tagged comparison |

This check disproves the tempting `97a...`/July-tag equivalence. It does **not** recover an exact source commit. The content-addressed metadata fetch was unavailable during the bounded check, so no source tree is inferred from these CIDs.

Before the implementation sends writes, capture `keccak256(eth_getCode(address,"latest"))` for every configured protocol address as a checked deployment baseline, require non-empty code, and fail configuration validation if the code hash changes. For ABI preflight, execute the documented read calls against the selected addresses, simulate each write with the real sender and exact calldata, and assert the expected event topics/decoded fields from the first real receipts. These checks make proceeding with the trusted address table safe without pretending that a source commit was published.

## 4. Provisional interfaces and role model

Everything in this section is backed by official ENS source/docs, but the Solidity links are pinned to the July standard tag because no hackathon source ref exists. Use the official hackathon docs' minimal signatures, with selector-level Sepolia simulation and receipt checks; the July links explain semantics but are not falsely claimed as hackathon source.

### Verifiable Factory and User Registry

The tagged `UserRegistry` initializer is:

```solidity
function initialize(address rootAccount, uint256 roleBitmap)
```

It grants `roleBitmap` to `rootAccount` on `ROOT_RESOURCE` ([pinned source](https://github.com/ensdomains/contracts-v2/blob/a399be8e8bcff572a56613c66aca7d4528437665/contracts/src/registry/UserRegistry.sol#L38-L49)). The factory call documented by ENS is:

```solidity
function deployProxy(address implementation, uint256 salt, bytes data)
event ProxyDeployed(
  address indexed sender,
  address indexed proxyAddress,
  uint256 salt,
  address implementation
)
```

The factory folds `msg.sender` into its CREATE2 salt. ENS's documented deterministic User Registry salt is:

```text
keccak256(abi.encode(keccak256("UserRegistry"), namehash("fuda.eth"), version))
```

See [Verifiable Factory](https://docs.ens.domains/ensv2/verifiable-factory/) for the current flow. At the July pin, the `contracts-v2` submodule pins `verifiable-factory` commit `5ef7b1a88fd9062bae580ed4048ca369f18450c4`.

There is already visible ABI drift in the official documentation: the hackathon-era docs show the Permissioned Resolver initializer as `initialize(Grant[] grants, bytes[] calls)`, whereas the July tagged Solidity exposes `initialize(address admin, uint256 roleBitmap, bytes[] setters)` ([tagged interface](https://github.com/ensdomains/contracts-v2/blob/a399be8e8bcff572a56613c66aca7d4528437665/contracts/src/resolver/interfaces/IPermissionedResolver.sol#L43-L60)). This is concrete evidence not to borrow the tagged Permissioned Resolver ABI for the hackathon address silently.

### Registry lifecycle signatures

The tagged `IStandardRegistry` interface is ([pinned source](https://github.com/ensdomains/contracts-v2/blob/a399be8e8bcff572a56613c66aca7d4528437665/contracts/src/registry/interfaces/IStandardRegistry.sol#L36-L87)):

```solidity
function register(
  string label,
  address owner,
  IRegistry registry,
  address resolver,
  uint256 roleBitmap,
  uint64 expiry
) external returns (uint256 tokenId);

function renew(uint256 anyId, uint64 newExpiry) external;
function unregister(uint256 anyId) external;
function setSubregistry(uint256 anyId, IRegistry registry) external;
function setResolver(uint256 anyId, address resolver) external;
function setParent(IRegistry parent, string label) external;
```

Important corrections for implementation/spec text:

- `unregister` does not take a string label. It takes `anyId`: labelhash, current token ID, or EAC resource, represented as `uint256`.
- `renew` takes an absolute `newExpiry` timestamp. The registrar-facing `renew(label, duration, token, referrer)` is a different method that converts a duration into a new expiry.
- `register`'s `expiry` is absolute. A custom registrar is responsible for turning a requested duration into a timestamp.
- Passing `address(0)` for a child registry means none; passing a zero resolver permits fallback to a resolver higher in the registry hierarchy.

### Registry roles

Pinned definitions: [`RegistryRolesLib.sol`](https://github.com/ensdomains/contracts-v2/blob/a399be8e8bcff572a56613c66aca7d4528437665/contracts/src/registry/libraries/RegistryRolesLib.sol).

| Role | Value | Scope/effect |
| --- | --- | --- |
| `ROLE_REGISTRAR` | `1 << 0` | Root only; register/reserve available labels |
| `ROLE_REGISTER_RESERVED` | `1 << 4` | Root only; promote reserved labels |
| `ROLE_SET_PARENT` | `1 << 8` | Root only; set registry's canonical parent |
| `ROLE_UNREGISTER` | `1 << 12` | Root or name; delete a registration |
| `ROLE_RENEW` | `1 << 16` | Root or name; extend expiry |
| `ROLE_SET_SUBREGISTRY` | `1 << 20` | Root or name; change child registry |
| `ROLE_SET_RESOLVER` | `1 << 24` | Root or name; change resolver |
| `ROLE_CAN_TRANSFER_ADMIN` | `(1 << 28) << 128` | Admin-only transfer capability; omit/revoke to make the name non-transferable |
| `ROLE_SET_URI` | `1 << 36` | Root only; registry metadata |
| `ROLE_CAN_NAME` | `1 << 120` | Root only; contract naming |
| `ROLE_UPGRADE` | `1 << 124` | Root only; UUPS upgrade authorization |

Every normal role's admin counterpart is `role << 128`. The account that initializes fuda's User Registry must therefore receive, at minimum:

- `ROLE_REGISTRAR_ADMIN` to authorize the lifecycle registrar/operator;
- `ROLE_RENEW_ADMIN` if names expire and are renewable; and
- `ROLE_UNREGISTER_ADMIN` if a separate lifecycle worker/registrar will revoke issuer or member names.

Grant only the operational role to the runtime contract/account (`REGISTRAR`, `RENEW`, and, if required, `UNREGISTER`), not the admin counterpart. The child-name `roleBitmap` passed to `register` determines what the issuer can do with its issuer name. Omit `ROLE_CAN_TRANSFER_ADMIN` for fuda's non-transferable issuer names. Do not describe this as burning Name Wrapper fuses; it is ENSv2 EAC.

The trust consequence should be explicit: any root-scoped `UNREGISTER`, `SET_RESOLVER`, or `SET_SUBREGISTRY` holder can affect every child in that registry. ENS's [Permissioned Registry documentation](https://docs.ens.domains/ensv2/permissioned-registry/) calls these out when discussing emancipation.

## 5. Resolver architecture for fuda

### What Universal Resolver V2 does

Universal Resolver V2 walks from the root down through `getSubregistry(label)` and remembers the deepest resolver found; the resolver covering the longest name suffix wins ([official docs](https://docs.ens.domains/ensv2/universal-resolver-v2/)). Therefore the intended hierarchy is viable:

```text
RootRegistry
└── ETHRegistry (.eth)
    └── fuda.eth
        ├── subregistry -> fuda UserRegistry proxy
        └── resolver    -> deployed FudaResolver
            └── <issuer>.fuda.eth entries may have resolver = 0 and inherit
```

The custom resolver at `fuda.eth` receives the full DNS-wire name through ENSIP-10 wildcard resolution. Deeper names can override it by setting their own resolver, so fuda must decide whether issuers are permitted to hold `ROLE_SET_RESOLVER` on their issuer token.

### Why `PermissionedResolverImpl` cannot simply point at fuda's gateway

The July tagged Permissioned Resolver implements `IExtendedResolver` and stores on-chain records/aliases. Its configuration surface contains record setters and `setAlias`; it has no arbitrary gateway URL, signer, `OffchainLookup`, or verification callback. The newer hackathon-era docs likewise describe a per-account record store with record linking, not an externally signed rotating-answer gateway ([Permissioned Resolver docs](https://docs.ens.domains/ensv2/permissioned-resolver/)).

Consequently, the C2 transport needs its own resolver contract implementing:

```solidity
// ENSIP-10 / IExtendedResolver
function resolve(bytes calldata dnsName, bytes calldata data)
  external view returns (bytes memory);

// EIP-3668
error OffchainLookup(
  address sender,
  string[] urls,
  bytes callData,
  bytes4 callbackFunction,
  bytes extraData
);
```

It should report ENSIP-10 interface ID `0x9061b923`, revert with `OffchainLookup`, and validate the signed gateway response in its callback. This matches the already-built fuda C2 boundary and keeps rotating private answers out of on-chain record storage. See [ENSIP-10](https://docs.ens.domains/ensip/10/) and [EIP-3668](https://eips.ethereum.org/EIPS/eip-3668).

## 6. Exact DNSAliasResolver rule for `fuda.sh`

Official grammar:

```text
ENS1 <resolver-address-or-name> <context>
```

`DNSTLDResolver` scans verified DNSSEC TXT records and uses the first valid `ENS1` record. The tagged parser splits the resolver identifier from the remaining context and accepts either a literal `0x` + 40-hex-character address or an ENS name resolving to an address ([pinned source](https://github.com/ensdomains/contracts-v2/blob/a399be8e8bcff572a56613c66aca7d4528437665/contracts/src/dns/DNSTLDResolver.sol#L273-L374)).

For `DNSAliasResolver`, context has two modes ([pinned source](https://github.com/ensdomains/contracts-v2/blob/a399be8e8bcff572a56613c66aca7d4528437665/contracts/src/dns/DNSAliasResolver.sol#L119-L144)):

- A context containing a space is split at the first space as `<oldSuffix> <newSuffix>`. The queried name must end in the DNS-encoded old suffix; the preceding labels are retained and the new suffix appended.
- A context with no space replaces the entire queried name with `<newName>`.

The exact dedicated-deployment record is:

```dns
fuda.sh.  TXT  "ENS1 0x005a3bf1d92ebe4b1e1641a0c6fa49f38e1762a6 sh eth"
```

Expected rewrites:

| Query | Rewritten ENSv2 name |
| --- | --- |
| `fuda.sh` | `fuda.eth` |
| `venue.fuda.sh` | `venue.fuda.eth` |
| `member.venue.fuda.sh` | `member.venue.fuda.eth` |

Operational requirements and caveats:

- Enable DNSSEC for `fuda.sh`; the resolver verifies the DNSSEC proof fetched through CCIP-Read.
- Publish one applicable `ENS1` record to avoid relying on DNS record iteration order.
- The rewrite operates on the suffix `sh`, not on a hard-coded `fuda` label. A zone owner could change the context to `fuda.sh other.eth` or use full replacement. Therefore “can only target `fuda.eth`” is not a protocol invariant.
- No ENSv2 registration is created for `fuda.sh`; the DNS name is a read-only, DNSSEC-authorized alias into the `.eth` hierarchy.

## 7. Recommended end-to-end deployment flow

This combines the official [app-developer tutorial](https://docs.ens.domains/ensv2/tutorial-app-developers/), [ETH Registrar guide](https://docs.ens.domains/ensv2/eth-registrar/), [Verifiable Factory guide](https://docs.ens.domains/ensv2/verifiable-factory/), and [contract-developer tutorial](https://docs.ens.domains/ensv2/tutorial-contract-developers/), while keeping the source-ref caveat above.

1. **Lock the deployment namespace.** Configure chain 11155111 and all addresses from the dedicated list. Override the Universal Resolver proxy to `0xd26f...`. Reject startup if normal and hackathon address families are mixed.
2. **Obtain funds.** Get Sepolia ETH for gas. Call the unrestricted `mint(address,uint256)` on hackathon `MockUSDC` (`0xcbfd...`) and approve the hackathon `ETHRegistrar` (`0x7d1b...`) for the quoted cost.
3. **Register `fuda.eth`.** Call `isAvailable("fuda")`; query `getRegisterPrice(label,duration,paymentToken)`; choose a random 32-byte secret; call `makeCommitment`; submit `commit`; wait at least `MIN_COMMITMENT_AGE` (documented as 60 seconds); then call `register` with exactly the committed owner, secret, subregistry, resolver, duration, and referrer values. The commitment normally expires after 24 hours.
4. **Deploy fuda's User Registry proxy.** Encode `UserRegistry.initialize(rootAccount, roleBitmap)`, derive the documented salt from `namehash("fuda.eth")` and a version, then call hackathon `VerifiableFactory.deployProxy(UserRegistryImpl,salt,data)`. Read `ProxyDeployed.proxyAddress` from the receipt.
5. **Connect it to the hierarchy.** On hackathon `ETHRegistry`, call `setSubregistry(uint256(keccak256(bytes("fuda"))), userRegistryProxy)`. A registry that is deployed but not connected can mint tokens but its names will not resolve.
6. **Deploy fuda's custom registrar/lifecycle contract.** Point it at the User Registry. Grant it root `ROLE_REGISTRAR | ROLE_RENEW`, and `ROLE_UNREGISTER` only if revocation is part of that contract's responsibility. The initializer account must already hold the corresponding admin roles.
7. **Deploy fuda's custom ENSIP-10 resolver.** Configure its gateway URL and authorized response signer. Set it as the resolver of `fuda.eth`. Child registrations may pass resolver zero to inherit the parent wildcard resolver; alternatively pass the same resolver explicitly after confirming the selected ABI.
8. **Register issuer labels on lifecycle evidence.** Use the normalized issuer handle as `label`, issuer/operator ownership according to the product trust model, a zero child registry unless nested issuer-owned namespaces are required, and an absolute expiry mirroring the `IssuerDelegation`. Use a child role bitmap that omits transfer authority for non-transferable names.
9. **Serve member names off-chain.** The custom resolver answers stable records from fuda's mirror and allocates a fresh address for private records. Member names need no child token if the design intentionally keeps the member layer off-chain.
10. **Publish and test the DNS alias.** Enable DNSSEC, publish the exact `ENS1 ... sh eth` TXT record, then prove `fuda.sh`, an issuer subname, and a member subname resolve through the hackathon Universal Resolver.
11. **Demonstrate lifecycle, not constants.** The prize requires a functional central integration. Record transactions and UI behavior for `.eth` registration, issuer-name creation, resolution, expiry/renewal, revocation/unregister, non-transferability, and `fuda.sh` DNSSEC aliasing.

Do not follow `forge install ensdomains/contracts-v2` unpinned for a reproducible deployment. The official contract tutorial currently shows that command, but it follows a moving branch and cannot solve the missing hackathon provenance.

## 8. Spec/plan corrections to carry forward

1. Replace any claim that the dedicated hackathon deployment is pinned to `97a5729...` or `sepolia-deployment-2026-07-31`. It is not.
2. Do not combine the normal Sepolia Universal Resolver (`0xeEe...`) with hackathon registries, or the hackathon proxy (`0xd26f...`) with normal addresses.
3. Replace `unregister(label)` with `unregister(uint256 anyId)` and use `uint256(keccak256(bytes(label)))` when starting from a label.
4. Distinguish registry `renew(anyId,newExpiry)` (absolute timestamp) from registrar `renew(label,duration,...)` (duration).
5. Replace “configure `PermissionedResolverImpl` with the fuda gateway” with “deploy and select the fuda ENSIP-10/EIP-3668 resolver.”
6. Treat `PermissionedResolverImpl` ABI snippets as version-sensitive; its initializer changed between the July tagged source and hackathon-era docs.
7. Replace any ENSv1 Name Wrapper/fuse construction in the primary plan with ENSv2 Permissioned Registry roles. Keep Name Wrapper only as the explicitly documented v1 fallback.
8. Replace “DNSAliasResolver can only map to `fuda.eth`” with the precise suffix-rewrite rule and DNSSEC trust statement.
9. Include the client Universal Resolver override and a negative test proving the default Sepolia client does not accidentally select the normal deployment.
10. Add a release gate requiring pinned runtime code hashes, minimal-ABI selector simulations, and real Sepolia receipt assertions. An ENS-published SHA/artifact bundle would improve reproducibility but is not required to proceed with the accepted address authority.

## 9. Decision and limitation summary

| Question | Answer |
| --- | --- |
| Is the ENS-dev docs address table accepted as authority? | **Yes.** The user explicitly accepts commit `825aca8...` and its full dedicated address table as the implementation namespace. |
| Exact hackathon address namespace available? | **Yes**, from official docs commit `825aca8...`; full list above. |
| Exact official `contracts-v2` source/ABI ref available? | **No.** This is a documented reproducibility limitation, not an implementation blocker given the accepted address authority and required on-chain preflight. |
| Can `97a...`/July artifacts be used as the hackathon source? | **No.** Static override bypasses that pin; sampled on-chain bytecode does not match. |
| Is the dedicated deployment live? | Sampled contracts have code; both dedicated web applications returned HTTP 200 on 2026-09-06. |
| Can the protocol Permissioned Resolver serve fuda's rotating gateway answers? | **Not through a documented configuration surface.** Keep the custom ENSIP-10/CCIP-Read resolver. |
| Exact DNS alias record known? | **Yes:** `ENS1 0x005a... sh eth`, with DNSSEC enabled. |
| Primary ENSv2 lifecycle model? | User Registry proxy + EAC roles + custom registrar/operator; Name Wrapper is v1 fallback only. |
| Optional upstream ask | ENS team: publish the 2026-09-03 `contracts-v2` SHA and generated artifacts/ABIs. The `825aca8...` address table is accepted here as authoritative. |
