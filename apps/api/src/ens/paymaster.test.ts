import { FUDA_REGISTRAR_ABI } from '@fuda/ens-contracts'
import { encodeFunctionData, parseAbi } from 'viem'
import { describe, expect, it } from 'vitest'

import { sponsorable } from './paymaster.ts'

const REGISTRAR = '0x58AF04ff5e6DAB45ECD17bD38fC4f4BBa45778B9'
const OTHER = `0x${'99'.repeat(20)}` as const

const SMART_WALLET_ABI = parseAbi([
  'function execute(address dest,uint256 value,bytes func)',
  'function executeBatch((address target,uint256 value,bytes data)[] calls)',
])

const claimCall = () =>
  encodeFunctionData({
    abi: FUDA_REGISTRAR_ABI,
    args: ['bakery', REGISTRAR, 2000n, 0n, 1500n, '0x1234'],
    functionName: 'claim',
  })

const transferCall = () =>
  encodeFunctionData({
    abi: parseAbi(['function transfer(address to,uint256 amount)']),
    args: [OTHER, 1n],
    functionName: 'transfer',
  })

const execute = (target: string, inner: string) =>
  encodeFunctionData({
    abi: SMART_WALLET_ABI,
    args: [target as `0x${string}`, 0n, inner as `0x${string}`],
    functionName: 'execute',
  })

const executeBatch = (calls: readonly (readonly [string, string])[]) =>
  encodeFunctionData({
    abi: SMART_WALLET_ABI,
    args: [
      calls.map(([target, data]) => ({
        data: data as `0x${string}`,
        target: target as `0x${string}`,
        value: 0n,
      })),
    ],
    functionName: 'executeBatch',
  })

describe(sponsorable, () => {
  it('sponsors a claim sent to the configured registrar', () => {
    expect(sponsorable(execute(REGISTRAR, claimCall()), REGISTRAR)).toBe(true)
  })

  it('refuses another contract, even for a claim-shaped call', () => {
    expect(sponsorable(execute(OTHER, claimCall()), REGISTRAR)).toBe(false)
  })

  it('refuses another function on the registrar', () => {
    expect(sponsorable(execute(REGISTRAR, transferCall()), REGISTRAR)).toBe(false)
  })

  it('checks every call in a batch, not just the first', () => {
    const good = executeBatch([[REGISTRAR, claimCall()]])
    const mixed = executeBatch([
      [REGISTRAR, claimCall()],
      [OTHER, transferCall()],
    ])

    expect(sponsorable(good, REGISTRAR)).toBe(true)
    expect(sponsorable(mixed, REGISTRAR)).toBe(false)
  })

  it('refuses an empty batch and undecodable call data', () => {
    expect(sponsorable(executeBatch([]), REGISTRAR)).toBe(false)
    expect(sponsorable('0xdeadbeef', REGISTRAR)).toBe(false)
    expect(sponsorable('0x', REGISTRAR)).toBe(false)
  })

  it('refuses a call the wallet makes directly rather than through execute', () => {
    expect(sponsorable(claimCall(), REGISTRAR)).toBe(false)
  })
})
