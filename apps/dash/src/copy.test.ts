import { pick } from '@fuda/i18n'
import { describe, expect, it } from 'vitest'

import { DASH_COPY } from './copy.ts'

describe('Dash copy', () => {
  it('defaults callers to the complete English branch', () => {
    const copy = pick(DASH_COPY, 'en')
    expect(copy.nav).toStrictEqual({
      card: 'Your cards',
      issue: 'Issue',
      newCard: 'New card',
      overview: 'Overview',
      rights: 'Rights',
    })
    expect(copy.auth.tokenLabel).toBe('Admin token')
    expect(copy.auth.title).toBe('fuda. dashboard')
    expect(copy.designer.submit).toBe('Create card')
  })

  it('names the card link field and its statuses in English', () => {
    const copy = pick(DASH_COPY, 'en')
    expect(copy.designer.slugLabel).toBe('Card link')
    expect(copy.designer.slugStatus.taken).toBe('Already used')
    expect(copy.designer.slugStatus.reserved).toBe('This name is reserved.')
    expect(copy.designer.failures.slugTaken).toContain('already used')
    expect(copy.published.addCard).toBe('Add another card')
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

  it('names the card link field and the card list in Japanese', () => {
    const copy = pick(DASH_COPY, 'ja')
    expect(copy.designer.slugLabel).toBe('カードのリンク')
    expect(copy.designer.slugStatus.taken).toBe('すでに使われています')
    expect(copy.published.addCard).toBe('カードを追加')
    expect(copy.published.titleMany).toBe('公開中のカード')
    expect(copy.published.venueLabel).toBe('店舗ページ')
  })
})
