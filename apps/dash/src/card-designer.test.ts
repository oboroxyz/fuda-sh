import { describe, expect, it } from 'vitest'

import {
  canSubmit,
  cardBodyFrom,
  cardUrl,
  createBodyFrom,
  createFailureOf,
  displayUrl,
  EMPTY_FORM,
  handleStatusOf,
  slugStatusOf,
  withSlug,
  withTitle,
} from './card-designer.ts'
import type { DesignerForm, DesignerStatus } from './card-designer.ts'

const filled: DesignerForm = {
  ...EMPTY_FORM,
  handle: 'wassie-coffee',
  name: 'Wassie Coffee',
  perk: 'Stamp card · 10 stamps',
  reward: 'Free drink of your choice',
  tagline: 'Omotesando · Coffee shop',
}

const free: DesignerStatus = { handle: 'available', slug: 'available' }

describe(handleStatusOf, () => {
  it('answers locally before the api is asked', () => {
    expect(handleStatusOf('')).toBe('idle')
    expect(handleStatusOf('Wassie')).toBe('format')
    expect(handleStatusOf('api')).toBe('reserved')
    expect(handleStatusOf('wassie-coffee')).toBe('checking')
  })
})

describe(slugStatusOf, () => {
  it('applies the card slug rule with its own reserved names', () => {
    expect(slugStatusOf('')).toBe('idle')
    expect(slugStatusOf('Coffee Club')).toBe('format')
    expect(slugStatusOf('settings')).toBe('reserved')
    expect(slugStatusOf('coffee-club')).toBe('checking')
  })
})

describe(withTitle, () => {
  it('suggests the slug from the title until the operator writes one', () => {
    expect(withTitle(EMPTY_FORM, 'Coffee Club').slug).toBe('coffee-club')
    expect(withTitle(EMPTY_FORM, '会員カード').slug).toBe('')
    expect(EMPTY_FORM.slug).toBe('membership-card')
  })

  it('stops following the title once the slug was edited by hand', () => {
    const edited = withSlug(EMPTY_FORM, 'club')
    expect(edited.slugEdited).toBe(true)
    expect(withTitle(edited, 'Coffee Club').slug).toBe('club')
    expect(withTitle(edited, 'Coffee Club').title).toBe('Coffee Club')
  })
})

describe(cardBodyFrom, () => {
  it('maps the card fields, its slug and an expiry in days', () => {
    const body = cardBodyFrom({ ...filled, category: 'ticket', slug: 'summer', validityDays: 30 })
    expect(body?.slug).toBe('summer')
    expect(body?.category).toBe('ticket')
    expect(body?.validityDays).toBe(30)
    expect(body?.lockScreen).toBe(false)
  })

  it('carries the venue only when the lock screen is on and a position was granted', () => {
    const venue = { lat: 35.665, lng: 139.712 }
    expect(cardBodyFrom({ ...filled, lockScreen: true, venue })?.venue).toStrictEqual(venue)
    expect(cardBodyFrom({ ...filled, lockScreen: true, venue: null })?.venue).toBeUndefined()
    expect(cardBodyFrom({ ...filled, lockScreen: false, venue })?.venue).toBeUndefined()
  })

  it('is null while the slug or the title cannot be used', () => {
    expect(cardBodyFrom({ ...filled, slug: '' })).toBeNull()
    expect(cardBodyFrom({ ...filled, slug: 'Summer Card' })).toBeNull()
    expect(cardBodyFrom({ ...filled, slug: 'cards' })).toBeNull()
    expect(cardBodyFrom({ ...filled, title: '' })).toBeNull()
  })
})

