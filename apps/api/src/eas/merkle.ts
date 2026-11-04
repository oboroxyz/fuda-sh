import { concatHex, encodeAbiParameters, keccak256 } from 'viem'
import type { Hex } from 'viem'

// The tree @openzeppelin/merkle-tree's StandardMerkleTree builds for ['bytes32'] leaves,
// so a proof made with that library verifies against these roots. Written here to keep
// the library's dependencies out of the Worker. A leaf is hashed twice: a uid is the
// bearer secret of a Standard pass, and a proof must never contain another holder's.
const leafOf = (uid: Hex): Hex => keccak256(keccak256(encodeAbiParameters([{ type: 'bytes32' }], [uid])))

// Same-length lower-case hex sorts the way the bytes do.
const byBytes = (a: Hex, b: Hex): number => {
  if (a === b) {
    return 0
  }
  return a < b ? -1 : 1
}

const pair = (a: Hex, b: Hex): Hex => keccak256(concatHex([a, b].toSorted(byBytes)))

// A complete binary tree stored as an array: the leaves fill the end, last-sorted first,
// and each parent at i hashes its children at 2i+1 and 2i+2. Input order does not matter.
export const merkleRoot = (uids: readonly Hex[]): Hex => {
  const leaves = uids.map((uid) => leafOf(uid)).toSorted(byBytes)
  const [first] = leaves
  if (first === undefined) {
    throw new Error('a merkle root needs at least one uid')
  }
  const size = 2 * leaves.length - 1
  const tree = new Map<number, Hex>(leaves.map((leaf, i) => [size - 1 - i, leaf]))
  const nodeAt = (i: number): Hex => {
    const node = tree.get(i)
    if (node === undefined) {
      throw new Error(`no merkle node at ${i}`)
    }
    return node
  }
  for (let i = size - 1 - leaves.length; i >= 0; i -= 1) {
    tree.set(i, pair(nodeAt(2 * i + 1), nodeAt(2 * i + 2)))
  }
  return nodeAt(0)
}
