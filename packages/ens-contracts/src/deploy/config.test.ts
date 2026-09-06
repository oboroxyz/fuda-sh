import { getAddress, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import {
  readParentMutationConfig,
  readPublicConfig,
  readTopologyMutationConfig,
  readTopologyVerificationConfig,
} from './config.ts'

const publicEnv = { ENS_RPC_URL: 'https://rpc.example' }
const mutationEnv = {
  ENS_COMMITMENT_SECRET: `0x${'11'.repeat(32)}`,
  ENS_PARENT_DURATION: '31536000',
  ENS_PARENT_KEY: `0x${'22'.repeat(32)}`,
  ...publicEnv,
}
const parentAddress = '0x1563915e194D8CfBA1943570603F7606A3115508'
const topologyEnv = {
  ENS_GATEWAY_SIGNER_KEY: `0x${'0'.repeat(63)}3`,
  ENS_PARENT_KEY: mutationEnv.ENS_PARENT_KEY,
  ENS_VOUCHER_KEY: `0x${'0'.repeat(63)}2`,
  ...publicEnv,
}
const verificationEnv = {
  ENS_GATEWAY_SIGNER_ADDRESS: '0x6813Eb9362372EEF6200f3b1dbC3f819671cBA69',
  ENS_PARENT_ADDRESS: parentAddress,
  ENS_REGISTRAR_ADDRESS: '0x3333333333333333333333333333333333333333',
  ENS_RESOLVER_ADDRESS: '0x2222222222222222222222222222222222222222',
  ENS_USER_REGISTRY_ADDRESS: '0x1111111111111111111111111111111111111111',
  ENS_VOUCHER_SIGNER_ADDRESS: '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF',
  ...publicEnv,
}

describe('topology configuration', () => {
  it('derives the expected principals and retains only the parent signing account', () => {
    const config = readTopologyMutationConfig(topologyEnv)
    expect(config.parentAddress).toBe(parentAddress)
    expect(config.parentAccount.address).toBe(parentAddress)
    expect(config.voucherSigner).toBe(verificationEnv.ENS_VOUCHER_SIGNER_ADDRESS)
    expect(config.gatewaySigner).toBe(verificationEnv.ENS_GATEWAY_SIGNER_ADDRESS)
    expect(Object.keys(config).toSorted()).toStrictEqual([
      'gatewaySigner',
      'parentAccount',
      'parentAddress',
      'parentLabel',
      'rpcUrl',
      'voucherSigner',
    ])
  })

  it.each(['ENS_PARENT_KEY', 'ENS_VOUCHER_KEY', 'ENS_GATEWAY_SIGNER_KEY'])(
    'rejects missing, malformed, and invalid scalar %s without exposing it',
    (field) => {
      for (const value of [undefined, 'secret', '0x11', `0x${'00'.repeat(32)}`, `0x${'ff'.repeat(32)}`]) {
        expect(() => readTopologyMutationConfig({ ...topologyEnv, [field]: value })).toThrow(field)
        expect(() => readTopologyMutationConfig({ ...topologyEnv, [field]: value })).not.toThrow(
          value ?? 'private-value-must-not-leak',
        )
      }
    },
  )

  it('rejects a parent key inconsistent with the expected owner', () => {
    expect(() =>
      readTopologyMutationConfig({
        ...topologyEnv,
        ENS_PARENT_ADDRESS: verificationEnv.ENS_REGISTRAR_ADDRESS,
      }),
    ).toThrow('ENS_PARENT_ADDRESS')
  })

  it('preserves all supplied resume addresses', () => {
    const config = readTopologyMutationConfig({ ...topologyEnv, ...verificationEnv })
    expect(config.userRegistryAddress).toBe(verificationEnv.ENS_USER_REGISTRY_ADDRESS)
    expect(config.resolverAddress).toBe(verificationEnv.ENS_RESOLVER_ADDRESS)
    expect(config.registrarAddress).toBe(verificationEnv.ENS_REGISTRAR_ADDRESS)
  })

  it('verifies from public values without touching any key or registration secret', () => {
    const env = new Proxy(verificationEnv, {
      get(target, field) {
        const name = String(field)
        if (name.endsWith('_KEY') || name === 'ENS_COMMITMENT_SECRET') {
          throw new Error('verification accessed a secret')
        }
        return target[field as keyof typeof target]
      },
    })
    expect(readTopologyVerificationConfig(env)).toStrictEqual({
      gatewaySigner: verificationEnv.ENS_GATEWAY_SIGNER_ADDRESS,
      parentAddress,
      parentLabel: 'fuda',
      registrarAddress: verificationEnv.ENS_REGISTRAR_ADDRESS,
      resolverAddress: verificationEnv.ENS_RESOLVER_ADDRESS,
      rpcUrl: publicEnv.ENS_RPC_URL,
      userRegistryAddress: verificationEnv.ENS_USER_REGISTRY_ADDRESS,
      voucherSigner: verificationEnv.ENS_VOUCHER_SIGNER_ADDRESS,
    })
  })

  it.each(Object.keys(verificationEnv))('requires explicit verification value %s', (field) => {
    expect(() => readTopologyVerificationConfig({ ...verificationEnv, [field]: undefined })).toThrow(field)
  })

  it.each(['ENS_VOUCHER_SIGNER_ADDRESS', 'ENS_GATEWAY_SIGNER_ADDRESS'])(
    'rejects malformed, zero, and bad-checksum public principal %s',
    (field) => {
      for (const value of ['secret', zeroAddress, parentAddress.replace('D8', 'd8')]) {
        expect(() => readTopologyVerificationConfig({ ...verificationEnv, [field]: value })).toThrow(field)
      }
    },
  )
})

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
