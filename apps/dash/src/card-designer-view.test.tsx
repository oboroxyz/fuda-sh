// @vitest-environment happy-dom
import type { IssuerView } from '@fuda/sdk'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_FORM, withCategory } from './card-designer.ts'
import type { DesignerForm } from './card-designer.ts'
import { CardDesigner, CardDesignerView } from './CardDesigner.tsx'
import type { CardDesignerViewProps } from './CardDesigner.tsx'
import { DASH_COPY } from './copy.ts'
import { EMPTY_LOGO } from './logo.ts'
import { LogoField } from './LogoField.tsx'
import type { LogoFieldProps } from './LogoField.tsx'
import { cleanup, mount, spacedText } from './test/render.tsx'

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

const showDesigner = (props: CardDesignerViewProps): HTMLElement =>
  mount(() => <CardDesignerView {...props} />)
const showLogo = (props: LogoFieldProps): HTMLElement => mount(() => <LogoField {...props} />)

const submitOf = (props: CardDesignerViewProps): boolean =>
  showDesigner(props).querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled === true

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
  onEditProfile: vi.fn<CardDesignerViewProps['onEditProfile']>(),
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
  savedLogoUrl: null,
  status: { handle: 'available', slug: 'available' },
  ...overrides,
})

const inputWithId = (props: CardDesignerViewProps, id: string): boolean =>
  showDesigner(props).querySelector(`#${id}`) !== null

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

describe(CardDesignerView, () => {
  afterEach(cleanup)

  it('does not publish an old draft after the designer is unmounted', () => {
    const frames: FrameRequestCallback[] = []
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- capture the browser callback API to test effects that run after unmount.
    const requestFrame = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const onDraftChange = vi.fn<(form: DesignerForm) => void>()
    const root = document.createElement('div')
    vi.useFakeTimers()
    let dispose: (() => void) | undefined
    try {
      dispose = render(
        () => (
          <CardDesigner
            busy={false}
            copy={DASH_COPY.en.designer}
            failure={null}
            initialDraft={{ ...filled, title: 'Previous session draft' }}
            issuer={issuer}
            logoCopy={DASH_COPY.en.logo}
            onCheckHandle={async () => await Promise.resolve('available')}
            onCheckSlug={async () => await Promise.resolve('available')}
            onDraftChange={onDraftChange}
            onEditProfile={vi.fn<() => void>()}
            onSubmit={vi.fn<() => void>()}
          />
        ),
        root,
      )
      dispose()
      onDraftChange.mockClear()
      for (const frame of frames.splice(0)) {
        frame(0)
      }
      expect(onDraftChange).not.toHaveBeenCalled()
    } finally {
      dispose?.()
      vi.clearAllTimers()
      vi.useRealTimers()
      requestFrame.mockRestore()
    }
  })

  it.each([
    { expected: null, logoUrl: null },
    { expected: 'https://cdn.example/logo.png?v=1', logoUrl: 'https://cdn.example/logo.png?v=1' },
    {
      expected: '/api/assets/wassie-coffee/logo/master?v=1',
      logoUrl: 'http://localhost:8787/assets/wassie-coffee/logo/master?v=1',
    },
  ])('previews the saved issuer logo: $logoUrl', ({ logoUrl, expected }) => {
    const root = document.createElement('div')
    let dispose: (() => void) | undefined
    try {
      dispose = render(
        () => (
          <CardDesigner
            busy={false}
            copy={DASH_COPY.en.designer}
            failure={null}
            issuer={{ ...issuer, logoUrl }}
            logoCopy={DASH_COPY.en.logo}
            onCheckHandle={async () => await Promise.resolve('available')}
            onCheckSlug={async () => await Promise.resolve('available')}
            onEditProfile={vi.fn<() => void>()}
            onSubmit={vi.fn<() => void>()}
          />
        ),
        root,
      )
      const preview = root.querySelector('.dash-card-preview')
      expect(preview?.textContent).toContain(issuer.name)
      expect(preview?.textContent).toContain('ABCD-E123-F5679')
      expect(preview?.querySelector('svg')).not.toBeNull()
      const image = preview?.querySelector('img')
      expect({
        alt: image?.getAttribute('alt') ?? null,
        src: image?.getAttribute('src') ?? null,
      }).toStrictEqual({ alt: expected === null ? null : '', src: expected })
    } finally {
      dispose?.()
    }
  })

  it('offers one multiline card description for onboarding', () => {
    const host = showDesigner(designer({ form: { ...filled, description: 'First line\nSecond line' } }))
    const textarea = host.querySelector('textarea')
    expect({ id: textarea?.id, maxLength: textarea?.maxLength, value: textarea?.value }).toStrictEqual({
      id: 'card-description',
      maxLength: 2000,
      value: 'First line\nSecond line',
    })
    expect(inputWithId(designer(), 'perk')).toBe(false)
    expect(inputWithId(designer(), 'reward')).toBe(false)
  })

  it('previews the venue name and title in the brand colour', () => {
    const preview = showDesigner(
      designer({ form: { ...filled, brandColor: '#1F513F' } }),
    ).querySelector<HTMLElement>('.dash-card-preview')!
    expect(spacedText(preview)).toContain('Wassie Coffee')
    expect(spacedText(preview)).toContain('Membership')
    expect({ background: preview.style.background, color: preview.style.color }).toStrictEqual({
      background: '#1F513F',
      color: '#FFFFFF',
    })
  })

  it.each(['#5CF794', '#0073EB', '#C389FF', '#777777'])(
    'uses black preview text when it has better contrast on %s',
    (brandColor) => {
      const preview = showDesigner(designer({ form: { ...filled, brandColor } })).querySelector<HTMLElement>(
        '.dash-card-preview',
      )!
      expect(preview.style.color).toBe('#000000')
    },
  )

  it('keeps venue colour controls out of the card form', () => {
    const host = showDesigner(designer({ form: { ...filled, brandColor: '#1D3A6E' } }))
    expect(host.querySelectorAll('.dash-swatch')).toHaveLength(0)
    expect(host.querySelectorAll('[aria-pressed]')).toHaveLength(0)
  })

  it('keeps handle status out of the card form', () => {
    const reserved = showDesigner(designer({ status: { handle: 'reserved', slug: 'available' } }))
    const idle = showDesigner(designer({ form: EMPTY_FORM, status: { handle: 'idle', slug: 'idle' } }))
    expect(spacedText(reserved)).not.toContain('This name is reserved.')
    expect(spacedText(idle)).not.toContain('This name is reserved.')
    expect(spacedText(idle)).not.toContain('Available')
  })

  it('shows the card link under the venue handle', () => {
    const host = showDesigner(designer({ form: { ...filled, slug: 'summer' } }))
    expect(spacedText(host)).toContain('Card link')
    expect(spacedText(host)).toContain('fuda.sh/@wassie-coffee/')
    expect(host.querySelector<HTMLInputElement>('#card-slug')?.value).toBe('summer')
  })

  it('labels every verdict the card link can reach', () => {
    const label = (slug: CardDesignerViewProps['status']['slug']): string =>
      spacedText(showDesigner(designer({ status: { handle: 'available', slug } })))
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
    expect(spacedText(showDesigner(view))).toContain('Claim window')
    expect(spacedText(showDesigner(view))).toContain('Leave both empty')
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
    expect(spacedText(showDesigner(inverted))).toContain('cannot close before it opens')
    expect(submitOf(both)).toBe(true)
    expect(spacedText(showDesigner(both))).toContain('Pick one')
    expect(spacedText(showDesigner(designer()))).not.toContain('Pick one')
  })

  it('reports a denied location, a taken link and a taken card link', () => {
    expect(spacedText(showDesigner(designer({ locationDenied: true })))).toContain('Location unavailable.')
    expect(spacedText(showDesigner(designer({ failure: 'taken' })))).toContain('That link is already taken.')
    expect(spacedText(showDesigner(designer({ failure: 'slugTaken' })))).toContain(
      'That card link is already used.',
    )
    expect(spacedText(showDesigner(designer({ failure: 'slugInvalid' })))).toContain(
      'That card link cannot be used.',
    )
  })
})

