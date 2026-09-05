import type { EntitlementView } from '@fuda/sdk'
import { describe, expect, it } from 'vitest'

import { classifyInput, displayState } from './verdict.ts'

const UID = `0x${'ab'.repeat(32)}`
const ent = (level: number): EntitlementView => ({
  holder: `0x${'11'.repeat(20)}`,
  issuer: `0x${'f0'.repeat(20)}`,
  level,
  schemaVersion: 1,
  tier: 1,
  usageModel: 1,
  validFrom: 0,
  validUntil: 0,
})

describe(classifyInput, () => {
  it('routes a bare uid to preview and a fuda:v1 payload to admit', () => {
    expect(classifyInput(UID)).toStrictEqual({ kind: 'preview', uid: UID })
    expect(classifyInput(`fuda:v1:${UID}`)).toStrictEqual({ kind: 'admit', qr: `fuda:v1:${UID}` })
  })

  it('trims whitespace and rejects anything else', () => {
    expect(classifyInput(`  ${UID}\n`)).toStrictEqual({ kind: 'preview', uid: UID })
    expect(classifyInput('hello')).toStrictEqual({ kind: 'invalid' })
    expect(classifyInput('fuda:v2:0x00')).toStrictEqual({ kind: 'invalid' })
  })
})

describe(displayState, () => {
  it('is GREEN for an admission ADMIT', () => {
    const s = displayState('admit', {
      body: { decision: 'ADMIT', entitlement: ent(0), reason: 'OK' },
      ok: true,
    })
    expect(s).toMatchObject({ title: 'ADMIT', tone: 'green' })
    expect(s.detail).toContain('REGULAR')
  })

  it('is YELLOW for a preview ADMIT of a level >= 1 right, never GREEN', () => {
    const s = displayState('preview', {
      body: { decision: 'ADMIT', entitlement: ent(1), reason: 'OK' },
      ok: true,
    })
    expect(s).toMatchObject({ title: 'VALID — signature required', tone: 'yellow' })
  })

  it('is YELLOW for a preview ADMIT that carries no entitlement', () => {
    const s = displayState('preview', { body: { decision: 'ADMIT', reason: 'OK' }, ok: true })
    expect(s).toMatchObject({ title: 'VALID — signature required', tone: 'yellow' })
    expect(s.detail).toContain('level unknown')
  })

  it('is GREEN for an admission ADMIT that carries no entitlement', () => {
    const s = displayState('admit', { body: { decision: 'ADMIT', reason: 'OK' }, ok: true })
    expect(s).toMatchObject({ title: 'ADMIT', tone: 'green' })
  })

  it('is GREEN for a preview ADMIT of a level 0 right', () => {
    const s = displayState('preview', {
      body: { decision: 'ADMIT', entitlement: ent(0), reason: 'OK' },
      ok: true,
    })
    expect(s.tone).toBe('green')
  })

  it('is GREEN, never YELLOW, for an admission ADMIT of a level >= 1 right', () => {
    const s = displayState('admit', {
      body: { decision: 'ADMIT', entitlement: ent(1), reason: 'OK' },
      ok: true,
    })
    expect(s).toMatchObject({ title: 'ADMIT', tone: 'green' })
  })

  it('is RED with the reason for a REJECT', () => {
    const s = displayState('admit', { body: { decision: 'REJECT', reason: 'LEVEL_REQUIRED' }, ok: true })
    expect(s).toMatchObject({ detail: 'LEVEL_REQUIRED', title: 'REJECT', tone: 'red' })
  })

  it('is RED with a network banner when the api is unreachable or 5xx', () => {
    const s = displayState('admit', { error: 'fetch failed', network: true, ok: false, status: 0 })
    expect(s).toMatchObject({ banner: 'network', tone: 'red' })
  })

  it('is RED with the error code and no banner for a 4xx', () => {
    const s = displayState('preview', { error: 'bad_uid', network: false, ok: false, status: 400 })
    expect(s).toMatchObject({ detail: 'bad_uid', title: 'REJECT', tone: 'red' })
    expect(s.tone === 'red' ? s.banner : 'network').toBeUndefined()
  })
})
