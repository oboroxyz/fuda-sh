# ENSv2 Issuer Claims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the B1-independent ENSv2 issuer-claim contracts, hybrid onchain/offchain resolution, typed-data package interface, and safe deployment tooling for the dedicated ETHOnline Sepolia namespace.

**Architecture:** A custom `FudaSubnameRegistrar` is the sole issuer-name mutation module and writes zero-role issuer entries into an ENSv2 User Registry. One `FudaResolver` reads active claimed issuer owners onchain, guards inactive claimed namespaces locally, and preserves the existing signed CCIP-Read path for unclaimed names and active member descendants. TypeScript modules hide the beta deployment ABI and transaction safety details behind a small package interface; live writes remain operator-triggered CLI actions.

**Tech Stack:** Solidity 0.8.28, Hardhat 3 Solidity tests, TypeScript 7, Vite+/Vitest, viem 2, pnpm 11.

**Spec:** `.superpowers/specs/2026-09-06-ensv2-claim-design.md`

## Global Constraints

- Build only the B1-independent scope. Do not add `POST /ens/claim-voucher`, guessed issuer tables, lifecycle hooks, or sentinel behavior.
- Use only the dedicated ETHOnline 2026 ENSv2 deployment on Ethereum Sepolia, `chainId = 11155111`; reject the normal Sepolia Universal Resolver `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`.
- Treat ENS docs commit `825aca8a882b56557607fde7dc477bc9ca68e06d` as the address authority, but do not claim it supplies a matching `contracts-v2` source ref.
- Do not copy Solidity, TypeScript, specs, or designs from another repository. Define only the minimal documented ABI interface used here.
- Keep `FudaResolver` and `FudaSubnameRegistrar` dependency-free Solidity written in this repository.
- Issuer registrations use `owner = issuer`, `subregistry = address(0)`, the shared resolver, absolute exclusive expiry, and child role bitmap `0`.
- Registrar root roles are exactly `ROLE_REGISTRAR | ROLE_RENEW`. `ROLE_UNREGISTER` is held for B1/c1 integration and is not granted in this work.
- Every transaction helper must simulate immediately before sending and require a successful receipt. Protocol calls validate their expected event; direct fuda contract creations validate the created address, runtime code, and immutables.
- Never print or persist `ENS_PARENT_KEY`, `ENS_COMMITMENT_SECRET`, `ENS_VOUCHER_KEY`, or `ENS_GATEWAY_SIGNER_KEY`.
- Do not send Sepolia transactions or modify Cloudflare DNS while executing this plan. Read-only Sepolia probes are allowed.
- Use `pnpm lint`, `pnpm format`, and `pnpm check`; suppress lint only inline with a reason.

## File Map

### Shared package interface

- `packages/ens-contracts/src/deployment.ts` — dedicated chain, complete address family, critical runtime-code hashes, roles, and Universal Resolver override.
- `packages/ens-contracts/src/abis.ts` — minimal beta ABI fragments used by contracts and tooling.
- `packages/ens-contracts/src/vouchers.ts` — expiry conversion and claim/renew EIP-712 builders.
- `packages/ens-contracts/src/index.ts` — the package's public TypeScript interface.
- `packages/ens-contracts/src/*.test.ts` — manifest and typed-data conformance tests.

### Solidity modules

- `packages/ens-contracts/contracts/interfaces/IUserRegistry.sol` — the three User Registry calls fuda contracts consume.
- `packages/ens-contracts/contracts/interfaces/IFudaIssuerMarker.sol` — the resolver wiring used by the registrar.
- `packages/ens-contracts/contracts/libraries/FudaECDSA.sol` — canonical 65-byte, low-s recovery shared by both contracts.
- `packages/ens-contracts/contracts/FudaSubnameRegistrar.sol` — issuer claim, renew, nonce, signer rotation, and registrar events.
- `packages/ens-contracts/contracts/FudaResolver.sol` — DNS parsing, claimed-issuer marker/state routing, CCIP-Read, and response verification.
- `packages/ens-contracts/test/FudaSubnameRegistrar.t.sol` — registrar unit/integration tests using a local registry fake.
- `packages/ens-contracts/test/FudaResolver.t.sol` — existing response tests plus hybrid routing and malformed-input coverage.

### Deployment modules and CLIs

- `packages/ens-contracts/src/deploy/config.ts` — strict environment parsing and viem clients for the dedicated chain.
- `packages/ens-contracts/src/deploy/preflight.ts` — read-only namespace, bytecode, ABI, account, and parent checks.
- `packages/ens-contracts/src/deploy/transaction.ts` — simulate/send/receipt/event invariant.
- `packages/ens-contracts/src/deploy/parent.ts` — idempotent commit and reveal state machines.
- `packages/ens-contracts/src/deploy/topology.ts` — dependency-ordered User Registry/resolver/registrar deployment and wiring.
- `packages/ens-contracts/src/deploy/verify.ts` — final topology and role assertions.
- `packages/ens-contracts/src/deploy/artifacts.ts` — validated Hardhat artifact loading for fuda-owned bytecode only.
- `packages/ens-contracts/src/deploy/*.test.ts` — client-fake tests for every no-send and failure path.
- `packages/ens-contracts/scripts/ens-*.ts` — thin non-interactive CLI entrypoints.

### Durable documentation

- `docs/specs/ens-naming.md` — shipped claim and hybrid-resolution behavior.
- `docs/adr/0003-hybrid-ensv2-resolver.md` — why one shared hybrid resolver and append-only markers are required.
- `docs/runbook.md` — exact read-only and credential-gated ENS commands.

---

### Task 1: Publish the dedicated deployment and voucher package interface

**Files:**

- Modify: `packages/ens-contracts/package.json`
- Create: `packages/ens-contracts/tsconfig.json`
- Create: `packages/ens-contracts/vite.config.ts`
- Create: `packages/ens-contracts/src/deployment.ts`
- Create: `packages/ens-contracts/src/deployment.test.ts`
- Create: `packages/ens-contracts/src/abis.ts`
- Create: `packages/ens-contracts/src/vouchers.ts`
- Create: `packages/ens-contracts/src/vouchers.test.ts`
- Create: `packages/ens-contracts/src/index.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: the approved address table and EIP-712 shapes in the design spec.
- Produces: `ENS_HACKATHON_CHAIN`, `ENS_HACKATHON_CONTRACTS`, `ENS_RUNTIME_CODE_HASHES`, `ENS_REGISTRY_ROLES`, `USER_REGISTRY_ROOT_ROLES`, the minimal ABI constants, `toRegistryExpiry(bounds)`, `claimVoucherTypedData(input)`, and `renewVoucherTypedData(input)`.

- [ ] **Step 1: Write failing manifest and voucher tests**

Create tests with these exact assertions:

```ts
import { hashTypedData, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import {
  claimVoucherTypedData,
  ENS_HACKATHON_CHAIN,
  ENS_HACKATHON_CONTRACTS,
  ENS_RUNTIME_CODE_HASHES,
  renewVoucherTypedData,
  toRegistryExpiry,
} from './index.ts'

const registrar = '0x1111111111111111111111111111111111111111' as const
const issuer = '0x2222222222222222222222222222222222222222' as const
const labelHash = `0x${'33'.repeat(32)}` as const

describe('dedicated deployment manifest', () => {
  it('pins the complete unique 40-address namespace and resolver override', () => {
    expect(ENS_HACKATHON_CHAIN.id).toBe(11_155_111)
    expect(ENS_HACKATHON_CHAIN.contracts.ensUniversalResolver?.address).toBe(
      '0xd26f2040d083af1cd2962ba303f4bea0c4faf142',
    )
    const addresses = Object.values(ENS_HACKATHON_CONTRACTS)
    expect(addresses).toHaveLength(40)
    expect(new Set(addresses.map((address) => address.toLowerCase())).size).toBe(40)
    expect(addresses).not.toContain(zeroAddress)
    expect(addresses.map((address) => address.toLowerCase())).not.toContain(
      '0xeeeeeeee14d718c2b47d9923deab1335e144eeee',
    )
  })

  it('pins a nonzero runtime hash for every protocol address the tooling calls', () => {
    expect(Object.keys(ENS_RUNTIME_CODE_HASHES).sort()).toStrictEqual(
      ['DNSAliasResolver', 'ETHRegistrar', 'ETHRegistry', 'MockUSDC', 'RootRegistry',
       'UpgradableUniversalResolverProxy', 'UserRegistryImpl', 'VerifiableFactory'].sort(),
    )
    for (const hash of Object.values(ENS_RUNTIME_CODE_HASHES)) {
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/u)
      expect(hash).not.toBe(`0x${'00'.repeat(32)}`)
    }
  })
})

