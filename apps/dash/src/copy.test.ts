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

  it('names the two time windows and their three validity modes in English', () => {
    const copy = pick(DASH_COPY, 'en')
    expect(copy.designer.claimLabel).toBe('Claim window')
    expect(copy.designer.validityLabel).toBe('Validity')
    expect(copy.designer.validityNone).toBe('Never')
    expect(copy.designer.validityDaysMode).toBe('Days after claiming')
    expect(copy.designer.validityFixed).toBe('On set dates')
  })

  it('explains a rejected window and a closed card in English', () => {
    const copy = pick(DASH_COPY, 'en')
    expect(copy.designer.windowProblems.bothRules).toContain('Not both')
    expect(copy.designer.windowProblems.claimOrder).toContain('cannot close before it opens')
    expect(copy.published.claimStates.closedSince).toBe('Closed since {until}')
    expect(copy.published.claimStates.openUntil).toBe('Open until {until}')
    expect(copy.published.validityStates.days).toBe('Valid {days} days after claiming')
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

  it('names the two time windows and the closed state in Japanese', () => {
    const copy = pick(DASH_COPY, 'ja')
    expect(copy.designer.claimLabel).toBe('受付期間')
    expect(copy.designer.validityLabel).toBe('有効期間')
    expect(copy.designer.validityNone).toBe('期限なし')
    expect(copy.designer.validityDaysMode).toBe('受け取ってから◯日')
    expect(copy.designer.validityFixed).toBe('日時を指定')
  })

  it('words a closed card and a rejected window in Japanese', () => {
    const copy = pick(DASH_COPY, 'ja')
    expect(copy.published.claimStates.closedSince).toBe('{until} に受付終了')
    expect(copy.published.claimStates.openUntil).toBe('{until} まで受付')
    expect(copy.published.validityStates.days).toBe('受け取ってから {days} 日間有効')
    expect(copy.designer.windowProblems.bothRules).toContain('どちらか一方')
    expect(copy.designer.windowProblems.validOrder).toContain('終了日時')
  })
})
