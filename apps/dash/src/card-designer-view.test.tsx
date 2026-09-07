/** @jsxImportSource hono/jsx/dom */
import type { CardView, IssuerView } from '@fuda/sdk'
import { describe, expect, it, vi } from 'vitest'

import { EMPTY_FORM } from './card-designer.ts'
import type { DesignerForm } from './card-designer.ts'
import { CardDesignerView } from './CardDesigner.tsx'
import type { CardDesignerViewProps } from './CardDesigner.tsx'
import { DASH_COPY } from './copy.ts'
import { PublishedCardView } from './PublishedCard.tsx'
import type { PublishedCardViewProps } from './PublishedCard.tsx'
import { QrBlock } from './QrBlock.tsx'
import { findViewNodes, viewProps, viewText, walkView } from './test/test-view.ts'

const filled: DesignerForm = { ...EMPTY_FORM, handle: 'wassie-coffee', name: 'Wassie Coffee' }

const submitOf = (props: CardDesignerViewProps): boolean =>
  walkView(CardDesignerView(props)).some(
    (node) => node.props.type === 'submit' && node.props.disabled === true,
  )

const designer = (overrides: Partial<CardDesignerViewProps> = {}): CardDesignerViewProps => ({
  busy: false,
  copy: DASH_COPY.en.designer,
  failure: null,
  form: filled,
  locationDenied: false,
  mode: 'venue',
  onField: vi.fn<CardDesignerViewProps['onField']>(),
  onLockScreen: vi.fn<CardDesignerViewProps['onLockScreen']>(),
  onSlug: vi.fn<CardDesignerViewProps['onSlug']>(),
  onSubmit: vi.fn<CardDesignerViewProps['onSubmit']>(),
  onTitle: vi.fn<CardDesignerViewProps['onTitle']>(),
  status: { handle: 'available', slug: 'available' },
  ...overrides,
})

const inputWithId = (props: CardDesignerViewProps, id: string): boolean =>
  walkView(CardDesignerView(props)).some((node) => node.props.id === id)

describe(CardDesignerView, () => {
  it('previews the venue name, card type and title in the brand colour', () => {
    const view = CardDesignerView(designer({ form: { ...filled, brandColor: '#1F513F' } }))
    const preview = walkView(view).find((node) => node.props.class === 'dash-card-preview')
    expect(viewText(preview)).toContain('Wassie Coffee')
    expect(viewText(preview)).toContain('Membership')
    expect(viewText(preview)).toContain('Membership Card')
    expect(viewProps(preview!).style).toStrictEqual({ background: '#1F513F' })
  })

  it('marks the chosen swatch and leaves the others unselected', () => {
    const view = CardDesignerView(designer({ form: { ...filled, brandColor: '#1D3A6E' } }))
    const swatches = walkView(view).filter((node) => String(node.props.class).includes('dash-swatch'))
    const selected = swatches.filter((node) => node.props['aria-pressed'] === true)
    expect(swatches).toHaveLength(4)
    expect(selected).toHaveLength(1)
    expect(selected[0]?.props['aria-label']).toBe('#1D3A6E')
  })

  it('explains why a handle cannot be used and hides the label while it is empty', () => {
    const reserved = CardDesignerView(designer({ status: { handle: 'reserved', slug: 'available' } }))
    const idle = CardDesignerView(designer({ form: EMPTY_FORM, status: { handle: 'idle', slug: 'idle' } }))
    expect(viewText(reserved)).toContain('This name is reserved.')
    expect(viewText(idle)).not.toContain('This name is reserved.')
    expect(viewText(idle)).not.toContain('Available')
  })

  it('shows the card link under the venue handle', () => {
    const view = CardDesignerView(designer({ form: { ...filled, slug: 'summer' } }))
    const field = walkView(view).find((node) => node.props.id === 'card-slug')
    expect(viewText(view)).toContain('Card link')
    expect(viewText(view)).toContain('fuda.sh/@wassie-coffee/')
    expect(viewProps(field!).value).toBe('summer')
  })

  it('labels every verdict the card link can reach', () => {
    const label = (slug: CardDesignerViewProps['status']['slug']): string =>
      viewText(CardDesignerView(designer({ status: { handle: 'available', slug } })))
    expect(label('available')).toContain('Available')
    expect(label('taken')).toContain('Already used')
    expect(label('format')).toContain('Use lowercase letters, digits and hyphens.')
    expect(label('reserved')).toContain('This name is reserved.')
  })

  it('asks for the venue fields only while the venue does not exist yet', () => {
    const venue = designer()
    const card = designer({ mode: 'card' })
    expect(inputWithId(venue, 'handle')).toBe(true)
    expect(inputWithId(venue, 'venue-name')).toBe(true)
    expect(inputWithId(card, 'handle')).toBe(false)
    expect(inputWithId(card, 'venue-name')).toBe(false)
    expect(inputWithId(card, 'card-slug')).toBe(true)
  })

  it('disables the submit until the form is complete and its names are free', () => {
    expect(submitOf(designer())).toBe(false)
    expect(submitOf(designer({ form: EMPTY_FORM }))).toBe(true)
    expect(submitOf(designer({ status: { handle: 'taken', slug: 'available' } }))).toBe(true)
    expect(submitOf(designer({ status: { handle: 'available', slug: 'taken' } }))).toBe(true)
    expect(submitOf(designer({ busy: true }))).toBe(true)
  })

  it('adds a card to an existing venue without a handle of its own', () => {
    const card = designer({ form: { ...EMPTY_FORM, handle: '' }, mode: 'card' })
    expect(submitOf(card)).toBe(false)
    expect(submitOf(designer({ ...card, form: { ...EMPTY_FORM, handle: '', slug: '' } }))).toBe(true)
  })

  it('reports a denied location, a taken link and a taken card link', () => {
    expect(viewText(CardDesignerView(designer({ locationDenied: true })))).toContain('Location unavailable.')
    expect(viewText(CardDesignerView(designer({ failure: 'taken' })))).toContain(
      'That link is already taken.',
    )
    expect(viewText(CardDesignerView(designer({ failure: 'slugTaken' })))).toContain(
      'That card link is already used.',
    )
    expect(viewText(CardDesignerView(designer({ failure: 'slugInvalid' })))).toContain(
      'That card link cannot be used.',
    )
  })
})

