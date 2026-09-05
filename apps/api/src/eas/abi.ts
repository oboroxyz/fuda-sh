import { parseAbi } from 'viem'

export const EAS_ABI = parseAbi([
  'struct AttestationRequestData { address recipient; uint64 expirationTime; bool revocable; bytes32 refUID; bytes data; uint256 value; }',
  'struct AttestationRequest { bytes32 schema; AttestationRequestData data; }',
  'struct RevocationRequestData { bytes32 uid; uint256 value; }',
  'struct RevocationRequest { bytes32 schema; RevocationRequestData data; }',
  'struct Attestation { bytes32 uid; bytes32 schema; uint64 time; uint64 expirationTime; uint64 revocationTime; bytes32 refUID; address recipient; address attester; bool revocable; bytes data; }',
  'function attest(AttestationRequest request) payable returns (bytes32)',
  'function revoke(RevocationRequest request) payable',
  'function getAttestation(bytes32 uid) view returns (Attestation)',
  'event Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)',
])

export const SCHEMA_REGISTRY_ABI = parseAbi([
  'struct SchemaRecord { bytes32 uid; address resolver; bool revocable; string schema; }',
  'function register(string schema, address resolver, bool revocable) returns (bytes32)',
  'function getSchema(bytes32 uid) view returns (SchemaRecord)',
])

// Coinbase Smart Wallet factory — the Claimable smart account's counterfactual address.
export const FACTORY_ABI = parseAbi([
  'function getAddress(bytes[] owners, uint256 nonce) view returns (address)',
])
