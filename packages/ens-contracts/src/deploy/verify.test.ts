import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { zeroAddress, zeroHash } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { ENS_HACKATHON_CONTRACTS } from '../index.ts'
import {
  addresses,
  gateway,
  node,
  other,
  owner,
  setupRoles,
  topologyFixture,
  voucher,
} from './test/topology-fixture.ts'
import { verifyTopology } from './verify.ts'

// Deployment pinning has independent preflight tests; exercise real preflight with controlled runtime bytes.
vi.mock(import('../index.ts'), async (original) => {
  const module = await original()
  const { keccak256 } = await import('viem')
  return {
    ...module,
    ENS_RUNTIME_CODE_HASHES: Object.fromEntries(
      Object.keys(module.ENS_RUNTIME_CODE_HASHES).map((name) => [name, keccak256('0x6000')]),
    ),
  } as unknown as typeof module
})

describe('topology read verification', () => {
  it('runs the verification CLI without secrets and reports missing public principals without leaking RPC credentials', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', fileURLToPath(new URL('../../scripts/ens-verify.ts', import.meta.url))],
      {
        encoding: 'utf-8',
        env: { ENS_RPC_URL: 'https://rpc.example/credential' },
        timeout: 5000,
      },
    )
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim()).toBe('{"error":"ENS topology verification failed"}')
  })

  it('returns only public expected configuration after checking the complete topology', async () => {
    const { context, writes, calls } = topologyFixture()
    await expect(verifyTopology(context, addresses)).resolves.toStrictEqual({
      ...addresses,
      chainId: 11_155_111,
      gatewaySigner: gateway,
      gatewayUrls: ['https://api.fuda.sh/ens/gateway'],
      parentAddress: owner,
      parentName: 'fuda.eth',
      parentNode: node,
      registrarRoles: '65537',
      setupRoles: setupRoles.toString(),
      status: 'verified',
      voucherSigner: voucher,
    })
    expect(writes).toStrictEqual([])
    expect(calls).toStrictEqual(
      expect.arrayContaining([
        `code:${addresses.userRegistryAddress}`,
        `code:${addresses.resolverAddress}`,
        `code:${addresses.registrarAddress}`,
        'read:resolver.supportsInterface:0x9061b923',
      ]),
    )
  })

  it('does not copy extra credentials from a structurally compatible address input into its report', async () => {
    const { context } = topologyFixture()
    const input = { ...addresses, parentAccount: context.config.parentAccount, rpcUrl: context.config.rpcUrl }
    const report = await verifyTopology(context, input)
    expect(report).not.toHaveProperty('parentAccount')
    expect(report).not.toHaveProperty('rpcUrl')
    expect(JSON.stringify(report)).not.toContain('secret-credential')
  })

  it.each([
    ['factory.verifyContract', zeroAddress],
    ['factory.verifyContract', other],
    ['registry.parent', [other, 'fuda']],
    ['registry.parent', [ENS_HACKATHON_CONTRACTS.ETHRegistry, 'wrong']],
    ['registry.parent', [zeroAddress, '']],
    ['eth.subregistry', other],
    ['eth.resolver', other],
    ['eth.owner', other],
    ['resolver.userRegistry', other],
    ['resolver.parentNode', zeroHash],
    ['resolver.signer', other],
    ['resolver.owner', other],
    ['resolver.gatewayUrls', []],
    ['resolver.gatewayUrls', ['https://wrong.example']],
    ['resolver.gatewayUrls', ['https://api.fuda.sh/ens/gateway', 'https://extra.example']],
    ['resolver.registrar', other],
    ['resolver.registrar', zeroAddress],
    ['registrar.userRegistry', other],
    ['registrar.resolver', other],
    ['registrar.parentNode', zeroHash],
    ['registrar.voucherSigner', other],
    ['registrar.owner', other],
    ['registry.ownerRoles', setupRoles - 256n],
    ['registry.ownerRoles', setupRoles + 1n],
    ['registry.registrarRoles', 0n],
    ['registry.registrarRoles', 1n],
    ['registry.registrarRoles', 69_633n],
    ['resolver.supportsInterface:0x01ffc9a7', false],
    ['resolver.supportsInterface:0x9061b923', false],
    ['resolver.supportsInterface:0xffffffff', true],
  ])('rejects the independent %s mismatch (%s)', async (field, value) => {
    const { context, writes } = topologyFixture({ reads: { [field]: value } })
    await expect(verifyTopology(context, addresses)).rejects.toThrow(/mismatch|unavailable/u)
    expect(writes).toStrictEqual([])
  })

  it.each(Object.values(addresses))('rejects missing runtime at %s', async (address) => {
    const { context } = topologyFixture({ noCode: address })
    await expect(verifyTopology(context, addresses)).rejects.toThrow('runtime code')
  })

  it('rejects consistently wrong owners and signers using explicit expected principals', async () => {
    const { context } = topologyFixture({
      reads: {
        'eth.owner': other,
        'registrar.owner': other,
        'registrar.voucherSigner': other,
        'resolver.owner': other,
        'resolver.signer': other,
      },
    })
    await expect(verifyTopology(context, addresses)).rejects.toThrow('unavailable')
  })

  it('redacts upstream read errors', async () => {
    const { context } = topologyFixture({ readError: 'resolver.gatewayUrls' })
    await expect(verifyTopology(context, addresses)).rejects.toThrow('read failed')
    await expect(verifyTopology(context, addresses)).rejects.not.toThrow('secret-credential')
  })

  it('requires the parent to remain owned even if reads otherwise match', async () => {
    const { context } = topologyFixture({ available: true })
    await expect(verifyTopology(context, addresses)).rejects.toThrow('parent')
  })
})
