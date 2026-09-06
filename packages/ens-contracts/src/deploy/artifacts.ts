import { readFile } from 'node:fs/promises'

import { isHex } from 'viem'
import type { Abi, Hex } from 'viem'

interface FudaArtifact {
  abi: Abi
  bytecode: Hex
}

export const loadFudaArtifact = async (name: string): Promise<FudaArtifact> => {
  if (name !== 'FudaResolver' && name !== 'FudaSubnameRegistrar') {
    throw new Error('unsupported fuda artifact')
  }
  let contents: string
  try {
    contents = await readFile(
      new URL(`../../artifacts/contracts/${name}.sol/${name}.json`, import.meta.url),
      'utf-8',
    )
  } catch {
    throw new Error(`${name}: artifact unavailable; run the contract build`)
  }
  try {
    const value: unknown = JSON.parse(contents)
    if (
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- parses untrusted JSON at the artifact file boundary.
      typeof value !== 'object' ||
      value === null ||
      !('abi' in value) ||
      !Array.isArray(value.abi) ||
      value.abi.length === 0 ||
      !('bytecode' in value) ||
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validate bytecode representation before viem consumes it.
      typeof value.bytecode !== 'string' ||
      !isHex(value.bytecode, { strict: true }) ||
      !/^0x(?:[\da-fA-F]{2})+$/u.test(value.bytecode)
    ) {
      throw new Error('invalid artifact')
    }
    // SAFETY: the allowlisted local Hardhat artifact has a nonempty ABI array; viem validates its use.
    return { abi: value.abi as Abi, bytecode: value.bytecode }
  } catch {
    throw new Error(`${name}: invalid artifact`)
  }
}
