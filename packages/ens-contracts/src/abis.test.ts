import {
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  toHex,
} from 'viem'
import { describe, expect, it } from 'vitest'

import { ETH_REGISTRY_ABI, FUDA_RESOLVER_ABI } from './abis.ts'

describe('deployment ABI wire compatibility', () => {
  it('decodes the non-indexed RegistrarSet address emitted by FudaResolver.sol', () => {
    const registrar = '0x3333333333333333333333333333333333333333'
    expect(
      decodeEventLog({
        abi: FUDA_RESOLVER_ABI,
        data: encodeAbiParameters([{ type: 'address' }], [registrar]),
        topics: [keccak256(toHex('RegistrarSet(address)'))],
      }),
    ).toStrictEqual({ args: { registrar }, eventName: 'RegistrarSet' })
  })

  it('encodes getTokenId for the stable resource and decodes its different current token ID', () => {
    const data = encodeFunctionData({ abi: ETH_REGISTRY_ABI, args: [42n], functionName: 'getTokenId' })
    expect(data).toBe(`${keccak256(toHex('getTokenId(uint256)')).slice(0, 10)}${'0'.repeat(62)}2a`)
    expect(
      decodeFunctionResult({
        abi: ETH_REGISTRY_ABI,
        data: encodeAbiParameters([{ type: 'uint256' }], [123n]),
        functionName: 'getTokenId',
      }),
    ).toBe(123n)
  })
})
