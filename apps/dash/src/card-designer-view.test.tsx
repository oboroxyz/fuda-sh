/** @jsxImportSource hono/jsx/dom */
import type { CardView, IssuerView } from '@fuda/sdk'
import { describe, expect, it, vi } from 'vitest'

import { EMPTY_FORM, formatInstant, withCategory } from './card-designer.ts'
import type { DesignerForm } from './card-designer.ts'
import { CardDesignerView } from './CardDesigner.tsx'
import type { CardDesignerViewProps } from './CardDesigner.tsx'
import { DASH_COPY } from './copy.ts'
import { EMPTY_LOGO } from './logo.ts'
import { LogoField } from './LogoField.tsx'
import type { LogoFieldProps } from './LogoField.tsx'
import { PublishedCardView } from './PublishedCard.tsx'
import type { PublishedCardViewProps } from './PublishedCard.tsx'
import { QrBlock } from './QrBlock.tsx'
import { findViewNodes, viewProps, viewText, walkView } from './test/test-view.ts'

const filled: DesignerForm = { ...EMPTY_FORM, handle: 'wassie-coffee', name: 'Wassie Coffee' }

const pngOf = (bytes: number): Blob => new Blob([new Uint8Array(bytes)], { type: 'image/png' })

const LOGO_BLOBS = { logo1x: pngOf(1), logo2x: pngOf(2), logo3x: pngOf(3), master: pngOf(4) }