describe('registry expiry conversion', () => {
  it('maps inclusive bounds to the earliest exclusive registry expiry', () => {
    expect(toRegistryExpiry([])).toBe(2n ** 64n - 1n)
    expect(toRegistryExpiry([0n, 500n, 300n])).toBe(301n)
    expect(() => toRegistryExpiry([2n ** 64n - 1n])).toThrow('finite validity bound')
  })
})

describe('voucher typed data', () => {
  const input = { deadline: 2_000n, expiry: 3_000n, issuer, labelHash, nonce: 7n, registrar }

  it('separates claim and renew by primary type with the fixed domain', () => {
    const claim = claimVoucherTypedData(input)
    const renew = renewVoucherTypedData(input)
    expect(claim.domain).toStrictEqual({
      chainId: 11_155_111,
      name: 'FudaSubnameRegistrar',
      verifyingContract: registrar,
      version: '1',
    })
    expect(claim.primaryType).toBe('ClaimVoucher')
    expect(renew.primaryType).toBe('RenewVoucher')
    expect(hashTypedData(claim)).toBe('0x923f42654b9c0bb0dc3c49be040b9f72aeee1becad195ab14c3e0d389bc5724a')
    expect(hashTypedData(renew)).toBe('0xe36967dad4b6815e19ce53998015a1073a004dce72bf2ee3437c075bb98882f3')
  })
})
```

- [ ] **Step 2: Run the TypeScript tests and verify the missing-module failure**

Run: `pnpm --filter @fuda/ens-contracts exec vitest run src/deployment.test.ts src/vouchers.test.ts`

Expected: FAIL because `src/index.ts` and its exports do not exist.

- [ ] **Step 3: Add the package configuration and exact manifest**

Set the package scripts and dependencies to:

```json
{
  "exports": { ".": "./src/index.ts", "./artifacts/*": "./artifacts/*" },
  "scripts": {
    "build": "hardhat build",
    "test": "vp test && hardhat test solidity"
  },
  "dependencies": { "viem": "^2.37.0" },
  "devDependencies": { "hardhat": "3.15.0", "vitest": "4.1.11" }
}
```

Use the standard package configs:

```ts
// vite.config.ts
import { defineConfig } from 'vite-plus'
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })
```

```json
{ "extends": "../../tsconfig.json", "include": ["src", "scripts", "vite.config.ts"] }
```

Define the complete accepted family exactly:

```ts
export const ENS_HACKATHON_CONTRACTS = {
  BatchRegistrar: '0xc8efa80d9f645b26bacd1bae8638492df3bae8ca',
  ContractNamer: '0x21a2b577709727119f1901314e0ba0150eafa15e',
  DefaultReverseRegistrarAdapter: '0x0a8d7ed4061548fb3cb192d0cbe9e1a57b3b1ae9',
  DNSAliasResolver: '0x005a3bf1d92ebe4b1e1641a0c6fa49f38e1762a6',
  DNSSECGatewayProvider: '0xfedb5c2fea17cef8547d534c3125f7601d3e30bd',
  DNSTLDResolver: '0x10107255fda20ab6c37a0efca1e9465f25066a00',
  DNSTXTResolver: '0x0ebc944ac29f91cc24ee507a2d46aa4901bbc748',
  ENSV1Resolver: '0x1f11e5b8bca2ccfe13bd8431853db159c4e9849c',
  ENSV2Resolver: '0xb1b2d8c4d4886d0d567b6a6b8a4b885229fafae4',
  ETHRegistrar: '0x7d1b7f586a62ac3f54b9a396849757814283270b',
  ETHRegistry: '0x1d78834d97c1d7b1a38c1dedbd1a287cfed3971e',
  ETHRenewerV1: '0x47bc0ab8f87db01383255e564cce92956ecc7c70',
  Graveyard: '0x2c29661b216717650ba6d4836b2bd37a0fe19adb',
  HCAOwnerAndSessionValidator: '0xeb099163a41912a94e56b2143feb6eb7979a51f0',
  HCAUpgradeSet: '0xde59f9285edbe391fc32d3cba8909ea047cc0fc3',
  LabelStore: '0xd7351f76866123a7e49381f38a30a96adba7e855',
  LockedMigrationController: '0x7fa65c83dd80cca2fbd91e16a6dc4f66b64efe22',
  ManagedUniversalResolverProxy: '0x1abed09f1f36383f27cf0b3a5e0ea1738e1fd921',
  MigrationHelper: '0x540f222a6fd9a54e77989556f366940d1ad81aec',
  MockDAI: '0x93403a98c3a6be906585cd0d68447c0fc600fb38',
  MockRegistrationIntentExecutor: '0x9675de20abf0216d07e3f5782dd92d0c7d3bb2cb',
  MockUSDC: '0xcbfd80f74375c54e545af34788ff465f96f66f05',
  PermissionedResolverImpl: '0xa9d3814ab151bf6e37a427432795371a8361614e',
  PublicResolverSet: '0x3866e84b54a78d1e3778421e0fbf3607fa9c402f',
  PublicResolverV2: '0xf9de4979ddb290baf5b760d0e788125017bc33f6',
  RegistryUpgradeSet: '0x658c43979721b6d30d173ea09622f2475761b382',
  ReverseRegistrarAdapter: '0x67ee68067c74cb3ab595fb793860f98c8a0283f7',
  RootBatchRegistrar: '0x9b30da91c1a3fb972d5a7d102390598d5ca70376',
  RootRegistry: '0xe7f0d5724f8337e3aa9a9910540341ff4273fed9',
  StandaloneHCAFactory: '0xb85152a8ef4db5caf37af6bffce66b559a9c0b58',
  StandaloneHCAImplementation: '0x7328a1926b45f0339913ab654fb98d1a0f5ec894',
  StandardRentPriceOracle: '0xfeba6589b5c1b35875c0389ccedf83148b6ee71b',
  TestnetV1PremigrationRegistrar: '0x1a8c627dc167bcf6b991e9d6e0a76e2dfab7ee88',
  UniversalHelper: '0x1d4cd7545d456f3b6a7e4380182279afcfa887b6',
  UniversalResolverV2: '0xfea8d4b7fcce0b8765c793d6695eac384aaa458f',
  UnlockedMigrationController: '0x97494264ad5437611cc2f43987c21f6f352d786a',
  UpgradableUniversalResolverProxy: '0xd26f2040d083af1cd2962ba303f4bea0c4faf142',
  UserRegistryImpl: '0x47b442d0cf617c41cabaff5f02f44dd1e5f72546',
  VerifiableFactory: '0x894bc9cc8ff1ad96b8a288c86a8c71d662c07780',
  WrapperRegistryImpl: '0x7c53b9dcef516662e9e8a229448cac30b90673cd',
} as const satisfies Record<string, Address>
```

Pin these observed runtime hashes:

```ts
export const ENS_RUNTIME_CODE_HASHES = {
  DNSAliasResolver: '0xf7dd02136f534990da1ed9fff4e1f264a574f2a0ba9fe5968dbda2395a9666e6',
  ETHRegistrar: '0x7366e548c3dce81a699be6ef0e929e2d7719e9b21d526a9e790bd400a45f3cdd',
  ETHRegistry: '0x252dbbf6b49fff13e41027de34566a6623d74818db562ae79b55932f6b0e5bc2',
  MockUSDC: '0xbaef4ab1c98851973ea3476add2574f228432d52f4cc81983c4bf9fe9711e000',
  RootRegistry: '0x252dbbf6b49fff13e41027de34566a6623d74818db562ae79b55932f6b0e5bc2',
  UpgradableUniversalResolverProxy:
    '0x9e9a5896c68cb6803d2833a9d0805e6c212227ac5f9aeab6aab738a967ef121c',
  UserRegistryImpl: '0x657401abae4ae5d78a2322bfccc52508971dcf5a4b739e74d06756939033b8a4',
  VerifiableFactory: '0xc8310f50b38b453448f32fa402d9fb662cd9f4b3c1747b85b266b2b6bf322895',
} as const satisfies Partial<Record<keyof typeof ENS_HACKATHON_CONTRACTS, Hex>>
```

Override viem's normal Sepolia resolver explicitly:

```ts
export const ENS_HACKATHON_CHAIN = defineChain({
  ...sepolia,
  contracts: {
    ...sepolia.contracts,
    ensUniversalResolver: {
      address: ENS_HACKATHON_CONTRACTS.UpgradableUniversalResolverProxy,
    },
  },
  id: 11_155_111,
  name: 'ENS ETHOnline 2026 Sepolia',
})
```

Define the dedicated viem chain by spreading `sepolia` and overriding `id`, `name`, and `contracts.ensUniversalResolver`. Define role bits with bigint shifts and this exact setup bitmap:

```ts
export const ENS_REGISTRY_ROLES = {
  REGISTRAR: 1n << 0n,
  SET_PARENT: 1n << 8n,
  UNREGISTER: 1n << 12n,
  RENEW: 1n << 16n,
  UPGRADE: 1n << 124n,
} as const

