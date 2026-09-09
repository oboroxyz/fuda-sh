// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import type { IssuerView, OperatorCardView } from '@fuda/sdk'
import { render, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CardEditPage } from './CardEditPage.tsx'
import type { CardEditPageProps } from './CardEditPage.tsx'
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
const card: OperatorCardView = {
  category: 'membership',
  claimFrom: 1_780_000_013,
  claimUntil: null,
  claimable: true,
  description: 'Welcome',
  id: 'card-1',
  lockScreen: true,
  slug: 'membership',
  title: 'Coffee members',
  validFrom: null,
  validUntil: null,
  validityDays: 45,
  venue: { lat: 35.6, lng: 139.7 },
}
let root: HTMLDivElement

const settings = () => ({
  load: vi
    .fn<CardEditPageProps['settings']['load']>()
    .mockResolvedValue({ body: { dailyLimit: 1, enabled: false, goal: 10 }, ok: true }),
  save: vi
    .fn<CardEditPageProps['settings']['save']>()
    .mockResolvedValue({ body: { dailyLimit: 1, enabled: true, goal: 10 }, ok: true }),
})
const props = (): CardEditPageProps => ({
  card,
  copy: DASH_COPY.en,
  issuer,
  load: vi.fn<CardEditPageProps['load']>().mockResolvedValue({ body: { card }, ok: true }),
  onNavigate: vi.fn<CardEditPageProps['onNavigate']>(),
  save: vi
    .fn<CardEditPageProps['save']>()
    .mockResolvedValue({ body: { card: { ...card, title: 'Updated' } }, ok: true }),
  settings: settings(),
})
const submit = () =>
  root
    .querySelector('form')!
    .dispatchEvent(new CustomEvent('submit', { bubbles: true, cancelable: true, detail: {} }))
const waitForm = async () => {
  await vi.waitFor(() => {
    expect(root.querySelector('#card-title')).not.toBeNull()
  })
}

describe(CardEditPage, () => {
  beforeEach(() => {
    root = document.createElement('div')
    document.body.append(root)
  })
  afterEach(() => {
    render(null, root)
    root.remove()
  })

  it('hydrates and saves without losing seconds, custom days, location or public URL identity', async () => {
    const p = props()
    render(<CardEditPage {...p} />, root)
    await waitForm()
    const title = root.querySelector<HTMLInputElement>('#card-title')!
    title.value = 'Updated'
    title.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLInputElement>('#card-title')?.value).toBe('Updated')
    })
    submit()
    await vi.waitFor(() => {
      expect(p.save).toHaveBeenCalledWith('card-1', {
        category: 'membership',
        claimFrom: 1_780_000_013,
        claimUntil: null,
        description: 'Welcome',
        lockScreen: true,
        title: 'Updated',
        validFrom: null,
        validUntil: null,
        validityDays: 45,
        venue: { lat: 35.6, lng: 139.7 },
      })
    })
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Card saved.')
    })
    expect(root.querySelector<HTMLInputElement>('#card-slug')?.value).toBe('membership')
  })

  it.each([
    { lockScreen: true, venue: null },
    { lockScreen: false, venue: { lat: 35.6, lng: 139.7 } },
  ])('preserves independently stored location fields on title-only edits: %j', async (location) => {
    const p = props()
    const loaded = { ...card, ...location }
    vi.spyOn(p, 'load').mockResolvedValue({ body: { card: loaded }, ok: true })
    render(<CardEditPage {...p} />, root)
    await waitForm()
    submit()
    await vi.waitFor(() => {
      expect(p.save).toHaveBeenCalledWith(
        'card-1',
        expect.objectContaining({ lockScreen: location.lockScreen }),
      )
    })
    expect(vi.mocked(p.save).mock.calls[0]?.[1].venue ?? null).toStrictEqual(location.venue)
  })

  it('keeps failed edits for retry and never sends two concurrent saves', async () => {
    const p = props()
    const pending = Promise.withResolvers<Awaited<ReturnType<CardEditPageProps['save']>>>()
    const save = vi
      .fn<CardEditPageProps['save']>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ body: { card }, ok: true })
    render(<CardEditPage {...p} save={save} />, root)
    await waitForm()
    submit()
    submit()
    expect(save).toHaveBeenCalledOnce()
    pending.resolve({ error: 'offline', network: true, ok: false, status: 0 })
    await vi.waitFor(() => {
      expect(root.querySelector('[role=alert]')?.textContent).toContain('Could not save')
    })
    expect(root.querySelector<HTMLInputElement>('#card-title')?.value).toBe('Coffee members')
    submit()
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Card saved.')
    })
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('loads optional Membership stamps on expansion and saves settings for that card', async () => {
    const p = props()
    render(<CardEditPage {...p} />, root)
    await waitForm()
    expect(p.settings.load).not.toHaveBeenCalled()
    const details = root.querySelector('details')!
    details.open = true
    details.dispatchEvent(new Event('toggle'))
    await vi.waitFor(() => {
      expect(p.settings.load).toHaveBeenCalledWith('card-1')
    })
    await vi.waitFor(() => {
      expect(details.querySelector('input[type=number]')).not.toBeNull()
    })
    const enabled = details.querySelector<HTMLInputElement>('input[type=checkbox]')!
    enabled.checked = true
    enabled.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => {
      expect(enabled.checked).toBe(true)
    })
    details.querySelector<HTMLButtonElement>('button')!.click()
    await vi.waitFor(() => {
      expect(p.settings.save).toHaveBeenCalledWith('card-1', { dailyLimit: 1, enabled: true, goal: 10 })
    })
  })

  it('does not load stamp settings for a ticket', async () => {
    const p = props()
    const ticket = { ...card, category: 'ticket' } as const
    render(
      <CardEditPage
        {...p}
        card={ticket}
        load={async () => await Promise.resolve({ body: { card: ticket }, ok: true })}
      />,
      root,
    )
    await waitForm()
    expect(root.querySelector('details')).toBeNull()
    expect(p.settings.load).not.toHaveBeenCalled()
  })

  it('discards a late card load after switching to another card', async () => {
    const p = props()
    const pending = Promise.withResolvers<Awaited<ReturnType<CardEditPageProps['load']>>>()
    const other = { ...card, category: 'ticket', id: 'card-2', slug: 'event', title: 'Event' } as const
    const load = vi
      .fn<CardEditPageProps['load']>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ body: { card: other }, ok: true })
    const Switcher = (): JSX.Element => {
      const [selected, setSelected] = useState(card)
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setSelected(other)
            }}
          >
            Switch
          </button>
          <CardEditPage {...p} card={selected} load={load} />
        </>
      )
    }
    render(<Switcher />, root)
    await vi.waitFor(() => {
      expect(load).toHaveBeenCalledWith('card-1')
    })
    root.querySelector('button')!.click()
    await waitForm()
    expect(root.querySelector<HTMLInputElement>('#card-title')?.value).toBe('Event')
    pending.resolve({ body: { card }, ok: true })
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLInputElement>('#card-title')?.value).toBe('Event')
    })
  })
})
