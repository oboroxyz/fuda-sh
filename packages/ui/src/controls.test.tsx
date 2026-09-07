/** @jsxImportSource hono/jsx/dom */
import { describe, expect, it } from 'vitest'

import { LanguageSwitcher, ThemeToggle } from './controls.tsx'

interface ControlNode {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Hono JSX test nodes contain heterogeneous props
  props: Record<string, unknown>
  tag: unknown
}

type MenuClickHandler = (event: {
  currentTarget: { closest: () => { open: boolean; tagName: string } }
}) => void

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

const findControls = (value: unknown, tag: string): ControlNode[] => {
  if (Array.isArray(value)) {
    return value.flatMap((child) => findControls(child, tag))
  }
  if (!isControlNode(value)) {
    return []
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- this test traverses Hono's untyped JSX node representation
  const matchesTag = value.tag === tag || (typeof value.tag === 'function' && value.tag.name === tag)
  return [...(matchesTag ? [value] : []), ...findControls(value.props.children, tag)]
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
      class: 'fuda-icon-button',
      type: 'button',
    })
    expect(findControl(theme, 'svg')?.props).toMatchObject({
      'aria-hidden': 'true',
      'data-ico': 'system',
    })
  })

  it('renders the language choice as a labelled globe menu', () => {
    const language = LanguageSwitcher({
      current: 'en',
      label: 'Language',
      onChange: () => {},
      options: [
        { label: 'English', value: 'en' },
        { label: '日本語', value: 'ja' },
      ],
    })

    expect(findControl(language, 'details')?.props).toMatchObject({ class: 'fuda-language-menu' })
    expect(findControl(language, 'summary')?.props).toMatchObject({
      'aria-label': 'Language',
      class: 'fuda-icon-button',
    })
    expect(findControl(language, 'svg')?.props).toMatchObject({ 'data-ico': 'language' })
    expect(findControls(language, 'button').map((node) => node.props['aria-current'])).toStrictEqual([
      'true',
      undefined,
    ])
  })

  it('closes the language menu and forwards the selected value', () => {
    const changes: string[] = []
    const language = LanguageSwitcher({
      current: 'en',
      label: 'Language',
      onChange: (value) => {
        changes.push(value)
      },
      options: [
        { label: 'English', value: 'en' },
        { label: '日本語', value: 'ja' },
      ],
    })
    const handler = findControls(language, 'button')[1]?.props.onClick as MenuClickHandler | undefined
    const menu = { open: true, tagName: 'DETAILS' }

    expect(handler).toBeTypeOf('function')
    handler?.({ currentTarget: { closest: () => menu } })
    expect(changes).toStrictEqual(['ja'])
    expect(menu.open).toBe(false)
  })
})
