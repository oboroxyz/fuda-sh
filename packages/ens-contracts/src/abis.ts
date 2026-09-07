import { parseAbi } from 'viem'

// Verified against the deployed UserRegistry implementation
// (0x47B442d0CF617c41CAbAFf5f02f44DD1e5f72546, Sourcify exact match). The
// initializer takes a list of grants, not a single root account, and
// `ExpiryUpdated.newExpiry` is indexed; both differed from this file's original
// declarations and both failed only against the real chain.
export const USER_REGISTRY_ABI = parseAbi([
  'function initialize((address account,uint256 roleBitmap)[] grants)',
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
  'event ExpiryUpdated(uint256 indexed tokenId,uint64 indexed newExpiry,address indexed sender)',
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

export const ETH_REGISTRY_ABI = parseAbi([
  'function getOwner(uint256 anyId) view returns (address)',
  'function getTokenId(uint256 anyId) view returns (uint256)',
  'function getResolver(string label) view returns (address)',
  'function getSubregistry(string label) view returns (address)',
  'function setResolver(uint256 anyId,address resolver)',
  'function setSubregistry(uint256 anyId,address registry)',
  // `resolver` and `subregistry` are indexed on the deployed PermissionedRegistry
  // (0x1d78834d97c1d7b1a38c1dedbd1a287cfed3971e, Sourcify exact match). Declaring
  // them unindexed made strict log parsing reject a receipt whose transaction had
  // in fact succeeded, so the deployment reported a failure it had not had.
  'event ResolverUpdated(uint256 indexed tokenId,address indexed resolver,address indexed sender)',
  'event SubregistryUpdated(uint256 indexed tokenId,address indexed subregistry,address indexed sender)',
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

export const ERC165_ABI = parseAbi(['function supportsInterface(bytes4 interfaceId) view returns (bool)'])

export const FUDA_RESOLVER_ABI = parseAbi([
  'function owner() view returns (address)',
  'function signer() view returns (address)',
  'function userRegistry() view returns (address)',
  'function parentNode() view returns (bytes32)',
  'function registrar() view returns (address)',
  'function gatewayUrls() view returns (string[])',
  'function setRegistrar(address registrar)',
  'event RegistrarSet(address registrar)',
])

export const FUDA_REGISTRAR_ABI = parseAbi([
  'function owner() view returns (address)',
  'function voucherSigner() view returns (address)',
  'function userRegistry() view returns (address)',
  'function resolver() view returns (address)',
  'function parentNode() view returns (bytes32)',
  'function nonces(address issuer) view returns (uint256)',
])