const issuer: IssuerView = {
  brandColor: '#6F4320',
  createdAt: 1_757_000_000,
  handle: 'wassie-coffee',
  id: 'issuer-1',
  name: 'Wassie Coffee',
  operatorAddress: `0x${'ab'.repeat(20)}`,
  tagline: 'Omotesando · Coffee shop',
}

const membership: CardView = {
  category: 'membership',
  claimFrom: null,
  claimUntil: null,
  claimable: true,
  id: 'card-1',
  perk: '',
  reward: '',
  slug: 'membership-card',
  title: 'Membership Card',
  validFrom: null,
  validUntil: null,
  validityDays: null,
}

const summer: CardView = {
  category: 'ticket',
  claimFrom: null,
  claimUntil: null,
  claimable: true,
  id: 'card-2',
  perk: '',
  reward: '',
  slug: 'summer',
  title: 'Summer Pass',
  validFrom: null,
  validUntil: null,
  validityDays: 30,
}

const published = (overrides: Partial<PublishedCardViewProps> = {}): PublishedCardViewProps => ({
  cards: [membership],
  copiedSlug: null,
  copy: DASH_COPY.en.published,
  issuer,
  onAddCard: vi.fn<() => void>(),
  onCopy: vi.fn<PublishedCardViewProps['onCopy']>(),
  onPrint: vi.fn<PublishedCardViewProps['onPrint']>(),
  onShare: null,
  printSlug: null,
  publicUrl: 'https://fuda.sh/@wassie-coffee',
  ...overrides,
})

const printTargets = (props: PublishedCardViewProps): string[] =>
  walkView(PublishedCardView(props))
    .map((node) => String(node.props.class))
    .filter((value) => value.includes('dash-print-target'))

const qrTargets = (props: PublishedCardViewProps): unknown[] =>
  findViewNodes(PublishedCardView(props), QrBlock).map((node) => viewProps(node).qr)

describe(PublishedCardView, () => {
  it('reads as one card when the venue published only one', () => {
    const view = PublishedCardView(published())
    expect(viewText(view)).toContain('Your card is live')
    expect(viewText(view)).not.toContain('Your cards are live')
    expect(qrTargets(published())).toStrictEqual(['https://fuda.sh/@wassie-coffee/membership-card'])
    expect(viewText(view)).toContain('fuda.sh/@wassie-coffee/membership-card')
  })

  it('names the venue and its own page above the cards', () => {
    const view = PublishedCardView(published())
    expect(viewText(view)).toContain('Wassie Coffee')
    expect(viewText(view)).toContain('Venue page')
    expect(viewText(view)).toContain('fuda.sh/@wassie-coffee')
  })

  it('gives every card of a venue its own link and QR', () => {
    const props = published({ cards: [membership, summer] })
    const view = PublishedCardView(props)
    expect(viewText(view)).toContain('Your cards are live')
    expect(qrTargets(props)).toStrictEqual([
      'https://fuda.sh/@wassie-coffee/membership-card',
      'https://fuda.sh/@wassie-coffee/summer',
    ])
    expect(viewText(view)).toContain('Summer Pass')
    expect(viewText(view)).toContain('fuda.sh/@wassie-coffee/summer')
  })

  it('offers another card and share only where the browser supports it', () => {
    expect(viewText(PublishedCardView(published()))).toContain('Add another card')
    expect(viewText(PublishedCardView(published()))).not.toContain('Share link')
    expect(viewText(PublishedCardView(published({ onShare: (): void => {} })))).toContain('Share link')
  })

  it('confirms a copy on the card that was copied and on no other', () => {
    const props = published({ cards: [membership, summer], copiedSlug: 'summer' })
    const text = viewText(PublishedCardView(props))
    expect(text).toContain('Copied')
    expect(text).toContain('Copy link')
    expect(viewText(PublishedCardView(published()))).not.toContain('Copied')
  })

  it('narrows the poster to one card while that card is printing', () => {
    const both = published({ cards: [membership, summer] })
    expect(printTargets(both)).toStrictEqual(['dash-print-target', 'dash-print-target'])
    expect(printTargets({ ...both, printSlug: 'summer' })).toStrictEqual([
      'dash-print-target dash-no-print',
      'dash-print-target',
    ])
  })
})
