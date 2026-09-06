import { parseAbi } from 'viem'

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

export const ERC165_ABI = parseAbi(['function supportsInterface(bytes4 interfaceId) view returns (bool)'])

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
