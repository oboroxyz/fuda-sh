import { defineChain } from 'viem'
import type { Address, Hex } from 'viem'
import { sepolia } from 'viem/chains'

// oxlint-disable-next-line sort-keys -- deployment manifest order is the accepted family order.
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

export const ENS_RUNTIME_CODE_HASHES = {
  DNSAliasResolver: '0xf7dd02136f534990da1ed9fff4e1f264a574f2a0ba9fe5968dbda2395a9666e6',
  ETHRegistrar: '0x7366e548c3dce81a699be6ef0e929e2d7719e9b21d526a9e790bd400a45f3cdd',
  ETHRegistry: '0x252dbbf6b49fff13e41027de34566a6623d74818db562ae79b55932f6b0e5bc2',
  MockUSDC: '0xbaef4ab1c98851973ea3476add2574f228432d52f4cc81983c4bf9fe9711e000',
  RootRegistry: '0x252dbbf6b49fff13e41027de34566a6623d74818db562ae79b55932f6b0e5bc2',
  UpgradableUniversalResolverProxy: '0x9e9a5896c68cb6803d2833a9d0805e6c212227ac5f9aeab6aab738a967ef121c',
  UserRegistryImpl: '0x657401abae4ae5d78a2322bfccc52508971dcf5a4b739e74d06756939033b8a4',
  VerifiableFactory: '0xc8310f50b38b453448f32fa402d9fb662cd9f4b3c1747b85b266b2b6bf322895',
} as const satisfies Partial<Record<keyof typeof ENS_HACKATHON_CONTRACTS, Hex>>

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

// oxlint-disable-next-line sort-keys -- roles are ordered by their protocol bit positions.
export const ENS_REGISTRY_ROLES = {
  // oxlint-disable-next-line no-bitwise -- protocol role values are bitmap shifts.
  REGISTRAR: 1n << 0n,
  // oxlint-disable-next-line no-bitwise -- protocol role values are bitmap shifts.
  SET_PARENT: 1n << 8n,
  // oxlint-disable-next-line no-bitwise -- protocol role values are bitmap shifts.
  UNREGISTER: 1n << 12n,
  // oxlint-disable-next-line no-bitwise -- protocol role values are bitmap shifts.
  RENEW: 1n << 16n,
  // oxlint-disable-next-line no-bitwise -- protocol role values are bitmap shifts.
  UPGRADE: 1n << 124n,
} as const

export const USER_REGISTRY_ROOT_ROLES =
  // oxlint-disable-next-line no-bitwise -- combines the root's protocol role bitmaps.
  ENS_REGISTRY_ROLES.SET_PARENT |
  // oxlint-disable-next-line no-bitwise -- packs child protocol roles in the upper bitmap.
  (ENS_REGISTRY_ROLES.REGISTRAR << 128n) |
  // oxlint-disable-next-line no-bitwise -- packs child protocol roles in the upper bitmap.
  (ENS_REGISTRY_ROLES.UNREGISTER << 128n) |
  // oxlint-disable-next-line no-bitwise -- packs child protocol roles in the upper bitmap.
  (ENS_REGISTRY_ROLES.RENEW << 128n) |
  // oxlint-disable-next-line no-bitwise -- combines the root's protocol role bitmaps.
  ENS_REGISTRY_ROLES.UPGRADE |
  // oxlint-disable-next-line no-bitwise -- packs the upgrade role in the upper bitmap.
  (ENS_REGISTRY_ROLES.UPGRADE << 128n)
