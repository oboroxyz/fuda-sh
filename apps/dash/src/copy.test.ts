import { pick } from '@fuda/i18n'
import { describe, expect, it } from 'vitest'

import { DASH_COPY } from './copy.ts'

describe('Dash copy', () => {
  it('defaults callers to the complete English branch', () => {
    const copy = pick(DASH_COPY, 'en')
    expect(copy.nav).toStrictEqual({
      card: 'Your card',
      issue: 'Issue',
      newCard: 'New card',
      overview: 'Overview',
      rights: 'Rights',
    })
    expect(copy.auth.tokenLabel).toBe('Admin token')
    expect(copy.auth.title).toBe('fuda. dashboard')
    expect(copy.designer.submit).toBe('Create card')
  })

  it('contains Japanese operator copy for every typed field', () => {
    const copy = pick(DASH_COPY, 'ja')
    expect(copy.nav).toStrictEqual({
      card: 'カード',
      issue: '発行',
      newCard: 'カードを作る',
      overview: '概要',
      rights: '権利',
    })
    expect(copy.auth.tokenLabel).toBe('管理トークン')
    expect(copy.auth.title).toBe('fuda. dashboard')
    expect(copy.designer.submit).toBe('カードを作成')
  })
})
