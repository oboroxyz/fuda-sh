import type { IssuerMeResponse } from '@fuda/sdk'
import { describe, expect, it } from 'vitest'

import { guardRedirect } from './guard.ts'

const venue = (cards: IssuerMeResponse['cards'] = []): IssuerMeResponse => ({
  cards,
  ens: null,
  issuer: {
    brandColor: '#112233',
    createdAt: 1,
    handle: 'coffee',
    id: 'issuer-1',
    logoUrl: null,
    name: 'Coffee',
    operatorAddress: `0x${'11'.repeat(20)}`,
    tagline: '',
  },
  publicUrl: 'https://fuda.sh/@coffee',
})
const unregistered: IssuerMeResponse = { cards: [], ens: null, issuer: null, publicUrl: null }
const card = {
  artworkUrl: null,
  category: 'membership',
  claimFrom: null,
  claimUntil: null,
  claimable: true,
  description: '',
  id: 'card-1',
  slug: 'club',
  title: 'Club',
  validFrom: null,
  validUntil: null,
  validityDays: null,
} as const

describe(guardRedirect, () => {
  it('sends a signed-out visit to sign-in and lets sign-in itself render', () => {
    expect(guardRedirect('/cards', null, null)).toBe('/signin')
    expect(guardRedirect('/', null, null)).toBe('/signin')
    expect(guardRedirect('/signin', null, null)).toBeNull()
  })

  it('sends a signed-in visit to sign-in on to its home', () => {
    expect(guardRedirect('/signin', 'admin', null)).toBe('/')
    expect(guardRedirect('/signin', 'operator', venue())).toBe('/cards')
    expect(guardRedirect('/signin', 'operator', unregistered)).toBe('/start')
  })

  it('keeps each surface on its own routes', () => {
    expect(guardRedirect('/', 'admin', null)).toBeNull()
    expect(guardRedirect('/cards', 'admin', null)).toBe('/')
    expect(guardRedirect('/rights', 'operator', venue())).toBe('/cards')
    expect(guardRedirect('/profile', 'operator', unregistered)).toBe('/start')
    expect(guardRedirect('/start', 'operator', venue())).toBe('/profile')
  })

  it('moves retired and unknown URLs to their current route', () => {
    expect(guardRedirect('/venue', 'operator', venue())).toBe('/profile')
    expect(guardRedirect('/published', 'operator', venue())).toBe('/cards')
    expect(guardRedirect('/nowhere', 'admin', null)).toBe('/')
    expect(guardRedirect('/rights/', 'admin', null)).toBe('/rights')
  })

  it('sends a known legacy stamp URL to the Card edit URL, and leaves an unknown one alone', () => {
    expect(guardRedirect('/cards/card-1/stamps', 'operator', venue([card]))).toBe('/cards/club/edit')
    expect(guardRedirect('/cards/other/stamps', 'operator', venue([card]))).toBeNull()
    expect(guardRedirect('/cards/club', 'operator', venue([card]))).toBeNull()
    expect(guardRedirect('/cards/club/edit', 'operator', venue([card]))).toBeNull()
  })
})
