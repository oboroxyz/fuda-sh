/** @jsxImportSource hono/jsx/dom */
import { pick } from '@fuda/i18n'
import type * as HonoDom from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DASH_COPY } from './copy.ts'
import { DashboardShell } from './DashboardShell.tsx'
import type { DashboardShellProps } from './DashboardShell.tsx'
import { findViewNodes, viewProps, viewText, walkView } from './test/test-view.ts'

type ClickHandler = (event: MouseEvent) => void
type DialogRef = (element: HTMLDialogElement | null) => (() => void) | undefined
type ButtonRef = (element: HTMLButtonElement | null) => void

// Keep the mounted refs and route-effect scheduling while exercising the real shell.
const hooks = vi.hoisted(() => ({
  effects: [] as Parameters<typeof HonoDom.useEffect>[0][],
  index: 0,
  slots: new Map<number, unknown>(),
}))
vi.mock(import('hono/jsx/dom'), async (importOriginal) => ({
  ...(await importOriginal()),
  useEffect: (
    effect: Parameters<typeof HonoDom.useEffect>[0],
    dependencies: readonly unknown[] = [],
  ): void => {
    const { index } = hooks
    hooks.index += 1
    const previous = hooks.slots.get(index) as unknown[] | undefined
    if (
      previous === undefined ||
      dependencies.some((value, position) => !Object.is(value, previous[position]))
    ) {
      hooks.effects.push(effect)
      hooks.slots.set(index, dependencies)
    }
  },
  useRef: <T,>(initial: T): { current: T } => {
    const { index } = hooks
    hooks.index += 1
    if (!hooks.slots.has(index)) {
      hooks.slots.set(index, { current: initial })
    }
    return hooks.slots.get(index) as { current: T }
  },
}))

const shell = (route: '/' | '/rights' | '/issue' = '/'): JSX.Element => {
  hooks.index = 0
  return DashboardShell({
    appearance: <div data-testid="appearance" />,
    children: <section>page</section>,
    copy: pick(DASH_COPY, 'en'),
    hasIssuer: false,
    onNavigate: (): void => {},
    onSignOut: null,
    route,
    surface: 'admin' as const,
  })
}

const linksIn = (node: unknown) => findViewNodes(node, 'a')

const linkWithPath = (node: unknown, path: string) =>
  linksIn(node).find((link) => viewProps(link).href === path)

const openDrawer = (view: JSX.Element): void => {
  const openMenu = walkView(view).find((node) => node.props['aria-label'] === 'Open menu')!
  ;(openMenu.props.onClick as () => void)()
}

describe('dashboard shell', () => {
  beforeEach(() => {
    hooks.index = 0
    hooks.slots.clear()
    hooks.effects.length = 0
  })

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
      hasIssuer: false,
      onNavigate,
      onSignOut: null,
      route: '/',
      surface: 'admin' as const,
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
      hasIssuer: false,
      onNavigate: (route) => {
        calls.push(route)
      },
      onSignOut: null,
      route: '/',
      surface: 'admin' as const,
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

  it('closes the same open drawer on back and forward route updates without closing on unrelated renders', () => {
    let focusCalls = 0
    const drawer = {
      close: (): void => {
        drawer.open = false
      },
      open: false,
      showModal: (): void => {
        drawer.open = true
      },
    }
    const opener = {
      focus: (): void => {
        focusCalls += 1
      },
    }
    const mount = (route: '/' | '/rights' | '/issue'): JSX.Element => {
      const view = shell(route)
      const openMenu = walkView(view).find((node) => node.props['aria-label'] === 'Open menu')!
      ;(openMenu.props.ref as ButtonRef)(opener as HTMLButtonElement)
      ;(findViewNodes(view, 'dialog')[0].props.ref as DialogRef)(drawer as HTMLDialogElement)
      for (const effect of hooks.effects.splice(0)) {
        effect()
      }
      return view
    }
    openDrawer(mount('/issue'))
    void mount('/issue')
    expect({ focusCalls, open: drawer.open }).toStrictEqual({ focusCalls: 0, open: true })

    const previous = mount('/rights')
    expect({ focusCalls, open: drawer.open }).toStrictEqual({ focusCalls: 1, open: false })
    openDrawer(previous)
    void mount('/issue')
    expect({ focusCalls, open: drawer.open }).toStrictEqual({ focusCalls: 2, open: false })
    void mount('/')
    expect(focusCalls).toBe(2)
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
