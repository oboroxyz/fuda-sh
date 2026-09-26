// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { render } from 'hono/jsx/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Scanner } from './Scanner.tsx'

// happy-dom has no BarcodeDetector, so every render here takes the
// camera-unavailable branch — the same one a keyboard-wedge scanner runs in.
const mount = (props: { autoFocus?: boolean }): HTMLElement => {
  const host = document.createElement('div')
  document.body.append(host)
  render(<Scanner onInput={() => {}} {...props} />, host)
  return host
}

describe(Scanner, () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('leaves focus alone by default, so a member phone keeps its keyboard down', async () => {
    const host = mount({})
    await vi.waitFor(() => {
      expect(host.querySelector('input')).not.toBeNull()
    })
    expect(document.activeElement).not.toBe(host.querySelector('input'))
  })

  it('focuses the input when asked, so a wedge scanner needs no click', async () => {
    const host = mount({ autoFocus: true })
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(host.querySelector('input'))
    })
  })

  it('takes focus back after a stray click, so the next scan still lands', async () => {
    const host = mount({ autoFocus: true })
    await vi.waitFor(() => {
      expect(host.querySelector('input')).not.toBeNull()
    })
    const input = host.querySelector('input')!
    input.blur()
    expect(document.activeElement).not.toBe(input)
    host.querySelector('form')!.parentElement!.click()
    expect(document.activeElement).toBe(input)
  })

  it('drops the dead video frame when no camera can be used', async () => {
    const host = mount({ autoFocus: true })
    await vi.waitFor(() => {
      expect(host.querySelector('.badge')).not.toBeNull()
    })
    expect(host.querySelector('video')).toBeNull()
  })
})
