import { setTimeout as sleep } from 'node:timers/promises'

import type { JSX } from 'solid-js'
import { render } from 'solid-js/web'

// DOM test helpers for Solid views. Each mount is disposed and the body
// cleared by `cleanup`, which the test files call from afterEach.
const disposers: (() => void)[] = []

export const mount = (view: () => JSX.Element): HTMLElement => {
  const host = document.createElement('div')
  document.body.append(host)
  disposers.push(render(view, host))
  return host
}

export const cleanup = (): void => {
  for (const dispose of disposers.splice(0)) {
    dispose()
  }
  document.body.replaceChildren()
}

// Lets resolved promises and queued microtasks run before an assertion.
export const flush = async (): Promise<void> => {
  await sleep(0)
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
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

// Picks an option the way a browser reports it: `input`, then `change`.
export const choose = (select: HTMLSelectElement, value: string): void => {
  select.value = value
  select.dispatchEvent(new Event('input', { bubbles: true }))
  select.dispatchEvent(new Event('change', { bubbles: true }))
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
