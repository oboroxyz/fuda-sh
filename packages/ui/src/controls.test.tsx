/** @jsxImportSource hono/jsx/dom */
import { describe, expect, it } from 'vitest'

import { LanguageSwitcher, ThemeToggle } from './controls.tsx'

interface ControlNode {
  props: Record<string, unknown>
  tag: unknown
}

const isControlNode = (value: unknown): value is ControlNode =>
  typeof value === 'object' && value !== null && 'props' in value && 'tag' in value

const findControl = (value: unknown, tag: string): ControlNode | undefined => {
  if (Array.isArray(value)) {
    return value.map((child) => findControl(child, tag)).find((child) => child !== undefined)
  }
  if (!isControlNode(value)) return undefined
  const matchesTag = value.tag === tag || (typeof value.tag === 'function' && value.tag.name === tag)
  return matchesTag ? value : findControl(value.props.children, tag)
}

describe('appearance controls', () => {
  it('names the theme control with its current localized mode', () => {
    const theme = ThemeToggle({
      labels: { control: 'Theme', dark: 'Dark', light: 'Light', system: 'System' },
      mode: 'system',
      onChange: () => {},
    })

    expect(findControl(theme, 'button')?.props).toMatchObject({
      'aria-label': 'Theme: System',
      type: 'button',
    })
  })

  it('renders the language choice as a labelled native select', () => {
    const language = LanguageSwitcher({
      current: 'en',
      label: 'Language',
      onChange: () => {},
      options: [
        { label: 'English', value: 'en' },
        { label: '日本語', value: 'ja' },
      ],
    })

    expect(findControl(language, 'select')?.props).toMatchObject({
      'aria-label': 'Language',
      value: 'en',
    })
  })
})