describe('the logo field', () => {
  afterEach(cleanup)

  it('offers the picker with the minimum source size and nothing held yet', () => {
    const host = showLogo(logoField())
    expect(host.querySelector<HTMLInputElement>('input[type="file"]')?.accept).toBe(
      'image/png,image/jpeg,image/webp',
    )
    expect(spacedText(host)).toContain('at least 660×660')
    expect(host.querySelectorAll('img')).toHaveLength(0)
  })

  it('keeps venue logo fields out of the card designer', () => {
    expect(showDesigner(designer()).querySelector('input[type="file"]')).toBeNull()
  })

  it('previews the generated master and offers to remove it once a file is held', () => {
    const pick = { previewUrl: 'blob:master', variants: LOGO_BLOBS }
    const host = showLogo(logoField({ state: { pick, rejection: null } }))
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:master')
    expect(spacedText(host)).toContain('Remove')
  })

  it('explains why the pipeline refused a file, and holds nothing after it', () => {
    const host = showLogo(logoField({ state: { pick: null, rejection: 'tooSmall' } }))
    expect(spacedText(host)).toContain('That image is too small')
    expect(host.querySelectorAll('img')).toHaveLength(0)
  })

  it('hides the remove action where the mark is already live', () => {
    const pick = { previewUrl: 'blob:master', variants: LOGO_BLOBS }
    expect(
      spacedText(showLogo(logoField({ onClear: null, state: { pick, rejection: null } }))),
    ).not.toContain('Remove')
  })

  it('says a failed upload left the card alone', () => {
    expect(spacedText(showDesigner(designer({ failure: 'logo' })))).toContain('Could not upload the logo')
  })
})
