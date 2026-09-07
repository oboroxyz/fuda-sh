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
  onField: vi.fn<CardDesignerViewProps['onField']>(),
  onLockScreen: vi.fn<CardDesignerViewProps['onLockScreen']>(),
  onSubmit: vi.fn<CardDesignerViewProps['onSubmit']>(),
  status: 'available',
  ...overrides,
})

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
    const reserved = CardDesignerView(designer({ status: 'reserved' }))
    const idle = CardDesignerView(designer({ form: EMPTY_FORM, status: 'idle' }))
    expect(viewText(reserved)).toContain('This name is reserved.')
    expect(viewText(idle)).not.toContain('This name is reserved.')
    expect(viewText(idle)).not.toContain('Available')
  })

  it('disables the submit until the form is complete and its handle is free', () => {
    expect(submitOf(designer())).toBe(false)
    expect(submitOf(designer({ form: EMPTY_FORM }))).toBe(true)
    expect(submitOf(designer({ status: 'taken' }))).toBe(true)
    expect(submitOf(designer({ busy: true }))).toBe(true)
  })

  it('reports a denied location and a failed create', () => {
    const denied = CardDesignerView(designer({ locationDenied: true }))
    const taken = CardDesignerView(designer({ failure: 'taken' }))
    expect(viewText(denied)).toContain('Location unavailable.')
    expect(viewText(taken)).toContain('That link is already taken.')
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

const card: CardView = {
  category: 'membership',
  id: 'card-1',
  perk: '',
  reward: '',
  title: 'Membership Card',
  validityDays: null,
}

const published = (overrides: Partial<PublishedCardViewProps> = {}): PublishedCardViewProps => ({
  card,
  copied: false,
  copy: DASH_COPY.en.published,
  issuer,
  onCopy: vi.fn<() => void>(),
  onPrint: vi.fn<() => void>(),
  onShare: null,
  publicUrl: 'https://fuda.sh/@wassie-coffee',
  ...overrides,
})

describe(PublishedCardView, () => {
  it('shows the link as a QR and as text without its scheme', () => {
    const view = PublishedCardView(published())
    const [qr] = findViewNodes(view, QrBlock)
    expect(viewProps(qr).qr).toBe('https://fuda.sh/@wassie-coffee')
    expect(viewText(view)).toContain('fuda.sh/@wassie-coffee')
    expect(viewText(view)).toContain('Your card is live')
  })

  it('offers share only where the browser supports it', () => {
    expect(viewText(PublishedCardView(published()))).not.toContain('Share link')
    expect(viewText(PublishedCardView(published({ onShare: (): void => {} })))).toContain('Share link')
  })

  it('confirms a copy in place of the copy label', () => {
    expect(viewText(PublishedCardView(published()))).toContain('Copy link')
    expect(viewText(PublishedCardView(published({ copied: true })))).toContain('Copied')
  })
})
