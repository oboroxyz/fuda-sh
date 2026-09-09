// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { render, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CardStampSettingsPage } from './CardStampSettingsPage.tsx'
import type { CardStampSettingsPageProps } from './CardStampSettingsPage.tsx'
import { DASH_COPY } from './copy.ts'

const membership = {
  category: 'membership',
  claimFrom: null,
  claimUntil: null,
  claimable: true,
  id: 'membership',
  perk: '',
  reward: '',
  slug: 'coffee',
  title: 'Coffee membership',
  validFrom: null,
  validUntil: null,
  validityDays: null,
} as const
const ticket = { ...membership, category: 'ticket', id: 'event', title: 'Special event' } as const
const initial = { dailyLimit: 1, enabled: false, goal: 10 }
let root: HTMLDivElement
const button = (label: string): HTMLButtonElement =>
  [...root.querySelectorAll('button')].find((element) => element.textContent === label)!

describe(CardStampSettingsPage, () => {
  beforeEach(() => {
    root = document.createElement('div')
    document.body.append(root)
  })
  afterEach(() => {
    render(<></>, root)
    root.remove()
  })

  it('saves only the identified Card and offers a return to the list', async () => {
    const load = vi
      .fn<CardStampSettingsPageProps['settings']['load']>()
      .mockResolvedValue({ body: initial, ok: true })
    const save = vi
      .fn<CardStampSettingsPageProps['settings']['save']>()
      .mockResolvedValue({ body: { ...initial, goal: 12 }, ok: true })
    const onBack = vi.fn<() => void>()
    render(
      <CardStampSettingsPage
        card={membership}
        copy={DASH_COPY.en}
        onBack={onBack}
        settings={{ load, save }}
      />,
      root,
    )
    await vi.waitFor(() => {
      expect(root.querySelectorAll('input[type=number]')).toHaveLength(2)
    })
    expect(root.querySelector('h1')?.textContent).toBe('Coffee membership')
    expect(load).toHaveBeenCalledExactlyOnceWith('membership')
    const [, goal] = root.querySelectorAll<HTMLInputElement>('input[type=number]')
    goal.value = '12'
    goal.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => {
      expect(goal.value).toBe('12')
    })
    button(DASH_COPY.en.stamps.save).click()
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledExactlyOnceWith('membership', { ...initial, goal: 12 })
    })
    button(DASH_COPY.en.stamps.back).click()
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('ignores a late membership response after navigating to the event ticket', async () => {
    const pending =
      Promise.withResolvers<Awaited<ReturnType<CardStampSettingsPageProps['settings']['load']>>>()
    const load = vi
      .fn<CardStampSettingsPageProps['settings']['load']>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ body: initial, ok: true })
    const save = vi.fn<CardStampSettingsPageProps['settings']['save']>()
    const Switcher = (): JSX.Element => {
      const [event, setEvent] = useState(false)
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setEvent(true)
            }}
          >
            Open event
          </button>
          <CardStampSettingsPage
            card={event ? ticket : membership}
            copy={DASH_COPY.en}
            onBack={() => {}}
            settings={{ load, save }}
          />
        </>
      )
    }
    render(<Switcher />, root)
    await vi.waitFor(() => {
      expect(load).toHaveBeenCalledWith('membership')
    })
    button('Open event').click()
    await vi.waitFor(() => {
      expect(load).toHaveBeenCalledWith('event')
    })
    pending.resolve({ body: { dailyLimit: 99, enabled: true, goal: 999 }, ok: true })
    await vi.waitFor(() => {
      expect(root.querySelector('h1')?.textContent).toBe('Special event')
      expect(root.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).toBe(false)
      expect(
        [...root.querySelectorAll<HTMLInputElement>('input[type=number]')].map((input) => input.value),
      ).toStrictEqual(['1', '10'])
    })
  })

  it('does not load settings for an unknown or foreign Card', () => {
    const load = vi.fn<CardStampSettingsPageProps['settings']['load']>()
    const save = vi.fn<CardStampSettingsPageProps['settings']['save']>()
    render(
      <CardStampSettingsPage card={null} copy={DASH_COPY.en} onBack={() => {}} settings={{ load, save }} />,
      root,
    )
    expect(root.textContent).toContain(DASH_COPY.en.stamps.cardNotFound)
    expect(load).not.toHaveBeenCalled()
    expect(root.querySelector('form')).toBeNull()
  })
})
