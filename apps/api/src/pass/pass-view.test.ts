import { describe, expect, it } from 'vitest'

import { passView } from './pass-view.ts'
import { PassPage } from './PassPage.tsx'

const UID = `0x${'ab'.repeat(32)}` as const
const HOLDER = '0x1111111111111111111111111111111111111111' as const

describe(passView, () => {
  it('maps an active ADMIT to VALID with tier label and short holder', () => {
    const view = passView(
      { branding: null, holder: HOLDER, level: 'bearer', logoPrefix: null, tier: 2, uid: UID },
      { decision: 'ADMIT', reason: 'OK' },
    )
    expect(view).toMatchObject({
      holderShort: '0x1111…1111',
      qr: `fuda:v1:${UID}`,
      status: 'VALID',
      tier: 'VIP',
    })
  })

  it('surfaces the REJECT reason as the status', () => {
    const view = passView(
      { branding: null, holder: HOLDER, level: 'bearer', logoPrefix: null, tier: 0, uid: UID },
      { decision: 'REJECT', reason: 'REVOKED' },
    )
    expect(view.status).toBe('REVOKED')
  })

  it('reports UNKNOWN when the chain could not be read and — for a missing holder', () => {
    const view = passView(
      { branding: null, holder: null, level: 'private', logoPrefix: null, tier: 1, uid: UID },
      null,
    )
    expect(view).toMatchObject({ holderShort: '—', status: 'UNKNOWN' })
  })

  it('falls back to a numbered label for a tier beyond the known ones', () => {
    const view = passView(
      { branding: null, holder: HOLDER, level: 'bearer', logoPrefix: null, tier: 9, uid: UID },
      null,
    )
    expect(view.tier).toBe('TIER 9')
  })
})

describe(PassPage, () => {
  it('renders enabled stamp progress and refreshes it from the public summary endpoint', async () => {
    const view = passView(
      {
        branding: null,
        holder: `0x${'11'.repeat(20)}`,
        level: 'bearer',
        logoPrefix: null,
        tier: 1,
        uid: `0x${'ab'.repeat(32)}`,
      },
      { decision: 'ADMIT', reason: 'OK' },
      { dailyLimit: 2, enabled: true, goal: 10, today: 1, total: 4 },
    )
    const page = String(await PassPage(view))
    expect(page).toContain('id="stamps"')
    expect(page).not.toContain('id="stamps" class="stamps" hidden')
    expect(page).toContain('4 / 10 stamps')
    expect(page).toContain('1 / 2 today')
    expect(page).toContain(`/v1/stamps/${view.uid}`)
  })

  it('hides stamp progress when stamps are disabled', async () => {
    const view = passView(
      {
        branding: null,
        holder: `0x${'11'.repeat(20)}`,
        level: 'bearer',
        logoPrefix: null,
        tier: 1,
        uid: `0x${'ab'.repeat(32)}`,
      },
      { decision: 'ADMIT', reason: 'OK' },
      { dailyLimit: 2, enabled: false, goal: 10, today: 0, total: 4 },
    )
    expect(String(await PassPage(view))).toContain('id="stamps" class="stamps" hidden')
  })
})
