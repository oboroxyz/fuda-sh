import type { Hex } from '@fuda/sdk'
import { describe, expect, it } from 'vitest'

import { appleAuthorized, applePassToken, appleWebServiceFrom } from './apple-web-service.ts'

const UID: Hex = `0x${'ab'.repeat(32)}`
const OTHER: Hex = `0x${'cd'.repeat(32)}`

describe(appleWebServiceFrom, () => {
  it('needs both the pass type and the secret', () => {
    expect(appleWebServiceFrom({ APPLE_PASS_TYPE_ID: 'pass.x', APPLE_WEB_SERVICE_SECRET: 's' })).toStrictEqual({
      passTypeId: 'pass.x',
      secret: 's',
    })
    expect(appleWebServiceFrom({ APPLE_PASS_TYPE_ID: 'pass.x' })).toBeNull()
    expect(appleWebServiceFrom({ APPLE_PASS_TYPE_ID: 'pass.x', APPLE_WEB_SERVICE_SECRET: '' })).toBeNull()
    expect(appleWebServiceFrom({ APPLE_WEB_SERVICE_SECRET: 's' })).toBeNull()
  })
})

describe(applePassToken, () => {
  it('is stable per pass, differs per pass and per secret, and is long enough for Wallet', async () => {
    const token = await applePassToken('secret', UID)
    expect(await applePassToken('secret', UID)).toBe(token)
    expect(await applePassToken('secret', OTHER)).not.toBe(token)
    expect(await applePassToken('other', UID)).not.toBe(token)
    expect(token.length).toBeGreaterThanOrEqual(16)
  })
})

describe(appleAuthorized, () => {
  it('accepts only the ApplePass scheme with this pass token', async () => {
    const token = await applePassToken('secret', UID)
    await expect(appleAuthorized('secret', UID, `ApplePass ${token}`)).resolves.toBe(true)
    await expect(appleAuthorized('secret', OTHER, `ApplePass ${token}`)).resolves.toBe(false)
    await expect(appleAuthorized('secret', UID, `Bearer ${token}`)).resolves.toBe(false)
    await expect(appleAuthorized('secret', UID, token)).resolves.toBe(false)
    await expect(appleAuthorized('secret', UID, undefined)).resolves.toBe(false)
  })
})