const logoField = (overrides: Partial<LogoFieldProps> = {}): LogoFieldProps => ({
  busy: false,
  copy: DASH_COPY.en.logo,
  id: 'venue-logo',
  label: DASH_COPY.en.logo.label,
  onClear: vi.fn<() => void>(),
  onPick: vi.fn<LogoFieldProps['onPick']>(),
  state: EMPTY_LOGO,
  ...overrides,
})

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
  logo: EMPTY_LOGO,
  logoCopy: DASH_COPY.en.logo,
  mode: 'card',
  onCategory: vi.fn<CardDesignerViewProps['onCategory']>(),
  onField: vi.fn<CardDesignerViewProps['onField']>(),
  onLockScreen: vi.fn<CardDesignerViewProps['onLockScreen']>(),
  onLogoClear: vi.fn<CardDesignerViewProps['onLogoClear']>(),
  onLogoPick: vi.fn<CardDesignerViewProps['onLogoPick']>(),
  onSlug: vi.fn<CardDesignerViewProps['onSlug']>(),
  onSubmit: vi.fn<CardDesignerViewProps['onSubmit']>(),
  onTitle: vi.fn<CardDesignerViewProps['onTitle']>(),
  onValidityDays: vi.fn<CardDesignerViewProps['onValidityDays']>(),
  onValidityMode: vi.fn<CardDesignerViewProps['onValidityMode']>(),
  onWindow: vi.fn<CardDesignerViewProps['onWindow']>(),
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

  it('keeps venue colour controls out of the card form', () => {
    const view = CardDesignerView(designer({ form: { ...filled, brandColor: '#1D3A6E' } }))
    const swatches = walkView(view).filter((node) => String(node.props.class).includes('dash-swatch'))
    const selected = swatches.filter((node) => node.props['aria-pressed'] === true)
    expect(swatches).toHaveLength(0)
    expect(selected).toHaveLength(0)
  })

  it('keeps handle status out of the card form', () => {
    const reserved = CardDesignerView(designer({ status: { handle: 'reserved', slug: 'available' } }))
    const idle = CardDesignerView(designer({ form: EMPTY_FORM, status: { handle: 'idle', slug: 'idle' } }))
    expect(viewText(reserved)).not.toContain('This name is reserved.')
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

  it('never asks for venue fields', () => {
    const venue = designer()
    const card = designer({ mode: 'card' })
    expect(inputWithId(venue, 'handle')).toBe(false)
    expect(inputWithId(venue, 'venue-name')).toBe(false)
    expect(inputWithId(card, 'handle')).toBe(false)
    expect(inputWithId(card, 'venue-name')).toBe(false)
    expect(inputWithId(card, 'card-slug')).toBe(true)
  })

  it('disables the submit until the form is complete and its names are free', () => {
    expect(submitOf(designer())).toBe(false)
    expect(submitOf(designer({ form: EMPTY_FORM }))).toBe(false)
    expect(submitOf(designer({ status: { handle: 'taken', slug: 'available' } }))).toBe(false)
    expect(submitOf(designer({ status: { handle: 'available', slug: 'taken' } }))).toBe(true)
    expect(submitOf(designer({ busy: true }))).toBe(true)
  })

  it('adds a card to an existing venue without a handle of its own', () => {
    const card = designer({ form: { ...EMPTY_FORM, handle: '' }, mode: 'card' })
    expect(submitOf(card)).toBe(false)
    expect(submitOf(designer({ ...card, form: { ...EMPTY_FORM, handle: '', slug: '' } }))).toBe(true)
  })

  it('asks for both ends of the claim window as optional instants', () => {
    const view = designer()
    expect(viewText(CardDesignerView(view))).toContain('Claim window')
    expect(viewText(CardDesignerView(view))).toContain('Leave both empty')
    expect(inputWithId(view, 'claim-from')).toBe(true)
    expect(inputWithId(view, 'claim-until')).toBe(true)
  })

  it('shows only the chosen validity rule and hides the other', () => {
    const none = designer()
    const days = designer({ form: { ...filled, validityDays: 30, validityMode: 'days' } })
    const fixed = designer({ form: withCategory(filled, 'ticket') })
    expect(inputWithId(none, 'validity-days')).toBe(false)
    expect(inputWithId(days, 'validity-days')).toBe(true)
    expect(inputWithId(days, 'valid-until')).toBe(false)
    expect(inputWithId(fixed, 'valid-from')).toBe(true)
    expect(inputWithId(fixed, 'valid-until')).toBe(true)
  })

  it('refuses an inverted window or two validity rules and says why', () => {
    const inverted = designer({
      form: { ...filled, claimFrom: '2026-09-04T22:00', claimUntil: '2026-09-04T19:00' },
    })
    const both = designer({ form: { ...filled, validUntil: '2026-09-04T22:00', validityDays: 30 } })
    expect(submitOf(inverted)).toBe(true)
    expect(viewText(CardDesignerView(inverted))).toContain('cannot close before it opens')
    expect(submitOf(both)).toBe(true)
    expect(viewText(CardDesignerView(both))).toContain('Pick one')
    expect(viewText(CardDesignerView(designer()))).not.toContain('Pick one')
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
  logoUrl: null,
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
  canAddCard: true,
  cards: [membership],
  copiedSlug: null,
  copy: DASH_COPY.en.published,
  issuer,
  now: 1_757_000_000,
  onAddCard: vi.fn<() => void>(),
  onCopy: vi.fn<PublishedCardViewProps['onCopy']>(),
  onPrint: vi.fn<PublishedCardViewProps['onPrint']>(),
  onShare: null,
  onVenue: vi.fn<PublishedCardViewProps['onVenue']>(),
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
  it('sends an empty venue to ENS until claimed, then offers the first card', () => {
    const view = PublishedCardView(published({ canAddCard: false, cards: [] }))
    expect(viewText(view)).toContain('Create your first card')
    expect(viewText(view)).toContain('Go to venue and ENS')
    expect(viewText(PublishedCardView(published({ cards: [] })))).toContain('Create your first card')
  })

  it('reads as one card when the venue published only one', () => {
    const view = PublishedCardView(published())
    expect(viewText(view)).toContain('Your card is live')
    expect(viewText(view)).not.toContain('Your cards are live')
    expect(qrTargets(published())).toStrictEqual(['https://fuda.sh/@wassie-coffee/membership-card'])
    expect(viewText(view)).toContain('fuda.sh/@wassie-coffee/membership-card')
  })

  it('keeps venue management out of the card list', () => {
    const view = PublishedCardView(published())
    expect(viewText(view)).toContain('Wassie Coffee')
    expect(viewText(view)).not.toContain('Venue page')
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

  it('marks a card that is no longer handed out and says when it closed', () => {
    const closed: CardView = { ...summer, claimUntil: 1_757_000_000, claimable: false }
    const text = viewText(PublishedCardView(published({ cards: [closed] })))
    expect(text).toContain('Closed since')
    expect(text).toContain(formatInstant(1_757_000_000))
    expect(text).toContain('Valid 30 days after claiming')
    expect(viewText(PublishedCardView(published()))).not.toContain('Closed')
  })

  it('says when a card opens later, closes later, and how long it stays valid', () => {
    const later: CardView = { ...membership, claimFrom: 1_800_000_000, claimable: false }
    expect(viewText(PublishedCardView(published({ cards: [later] })))).toContain(
      `Opens ${formatInstant(1_800_000_000)}`,
    )
    expect(viewText(PublishedCardView(published({ cards: [summer] })))).toContain('Valid 30 days')
    expect(viewText(PublishedCardView(published()))).toContain('Does not expire')
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

describe('the logo field', () => {
  it('offers the picker with the minimum source size and nothing held yet', () => {
    const view = LogoField(logoField())
    const input = walkView(view).find((node) => node.props.type === 'file')
    expect(viewProps(input!).accept).toBe('image/png,image/jpeg,image/webp')
    expect(viewText(view)).toContain('at least 660×660')
    expect(findViewNodes(view, 'img')).toHaveLength(0)
  })

  it('keeps venue logo fields out of the card designer', () => {
    const [field] = findViewNodes(CardDesignerView(designer()), LogoField)
    expect(field).toBeUndefined()
  })

  it('previews the generated master and offers to remove it once a file is held', () => {
    const pick = { previewUrl: 'blob:master', variants: LOGO_BLOBS }
    const view = LogoField(logoField({ state: { pick, rejection: null } }))
    const [image] = findViewNodes(view, 'img')
    expect(image?.props.src).toBe('blob:master')
    expect(viewText(view)).toContain('Remove')
  })

  it('explains why the pipeline refused a file, and holds nothing after it', () => {
    const view = LogoField(logoField({ state: { pick: null, rejection: 'tooSmall' } }))
    expect(viewText(view)).toContain('That image is too small')
    expect(findViewNodes(view, 'img')).toHaveLength(0)
  })

  it('hides the remove action where the mark is already live', () => {
    const pick = { previewUrl: 'blob:master', variants: LOGO_BLOBS }
    const view = LogoField(logoField({ onClear: null, state: { pick, rejection: null } }))
    expect(viewText(view)).not.toContain('Remove')
  })

  it('says a failed upload left the card alone', () => {
    expect(viewText(CardDesignerView(designer({ failure: 'logo' })))).toContain('Could not upload the logo')
  })
})

describe('the published card boundary', () => {
  it('leaves venue logo management to the venue page', () => {
    const view = PublishedCardView(published())
    const [image] = findViewNodes(view, 'img')
    const [field] = findViewNodes(view, LogoField)
    expect(image).toBeUndefined()
    expect(field).toBeUndefined()
  })
})
