import { describe, expect, it } from 'vitest'

import {
  isIssuerHandle,
  isMemberNumber,
  issuerEnsName,
  memberEnsName,
  normalizeParentName,
  parseFudaEnsName,
} from './names.ts'

describe('ENS names', () => {
  it.each(['coffee', 'coffee-2', 'a', 'a'.repeat(63)])('accepts the canonical Issuer Handle %s', (handle) => {
    expect(isIssuerHandle(handle)).toBe(true)
  })

  it.each([
    '',
    '-coffee',
    'coffee-',
    'Coffee',
    'coffee_shop',
    'a'.repeat(64),
    'www',
    'api',
    'dash',
    'gate',
    'app',
    'admin',
    'fuda',
  ])('rejects an invalid or reserved Issuer Handle %s', (handle) => {
    expect(isIssuerHandle(handle)).toBe(false)
  })

  it('accepts a member number with a valid Luhn-mod-28 check character', () => {
    expect(isMemberNumber('qj2yxphepdrka')).toBe(true)
  })

  it.each(['qj2yxphepdrk2', 'QJ2YXPHEPDRKA', 'qj2y-xphe-pdrka', 'qj2yxphepdrk'])(
    'rejects a corrupted or non-canonical member number %s',
    (memberNumber) => {
      expect(isMemberNumber(memberNumber)).toBe(false)
    },
  )

  it('normalizes parent casing and one terminal root dot', () => {
    expect(normalizeParentName('Fuda.ETH.')).toBe('fuda.eth')
  })

  it.each(['fuda', 'fuda..eth', '.fuda.eth', 'fuda.eth..', 'fuda_eth.test'])(
    'rejects the malformed parent name %s',
    (parentName) => {
      expect(() => normalizeParentName(parentName)).toThrow('invalid ENS parent name')
    },
  )

  it('constructs canonical Issuer and member names', () => {
    expect(issuerEnsName('coffee', 'Fuda.ETH.')).toBe('coffee.fuda.eth')
    expect(memberEnsName('qj2yxphepdrka', 'coffee', 'Fuda.ETH.')).toBe('qj2yxphepdrka.coffee.fuda.eth')
  })

  it('rejects invalid labels instead of repairing them during construction', () => {
    expect(() => issuerEnsName('Coffee', 'fuda.eth')).toThrow('invalid issuer handle')
    expect(() => memberEnsName('QJ2YXPHEPDRKA', 'coffee', 'fuda.eth')).toThrow('invalid member number')
  })

  it('parses only exact Issuer and member depths beneath the configured parent', () => {
    expect(parseFudaEnsName('COFFEE.FUDA.ETH.', 'fuda.eth')).toStrictEqual({
      issuerHandle: 'coffee',
      kind: 'issuer',
    })
    expect(parseFudaEnsName('QJ2YXPHEPDRKA.COFFEE.FUDA.ETH.', 'fuda.eth')).toStrictEqual({
      issuerHandle: 'coffee',
      kind: 'member',
      memberNumber: 'qj2yxphepdrka',
    })
  })

  it.each([
    'fuda.eth',
    'extra.qj2yxphepdrka.coffee.fuda.eth',
    'coffee.other.eth',
    'Coffee-.fuda.eth',
    'qj2yxphepdrk2.coffee.fuda.eth',
  ])('does not parse a foreign, malformed, or unsupported name %s', (name) => {
    expect(parseFudaEnsName(name, 'fuda.eth')).toBeNull()
  })
})
