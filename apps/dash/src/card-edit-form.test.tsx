// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import type { IssuerView } from '@fuda/sdk'
import { render } from 'hono/jsx/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_FORM } from './card-designer.ts'
import { CardDesigner } from './CardDesigner.tsx'
import type { CardDesignerProps } from './CardDesigner.tsx'
import { DASH_COPY } from './copy.ts'

const issuer: IssuerView = {
  brandColor: '#0073EB',
  createdAt: 1,
  handle: 'coffee',
  id: 'issuer',
  logoUrl: null,
  name: 'Coffee',
  operatorAddress: `0x${'ab'.repeat(20)}`,
  tagline: '',
}
let root: HTMLDivElement

const props = (): CardDesignerProps => ({
  busy: false,
  copy: DASH_COPY.en.designer,
  editing: true,
  failure: null,
  initialDraft: {
    ...EMPTY_FORM,
    slug: 'membership',
    slugEdited: true,
    title: 'Members',
    validityDays: 45,
    validityMode: 'days',
    windowEdited: true,
  },
  issuer,
  logoCopy: DASH_COPY.en.logo,
  onCheckHandle: vi.fn<CardDesignerProps['onCheckHandle']>().mockResolvedValue('available'),
  onCheckSlug: vi.fn<CardDesignerProps['onCheckSlug']>().mockResolvedValue('taken'),
  onEditProfile: vi.fn<CardDesignerProps['onEditProfile']>(),
  onSubmit: vi.fn<CardDesignerProps['onSubmit']>(),
})

describe('shared card edit form', () => {
  beforeEach(() => {
    root = document.createElement('div')
    document.body.append(root)
  })
  afterEach(() => {
    render(null, root)
    root.remove()
  })

  it('keeps the published slug read-only and submits existing custom validity without a name check', async () => {
    const input = props()
    render(<CardDesigner {...input} />, root)
    expect(root.querySelector<HTMLInputElement>('#card-slug')?.readOnly).toBe(true)
    expect(root.querySelector<HTMLSelectElement>('#validity-days')?.value).toBe('45')
    const title = root.querySelector<HTMLInputElement>('#card-title')!
    title.value = 'Renamed card'
    title.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLInputElement>('#card-title')?.value).toBe('Renamed card')
    })
    root
      .querySelector('form')!
      .dispatchEvent(new CustomEvent('submit', { bubbles: true, cancelable: true, detail: {} }))
    expect(input.onSubmit).toHaveBeenCalledWith(
      'card',
      expect.objectContaining({ slug: 'membership', title: 'Renamed card', validityDays: 45 }),
      null,
    )
    expect(input.onCheckSlug).not.toHaveBeenCalled()
  })

  it('allows an existing reserved new slug to be edited without changing the URL', async () => {
    const input = props()
    render(<CardDesigner {...input} initialDraft={{ ...input.initialDraft!, slug: 'new' }} />, root)
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(false)
    })
    root
      .querySelector('form')!
      .dispatchEvent(new CustomEvent('submit', { bubbles: true, cancelable: true, detail: {} }))
    expect(input.onSubmit).toHaveBeenCalledWith('card', expect.objectContaining({ slug: 'new' }), null)
  })
})
