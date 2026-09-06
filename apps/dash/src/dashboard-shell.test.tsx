/** @jsxImportSource hono/jsx/dom */
import { pick } from '@fuda/i18n'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { describe, expect, it, vi } from 'vitest'

import { DASH_COPY } from './copy.ts'
import { DashboardShell } from './DashboardShell.tsx'
import type { DashboardShellProps } from './DashboardShell.tsx'
import { findViewNodes, viewProps, viewText, walkView } from './test/test-view.ts'

type ClickHandler = (event: MouseEvent) => void
type DialogRef = (element: HTMLDialogElement | null) => (() => void) | undefined
type ButtonRef = (element: HTMLButtonElement | null) => void

const shell = (route: '/' | '/rights' | '/issue' = '/'): JSX.Element =>
  DashboardShell({
    appearance: <div data-testid="appearance" />,
    children: <section>page</section>,
    copy: pick(DASH_COPY, 'en'),
    onNavigate: (): void => {},
    route,
  })

const linksIn = (node: unknown) => findViewNodes(node, 'a')

const linkWithPath = (node: unknown, path: string) =>
  linksIn(node).find((link) => viewProps(link).href === path)

describe('dashboard shell', () => {
  it('renders labelled desktop and drawer navigation with the selected route and appearance', () => {
    const view = shell()
    const navigation = findViewNodes(view, 'nav')

    expect(navigation).toHaveLength(2)
    expect(navigation.map((node) => viewProps(node)['aria-label'])).toStrictEqual([
      'Dashboard navigation',
      'Dashboard navigation',
    ])
    for (const nav of navigation) {
      expect(linksIn(nav).map((link) => viewProps(link).href)).toStrictEqual(['/', '/rights', '/issue'])
    }
    expect(
      walkView(view)
        .filter((node) => viewProps(node)['aria-current'] === 'page')
        .map(viewText),
    ).toStrictEqual(['Overview', 'Overview'])
    expect(walkView(view).some((node) => viewProps(node)['aria-label'] === 'Open menu')).toBe(true)
    expect(walkView(view).some((node) => viewProps(node)['data-testid'] === 'appearance')).toBe(true)
  })

  it('marks Rights as the current route', () => {
    const view = shell('/rights')

    expect(
      walkView(view)
        .filter((node) => viewProps(node)['aria-current'] === 'page')
        .map(viewText),
    ).toStrictEqual(['Rights', 'Rights'])
  })

  it('uses native links while intercepting only unmodified primary navigation', () => {
    const navigated: string[] = []
    const onNavigate: DashboardShellProps['onNavigate'] = (route): void => {
      navigated.push(route)
    }
    const view = DashboardShell({
      appearance: <div />,
      children: <section>page</section>,
      copy: pick(DASH_COPY, 'en'),
      onNavigate,
      route: '/',
    })
    const rights = linkWithPath(findViewNodes(view, 'aside')[0], '/rights')
    const handler = viewProps(rights!).onClick as ClickHandler
    const preventDefault = vi.fn<() => void>()

    handler({
      button: 0,
      ctrlKey: false,
      metaKey: false,
      preventDefault,
      shiftKey: false,
    } as unknown as MouseEvent)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(navigated).toStrictEqual(['/rights'])

    handler({
      button: 0,
      ctrlKey: true,
      metaKey: false,
      preventDefault,
      shiftKey: false,
    } as unknown as MouseEvent)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(navigated).toStrictEqual(['/rights'])
  })

  it('closes the drawer before mobile navigation and restores its opener focus', () => {
    const calls: string[] = []
    const view = DashboardShell({
      appearance: <div />,
      children: <section>page</section>,
      copy: pick(DASH_COPY, 'en'),
      onNavigate: (route) => {
        calls.push(route)
      },
      route: '/',
    })
    const [dialog] = findViewNodes(view, 'dialog')
    const openMenu = walkView(view).find((node) => viewProps(node)['aria-label'] === 'Open menu')
    const closeMenu = walkView(view).find((node) => viewProps(node)['aria-label'] === 'Close menu')
    let focusCalls = 0
    let showModalCalls = 0
    const opener = {
      focus: (): void => {
        focusCalls += 1
      },
    } as unknown as HTMLButtonElement
    const drawer = {
      close: () => {
        calls.push('close')
      },
      showModal: (): void => {
        showModalCalls += 1
      },
    } as unknown as HTMLDialogElement

    ;(viewProps(openMenu!).ref as ButtonRef)(opener)
    ;(viewProps(dialog).ref as DialogRef)(drawer)
    ;(viewProps(openMenu!).onClick as ClickHandler)({} as MouseEvent)
    expect(showModalCalls).toBe(1)

    ;(viewProps(linkWithPath(dialog, '/rights')!).onClick as ClickHandler)({
      button: 0,
      ctrlKey: false,
      metaKey: false,
      preventDefault: vi.fn<() => void>(),
      shiftKey: false,
    } as unknown as MouseEvent)
    expect(calls).toStrictEqual(['close', '/rights'])
    expect(focusCalls).toBe(1)

    ;(viewProps(closeMenu!).onClick as ClickHandler)({} as MouseEvent)
    ;(viewProps(dialog).onCancel as (event: Event) => void)({
      preventDefault: vi.fn<() => void>(),
    } as unknown as Event)
    ;(viewProps(dialog).onClick as ClickHandler)({
      currentTarget: drawer,
      target: drawer,
    } as unknown as MouseEvent)
    expect(calls).toStrictEqual(['close', '/rights', 'close', 'close', 'close'])
    expect(focusCalls).toBe(4)
  })

  it('closes an open mobile drawer when entering desktop and cleans up the breakpoint listener', () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined
    let removed: ((event: MediaQueryListEvent) => void) | undefined
    const breakpoint = {
      addEventListener: (_type: 'change', next: EventListenerOrEventListenerObject | null): void => {
        listener = next as (event: MediaQueryListEvent) => void
      },
      matches: false,
      removeEventListener: (_type: 'change', next: EventListenerOrEventListenerObject | null): void => {
        removed = next as (event: MediaQueryListEvent) => void
      },
    } as unknown as MediaQueryList
    const matchMedia = vi.fn<(query: string) => MediaQueryList>(() => breakpoint)
    vi.stubGlobal('matchMedia', matchMedia)

    try {
      const view = shell()
      const [dialog] = findViewNodes(view, 'dialog')
      const openMenu = walkView(view).find((node) => viewProps(node)['aria-label'] === 'Open menu')
      let closeCalls = 0
      let focusCalls = 0
      const drawer = {
        close: (): void => {
          closeCalls += 1
        },
        open: true,
      } as unknown as HTMLDialogElement
      const opener = {
        focus: (): void => {
          focusCalls += 1
        },
      } as unknown as HTMLButtonElement

      ;(viewProps(openMenu!).ref as ButtonRef)(opener)
      const cleanup = (viewProps(dialog).ref as DialogRef)(drawer)
      if (listener === undefined) {
        throw new Error('Expected a breakpoint listener')
      }

      listener({ matches: false } as MediaQueryListEvent)
      listener({ matches: true } as MediaQueryListEvent)
      listener({ matches: true } as MediaQueryListEvent)

      cleanup?.()
      expect({ closeCalls, focusCalls, query: matchMedia.mock.calls, removed }).toStrictEqual({
        closeCalls: 1,
        focusCalls: 1,
        query: [['(min-width: 64rem)']],
        removed: listener,
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
