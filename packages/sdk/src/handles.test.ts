import { describe, expect, it } from 'vitest'

import { isCardCategory, isIssuerHandle, issuerHandleProblem, normalizeBrandColor } from './handles.ts'

describe('issuer handles', () => {
  it('accepts lowercase ascii with inner hyphens', () => {
    expect(isIssuerHandle('wassie-coffee')).toBe(true)
    expect(isIssuerHandle('a')).toBe(true)
    expect(isIssuerHandle('a'.repeat(63))).toBe(true)
  })

  it('rejects edge hyphens, upper case, length and reserved names', () => {
    expect(isIssuerHandle('-wassie')).toBe(false)
    expect(isIssuerHandle('Wassie')).toBe(false)
    expect(isIssuerHandle('a'.repeat(64))).toBe(false)
    expect(isIssuerHandle('issuers')).toBe(false)
    expect(isIssuerHandle('auth')).toBe(false)
  })

  it('names the problem for a form', () => {
    expect(issuerHandleProblem('')).toBe('empty')
    expect(issuerHandleProblem('Wassie')).toBe('format')
    expect(issuerHandleProblem('api')).toBe('reserved')
    expect(issuerHandleProblem('wassie')).toBeNull()
  })
})

describe('brand colours and categories', () => {
  it('normalizes a hex colour and rejects anything else', () => {
    expect(normalizeBrandColor('#6f4320')).toBe('#6F4320')
    expect(normalizeBrandColor('6F4320')).toBeNull()
    expect(normalizeBrandColor('#fff')).toBeNull()
  })

  it('knows the two card categories', () => {
    expect(isCardCategory('membership')).toBe(true)
    expect(isCardCategory('ticket')).toBe(true)
    expect(isCardCategory('loyalty')).toBe(false)
  })
})
