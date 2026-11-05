import { setTimeout as sleep } from 'node:timers/promises'

import { mount as mountView, settle } from '@fuda/ui/test'
import type { ComponentChild } from 'preact'
import { act as testAct } from 'preact/test-utils'

// DOM test helpers for Preact views, on the shared UI mount. Each mount is
// disposed and the body cleared by `cleanup`, which the test files call from afterEach.
interface Mounted {
  dispose: () => void
  host: HTMLElement
  update: (view: ComponentChild) => void
}

const mounted: Mounted[] = []

// Mounts a view and returns the handle, so a test can render the same tree again
// with new props.
export const open = (view: ComponentChild): Mounted => {
  const handle = mountView(view)
  mounted.push(handle)
  return handle
}

export const mount = (view: ComponentChild): HTMLElement => open(view).host

// Renders into a host the test owns (and removes), for tests that look at the host after unmount.
export const render = (view: ComponentChild, host: HTMLElement): (() => void) => {
  const handle = mountView(view, host)
  mounted.push(handle)
  return handle.dispose
}

export const cleanup = (): void => {
  for (const handle of mounted.splice(0)) {
    handle.dispose()
  }
  document.body.replaceChildren()
}

// Lets resolved promises, queued microtasks and pending renders run before an assertion.
export const flush = async (): Promise<void> => {
  await sleep(0)
  await settle()
}

// Runs a user action and flushes the renders and effects it causes before returning,
// so the next line sees the screen the user would.
export const act = (run: () => void): void => {
  void testAct(run)
}

export const tap = (element: HTMLElement): void => {
  act(() => {
    element.click()
  })
}

export const textOf = (element: Element | null): string =>
  element?.textContent?.replaceAll(/\s+/gu, ' ').trim() ?? ''

export const buttonNamed = (host: ParentNode, name: string): HTMLButtonElement => {
  const button = [...host.querySelectorAll('button')].find((candidate) => textOf(candidate) === name)
  if (button === undefined) {
    throw new Error(`no button named ${name}`)
  }
  return button
}

// Types into a field the way a user does: set the value, then fire `input`.
export const typeInto = (field: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
  field.value = value
  act(() => {
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

// Picks an option the way a browser reports it: `input`, then `change`.
export const choose = (select: HTMLSelectElement, value: string): void => {
  select.value = value
  act(() => {
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

// Visible text with one space between text nodes, so adjacent elements read
// as separate words ("Total rights 3"), the way a screen reader would.
export const spacedText = (element: Node | null | undefined): string => {
  if (element === null || element === undefined) {
    return ''
  }
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent?.trim() ?? ''
    if (text !== '') {
      parts.push(text)
    }
  }
  return parts.join(' ').replaceAll(/\s+/gu, ' ')
}
