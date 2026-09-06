/** @jsxImportSource hono/jsx/dom */
import { describe, expect, it } from 'vitest'

import { IconButton } from './IconButton.tsx'

interface ControlNode {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Hono JSX test nodes contain heterogeneous props
  props: Record<string, unknown>
  tag: unknown
}

const isControlNode = (value: unknown): value is ControlNode =>
  typeof value === 'object' && value !== null && 'props' in value && 'tag' in value

const findControl = (value: unknown, tag: string): ControlNode | undefined => {
  if (Array.isArray(value)) {
    return value.map((child) => findControl(child, tag)).find((child) => child !== undefined)
  }
  if (!isControlNode(value)) {
    return undefined
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- this test traverses Hono's untyped JSX node representation
  const matchesTag = value.tag === tag || (typeof value.tag === 'function' && value.tag.name === tag)
  return matchesTag ? value : findControl(value.props.children, tag)
}

describe(IconButton, () => {
  it('exposes the supplied accessible name on a native button', () => {
    const icon = IconButton({
      children: <span aria-hidden="true">X</span>,
      label: 'Close menu',
      onClick: () => {},
    })

    expect(findControl(icon, 'button')?.props).toMatchObject({
      'aria-label': 'Close menu',
      type: 'button',
    })
  })
})
