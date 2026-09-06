import { readFile } from 'node:fs/promises'
import type * as fsPromises from 'node:fs/promises'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadFudaArtifact } from './artifacts.ts'

vi.mock(import('node:fs/promises'), async (original) => ({
  ...(await original()),
  readFile: vi.fn<typeof readFile>() as typeof readFile,
}))

describe('fuda artifact allowlist', () => {
  afterEach(() => {
    vi.resetAllMocks()
  })

  it.each(['FudaResolver', 'FudaSubnameRegistrar'] as const)(
    'loads built %s only from its package path',
    async (name) => {
      const original = await vi.importActual<typeof fsPromises>('node:fs/promises')
      vi.mocked(readFile).mockImplementation(original.readFile)
      const artifact = await loadFudaArtifact(name)
      expect(artifact.abi.length).toBeGreaterThan(0)
      expect(artifact.bytecode).toMatch(/^0x[\da-f]+$/iu)
      expect(readFile).toHaveBeenCalledWith(
        new URL(`../../artifacts/contracts/${name}.sol/${name}.json`, import.meta.url),
        'utf-8',
      )
    },
  )

  it.each(['Other', '../FudaResolver', 'FudaResolver.json', ''])(
    'rejects unowned contract name %j before file access',
    async (name) => {
      await expect(loadFudaArtifact(name)).rejects.toThrow('unsupported fuda artifact')
      expect(readFile).not.toHaveBeenCalled()
    },
  )

  it('reports a missing artifact without exposing filesystem error contents', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('sensitive path'))
    await expect(loadFudaArtifact('FudaResolver')).rejects.toThrow('FudaResolver: artifact unavailable')
  })

  it.each([
    'not JSON',
    '{}',
    '{"abi":[],"bytecode":"0x6000"}',
    '{"abi":[{"type":"constructor","inputs":[]}],"bytecode":"0x"}',
    '{"abi":[{"type":"constructor","inputs":[]}],"bytecode":"0xzz"}',
  ])('rejects invalid artifact %j', async (contents) => {
    vi.mocked(readFile).mockResolvedValue(contents)
    await expect(loadFudaArtifact('FudaResolver')).rejects.toThrow('FudaResolver: invalid artifact')
  })
})
