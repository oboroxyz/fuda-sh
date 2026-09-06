import { getAddress, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import { readParentMutationConfig, readPublicConfig } from './config.ts'

const publicEnv = { ENS_RPC_URL: 'https://rpc.example' }
const mutationEnv = {
  ENS_COMMITMENT_SECRET: `0x${'11'.repeat(32)}`,
  ENS_PARENT_DURATION: '31536000',
  ENS_PARENT_KEY: `0x${'22'.repeat(32)}`,
  ...publicEnv,
}
const parentAddress = '0x1563915e194D8CfBA1943570603F7606A3115508'

describe('public configuration', () => {
  it('requires an explicit RPC and never falls back', () => {
    expect(() => readPublicConfig({})).toThrow('ENS_RPC_URL')
  })

  it.each([
    '',
    ' rpc.example ',
    'https://',
    'ftp://rpc.example',
    'file:///tmp/rpc',
    'https://rpc.example\n',
    'https:rpc.example',
    'https://rpc.exa\nmple',
    'https://rpc.example\\path',
  ])('rejects invalid RPC URL %j', (url) => {
    expect(() => readPublicConfig({ ENS_RPC_URL: url })).toThrow('ENS_RPC_URL')
  })

  it('reads only public keys and fixes the parent label', () => {
    const env = new Proxy(
      { ...publicEnv, ENS_PARENT_LABEL: 'other' },
      {
        get(target, key) {
          if (key === 'ENS_PARENT_KEY' || key === 'ENS_COMMITMENT_SECRET') {
            throw new Error('public path accessed a secret')
          }
          return target[key as keyof typeof target]
        },
      },
    )
    expect(readPublicConfig(env)).toStrictEqual({ parentLabel: 'fuda', rpcUrl: 'https://rpc.example' })
  })

  it.each([
    ['ENS_PARENT_ADDRESS', 'parentAddress'],
    ['ENS_USER_REGISTRY_ADDRESS', 'userRegistryAddress'],
    ['ENS_RESOLVER_ADDRESS', 'resolverAddress'],
    ['ENS_REGISTRAR_ADDRESS', 'registrarAddress'],
  ])('checksums optional %s', (key, field) => {
    expect(readPublicConfig({ ...publicEnv, [key]: parentAddress.toLowerCase() })).toHaveProperty(
      field,
      getAddress(parentAddress),
    )
  })

  it.each([
    'ENS_PARENT_ADDRESS',
    'ENS_USER_REGISTRY_ADDRESS',
    'ENS_RESOLVER_ADDRESS',
    'ENS_REGISTRAR_ADDRESS',
  ])('rejects malformed, zero, and bad-checksum %s', (key) => {
    for (const value of ['', '0x1234', zeroAddress, `${parentAddress} `, parentAddress.replace('D8', 'd8')]) {
      expect(() => readPublicConfig({ ...publicEnv, [key]: value })).toThrow(key)
    }
  })
})

describe('parent mutation configuration', () => {
  it('requires secrets only on the mutation path', () => {
    expect(() => readParentMutationConfig(publicEnv)).toThrow('ENS_PARENT_KEY')
    expect(() => readParentMutationConfig({ ...mutationEnv, ENS_COMMITMENT_SECRET: undefined })).toThrow(
      'ENS_COMMITMENT_SECRET',
    )
  })

  it('derives the parent account and parses uint64 duration', () => {
    const config = readParentMutationConfig(mutationEnv)
    expect(config.parentAccount.address).toBe(parentAddress)
    expect(config.parentDuration).toBe(31_536_000n)
    expect(config.commitmentSecret).toBe(mutationEnv.ENS_COMMITMENT_SECRET)
  })

  it.each(['ENS_PARENT_KEY', 'ENS_COMMITMENT_SECRET'])(
    'rejects non-exact bytes32 %s without disclosing the input',
    (key) => {
      for (const value of ['0x11', `0x${'11'.repeat(33)}`, '11'.repeat(32), `0x${'gg'.repeat(32)}`]) {
        const parse = () => readParentMutationConfig({ ...mutationEnv, [key]: value })
        expect(parse).toThrow(key)
        expect(parse).not.toThrow(value)
      }
    },
  )

  it.each([`0x${'00'.repeat(32)}`, `0x${'ff'.repeat(32)}`])('rejects invalid secp256k1 scalar %s', (key) => {
    expect(() => readParentMutationConfig({ ...mutationEnv, ENS_PARENT_KEY: key })).toThrow('ENS_PARENT_KEY')
  })

  it.each(['', '-1', '+1', ' 1', '1 ', '1.0', '1e3', '0x10', '18446744073709551616'])(
    'rejects non-uint64 decimal duration %j',
    (duration) => {
      expect(() => readParentMutationConfig({ ...mutationEnv, ENS_PARENT_DURATION: duration })).toThrow(
        'ENS_PARENT_DURATION',
      )
    },
  )

  it.each(['0', '18446744073709551615'])('accepts uint64 boundary %s', (duration) => {
    expect(readParentMutationConfig({ ...mutationEnv, ENS_PARENT_DURATION: duration }).parentDuration).toBe(
      BigInt(duration),
    )
  })

  it('accepts the expected account and rejects a different account', () => {
    expect(
      readParentMutationConfig({ ...mutationEnv, ENS_PARENT_ADDRESS: parentAddress }).parentAccount.address,
    ).toBe(parentAddress)
    expect(() =>
      readParentMutationConfig({
        ...mutationEnv,
        ENS_PARENT_ADDRESS: '0x1111111111111111111111111111111111111111',
      }),
    ).toThrow('ENS_PARENT_ADDRESS')
  })
})
