import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { encodeDeployData, zeroAddress, zeroHash } from 'viem'
import type { Abi, Hex } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { ENS_HACKATHON_CONTRACTS } from '../index.ts'
import {
  addresses,
  gateway,
  labelId,
  node,
  operations,
  other,
  owner,
  setupRoles,
  topologyFixture,
  txHash,
  voucher,
} from './test/topology-fixture.ts'
import { deployTopology } from './topology.ts'

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

describe('dependency ordered topology deployment', () => {
  it('runs the noninteractive deployment CLI with sanitized configuration failure output', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', fileURLToPath(new URL('../../scripts/ens-topology-deploy.ts', import.meta.url))],
      {
        encoding: 'utf-8',
        env: { ENS_PARENT_KEY: 'private-key-must-not-leak', ENS_RPC_URL: 'https://rpc.example/credential' },
        timeout: 5000,
      },
    )
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim()).toBe('{"error":"ENS topology deployment failed"}')
  })

  it('performs preflight, exact deterministic proxy creation, ordered direct creation and wiring, then verification', async () => {
    const { actions, calls, context, progress, writes } = topologyFixture({ stage: 0 })
    await expect(deployTopology(context)).resolves.toMatchObject({ ...addresses, status: 'complete' })
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
    expect(writes).toHaveLength(8)
    expect(progress).toStrictEqual(
      expect.arrayContaining([
        { address: addresses.userRegistryAddress, hash: txHash, operation: 'deploy-user-registry' },
        { address: addresses.resolverAddress, hash: txHash, operation: 'deploy-resolver' },
        { address: addresses.registrarAddress, hash: txHash, operation: 'deploy-registrar' },
      ]),
    )
    expect(calls.indexOf('progress')).toBeLessThan(calls.indexOf('simulate:set-parent'))
  })

  it.each([
    [
      'deploy-resolver',
      'FudaResolver',
      [addresses.userRegistryAddress, node, gateway, ['https://api.fuda.sh/ens/gateway']],
    ],
    [
      'deploy-registrar',
      'FudaSubnameRegistrar',
      [addresses.userRegistryAddress, addresses.resolverAddress, voucher, node],
    ],
  ] as const)('sends the exact constructor init code for %s', async (operation, name, args) => {
    const { context, writes } = topologyFixture({ stage: 0 })
    await deployTopology(context)
    // Parse actual generated artifacts without calling the loader under test.
    const artifact = JSON.parse(
      await readFile(new URL(`../../artifacts/contracts/${name}.sol/${name}.json`, import.meta.url), 'utf-8'),
    ) as { abi: Abi; bytecode: Hex }
    const write = writes.find((entry) => entry.operation === operation)
    expect(write?.request).toHaveProperty('data', encodeDeployData({ ...artifact, args }))
    expect(write?.request.account.address).toBe(owner)
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'resumes after step %i only after reading every supplied contract',
    async (stage) => {
      const { actions, calls, context, writes } = topologyFixture({ stage })
      await expect(deployTopology(context)).resolves.toMatchObject({
        ...addresses,
        status: stage === 8 ? 'already-complete' : 'complete',
      })
      expect(actions).toStrictEqual(['preflight', ...operations.slice(stage), 'verify'])
      expect(writes).toHaveLength(8 - stage)
      const firstSend = calls.findIndex((call) => call.startsWith('send:'))
      expect(calls).toContain(`code:${addresses.userRegistryAddress}`)
      const requiredReads = [
        [1, 'read:registry.ownerRoles'],
        [3, 'read:resolver.signer'],
        [4, 'read:registrar.voucherSigner'],
      ] as const
      expect(calls.slice(0, firstSend === -1 ? calls.length : firstSend)).toStrictEqual(
        expect.arrayContaining(
          requiredReads.filter(([minimumStage]) => stage >= minimumStage).map(([, read]) => read),
        ),
      )
    },
  )

  it('discovers a fully linked rerun from public ETH pointers with zero sends', async () => {
    const { context, writes } = topologyFixture({ autoDiscover: true })
    await expect(deployTopology(context)).resolves.toMatchObject({ ...addresses, status: 'already-complete' })
    expect(writes).toStrictEqual([])
  })

  it.each(['ENS_USER_REGISTRY_ADDRESS', 'ENS_RESOLVER_ADDRESS', 'ENS_REGISTRAR_ADDRESS'])(
    'rejects the wrong supplied %s before any transaction',
    async (field) => {
      const { context, writes } = topologyFixture({ resume: { [field]: other } })
      await expect(deployTopology(context)).rejects.toThrow('read failed')
      expect(writes).toStrictEqual([])
    },
  )

  it.each([{ ENS_USER_REGISTRY_ADDRESS: undefined }, { ENS_RESOLVER_ADDRESS: undefined }])(
    'rejects incomplete resume dependencies %j',
    async (resume) => {
      const { context, writes } = topologyFixture({ resume, stage: 4 })
      await expect(deployTopology(context)).rejects.toThrow('resume requires')
      expect(writes).toStrictEqual([])
    },
  )

  it.each([
    ['registry.parent', [zeroAddress, 'fuda']],
    ['registry.parent', [other, 'fuda']],
    ['registry.parent', [ENS_HACKATHON_CONTRACTS.ETHRegistry, 'other']],
    ['eth.subregistry', other],
    ['eth.resolver', other],
    ['resolver.registrar', other],
    ['resolver.signer', other],
    ['registrar.voucherSigner', other],
    ['registry.ownerRoles', setupRoles + 1n],
    ['registry.registrarRoles', 1n],
    ['registry.registrarRoles', 69_633n],
  ])('fails closed on conflicting partial state %s', async (field, value) => {
    const { context, writes } = topologyFixture({ reads: { [field]: value }, stage: 4 })
    await expect(deployTopology(context)).rejects.toThrow(/mismatch|conflicting partial state/u)
    expect(writes).toStrictEqual([])
  })

  it.each([{ wrongChain: true }, { available: true }])(
    'rejects unmet preflight %j with no sends',
    async (scenario) => {
      const { context, writes, actions } = topologyFixture({ ...scenario, stage: 0 })
      await expect(deployTopology(context)).rejects.toThrow(/wrong ENS chain|parent must be owned/u)
      expect(writes).toStrictEqual([])
      expect(actions).toStrictEqual(['preflight'])
    },
  )
})

