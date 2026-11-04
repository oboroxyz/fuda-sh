import type { Hex } from 'viem'
import { describe, expect, it } from 'vitest'

import { merkleRoot } from './merkle.ts'

const repeated = (count: number): Hex[] =>
  Array.from({ length: count }, (_, i): Hex => `0x${(i + 1).toString(16).padStart(2, '0').repeat(32)}`)

const numbered = (count: number): Hex[] =>
  Array.from({ length: count }, (_, i): Hex => `0x${(i + 1).toString(16).padStart(64, '0')}`)

// Roots from @openzeppelin/merkle-tree 1.0.8, StandardMerkleTree.of(uids, ['bytes32']).
describe(merkleRoot, () => {
  it.each([
    [1, '0xce895d90d3a0ed5312ae8dcfff377010c4aa1b7e9f1fa69836a3802d014c313e'],
    [2, '0xc47aba36d45add76b43fb8cfe13e4a9ee53d408aadcf3351d97f1a0d95166d36'],
    [3, '0xd0721d2dc79379fabc8f9fedaf82df1f99c98be5da4b6affa7ff9a42314b4e1c'],
    [5, '0x79aab7c0a1a9180805943f05bdc1736b8aeb5b45ccde479da091d0e41c4e3f4a'],
    [8, '0xeb0820aafa728156f29ad00993b42c04748db51b45db936ca4f26d0e34d6b9d2'],
  ])('matches the library for %i uids', (count, root) => {
    expect(merkleRoot(repeated(count))).toBe(root)
  })

  it('matches the library for a full batch', () => {
    expect(merkleRoot(numbered(1000))).toBe(
      '0xf022299fcf648d29b98eec0530710ca88de163fb9051b9c59c6fb37e8e1f94af',
    )
  })

  it('does not depend on the order of the uids', () => {
    expect(merkleRoot(repeated(5).toReversed())).toBe(merkleRoot(repeated(5)))
  })

  it('refuses an empty batch', () => {
    expect(() => merkleRoot([])).toThrow('at least one')
  })
})
