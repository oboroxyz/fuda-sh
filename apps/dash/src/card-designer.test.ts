import { describe, expect, it } from 'vitest'

import {
  canSubmit,
  cardBodyFrom,
  cardUrl,
  claimStateOf,
  createFailureOf,
  displayUrl,
  EMPTY_FORM,
  formatInstant,
  handleStatusOf,
  localFromUnix,
  slugStatusOf,
  unixFromLocal,
  validityStateOf,
  windowProblemOf,
  withCategory,
  withSlug,
  withTitle,
  withValidityDays,
  withValidityMode,
  withWindow,
} from './card-designer.ts'
import type { DesignerForm, DesignerStatus } from './card-designer.ts'

const filled: DesignerForm = {
  ...EMPTY_FORM,
  description: 'Stamp card · 10 stamps\nFree drink of your choice',
  handle: 'wassie-coffee',
  name: 'Wassie Coffee',
  tagline: 'Omotesando · Coffee shop',
}

const free: DesignerStatus = { handle: 'available', slug: 'available' }

describe(handleStatusOf, () => {
  it('answers locally before the api is asked', () => {
    expect(handleStatusOf('')).toBe('idle')
    expect(handleStatusOf('Wassie')).toBe('format')
    expect(handleStatusOf('ab--cd')).toBe('format')
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

describe(canSubmit, () => {
  it('ignores the handle when the venue already exists and only a card is added', () => {
    expect(canSubmit('card', { ...EMPTY_FORM, handle: '' }, free, false)).toBe(true)
    expect(canSubmit('card', { ...EMPTY_FORM, handle: '' }, { ...free, handle: 'taken' }, false)).toBe(true)
    expect(canSubmit('card', { ...EMPTY_FORM, slug: '' }, free, false)).toBe(false)
    expect(canSubmit('card', EMPTY_FORM, { ...free, slug: 'taken' }, false)).toBe(false)
  })
})

describe(createFailureOf, () => {
  it('maps ENS prerequisites to venue guidance', () => {
    expect(createFailureOf(409, false, 'ens_required')).toBe('ensRequired')
    expect(createFailureOf(503, false, 'ens_not_configured')).toBe('ensUnavailable')
  })

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

// A whole minute, because `datetime-local` has no seconds to round-trip.
const MINUTE = 1_756_999_980
const DOORS = '2026-09-04T19:00'
const CURTAIN = '2026-09-04T22:00'

const ticket = withCategory(EMPTY_FORM, 'ticket')

describe(unixFromLocal, () => {
  it('round-trips a local instant through the field text and back', () => {
    expect(unixFromLocal(localFromUnix(MINUTE))).toBe(MINUTE)
    expect(localFromUnix(unixFromLocal(DOORS))).toBe(DOORS)
    expect(localFromUnix(null)).toBe('')
  })

  it('reads an empty or half-typed field as an unbounded end, not as zero', () => {
    expect(unixFromLocal('')).toBeNull()
    expect(unixFromLocal('not a date')).toBeNull()
  })
})

describe(formatInstant, () => {
  it('prints the same wall clock the operator typed, without the T', () => {
    expect(formatInstant(unixFromLocal(DOORS) ?? 0)).toBe('2026-09-04 19:00')
  })
})

describe(withValidityMode, () => {
  it('clears the other rule so the body can never carry both', () => {
    const both: DesignerForm = { ...EMPTY_FORM, validFrom: DOORS, validityDays: 30 }
    expect(withValidityMode(both, 'fixed').validityDays).toBeNull()
    expect(withValidityMode(both, 'days').validFrom).toBe('')
    expect(withValidityMode(both, 'days').validityDays).toBe(30)
    expect(withValidityMode(both, 'none').validityDays).toBeNull()
    expect(withValidityMode(both, 'none').validFrom).toBe('')
  })

  it('starts the relative rule at a usable number of days', () => {
    expect(withValidityMode(EMPTY_FORM, 'days').validityDays).toBe(30)
    expect(withValidityMode(EMPTY_FORM, 'days').validityMode).toBe('days')
  })
})

describe(withCategory, () => {
  it('gives each card type the windows it usually wants', () => {
    expect(ticket.validityMode).toBe('fixed')
    expect(ticket.claimFrom).toBe('')
    expect(withCategory(ticket, 'membership').validityMode).toBe('none')
    expect(withCategory(ticket, 'membership').validUntil).toBe('')
  })

  it('stops overwriting the windows once the operator set one by hand', () => {
    const edited = withWindow(EMPTY_FORM, 'claimUntil', CURTAIN)
    expect(withCategory(edited, 'ticket').claimUntil).toBe(CURTAIN)
    expect(withCategory(edited, 'ticket').validityMode).toBe('none')
    expect(withCategory(withValidityDays(EMPTY_FORM, 90), 'ticket').validityDays).toBe(90)
    expect(withCategory(edited, 'ticket').category).toBe('ticket')
  })
})

describe(withWindow, () => {
  it("closes a ticket's claim window when its event ends", () => {
    expect(withWindow(ticket, 'validUntil', CURTAIN).claimUntil).toBe(CURTAIN)
    expect(withWindow(EMPTY_FORM, 'validUntil', CURTAIN).claimUntil).toBe('')
  })

  it('leaves a hand-typed claim end alone from then on', () => {
    const typed = withWindow(ticket, 'claimUntil', DOORS)
    expect(typed.claimUntilEdited).toBe(true)
    expect(withWindow(typed, 'validUntil', CURTAIN).claimUntil).toBe(DOORS)
    expect(withWindow(typed, 'validUntil', CURTAIN).validUntil).toBe(CURTAIN)
  })
})

describe(windowProblemOf, () => {
  it('names the two rules the api would reject', () => {
    expect(windowProblemOf(EMPTY_FORM)).toBeNull()
    expect(windowProblemOf({ ...EMPTY_FORM, validFrom: DOORS, validityDays: 30 })).toBe('bothRules')
    expect(windowProblemOf({ ...EMPTY_FORM, claimFrom: CURTAIN, claimUntil: DOORS })).toBe('claimOrder')
    expect(windowProblemOf({ ...EMPTY_FORM, validFrom: CURTAIN, validUntil: DOORS })).toBe('validOrder')
    expect(windowProblemOf({ ...EMPTY_FORM, claimFrom: DOORS, claimUntil: CURTAIN })).toBeNull()
  })
})

describe('card body windows', () => {
  it('carries both windows to the api as unix seconds', () => {
    const body = cardBodyFrom({ ...filled, claimFrom: DOORS, validFrom: DOORS, validUntil: CURTAIN })
    expect(body?.claimFrom).toBe(unixFromLocal(DOORS))
    expect(body?.claimUntil).toBeNull()
    expect(body?.validFrom).toBe(unixFromLocal(DOORS))
    expect(body?.validUntil).toBe(unixFromLocal(CURTAIN))
    expect(body?.validityDays).toBeNull()
  })

  it('is null for an inverted window or for two validity rules at once', () => {
    expect(cardBodyFrom({ ...filled, claimFrom: CURTAIN, claimUntil: DOORS })).toBeNull()
    expect(cardBodyFrom({ ...filled, validFrom: CURTAIN, validUntil: DOORS })).toBeNull()
    expect(cardBodyFrom({ ...filled, validUntil: CURTAIN, validityDays: 30 })).toBeNull()
    expect(canSubmit('card', { ...filled, claimFrom: CURTAIN, claimUntil: DOORS }, free, false)).toBe(false)
    expect(canSubmit('card', { ...filled, validUntil: CURTAIN, validityDays: 30 }, free, false)).toBe(false)
  })
})

const openCard = {
  claimFrom: null,
  claimUntil: null,
  claimable: true,
  validFrom: null,
  validUntil: null,
  validityDays: null,
}

describe(claimStateOf, () => {
  it('separates a card that is open, closing, closed and not open yet', () => {
    const card = {
      ...openCard,
      category: 'membership',
      description: '',
      id: 'c',
      slug: 's',
      title: 'T',
    } as const
    expect(claimStateOf(card, 1000)).toBe('open')
    expect(claimStateOf({ ...card, claimUntil: 2000 }, 1000)).toBe('openUntil')
    expect(claimStateOf({ ...card, claimUntil: 500, claimable: false }, 1000)).toBe('closed')
    expect(claimStateOf({ ...card, claimFrom: 2000, claimable: false }, 1000)).toBe('notYet')
  })
})

describe(validityStateOf, () => {
  it('tells the relative rule, the fixed one and no rule apart', () => {
    expect(validityStateOf(openCard)).toBe('never')
    expect(validityStateOf({ ...openCard, validityDays: 30 })).toBe('days')
    expect(validityStateOf({ ...openCard, validFrom: 1, validUntil: 2 })).toBe('fixed')
    expect(validityStateOf({ ...openCard, validFrom: 1 })).toBe('from')
    expect(validityStateOf({ ...openCard, validUntil: 2 })).toBe('until')
  })
})
