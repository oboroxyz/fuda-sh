import { describe, expect, it } from 'vitest'

import {
  canSubmit,
  createBodyFrom,
  createFailureOf,
  displayUrl,
  EMPTY_FORM,
  handleStatusOf,
} from './card-designer.ts'
import type { DesignerForm } from './card-designer.ts'

const filled: DesignerForm = {
  ...EMPTY_FORM,
  handle: 'wassie-coffee',
  name: 'Wassie Coffee',
  perk: 'Stamp card · 10 stamps',
  reward: 'Free drink of your choice',
  tagline: 'Omotesando · Coffee shop',
}

describe(handleStatusOf, () => {
  it('answers locally before the api is asked', () => {
    expect(handleStatusOf('')).toBe('idle')
    expect(handleStatusOf('Wassie')).toBe('format')
    expect(handleStatusOf('api')).toBe('reserved')
    expect(handleStatusOf('wassie-coffee')).toBe('checking')
  })
})

describe(createBodyFrom, () => {
  it('maps the form onto the api body and upper-cases the brand colour', () => {
    const body = createBodyFrom({ ...filled, brandColor: '#6f4320' })
    expect(body?.brandColor).toBe('#6F4320')
    expect(body?.handle).toBe('wassie-coffee')
    expect(body?.card).toMatchObject({
      category: 'membership',
      lockScreen: false,
      title: 'Membership Card',
      validityDays: null,
    })
  })

  it('carries the venue only when the lock screen is on and a position was granted', () => {
    const venue = { lat: 35.665, lng: 139.712 }
    expect(createBodyFrom({ ...filled, lockScreen: true, venue })?.card.venue).toStrictEqual(venue)
    expect(createBodyFrom({ ...filled, lockScreen: true, venue: null })?.card.venue).toBeUndefined()
    expect(createBodyFrom({ ...filled, lockScreen: false, venue })?.card.venue).toBeUndefined()
  })

  it('keeps an expiry in days and a ticket category', () => {
    const body = createBodyFrom({ ...filled, category: 'ticket', validityDays: 30 })
    expect(body?.card.category).toBe('ticket')
    expect(body?.card.validityDays).toBe(30)
  })

  it('is null while a required field or the colour is not usable', () => {
    expect(createBodyFrom(EMPTY_FORM)).toBeNull()
    expect(createBodyFrom({ ...filled, brandColor: 'brown' })).toBeNull()
    expect(createBodyFrom({ ...filled, name: '' })).toBeNull()
    expect(createBodyFrom({ ...filled, handle: 'Wassie' })).toBeNull()
  })
})

describe(canSubmit, () => {
  it('allows a complete form whose handle is free and blocks every other state', () => {
    expect(canSubmit(filled, 'available', false)).toBe(true)
    expect(canSubmit(filled, 'available', true)).toBe(false)
    expect(canSubmit(filled, 'taken', false)).toBe(false)
    expect(canSubmit(filled, 'reserved', false)).toBe(false)
    expect(canSubmit(EMPTY_FORM, 'available', false)).toBe(false)
  })

  it('still allows a submit while the availability check is in flight or unknown', () => {
    expect(canSubmit(filled, 'checking', false)).toBe(true)
    expect(canSubmit(filled, 'unknown', false)).toBe(true)
  })
})

describe(createFailureOf, () => {
  it('separates a taken link, an expired session, bad input and an unreachable api', () => {
    expect(createFailureOf(409, false, 'handle_taken')).toBe('taken')
    expect(createFailureOf(409, false, 'issuer_exists')).toBe('input')
    expect(createFailureOf(401, false, 'unauthorized')).toBe('session')
    expect(createFailureOf(400, false, 'bad_handle')).toBe('input')
    expect(createFailureOf(0, true, 'offline')).toBe('network')
  })
})

describe(displayUrl, () => {
  it('shows the link the way a poster does', () => {
    expect(displayUrl('https://fuda.sh/@wassie-coffee')).toBe('fuda.sh/@wassie-coffee')
    expect(displayUrl('http://localhost:5173/@wassie-coffee')).toBe('localhost:5173/@wassie-coffee')
  })
})