describe(createBodyFrom, () => {
  it('nests the card under the venue and upper-cases the brand colour', () => {
    const body = createBodyFrom({ ...filled, brandColor: '#6f4320' })
    expect(body?.brandColor).toBe('#6F4320')
    expect(body?.handle).toBe('wassie-coffee')
    expect(body?.card).toMatchObject({
      category: 'membership',
      slug: 'membership-card',
      title: 'Membership Card',
      validityDays: null,
    })
  })

  it('is null while a required field, the colour or the slug is not usable', () => {
    expect(createBodyFrom(EMPTY_FORM)).toBeNull()
    expect(createBodyFrom({ ...filled, brandColor: 'brown' })).toBeNull()
    expect(createBodyFrom({ ...filled, name: '' })).toBeNull()
    expect(createBodyFrom({ ...filled, handle: 'Wassie' })).toBeNull()
    expect(createBodyFrom({ ...filled, slug: '' })).toBeNull()
  })
})

describe(canSubmit, () => {
  it('allows a complete venue form whose handle and slug are free', () => {
    expect(canSubmit('venue', filled, free, false)).toBe(true)
    expect(canSubmit('venue', filled, free, true)).toBe(false)
    expect(canSubmit('venue', filled, { ...free, handle: 'taken' }, false)).toBe(false)
    expect(canSubmit('venue', filled, { ...free, slug: 'reserved' }, false)).toBe(false)
    expect(canSubmit('venue', EMPTY_FORM, free, false)).toBe(false)
  })

  it('ignores the handle when the venue already exists and only a card is added', () => {
    expect(canSubmit('card', { ...EMPTY_FORM, handle: '' }, free, false)).toBe(true)
    expect(canSubmit('card', { ...EMPTY_FORM, handle: '' }, { ...free, handle: 'taken' }, false)).toBe(true)
    expect(canSubmit('card', { ...EMPTY_FORM, slug: '' }, free, false)).toBe(false)
    expect(canSubmit('card', EMPTY_FORM, { ...free, slug: 'taken' }, false)).toBe(false)
  })

  it('still allows a submit while an availability check is in flight or unknown', () => {
    expect(canSubmit('venue', filled, { handle: 'checking', slug: 'checking' }, false)).toBe(true)
    expect(canSubmit('venue', filled, { handle: 'unknown', slug: 'unknown' }, false)).toBe(true)
  })
})

describe(createFailureOf, () => {
  it('separates a taken handle, a taken slug, an expired session and an unreachable api', () => {
    expect(createFailureOf(409, false, 'handle_taken')).toBe('taken')
    expect(createFailureOf(409, false, 'slug_taken')).toBe('slugTaken')
    expect(createFailureOf(409, false, 'issuer_exists')).toBe('input')
    expect(createFailureOf(401, false, 'unauthorized')).toBe('session')
    expect(createFailureOf(0, true, 'offline')).toBe('network')
  })

  it('tells a rejected slug apart from any other rejected field', () => {
    expect(createFailureOf(400, false, 'bad_slug')).toBe('slugInvalid')
    expect(createFailureOf(400, false, 'bad_handle')).toBe('input')
    expect(createFailureOf(400, false, 'bad_input')).toBe('input')
  })
})

describe(displayUrl, () => {
  it('shows the link the way a poster does', () => {
    expect(displayUrl('https://fuda.sh/@wassie-coffee')).toBe('fuda.sh/@wassie-coffee')
    expect(displayUrl('http://localhost:5173/@wassie-coffee')).toBe('localhost:5173/@wassie-coffee')
    expect(displayUrl(cardUrl('https://fuda.sh/@wassie-coffee', 'summer'))).toBe(
      'fuda.sh/@wassie-coffee/summer',
    )
  })
})

describe(cardUrl, () => {
  it('puts the card under the venue page without doubling the separator', () => {
    expect(cardUrl('https://fuda.sh/@wassie-coffee', 'summer')).toBe('https://fuda.sh/@wassie-coffee/summer')
    expect(cardUrl('https://fuda.sh/@wassie-coffee/', 'summer')).toBe('https://fuda.sh/@wassie-coffee/summer')
  })
})
