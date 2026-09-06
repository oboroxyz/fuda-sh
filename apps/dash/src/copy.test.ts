import { pick } from '@fuda/i18n'
import { describe, expect, it } from 'vitest'

import { DASH_COPY } from './copy.ts'

describe('Dash copy', () => {
  it('defaults callers to the complete English branch', () => {
    const copy = pick(DASH_COPY, 'en')
    expect(copy.nav).toStrictEqual({ issue: 'Issue', overview: 'Overview', rights: 'Rights' })
    expect(copy.auth.tokenLabel).toBe('Admin token')
    expect(copy.revoke.confirm).toBe('Revoke right')
  })

  it('contains Japanese operator copy for every typed field', () => {
    const copy = pick(DASH_COPY, 'ja')
    expect(copy.nav).toStrictEqual({ issue: '発行', overview: '概要', rights: '権利' })
    expect(copy.auth.tokenLabel).toBe('管理トークン')
    expect(copy.revoke.confirm).toBe('権利を取り消す')
  })
})
