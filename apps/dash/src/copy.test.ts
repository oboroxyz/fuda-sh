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
      reception: 'Reception',
      rights: 'Rights',
      venue: 'Profile',
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
    expect(copy.published.addCard).toBe('Add card')
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
      reception: '受付',
      rights: '権利',
      venue: 'プロフィール',
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

  it('names the logo field and every rejection in English', () => {
    const copy = pick(DASH_COPY, 'en')
    expect(copy.logo.label).toBe('Logo')
    expect(copy.logo.change).toBe('Change logo')
    expect(copy.logo.hint).toContain('660×660')
    expect(copy.logo.rejections.tooLarge).toContain('10 MB')
    expect(copy.designer.failures.logo).toContain('Could not upload the logo')
  })

  it('names the logo field and every rejection in Japanese', () => {
    const copy = pick(DASH_COPY, 'ja')
    expect(copy.logo.label).toBe('ロゴ')
    expect(copy.logo.change).toBe('ロゴを変更')
    expect(copy.logo.choose).toBe('画像を選ぶ')
    expect(copy.logo.hint).toContain('660px 以上')
    expect(copy.logo.rejections.tooSmall).toBe('画像が小さすぎます。660px 以上の画像を選んでください。')
  })

  it('explains a refused logo in Japanese without borrowing English words', () => {
    const copy = pick(DASH_COPY, 'ja')
    expect(copy.logo.rejections.type).toBe('PNG・JPEG・WebP の画像を選んでください。')
    expect(copy.logo.updateFailed).toBe('ロゴを更新できませんでした。もう一度お試しください。')
    expect(copy.designer.failures.logo).toContain('入力内容はそのままです')
  })
})
