import { parseAbi } from 'viem'
import type { Hex } from 'viem'

// ERC-8432 reference a2f4291, IIPAssetRegistry and IPAssetTypes.
export const IP_REGISTRY_ABI = parseAbi([
  'function agreementCountOf(bytes32 assetId) view returns (uint256)',
  'function activeAgreementsOf(bytes32 assetId, address party, uint256 cursor, uint256 limit) view returns (bytes32[] agreementIds, uint256 nextCursor)',
  'function agreementOf(bytes32 agreementId) view returns (bytes32 assetId, bytes32 termsId, address party, uint8 agreementTokenization, address agreementCollection, uint256 agreementTokenId, (address licensor, address createdBy, address initialLicensee, uint64 createdAt, uint8 creationMode, bytes32 licenseParamsHash, bytes32 acceptanceHash) evidence, uint64 expiry, bool transferable, bool revocable)',
  'function isActiveAgreementHolder(bytes32 agreementId, bytes32 assetId, address party) view returns (bool)',
])

export interface RegistryAgreement {
  assetId: Hex
  termsId: Hex
  creationMode: number
}

export interface RegistryReads {
  agreementCountOf: (registry: Hex, assetId: Hex) => Promise<bigint>
  activeAgreementsOf: (
    registry: Hex,
    assetId: Hex,
    holder: Hex,
    cursor: bigint,
    limit: bigint,
  ) => Promise<{ agreementIds: readonly Hex[]; nextCursor: bigint }>
  agreementOf: (registry: Hex, agreementId: Hex) => Promise<RegistryAgreement>
  isActiveAgreementHolder: (registry: Hex, agreementId: Hex, assetId: Hex, holder: Hex) => Promise<boolean>
}