describe('confirmed protocol writes', () => {
  it.each(operations)('redacts simulation/send/receipt/revert failures for %s', async (operation) => {
    for (const fail of ['simulate', 'send', 'wait', 'reverted'] as const) {
      const { context, writes } = topologyFixture({ fail, failOperation: operation, stage: 0 })
      // oxlint-disable-next-line no-await-in-loop -- each failure must stop its own state-machine run.
      await expect(deployTopology(context)).rejects.toThrow(`${operation}: transaction failed`)
      expect(writes.length).toBeLessThanOrEqual(operations.indexOf(operation) + 1)
    }
  })

  it.each(
    operations.filter((operation) => operation !== 'deploy-resolver' && operation !== 'deploy-registrar'),
  )('rejects missing, malformed, and wrong-emitter %s events', async (operation) => {
    for (const fail of ['missing', 'malformed', 'emitter'] as const) {
      const { context, writes } = topologyFixture({ fail, failOperation: operation, stage: 0 })
      // oxlint-disable-next-line no-await-in-loop -- independent event corruption scenarios.
      await expect(deployTopology(context)).rejects.toThrow(`${operation}: transaction failed`)
      expect(writes).toHaveLength(operations.indexOf(operation) + 1)
    }
  })

  it.each([
    ['deploy-user-registry', 'sender', other],
    ['deploy-user-registry', 'proxyAddress', zeroAddress],
    ['deploy-user-registry', 'salt', 42n],
    ['deploy-user-registry', 'implementation', other],
    ['set-parent', 'parent', other],
    ['set-parent', 'label', 'wrong'],
    ['set-parent', 'sender', other],
    ['set-resolver-registrar', 'registrar', other],
    ['attach-subregistry', 'tokenId', labelId],
    ['attach-subregistry', 'subregistry', other],
    ['attach-subregistry', 'sender', other],
    ['attach-parent-resolver', 'tokenId', labelId],
    ['attach-parent-resolver', 'resolver', other],
    ['attach-parent-resolver', 'sender', other],
    ['grant-registrar-roles', 'resource', 1n],
    ['grant-registrar-roles', 'account', other],
    ['grant-registrar-roles', 'oldRoleBitmap', 1n],
    ['grant-registrar-roles', 'newRoleBitmap', 69_633n],
  ] as const)('rejects incorrect %s event field %s', async (operation, field, value) => {
    const { context, writes } = topologyFixture({
      eventFields: { [field]: value },
      failOperation: operation,
      stage: 0,
    })
    await expect(deployTopology(context)).rejects.toThrow(`${operation}: transaction failed`)
    expect(writes).toHaveLength(operations.indexOf(operation) + 1)
  })

  it('rejects a false role grant simulation without sending', async () => {
    const { context, writes } = topologyFixture({ grantResult: false, stage: 7 })
    await expect(deployTopology(context)).rejects.toThrow('grant-registrar-roles: transaction failed')
    expect(writes).toStrictEqual([])
  })

  it.each([
    ['set-parent', 1],
    ['set-resolver-registrar', 4],
    ['attach-subregistry', 5],
    ['attach-parent-resolver', 6],
    ['grant-registrar-roles', 7],
  ] as const)('rereads the %s link after its valid receipt', async (operation, stage) => {
    const { context, writes } = topologyFixture({ noApply: true, stage })
    await expect(deployTopology(context)).rejects.toThrow(`${operation}: transaction failed`)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.operation).toBe(operation)
  })
})

