import { getAddress, isAddress, isHex, zeroAddress } from 'viem'
import type { Address, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

type Environment = Record<string, string | undefined>

export interface PublicConfig {
  parentAddress?: Address
  parentLabel: 'fuda'
  registrarAddress?: Address
  resolverAddress?: Address
  rpcUrl: string
  userRegistryAddress?: Address
}

const readRpcUrl = (value: string | undefined): string => {
  if (value === undefined || !/^https?:\/\//u.test(value) || /[\s\\]/u.test(value)) {
    throw new Error('ENS_RPC_URL: explicit HTTP(S) URL required')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('ENS_RPC_URL: explicit HTTP(S) URL required')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname === '') {
    throw new Error('ENS_RPC_URL: explicit HTTP(S) URL required')
  }
  return value
}

const optionalAddress = (env: Environment, key: string): Address | undefined => {
  const value = env[key]
  if (value === undefined) {
    return undefined
  }
  if (!isAddress(value, { strict: true }) || value === zeroAddress) {
    throw new Error(`${key}: nonzero Ethereum address required`)
  }
  return getAddress(value)
}

export const readPublicConfig = (env: Environment): PublicConfig => {
  const rpcUrl = readRpcUrl(env.ENS_RPC_URL)
  const parentAddress = optionalAddress(env, 'ENS_PARENT_ADDRESS')
  const userRegistryAddress = optionalAddress(env, 'ENS_USER_REGISTRY_ADDRESS')
  const resolverAddress = optionalAddress(env, 'ENS_RESOLVER_ADDRESS')
  const registrarAddress = optionalAddress(env, 'ENS_REGISTRAR_ADDRESS')
  const config: PublicConfig = {
    parentLabel: 'fuda',
    rpcUrl,
  }
  if (parentAddress !== undefined) {
    config.parentAddress = parentAddress
  }
  if (userRegistryAddress !== undefined) {
    config.userRegistryAddress = userRegistryAddress
  }
  if (resolverAddress !== undefined) {
    config.resolverAddress = resolverAddress
  }
  if (registrarAddress !== undefined) {
    config.registrarAddress = registrarAddress
  }
  return config
}

const bytes32 = (env: Environment, key: string): Hex => {
  const value = env[key]
  if (value === undefined || !isHex(value, { strict: true }) || !/^0x[\da-fA-F]{64}$/u.test(value)) {
    throw new Error(`${key}: exact 32-byte hex value required`)
  }
  return value
}

export const readParentMutationConfig = (env: Environment) => {
  const config = readPublicConfig(env)
  const key = bytes32(env, 'ENS_PARENT_KEY')
  let parentAccount: ReturnType<typeof privateKeyToAccount>
  try {
    parentAccount = privateKeyToAccount(key)
  } catch {
    throw new Error('ENS_PARENT_KEY: invalid secp256k1 private key')
  }
  if (config.parentAddress !== undefined && config.parentAddress !== parentAccount.address) {
    throw new Error('ENS_PARENT_ADDRESS: does not match ENS_PARENT_KEY account')
  }
  const commitmentSecret = bytes32(env, 'ENS_COMMITMENT_SECRET')
  const duration = env.ENS_PARENT_DURATION
  if (duration === undefined || !/^\d+$/u.test(duration) || BigInt(duration) > 2n ** 64n - 1n) {
    throw new Error('ENS_PARENT_DURATION: decimal uint64 required')
  }
  return { ...config, commitmentSecret, parentAccount, parentDuration: BigInt(duration) }
}

const accountFromKey = (env: Environment, name: string) => {
  const key = bytes32(env, name)
  try {
    return privateKeyToAccount(key)
  } catch {
    throw new Error(`${name}: invalid secp256k1 private key`)
  }
}

const requiredAddress = (env: Environment, key: string): Address => {
  const address = optionalAddress(env, key)
  if (address === undefined) {
    throw new Error(`${key}: nonzero Ethereum address required`)
  }
  return address
}

export const readTopologyMutationConfig = (env: Environment) => {
  const config = readPublicConfig(env)
  const parentAccount = accountFromKey(env, 'ENS_PARENT_KEY')
  if (config.parentAddress !== undefined && config.parentAddress !== parentAccount.address) {
    throw new Error('ENS_PARENT_ADDRESS: does not match ENS_PARENT_KEY account')
  }
  return {
    ...config,
    gatewaySigner: accountFromKey(env, 'ENS_GATEWAY_SIGNER_KEY').address,
    parentAccount,
    parentAddress: parentAccount.address,
    voucherSigner: accountFromKey(env, 'ENS_VOUCHER_KEY').address,
  }
}

export const readTopologyVerificationConfig = (env: Environment) => ({
  ...readPublicConfig(env),
  gatewaySigner: requiredAddress(env, 'ENS_GATEWAY_SIGNER_ADDRESS'),
  parentAddress: requiredAddress(env, 'ENS_PARENT_ADDRESS'),
  registrarAddress: requiredAddress(env, 'ENS_REGISTRAR_ADDRESS'),
  resolverAddress: requiredAddress(env, 'ENS_RESOLVER_ADDRESS'),
  userRegistryAddress: requiredAddress(env, 'ENS_USER_REGISTRY_ADDRESS'),
  voucherSigner: requiredAddress(env, 'ENS_VOUCHER_SIGNER_ADDRESS'),
})
