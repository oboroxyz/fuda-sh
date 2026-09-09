// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { render } from 'hono/jsx/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CardDetailPage } from './CardDetailPage.tsx'
import { DASH_COPY } from './copy.ts'
import type { DashRoute } from './router.ts'
import { membershipCard } from './test/management-fixtures.ts'

let root: HTMLDivElement

describe('Card detail', () => {
  beforeEach(() => {
    root = document.createElement('div')
    document.body.append(root)
  })
  afterEach(() => {
    render(null, root)
    root.remove()
    vi.restoreAllMocks()
  })

  it('offers real back and edit links, preserving modified navigation', () => {
    const navigate = vi.fn<(route: DashRoute) => void>()
    render(
      <CardDetailPage
        card={membershipCard}
        copy={DASH_COPY.en}
        publicUrl="https://fuda.sh/@coffee"
        onNavigate={navigate}
      />,
      root,
    )
    const back = root.querySelector<HTMLAnchorElement>('a[href="/cards"]')!
    expect(back.textContent).toBe('< Back to card')
    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
    back.dispatchEvent(modified)
    expect(modified.defaultPrevented).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
    const normal = new MouseEvent('click', { bubbles: true, cancelable: true })
    back.dispatchEvent(normal)
    expect(normal.defaultPrevented).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/cards')
  })

  it('links to the shared editor', () => {
    render(
      <CardDetailPage
        card={membershipCard}
        copy={DASH_COPY.en}
        publicUrl="https://fuda.sh/@coffee"
        onNavigate={() => {}}
      />,
      root,
    )
    expect(root.querySelector('a[href="/cards/membership/edit"]')?.textContent).toBe('Edit')
    expect(root.querySelector('form')).toBeNull()
  })

  it('keeps QR poster and copy actions on the card detail', async () => {
    const print = vi.fn<() => void>()
    vi.stubGlobal('print', print)
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(
      <CardDetailPage
        card={membershipCard}
        copy={DASH_COPY.en}
        publicUrl="https://fuda.sh/@coffee"
        onNavigate={() => {}}
      />,
      root,
    )
    const button = (label: string) =>
      [...root.querySelectorAll('button')].find((node) => node.textContent === label)!
    button('Print QR poster').click()
    expect(print).toHaveBeenCalledOnce()
    button('Copy link').click()
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Copied')
    })
    expect(clipboard).toHaveBeenCalledWith('https://fuda.sh/@coffee/membership')
    expect(root.querySelector('svg')).not.toBeNull()
  })

  it('does not expose actions for an unknown Card', () => {
    render(
      <CardDetailPage
        card={null}
        copy={DASH_COPY.en}
        publicUrl="https://fuda.sh/@coffee"
        onNavigate={() => {}}
      />,
      root,
    )
    expect(root.textContent).toContain(DASH_COPY.en.stamps.cardNotFound)
    expect(root.querySelector('button')).toBeNull()
    expect(root.querySelector('svg')).toBeNull()
  })
})