export const USER_REGISTRY_ROOT_ROLES =
  ENS_REGISTRY_ROLES.SET_PARENT |
  (ENS_REGISTRY_ROLES.REGISTRAR << 128n) |
  (ENS_REGISTRY_ROLES.UNREGISTER << 128n) |
  (ENS_REGISTRY_ROLES.RENEW << 128n) |
  ENS_REGISTRY_ROLES.UPGRADE |
  (ENS_REGISTRY_ROLES.UPGRADE << 128n)
```

- [ ] **Step 4: Add the minimal ABI and voucher implementation**

Use `parseAbi` and include only these protocol functions/events:

```ts
export const USER_REGISTRY_ABI = parseAbi([
  'function initialize(address rootAccount,uint256 roleBitmap)',
  'function register(string label,address owner,address registry,address resolver,uint256 roleBitmap,uint64 expiry) returns (uint256 tokenId)',
  'function renew(uint256 anyId,uint64 newExpiry)',
  'function getOwner(uint256 anyId) view returns (address)',
  'function getExpiry(uint256 anyId) view returns (uint64)',
  'function getParent() view returns (address parent,string label)',
  'function setParent(address parent,string label)',
  'function grantRootRoles(uint256 roleBitmap,address account) returns (bool)',
  'function hasRootRoles(uint256 roleBitmap,address account) view returns (bool)',
  'function roles(uint256 anyId,address account) view returns (uint256)',
  'event LabelRegistered(uint256 indexed tokenId,bytes32 indexed labelHash,string label,address owner,uint64 expiry,address indexed sender)',
  'event ExpiryUpdated(uint256 indexed tokenId,uint64 newExpiry,address indexed sender)',
  'event ParentUpdated(address indexed parent,string label,address indexed sender)',
  'event EACRolesChanged(uint256 indexed resource,address indexed account,uint256 oldRoleBitmap,uint256 newRoleBitmap)',
])

export const ETH_REGISTRAR_ABI = parseAbi([
  'function isAvailable(string label) view returns (bool)',
  'function getRegisterPrice(string label,uint64 duration,address paymentToken) view returns (uint256 base,uint256 premium)',
  'function makeCommitment(string label,address owner,bytes32 secret,address subregistry,address resolver,uint64 duration,bytes32 referrer) pure returns (bytes32)',
  'function commitmentAt(bytes32 commitment) view returns (uint64)',
  'function MIN_COMMITMENT_AGE() view returns (uint64)',
  'function MAX_COMMITMENT_AGE() view returns (uint64)',
  'function commit(bytes32 commitment)',
  'function register(string label,address owner,bytes32 secret,address subregistry,address resolver,uint64 duration,address paymentToken,bytes32 referrer) returns (uint256 tokenId)',
  'event CommitmentMade(bytes32 commitment)',
  'event NameRegistered(uint256 indexed tokenId,string label,address owner,address subregistry,address resolver,uint64 duration,address paymentToken,bytes32 referrer,uint256 base,uint256 premium)',
])
```

Define the remaining minimal interfaces explicitly:

```ts
export const ETH_REGISTRY_ABI = parseAbi([
  'function getOwner(uint256 anyId) view returns (address)',
  'function getResolver(string label) view returns (address)',
  'function getSubregistry(string label) view returns (address)',
  'function setResolver(uint256 anyId,address resolver)',
  'function setSubregistry(uint256 anyId,address registry)',
  'event ResolverUpdated(uint256 indexed tokenId,address resolver,address indexed sender)',
  'event SubregistryUpdated(uint256 indexed tokenId,address subregistry,address indexed sender)',
])

export const FACTORY_ABI = parseAbi([
  'function proxyLogic() view returns (address)',
  'function deployProxy(address implementation,uint256 salt,bytes data) returns (address proxyAddress)',
  'function verifyContract(address proxy) view returns (address implementation)',
  'event ProxyDeployed(address indexed sender,address indexed proxyAddress,uint256 salt,address implementation)',
])

export const MOCK_USDC_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner,address spender) view returns (uint256)',
  'function mint(address to,uint256 amount)',
  'function approve(address spender,uint256 amount) returns (bool)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'event Approval(address indexed owner,address indexed spender,uint256 value)',
])

export const ERC165_ABI = parseAbi([
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
])

export const FUDA_RESOLVER_ABI = parseAbi([
  'function owner() view returns (address)',
  'function signer() view returns (address)',
  'function userRegistry() view returns (address)',
  'function parentNode() view returns (bytes32)',
  'function registrar() view returns (address)',
  'function gatewayUrls() view returns (string[])',
  'function setRegistrar(address registrar)',
  'event RegistrarSet(address indexed registrar)',
])

export const FUDA_REGISTRAR_ABI = parseAbi([
  'function owner() view returns (address)',
  'function voucherSigner() view returns (address)',
  'function userRegistry() view returns (address)',
  'function resolver() view returns (address)',
  'function parentNode() view returns (bytes32)',
  'function nonces(address issuer) view returns (uint256)',
])
```

Implement the voucher interface exactly:

```ts
export interface VoucherInput {
  deadline: bigint
  expiry: bigint
  issuer: Address
  labelHash: Hex
  nonce: bigint
  registrar: Address
}