describe('direct creation outcome verification', () => {
  it.each([
    ['deploy-user-registry', addresses.userRegistryAddress],
    ['deploy-resolver', addresses.resolverAddress],
    ['deploy-registrar', addresses.registrarAddress],
  ] as const)(
    'publishes the confirmed %s address for resume even when subsequent runtime verification fails',
    async (operation, address) => {
      const { context, progress } = topologyFixture({ noCode: address, stage: 0 })
      await expect(deployTopology(context)).rejects.toThrow(`${operation}: transaction failed`)
      expect(progress).toStrictEqual(expect.arrayContaining([{ address, hash: txHash, operation }]))
    },
  )

  it.each(['deploy-resolver', 'deploy-registrar'] as const)(
    'requires a nonzero deployed address for %s',
    async (operation) => {
      for (const receiptAddress of [null, zeroAddress, other] as const) {
        const { context, writes } = topologyFixture({ failOperation: operation, receiptAddress, stage: 0 })
        // oxlint-disable-next-line no-await-in-loop -- each distinct receipt defect must independently reject.
        await expect(deployTopology(context)).rejects.toThrow(`${operation}: transaction failed`)
        expect(writes).toHaveLength(operations.indexOf(operation) + 1)
      }
    },
  )

  it.each([
    ['deploy-user-registry', addresses.userRegistryAddress],
    ['deploy-resolver', addresses.resolverAddress],
    ['deploy-registrar', addresses.registrarAddress],
  ] as const)('rejects empty runtime after %s before the next send', async (operation, address) => {
    const { context, writes } = topologyFixture({ noCode: address, stage: 0 })
    await expect(deployTopology(context)).rejects.toThrow(`${operation}: transaction failed`)
    expect(writes).toHaveLength(operations.indexOf(operation) + 1)
  })

  it.each([
    ['deploy-user-registry', 'factory.verifyContract', other],
    ['deploy-user-registry', 'registry.ownerRoles', setupRoles + 1n],
    ['deploy-resolver', 'resolver.owner', other],
    ['deploy-resolver', 'resolver.userRegistry', other],
    ['deploy-resolver', 'resolver.parentNode', zeroHash],
    ['deploy-resolver', 'resolver.signer', other],
    ['deploy-resolver', 'resolver.gatewayUrls', ['https://wrong.example']],
    ['deploy-resolver', 'resolver.registrar', other],
    ['deploy-registrar', 'registrar.owner', other],
    ['deploy-registrar', 'registrar.userRegistry', other],
    ['deploy-registrar', 'registrar.resolver', other],
    ['deploy-registrar', 'registrar.parentNode', zeroHash],
    ['deploy-registrar', 'registrar.voucherSigner', other],
  ] as const)(
    'rejects wrong %s constructor outcome %s before later writes',
    async (operation, field, value) => {
      const { context, writes } = topologyFixture({ postReads: { [field]: value }, stage: 0 })
      await expect(deployTopology(context)).rejects.toThrow(`${operation}: transaction failed`)
      expect(writes).toHaveLength(operations.indexOf(operation) + 1)
    },
  )
})
