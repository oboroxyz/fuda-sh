import type { EntitlementView } from '@fuda/sdk'
import { describe, expect, it } from 'vitest'

import { classifyInput, displayState, unreadableInput } from './verdict.ts'

const UID = `0x${'ab'.repeat(32)}`
const ent = (level: number, validUntil = 0): EntitlementView => ({
  holder: `0x${'11'.repeat(20)}`,
  issuer: `0x${'f0'.repeat(20)}`,
  level,
  schemaVersion: 1,
  tier: 1,
  usageModel: 1,
  validFrom: 0,
  validUntil,
})

const del = { active: true, issuer: `0x${'f0'.repeat(20)}` as const, name: 'fuda root' }

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
    expect(s.facts).toMatchObject({ holder: '0x1111…1111', tier: 'REGULAR', usage: 'multi-use' })
  })

  it('reports the delegation it was issued under and the validity end', () => {
    const s = displayState('admit', {
      body: { decision: 'ADMIT', delegation: del, entitlement: ent(0, 1_790_467_200), reason: 'OK' },
      ok: true,
    })
    expect(s.facts.delegation).toBe('fuda root')
    expect(s.facts.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
  })

  it('leaves the validity end unset for a right that never expires', () => {
    const s = displayState('admit', {
      body: { decision: 'ADMIT', entitlement: ent(0), reason: 'OK' },
      ok: true,
    })
    expect(s.facts.validUntil).toBeNull()
  })

  it('carries the facts it has on a REJECT too, so staff can see what was presented', () => {
    const s = displayState('admit', {
      body: { decision: 'REJECT', delegation: del, entitlement: ent(0), reason: 'REVOKED' },
      ok: true,
    })
    expect(s).toMatchObject({ detail: 'REVOKED', tone: 'red' })
    expect(s.facts).toMatchObject({ delegation: 'fuda root', tier: 'REGULAR' })
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

  it('names the verifier and when it verified, from a human badge', () => {
    const s = displayState('admit', {
      body: {
        badges: [{ at: 1_790_405_702, kind: 'human', verifier: 'world' }],
        decision: 'ADMIT',
        entitlement: ent(0),
        reason: 'OK',
      },
      ok: true,
    })
    expect(s.badge?.verifier).toBe('world')
    expect(s.badge?.at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u)
  })

  it('has no badge when the response carries none', () => {
    const s = displayState('admit', {
      body: { decision: 'ADMIT', entitlement: ent(0), reason: 'OK' },
      ok: true,
    })
    expect(s.badge).toBeNull()
  })

  it('ignores a badge kind it does not display', () => {
    const s = displayState('admit', {
      body: {
        badges: [{ at: 1_790_405_702, kind: 'human', verifier: 'world' }],
        decision: 'ADMIT',
        entitlement: ent(0),
        reason: 'OK',
      },
      ok: true,
    })
    expect(s.badge).not.toBeNull()
  })

  it('has no badge and no facts when the request itself failed', () => {
    const s = displayState('admit', { error: 'fetch failed', network: true, ok: false, status: 0 })
    expect(s.badge).toBeNull()
    expect(s.facts).toStrictEqual({
      delegation: null,
      holder: null,
      tier: null,
      usage: null,
      validUntil: null,
    })
  })
})

describe(unreadableInput, () => {
  it('is RED with no facts, for input that never reached the api', () => {
    expect(unreadableInput()).toStrictEqual({
      badge: null,
      detail: 'not a fuda pass',
      facts: { delegation: null, holder: null, tier: null, usage: null, validUntil: null },
      title: 'REJECT',
      tone: 'red',
    })
  })
})