export const toRegistryExpiry = (bounds: readonly bigint[]): bigint => {
  const finite = bounds.filter((bound) => bound !== 0n)
  if (finite.length === 0) return 2n ** 64n - 1n
  const earliest = finite.reduce((left, right) => (left < right ? left : right))
  if (earliest < 0n || earliest >= 2n ** 64n - 1n) {
    throw new Error('finite validity bound must be between 0 and uint64 max - 1')
  }
  return earliest + 1n
}
```

Return typed-data objects with separate primary types:

```ts
const VOUCHER_FIELDS = [
  { name: 'labelHash', type: 'bytes32' },
  { name: 'issuer', type: 'address' },
  { name: 'expiry', type: 'uint64' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint64' },
] as const

const voucherDomain = (registrar: Address) => ({
  chainId: ENS_HACKATHON_CHAIN.id,
  name: 'FudaSubnameRegistrar',
  verifyingContract: registrar,
  version: '1',
}) as const

const voucherMessage = (input: VoucherInput) => ({
  deadline: input.deadline,
  expiry: input.expiry,
  issuer: input.issuer,
  labelHash: input.labelHash,
  nonce: input.nonce,
})

export const claimVoucherTypedData = (input: VoucherInput) => ({
  domain: voucherDomain(input.registrar),
  message: voucherMessage(input),
  primaryType: 'ClaimVoucher',
  types: { ClaimVoucher: VOUCHER_FIELDS },
}) as const

export const renewVoucherTypedData = (input: VoucherInput) => ({
  domain: voucherDomain(input.registrar),
  message: voucherMessage(input),
  primaryType: 'RenewVoucher',
  types: { RenewVoucher: VOUCHER_FIELDS },
}) as const
```

- [ ] **Step 5: Install and run package checks**

Run: `pnpm install --lockfile-only`

Run: `pnpm --filter @fuda/ens-contracts exec vitest run src/deployment.test.ts src/vouchers.test.ts`

Run: `pnpm check`

Expected: both focused test files pass and the workspace check is clean.

- [ ] **Step 6: Commit the shared interface**

```bash
git add packages/ens-contracts pnpm-lock.yaml
git commit -m "feat(ens): define ENSv2 deployment interface"
```

---

### Task 2: Implement the voucher-gated issuer registrar

**Files:**

- Create: `packages/ens-contracts/contracts/interfaces/IUserRegistry.sol`
- Create: `packages/ens-contracts/contracts/interfaces/IFudaIssuerMarker.sol`
- Create: `packages/ens-contracts/contracts/libraries/FudaECDSA.sol`
- Create: `packages/ens-contracts/contracts/FudaSubnameRegistrar.sol`
- Create: `packages/ens-contracts/test/FudaSubnameRegistrar.t.sol`

**Interfaces:**

- Consumes: User Registry `register`, `renew`, and `getOwner`; resolver `parentNode()` and `markIssuer(label)`.
- Produces: the exact `claim`, `renew`, `nonces`, `setVoucherSigner`, `IssuerClaimed`, `IssuerRenewed`, and `VoucherSignerUpdated` interface in the approved spec.

Use only these Solidity seams:

```solidity
interface IUserRegistry {
    function register(
        string calldata label,
        address owner,
        address registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId);
    function renew(uint256 anyId, uint64 newExpiry) external;
    function getOwner(uint256 anyId) external view returns (address);
}

interface IFudaIssuerMarker {
    function parentNode() external view returns (bytes32);
    function markIssuer(string calldata label) external;
}
```

- [ ] **Step 1: Write the registrar fake and failing happy-path tests**

The local fake records every argument and models expiry masking; it does not copy ENS code:

```solidity
contract FakeUserRegistry is IUserRegistry {
    struct Entry { address owner; address registry; address resolver; uint256 roles; uint64 expiry; }
    mapping(uint256 => Entry) internal entries;
    uint256 internal nextTokenId = 1;

    function register(string calldata label, address owner, address registry, address resolver,
        uint256 roleBitmap, uint64 expiry) external returns (uint256 tokenId) {
        uint256 id = uint256(keccak256(bytes(label)));
        require(getOwner(id) == address(0), "active");
        entries[id] = Entry(owner, registry, resolver, roleBitmap, expiry);
        return nextTokenId++;
    }

    function getOwner(uint256 anyId) public view returns (address) {
        Entry memory entry = entries[anyId];
        return block.timestamp < entry.expiry ? entry.owner : address(0);
    }

    function renew(uint256 anyId, uint64 newExpiry) external {
        require(newExpiry >= entries[anyId].expiry, "reduced");
        entries[anyId].expiry = newExpiry;
    }
}
```

In `setUp`, call `VM.chainId(11_155_111)`, derive issuer/signer addresses with `VM.addr`, deploy a fake marker whose `parentNode()` matches, then deploy the registrar. Add tests named:

```solidity
function testClaimRegistersExactImmutableSettingsAndMarksIssuer() public;
function testClaimConsumesNonceAndEmitsIssuerClaimed() public;
function testRenewExtendsTheActiveIssuersExactLabel() public;
function testExpiredIssuerUsesClaimForFreshRegistration() public;
function testOwnerRotatesVoucherSignerAndOldSignerStopsAuthorizing() public;
function testMatchesTypeScriptClaimAndRenewDigestVectors() public pure;
```

The first test must assert the fake entry is `(issuer, address(0), resolver, 0, expiry)` and that the marker received the original lowercase label. The vector test independently computes the two EIP-712 digests for registrar `0x1111111111111111111111111111111111111111`, issuer `0x2222222222222222222222222222222222222222`, label hash `0x3333333333333333333333333333333333333333333333333333333333333333`, expiry `3000`, nonce `7`, and deadline `2000`, then asserts the full literal Task 1 hashes.

- [ ] **Step 2: Run the happy-path tests and verify they fail to compile**

Run: `pnpm --filter @fuda/ens-contracts exec hardhat test solidity --grep FudaSubnameRegistrar`

Expected: FAIL because the registrar and interfaces do not exist.

- [ ] **Step 3: Implement the minimal registrar happy path**

Use these public constants and immutable fields:

```solidity
bytes32 public constant CLAIM_TYPEHASH = keccak256(
    "ClaimVoucher(bytes32 labelHash,address issuer,uint64 expiry,uint256 nonce,uint64 deadline)"
);
bytes32 public constant RENEW_TYPEHASH = keccak256(
    "RenewVoucher(bytes32 labelHash,address issuer,uint64 expiry,uint256 nonce,uint64 deadline)"
);
IUserRegistry public immutable userRegistry;
IFudaIssuerMarker public immutable resolver;
bytes32 public immutable parentNode;
address public immutable owner;
address public voucherSigner;
mapping(address issuer => uint256 nonce) public nonces;
```

Build the EIP-712 digest as `keccak256(abi.encodePacked(hex"1901", DOMAIN_SEPARATOR, structHash))`. In `claim`, validate and increment the nonce before calling:

```solidity
tokenId = userRegistry.register(label, issuer, address(0), address(resolver), 0, expiry);
resolver.markIssuer(label);
emit IssuerClaimed(labelHash, issuer, tokenId, expiry, nonce);
```

In `renew`, require `userRegistry.getOwner(uint256(labelHash)) == issuer`, increment first, call `userRegistry.renew(uint256(labelHash), expiry)`, and emit `IssuerRenewed` with the consumed nonce.

- [ ] **Step 4: Add failing validation, replay, and atomicity tests**

Add one focused test per failure:

```solidity
function testRejectsWrongChainAtConstruction() public;
function testRejectsZeroConstructorAddressesAndMismatchedParent() public;
function testRejectsNonIssuerCaller() public;
function testRejectsEmptyUppercaseLeadingHyphenTrailingHyphenAndOverlongLabels() public;
function testRejectsWrongLabelHashActionChainContractSignerAndNonce() public;
function testRejectsExpiredDeadlineAndNonFutureExpiry() public;
function testRejectsMalformedInvalidVAndHighSSignatures() public;
function testRejectsReplay() public;
function testRejectsRenewalByFormerOrExpiredOwnerAndReducedExpiry() public;
function testRegistryFailureRollsBackNonceAndMarker() public;
function testMarkerFailureRollsBackRegistrationAndNonce() public;
function testOnlyOwnerCanRotateVoucherSignerAndZeroIsRejected() public;
function testRegisteredIssuerHasNoTransferRole() public;
```

For wrong action, sign `RENEW_TYPEHASH` and call `claim`. For wrong contract, calculate the domain with `address(0xbeef)`. For high-s, replace `s` with `SECP256K1_ORDER - s` and flip `v`. Atomicity tests make the fake registry or marker revert and assert the nonce and fake entry remain unchanged.

- [ ] **Step 5: Implement validation and shared ECDSA recovery**

`FudaECDSA.recover` accepts only 65 bytes, `v` 27/28, nonzero recovery, and:

```solidity
uint256 internal constant SECP256K1_HALF_ORDER =
    0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
```

The label validator accepts 1–63 bytes; each byte is `a-z`, `0-9`, or `-`, and the first/last byte cannot be `-`. Constructor checks `block.chainid == 11155111`, every address nonzero, and `resolver.parentNode() == parentNode`. Keep administration immutable and allow only the owner to set a nonzero signer.

- [ ] **Step 6: Run registrar and full Solidity tests**

Run: `pnpm --filter @fuda/ens-contracts exec hardhat test solidity --grep FudaSubnameRegistrar`

Run: `pnpm --filter @fuda/ens-contracts exec hardhat test solidity`

Expected: all registrar cases pass and all existing resolver tests still pass.

- [ ] **Step 7: Commit the registrar**

```bash
git add packages/ens-contracts/contracts packages/ens-contracts/test/FudaSubnameRegistrar.t.sol
git commit -m "feat(ens): add voucher-gated issuer registrar"
```

---

### Task 3: Deepen `FudaResolver` into the hybrid resolver

**Files:**

- Modify: `packages/ens-contracts/contracts/FudaResolver.sol`
- Modify: `packages/ens-contracts/test/FudaResolver.t.sol`
- Modify: `apps/api/src/ens/conformance.test.ts`

**Interfaces:**

- Consumes: User Registry `getOwner(labelHash)` and registrar-only `markIssuer(label)`.
- Produces: exact claimed issuer ETH address results; fail-closed inactive claimed namespaces; unchanged signed `OffchainLookup` and `resolveWithProof` envelopes elsewhere.

- [ ] **Step 1: Update the fixture and write failing hybrid-routing tests**

Change resolver construction to:

```solidity
resolver = new FudaResolver(
    address(registry),
    _namehash("fuda.eth"),
    VM.addr(SIGNER_KEY),
    urls
);
resolver.setRegistrar(address(this));
```

Add tests named:

```solidity
function testNeverClaimedIssuerAndMemberStayOffchain() public;
function testActiveClaimedIssuerLegacyAddrComesFromRegistry() public;
function testActiveClaimedIssuerCoin60AddrComesFromRegistry() public;
function testActiveClaimedMemberStaysOffchain() public;
function testInactiveClaimedIssuerReturnsSelectorSpecificEmptyAddresses() public;
function testInactiveClaimedMemberReturnsSelectorSpecificEmptyAddresses() public;
function testInactiveClaimedNamespaceRejectsUnsupportedSelectorWithoutOffchainLookup() public;
function testReregisteredIssuerAndMemberBecomeLiveAgain() public;
function testRegistryFailureNeverFallsBackOffchain() public;
```

Assert legacy local output is `abi.encode(owner)`, multicoin output is `abi.encode(abi.encodePacked(owner))`, legacy empty is `abi.encode(address(0))`, and multicoin empty is `abi.encode(bytes(""))`.

- [ ] **Step 2: Run focused resolver tests and verify routing failures**

Run: `pnpm --filter @fuda/ens-contracts exec hardhat test solidity --grep FudaResolver`

Expected: FAIL because the constructor and marker interface have not been implemented.

- [ ] **Step 3: Implement marker state and resolver routing**

Add:

```solidity
IUserRegistry public immutable userRegistry;
bytes32 public immutable parentNode;
address public registrar;
mapping(bytes32 issuerNode => bytes32 labelHash) public issuerLabelHashes;

function setRegistrar(address nextRegistrar) external onlyOwner {
    if (nextRegistrar == address(0)) revert InvalidRegistrar();
    if (registrar != address(0)) revert RegistrarAlreadySet();
    registrar = nextRegistrar;
    emit RegistrarSet(nextRegistrar);
}

function markIssuer(string calldata label) external {
    if (msg.sender != registrar) revert Unauthorized();
    bytes32 labelHash = keccak256(bytes(label));
    issuerLabelHashes[keccak256(abi.encodePacked(parentNode, labelHash))] = labelHash;
}
```

Refactor `resolve(name, data)` to preserve `msg.data` for offchain requests and execute this order:

```text
parse and validate the complete DNS-wire name
classify legacy addr / coin-60 addr / other
for a supported addr record, decode exactly and require record node == parsed namehash
walk suffix nodes from right to left and find the nearest nonzero issuerLabelHashes marker
if marked: call userRegistry.getOwner(uint256(labelHash)) exactly once
if marked + owner zero: return the selector-specific empty addr or revert InactiveIssuer
if exact marked + supported addr: return the registry owner encoding
otherwise: revert the existing byte-for-byte OffchainLookup envelope
```

Replace the resolver's private recovery implementation with `FudaECDSA.recover` from Task 2, preserving every existing malformed, invalid-v, high-s, and zero-recovery rejection.

- [ ] **Step 4: Add failing parser, authorization, and selector tests**

Add:

```solidity
function testRejectsCompressionPointerMissingRootExtraBytesEmptyLabelAndOversizeLabel() public;
function testRejectsDnsNamesOver255BytesBeforeRegistryRead() public;
function testRejectsLegacyAndCoin60NodeMismatchBeforeRegistryRead() public;
function testNon60CoinTypeRemainsAnOffchainUnsupportedRecordWhenActive() public;
function testOnlyOwnerWiresRegistrarOnceAndZeroIsRejected() public;
function testSetRegistrarEmitsRegistrarSet() public;
function testOnlyRegistrarMarksAndMarkerSurvivesInactiveState() public;
function testSupportsERC165AndENSIP10AfterHybridization() public;
```

Instrument the fake registry with a read counter so malformed names and supported node mismatches assert zero registry reads.

- [ ] **Step 5: Implement strict DNS parsing**

Use two passes over at most 255 DNS bytes: the first validates labels, the zero terminator, and exact end-of-input while counting labels; the second hashes each label. Compute suffix namehashes right-to-left from `bytes32(0)`. Reject a length byte over 63 (including compression pointers), a zero before the final byte, a missing final zero, no labels, or total bytes over 255.

Decode supported records only when calldata length is exactly 36 bytes for legacy or 68 bytes for multicoin; coin type must equal `60`. Preserve unknown record bytes in the offchain request and never call `resolveWithProof` for local answers.

- [ ] **Step 6: Update the TypeScript/Solidity conformance vector**

Deploy the vector resolver with an etched fake registry and the new constructor fields, keeping resolver address `0x1111111111111111111111111111111111111111`. The full request, `extraData`, expiry, signer, signature, and expected gateway result must remain byte-for-byte identical; this proves hybridization did not alter the signed transport.

- [ ] **Step 7: Run focused and cross-language tests**

Run: `pnpm --filter @fuda/ens-contracts exec hardhat test solidity`

Run: `pnpm --filter api exec vitest run src/ens/conformance.test.ts src/ens/gateway.test.ts`

Expected: all Solidity tests pass and the existing cross-language vector remains exact.

- [ ] **Step 8: Commit the hybrid resolver**

```bash
git add packages/ens-contracts apps/api/src/ens/conformance.test.ts
git commit -m "feat(ens): resolve claimed issuers onchain"
```

---

### Task 4: Add strict configuration and read-only namespace preflight

**Files:**

- Create: `packages/ens-contracts/src/deploy/config.ts`
- Create: `packages/ens-contracts/src/deploy/config.test.ts`
- Create: `packages/ens-contracts/src/deploy/preflight.ts`
- Create: `packages/ens-contracts/src/deploy/preflight.test.ts`
- Create: `packages/ens-contracts/scripts/ens-preflight.ts`
- Modify: `packages/ens-contracts/package.json`

**Interfaces:**

- Consumes: Task 1 chain, manifest, hashes, and ABIs.
- Produces: `readPublicConfig(env)`, `readParentMutationConfig(env)`, `createEnsPublicClient(url)`, and `runPreflight(client, config): Promise<PreflightReport>`.

- [ ] **Step 1: Write failing environment parsing tests**

Cover required `ENS_RPC_URL`, exact 32-byte private keys/secrets, decimal uint64 duration, optional resume addresses, fixed `fuda` label, and no implicit RPC fallback. Assert public preflight parsing never requests a private key.

```ts
expect(() => readPublicConfig({})).toThrow('ENS_RPC_URL')
expect(() => readParentMutationConfig({ ENS_RPC_URL: 'https://rpc.example' })).toThrow('ENS_PARENT_KEY')
expect(() => readParentMutationConfig({
  ENS_COMMITMENT_SECRET: `0x${'11'.repeat(32)}`,
  ENS_PARENT_DURATION: '31536000',
  ENS_PARENT_KEY: `0x${'22'.repeat(32)}`,
  ENS_RPC_URL: 'https://rpc.example',
})).not.toThrow()
```

- [ ] **Step 2: Write failing preflight tests with a fake public client**

Test success plus one failure for: wrong chain ID, empty code, changed code hash, normal Sepolia Universal Resolver, failed ABI read, `fuda` unavailable without the configured expected owner, wrong configured account, and mixed address family. A simulated write failure is covered in Task 5; preflight itself sends nothing. An available parent and a parent already owned by optional `ENS_PARENT_ADDRESS` are both valid idempotent states.

- [ ] **Step 3: Run focused tests and verify missing modules**

Run: `pnpm --filter @fuda/ens-contracts exec vitest run src/deploy/config.test.ts src/deploy/preflight.test.ts`

Expected: FAIL because configuration and preflight modules do not exist.

- [ ] **Step 4: Implement parsing and preflight**

Use `getAddress`, exact hex-length checks, `URL`, and bigint range checks. `readPublicConfig` accepts optional `ENS_PARENT_ADDRESS` as a checksummed public verification input; `readParentMutationConfig` requires the parent key, commitment secret, and duration only on a path that will mutate. `runPreflight` performs:

```ts
const actualChainId = await client.getChainId()
if (actualChainId !== ENS_HACKATHON_CHAIN.id) throw new Error('wrong ENS chain')

for (const [name, expectedHash] of Object.entries(ENS_RUNTIME_CODE_HASHES)) {
  const code = await client.getCode({ address: ENS_HACKATHON_CONTRACTS[name] })
  if (code === undefined || code === '0x') throw new Error(`${name}: no runtime code`)
  if (keccak256(code) !== expectedHash) throw new Error(`${name}: runtime code hash mismatch`)
}
```

Then run one documented read against every critical address: Universal Resolver and DNS Alias Resolver `supportsInterface(0x9061b923)`, ETH Registrar `isAvailable('fuda')` plus commitment ages, ETH Registry `getOwner(labelhash('fuda'))`, Root Registry `getSubregistry('eth')`, Factory `proxyLogic()`, User Registry implementation `supportsInterface(0x01ffc9a7)`, and Mock USDC `balanceOf(zeroAddress)`. Call Factory `verifyContract` when a proxy address is supplied and verify configured public owner accounts. Catch each viem error and rethrow with the contract/function name.

- [ ] **Step 5: Add the thin CLI and package script**

The CLI calls only `readPublicConfig(process.env)`, `createEnsPublicClient`, and `runPreflight`, then prints JSON containing chain ID, checked contract names, parent state, and no secrets. Add:

```json
"ens:preflight": "tsx scripts/ens-preflight.ts"
```

- [ ] **Step 6: Run tests and a read-only live probe**

Run: `pnpm --filter @fuda/ens-contracts exec vitest run src/deploy/config.test.ts src/deploy/preflight.test.ts`

Run: `ENS_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com pnpm --filter @fuda/ens-contracts ens:preflight`

Expected: tests pass; live output identifies chain `11155111`, all eight matching runtime hashes, and the current `fuda` availability/owner state without sending a transaction.

- [ ] **Step 7: Commit preflight**

```bash
git add packages/ens-contracts
git commit -m "feat(ens): preflight dedicated ENSv2 namespace"
```

---

### Task 5: Centralize the simulate-send-receipt-outcome invariant

**Files:**

- Create: `packages/ens-contracts/src/deploy/transaction.ts`
- Create: `packages/ens-contracts/src/deploy/transaction.test.ts`

**Interfaces:**

- Consumes: viem public/wallet clients and a caller-supplied receipt/outcome assertion.
- Produces: generic `simulateSendAndConfirm<Result, Request>(input)` used by every mutation CLI without production casts.

- [ ] **Step 1: Write failing transaction-invariant tests**

Use fake clients and assert this exact call order:

```ts
expect(calls).toStrictEqual(['simulate', 'send', 'receipt', 'assert'])
```

Add cases where simulation throws (send count `0`), send throws (receipt count `0`), receipt status is `reverted` (assertion count `0`), and the receipt/outcome assertion throws. Assert the returned hash and receipt are those from the fake.

- [ ] **Step 2: Run the test and verify the missing module**

Run: `pnpm --filter @fuda/ens-contracts exec vitest run src/deploy/transaction.test.ts`

Expected: FAIL because `transaction.ts` does not exist.

- [ ] **Step 3: Implement the single transaction path**

Expose one function with injected actions so viem's generics stay at call sites:

```ts
interface ConfirmedWriteInput<Result, Request> {
  assertReceipt(receipt: TransactionReceipt): Promise<void> | void
  send(simulatedRequest: Request): Promise<Hash>
  simulate(): Promise<{ request: Request; result: Result }>
  wait(hash: Hash): Promise<TransactionReceipt>
}

export const simulateSendAndConfirm = async <Result, Request>(
  input: ConfirmedWriteInput<Result, Request>,
) => {
  const { request, result } = await input.simulate()
  const hash = await input.send(request)
  const receipt = await input.wait(hash)
  if (receipt.status !== 'success') throw new Error(`transaction reverted: ${hash}`)
  await input.assertReceipt(receipt)
  return { hash, receipt, result }
}
```

- [ ] **Step 4: Run tests and type checks**

Run: `pnpm --filter @fuda/ens-contracts exec vitest run src/deploy/transaction.test.ts`

Run: `pnpm check`

Expected: call-order and no-send tests pass; the generic helper type-checks without unsafe production casts.

- [ ] **Step 5: Commit the transaction module**

```bash
git add packages/ens-contracts/src/deploy/transaction.ts packages/ens-contracts/src/deploy/transaction.test.ts
git commit -m "feat(ens): enforce safe deployment writes"
```

---

### Task 6: Implement idempotent parent commit and reveal CLIs

**Files:**

- Create: `packages/ens-contracts/src/deploy/parent.ts`
- Create: `packages/ens-contracts/src/deploy/parent.test.ts`
- Create: `packages/ens-contracts/scripts/ens-parent-commit.ts`
- Create: `packages/ens-contracts/scripts/ens-parent-reveal.ts`
- Modify: `packages/ens-contracts/package.json`

**Interfaces:**

- Consumes: strict parent config, ABIs, manifest, preflight, and the confirmed-write helper.
- Produces: `commitParentName(context)` and `revealParentName(context)`; both return public transaction summaries and never return the commitment secret/private key.

- [ ] **Step 1: Write failing parent-state tests**

Use this exact registration input:

```ts
const registration = {
  duration: config.duration,
  label: 'fuda',
  owner: config.account.address,
  paymentToken: ENS_HACKATHON_CONTRACTS.MockUSDC,
  referrer: zeroHash,
  resolver: zeroAddress,
  secret: config.commitmentSecret,
  subregistry: zeroAddress,
} as const
```

Cover:

- already registered to `ENS_PARENT_ADDRESS`: both functions verify and return `already-complete` without loading the key or commitment secret;
- unavailable to another owner: fail before any write;
- fresh commitment: mint only the USDC balance shortfall, approve only the allowance shortfall, then commit;
- existing unexpired commitment: verify its age and do not send a duplicate;
- reveal too young or older than `MAX_COMMITMENT_AGE`: fail before simulation;
- mature reveal: re-read price, top up/approve if needed, simulate register, send, validate `NameRegistered` and the ETH Registry `LabelRegistered` receipt logs;
- failed simulation/receipt/event: propagate and never report success.

- [ ] **Step 2: Run focused tests and verify the missing module**

Run: `pnpm --filter @fuda/ens-contracts exec vitest run src/deploy/parent.test.ts`

Expected: FAIL because `parent.ts` does not exist.

- [ ] **Step 3: Implement the commit state machine**

Call read-only preflight first. If `fuda` is already registered, require the optional public `ENS_PARENT_ADDRESS` to match and return before calling `readParentMutationConfig`. For an available name, load the key and commitment secret, require the derived account to match `ENS_PARENT_ADDRESS` when it is supplied, and derive the commitment with the onchain `makeCommitment` view. Read `commitmentAt`, current balance, allowance, and price. Each needed `mint`, `approve`, and `commit` uses `simulateSendAndConfirm` with respectively `Transfer`, `Approval`, and `CommitmentMade` assertions. Never include `secret`, key, or raw signed transaction in returned/logged objects.

- [ ] **Step 4: Implement the reveal state machine**

Use the latest block timestamp and onchain min/max ages:

```ts
const age = now - commitmentAt
if (age < minAge) throw new Error(`commitment is ${minAge - age}s too young`)
if (age > maxAge) throw new Error('commitment expired; submit a new commit')
```

Re-read availability and price, ensure payment, simulate the exact eight-argument `register`, wait, and decode both registrar and registry events. Confirm the registry's `getOwner(labelHash('fuda'))` equals the setup account before returning.

- [ ] **Step 5: Add CLI scripts and package commands**

Each CLI constructs clients, calls its one module function, and prints only JSON-safe addresses, amounts, status, transaction hashes, and timestamps.

```json
"ens:parent:commit": "tsx scripts/ens-parent-commit.ts",
"ens:parent:reveal": "tsx scripts/ens-parent-reveal.ts"
```

- [ ] **Step 6: Run tests and package checks**

Run: `pnpm --filter @fuda/ens-contracts exec vitest run src/deploy/parent.test.ts src/deploy/transaction.test.ts`

Run: `pnpm --filter @fuda/ens-contracts test`

Expected: all fake-client state paths and the combined TypeScript/Solidity package suite pass. Do not run either mutation CLI.

- [ ] **Step 7: Commit parent tooling**

```bash
git add packages/ens-contracts
git commit -m "feat(ens): prepare fuda.eth registration tooling"
```

---

### Task 7: Implement topology deployment and verification

**Files:**

- Create: `packages/ens-contracts/src/deploy/artifacts.ts`
- Create: `packages/ens-contracts/src/deploy/artifacts.test.ts`
- Create: `packages/ens-contracts/src/deploy/topology.ts`
- Create: `packages/ens-contracts/src/deploy/topology.test.ts`
- Create: `packages/ens-contracts/src/deploy/verify.ts`
- Create: `packages/ens-contracts/src/deploy/verify.test.ts`
- Create: `packages/ens-contracts/scripts/ens-topology-deploy.ts`
- Create: `packages/ens-contracts/scripts/ens-verify.ts`
- Modify: `packages/ens-contracts/package.json`

**Interfaces:**

- Consumes: completed parent ownership, fuda-owned Hardhat artifacts, Task 1 roles/ABIs, and Task 5 confirmed writes.
- Produces: `deployTopology(context): Promise<TopologyAddresses>` and `verifyTopology(context, addresses): Promise<TopologyReport>`.

- [ ] **Step 1: Write failing artifact-loader tests**

Build first, then assert `loadFudaArtifact('FudaResolver')` and `loadFudaArtifact('FudaSubnameRegistrar')` return nonempty `abi` arrays and `0x` bytecode. Reject a missing artifact, empty bytecode, and any contract name outside the two-name allowlist.

- [ ] **Step 2: Write failing topology state-machine tests**

Cover the exact dependency order:

```ts
expect(actions).toStrictEqual([
  'preflight',
  'deploy-user-registry',
  'set-parent',
  'deploy-resolver',
  'deploy-registrar',
  'set-resolver-registrar',
  'attach-subregistry',
  'attach-parent-resolver',
  'grant-registrar-roles',
  'verify',
])
```

Also test a completely wired rerun performs reads and returns `already-complete` with zero sends; partial resume accepts `ENS_USER_REGISTRY_ADDRESS`, `ENS_RESOLVER_ADDRESS`, and `ENS_REGISTRAR_ADDRESS`, verifies their code and immutable pointers, and continues at the first missing link. Wrong supplied addresses fail closed.

- [ ] **Step 3: Write failing topology verification tests**

`verifyTopology` must reject each mismatch independently: proxy not verified by Factory, wrong implementation, wrong canonical parent/label, wrong ETH Registry subregistry, wrong parent resolver, resolver wrong registry/parent/signer/URLs/registrar, registrar wrong registry/resolver/parent/signer/owner, setup owner roles differing from `USER_REGISTRY_ROOT_ROLES`, registrar roles differing from exactly `REGISTRAR | RENEW`, or failed ERC-165/ENSIP-10 support.

- [ ] **Step 4: Run focused tests and verify missing modules**

Run: `pnpm --filter @fuda/ens-contracts exec vitest run src/deploy/artifacts.test.ts src/deploy/topology.test.ts src/deploy/verify.test.ts`

Expected: FAIL because the artifact, topology, and verification modules do not exist.

- [ ] **Step 5: Implement artifact loading and deterministic User Registry setup**

Load only these generated paths relative to the package root:

```text
artifacts/contracts/FudaResolver.sol/FudaResolver.json
artifacts/contracts/FudaSubnameRegistrar.sol/FudaSubnameRegistrar.json
```

Compute the User Registry salt and initializer exactly:

```ts
const salt = keccak256(encodeAbiParameters(
  parseAbiParameters('bytes32 kind,bytes32 node,uint256 version'),
  [keccak256(toHex('UserRegistry')), namehash('fuda.eth'), 0n],
))
const initializer = encodeFunctionData({
  abi: USER_REGISTRY_ABI,
  args: [account.address, USER_REGISTRY_ROOT_ROLES],
  functionName: 'initialize',
})
```

Simulate/send `VerifiableFactory.deployProxy(UserRegistryImpl, BigInt(salt), initializer)` and decode its `ProxyDeployed(sender, proxyAddress, salt, implementation)` event. Use the event's proxy address; never guess it from a different factory version.

- [ ] **Step 6: Implement dependency-ordered fuda contract deployment and wiring**

After `setParent(ETHRegistry, 'fuda')`, deploy:

```ts
FudaResolver(userRegistry, namehash('fuda.eth'), gatewaySigner, ['https://api.fuda.sh/ens/gateway'])
FudaSubnameRegistrar(userRegistry, resolver, voucherSigner, namehash('fuda.eth'))
```

Then call, in order, resolver `setRegistrar(registrar)`, ETH Registry `setSubregistry(labelhash('fuda'), userRegistry)`, ETH Registry `setResolver(labelhash('fuda'), resolver)`, and User Registry `grantRootRoles(REGISTRAR | RENEW, registrar)`. Every method call uses the confirmed-write helper and validates its contract event. Direct resolver/registrar deployments validate `receipt.contractAddress`, nonempty runtime code, and every immutable field because an EOA `CREATE` has no caller-contract event. Print each deployed public address and transaction hash immediately so an operator can supply resume addresses after an interrupted first run.

- [ ] **Step 7: Implement comprehensive read verification**

Read all immutable/configuration fields and assert:

```ts
const registrarRoles = ENS_REGISTRY_ROLES.REGISTRAR | ENS_REGISTRY_ROLES.RENEW
expect(await registry.roles(0n, account.address)).toBe(USER_REGISTRY_ROOT_ROLES)
expect(await registry.roles(0n, registrar)).toBe(registrarRoles)
expect(await ethRegistry.getSubregistry('fuda')).toBe(userRegistry)
expect(await ethRegistry.getResolver('fuda')).toBe(resolver)
expect(await factory.verifyContract(userRegistry)).toBe(ENS_HACKATHON_CONTRACTS.UserRegistryImpl)
```

Verify resolver ERC-165 and ENSIP-10 interface IDs, exact gateway URL, signers, owners, parent node, registry pointers, and one-time registrar wiring. Return only public configuration.

- [ ] **Step 8: Add CLIs and package commands**

The topology CLI requires parent, voucher, and gateway keys only to derive the three corresponding public accounts/signers. It signs deployment/wiring transactions only with the parent account. The verify CLI accepts the three deployed addresses and requires only `ENS_RPC_URL`.

```json
"ens:topology:deploy": "hardhat build && tsx scripts/ens-topology-deploy.ts",
"ens:verify": "tsx scripts/ens-verify.ts"
```

- [ ] **Step 9: Run topology tests and the full package suite**

Run: `pnpm --filter @fuda/ens-contracts exec vitest run src/deploy/artifacts.test.ts src/deploy/topology.test.ts src/deploy/verify.test.ts`

Run: `pnpm --filter @fuda/ens-contracts test`

Run: `pnpm check`

Expected: all state-machine and mismatch tests pass; both fuda Solidity artifacts build. Do not run the topology mutation CLI.

- [ ] **Step 10: Commit topology tooling**

```bash
git add packages/ens-contracts
git commit -m "feat(ens): prepare hybrid ENSv2 topology deployment"
```

---

### Task 8: Make shipped behavior canonical and complete verification

**Files:**

- Modify: `docs/specs/ens-naming.md`
- Create: `docs/adr/0003-hybrid-ensv2-resolver.md`
- Modify: `docs/runbook.md`
- Modify: `README.md` if its current ENS summary conflicts with the shipped behavior
- Delete: `.superpowers/specs/2026-09-06-ensv2-claim-design.md`
- Delete: `.superpowers/plans/2026-09-06-ensv2-issuer-claims.md`
- Delete: `.superpowers/research/2026-09-06-ensv2-hackathon.md`

**Interfaces:**

- Consumes: verified behavior from Tasks 1–7.
- Produces: durable operator/product documentation with no active temporary artifact.

- [ ] **Step 1: Update the canonical ENS specification**

Replace the obsolete “every query goes to the gateway” and “matching source commit will be pinned” statements with:

- the dedicated chain/address namespace and required Universal Resolver override;
- issuer onchain ownership versus member offchain resolution;
- never-claimed, active-claimed, inactive-claimed, and re-registered result matrix;
- append-only marker and no-offchain-resurrection invariant;
- claim/renew EIP-712 fields, self-submission, nonce, deadlines, exclusive expiry conversion, and role bitmap zero;
- registrar/lifecycle role separation;
- B1-dependent route/lifecycle work and live mutation gates still excluded.

- [ ] **Step 2: Write ADR 0003**

Use this decision statement:

```markdown
## Decision

Use one shared `FudaResolver` on `fuda.eth` and every claimed issuer entry. The
resolver reads active claimed issuer ownership from the fuda User Registry and
uses the signed gateway only for unclaimed names, supported non-address records
on active issuers, and member descendants of active issuers. An append-only
issuer marker prevents an expired or unregistered claimed namespace from ever
falling back to a stale offchain issuer row.
```

Record the rejected stock Permissioned Resolver, per-issuer resolver, and parent-only offchain choices and their consequences.

- [ ] **Step 3: Replace the runbook ENS section**

Document these commands without embedding keys:

```bash
ENS_RPC_URL=https://… pnpm --filter @fuda/ens-contracts ens:preflight
ENS_RPC_URL=https://… ENS_PARENT_ADDRESS=0x… ENS_PARENT_KEY=0x… ENS_COMMITMENT_SECRET=0x… ENS_PARENT_DURATION=31536000 pnpm --filter @fuda/ens-contracts ens:parent:commit
ENS_RPC_URL=https://… ENS_PARENT_ADDRESS=0x… ENS_PARENT_KEY=0x… ENS_COMMITMENT_SECRET=0x… ENS_PARENT_DURATION=31536000 pnpm --filter @fuda/ens-contracts ens:parent:reveal
ENS_RPC_URL=https://… ENS_PARENT_KEY=0x… ENS_VOUCHER_KEY=0x… ENS_GATEWAY_SIGNER_KEY=0x… pnpm --filter @fuda/ens-contracts ens:topology:deploy
ENS_RPC_URL=https://… ENS_USER_REGISTRY_ADDRESS=0x… ENS_RESOLVER_ADDRESS=0x… ENS_REGISTRAR_ADDRESS=0x… pnpm --filter @fuda/ens-contracts ens:verify
```

State that these mutation commands are prepared but were not executed, and document the DNSSEC TXT value exactly as `ENS1 0x005a3bf1d92ebe4b1e1641a0c6fa49f38e1762a6 sh eth`.

- [ ] **Step 4: Run focused and serialized API verification**

Run: `pnpm --filter @fuda/ens-contracts test`

Run: `CI=1 pnpm --filter api test`

Expected: contract package passes; the API suite passes in its existing serialized Cloudflare pool configuration.

- [ ] **Step 5: Run full repository gates**

Run: `pnpm test`

Run: `pnpm check`

Run: `pnpm format:check`

Run: `pnpm install --frozen-lockfile`

Run: `git diff --check`

Expected: every command exits `0` and the frozen install changes no tracked file.

- [ ] **Step 6: Request code review and resolve findings**

Invoke `superpowers:requesting-code-review` against the complete branch diff. Fix each confirmed Critical or Important finding with a focused regression test, rerun the affected suite, and repeat review until no confirmed Critical or Important issue remains.

- [ ] **Step 7: Remove completed temporary artifacts**

After implementation, tests, canonical docs, ADR, and review are clean, delete the three `.superpowers` files listed above. Confirm `rg --files .superpowers` shows no artifact for this completed ENS change.

- [ ] **Step 8: Run post-cleanup verification and commit completion**

Run: `pnpm check`

Run: `pnpm test`

Run: `git diff --check`

Then commit:

```bash
git add docs README.md .superpowers packages/ens-contracts apps/api/src/ens/conformance.test.ts pnpm-lock.yaml
git commit -m "docs: make hybrid ENSv2 behavior canonical"
```

The final handoff must state that repository implementation/tooling is complete and verified, while live Sepolia transactions, DNS mutation, B1 voucher issuance, B1 lifecycle integration, and c1 sentinel wiring remain explicit external gates.
