/** @jsxImportSource hono/jsx/dom */
import { setTimeout } from 'node:timers/promises'

import type { IssueResponse, MembersResponse } from '@fuda/sdk'
import { LanguageSwitcher, ThemeToggle } from '@fuda/ui'
import type { LanguageSwitcherProps, ThemeToggleProps } from '@fuda/ui'
import type * as HonoDom from 'hono/jsx/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Result } from './api.ts'
import type { DashIo } from './app-actions.ts'
import { App, AppView } from './App.tsx'
import type { AppProps, AppViewProps } from './App.tsx'
import { DASH_COPY } from './copy.ts'
import { findViewNodes, viewProps } from './test/test-view.ts'

// Control only hook scheduling; App, actions, router and browser preference helpers remain real.
const hooks = vi.hoisted(() => ({
  cleanups: new Map<number, () => void>(),
  effects: [] as { effect: Parameters<typeof HonoDom.useEffect>[0]; index: number }[],
  index: 0,
  slots: new Map<number, unknown>(),
}))
vi.mock(import('hono/jsx/dom'), async (importOriginal) => ({
  ...(await importOriginal()),
  useCallback: (<T,>(callback: T, dependencies: readonly unknown[]): T => {
    const { index } = hooks
    hooks.index += 1
    const previous = hooks.slots.get(index) as { callback: T; dependencies: readonly unknown[] } | undefined
    if (
      previous === undefined ||
      dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))
    ) {
      hooks.slots.set(index, { callback, dependencies })
      return callback
    }
    return previous.callback
  }) as typeof HonoDom.useCallback,
  useEffect: (
    effect: Parameters<typeof HonoDom.useEffect>[0],
    dependencies: readonly unknown[] = [],
  ): void => {
    const { index } = hooks
    hooks.index += 1
    const previous = hooks.slots.get(index) as readonly unknown[] | undefined
    if (previous === undefined || dependencies.some((value, i) => !Object.is(value, previous[i]))) {
      hooks.effects.push({ effect, index })
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
  useState: (<T,>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void] => {
    const { index } = hooks
    hooks.index += 1
    if (!hooks.slots.has(index)) {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- emulate the hook's lazy initializer contract.
      hooks.slots.set(index, typeof initial === 'function' ? (initial as () => T)() : initial)
    }
    return [
      hooks.slots.get(index) as T,
      (value): void => {
        const next =
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- emulate the hook's functional state updater contract.
          typeof value === 'function' ? (value as (previous: T) => T)(hooks.slots.get(index) as T) : value
        hooks.slots.set(index, next)
      },
    ]
  }) as typeof HonoDom.useState,
}))

const UID = `0x${'ab'.repeat(32)}` as const
const listSuccess: Result<MembersResponse> = {
  body: {
    members: [
      {
        createdAt: 1,
        holder: null,
        level: 'private',
        memberId: 'alice',
        status: 'active',
        tier: 2,
        uid: UID,
      },
    ],
  },
  ok: true,
}
const unauthorized = { error: 'unauthorized', network: false, ok: false, status: 401 } as const

const fixture = () => ({
  issueRight: vi.fn<DashIo['issueRight']>().mockResolvedValue({
    body: {
      holder: `0x${'11'.repeat(20)}`,
      level: 'bearer',
      passUrls: { apple: '/apple', google: '/google', web: '/pass' },
      qr: `fuda:v1:${UID}`,
      uid: UID,
    },
    ok: true,
  }),
  listMembers: vi.fn<DashIo['listMembers']>().mockResolvedValue(listSuccess),
  revokeRight: vi
    .fn<DashIo['revokeRight']>()
    .mockResolvedValue({ body: { revoked: true, uid: UID }, ok: true }),
})

const browser = {
  dark: false,
  mediaListeners: new Set<() => void>(),
  routeListeners: new Set<() => void>(),
  storage: new Map<string, string>(),
}
const location = { pathname: '/rights/' }
const root = {
  classList: { toggle: vi.fn<(name: string, force: boolean) => void>() },
  dataset: { theme: 'light', themeMode: 'system' },
  lang: 'en',
}
const history = {
  pushState: vi.fn<(data: null, unused: string, path: string) => void>((_data, _unused, path) => {
    location.pathname = path
  }),
  replaceState: vi.fn<(data: null, unused: string, path: string) => void>((_data, _unused, path) => {
    location.pathname = path
  }),
}

const render = (io: DashIo, initialTheme: AppProps['initialTheme'] = 'system'): AppViewProps => {
  hooks.index = 0
  const view = App({ initialTheme, io })
  for (const { effect, index } of hooks.effects.splice(0)) {
    hooks.cleanups.get(index)?.()
    hooks.cleanups.delete(index)
    const cleanup = effect()
    if (cleanup !== undefined) {
      hooks.cleanups.set(index, cleanup)
    }
  }
  return viewProps(findViewNodes(view, AppView)[0]) as unknown as AppViewProps
}
const language = (view: AppViewProps): LanguageSwitcherProps =>
  viewProps(findViewNodes(view.appearance, LanguageSwitcher)[0]) as unknown as LanguageSwitcherProps
const theme = (view: AppViewProps): ThemeToggleProps =>
  viewProps(findViewNodes(view.appearance, ThemeToggle)[0]) as unknown as ThemeToggleProps
const authenticate = async (io: DashIo): Promise<AppViewProps> => {
  render(io).onToken('secret')
  render(io)
  await setTimeout(0)
  return render(io)
}

describe(App, () => {
  beforeEach(() => {
    hooks.index = 0
    hooks.slots.clear()
    hooks.effects.length = 0
    hooks.cleanups.clear()
    browser.dark = false
    browser.mediaListeners.clear()
    browser.routeListeners.clear()
    browser.storage.clear()
    location.pathname = '/rights/'
    root.lang = 'en'
    root.dataset.theme = 'light'
    root.dataset.themeMode = 'system'
    vi.clearAllMocks()
    vi.stubGlobal('location', location)
    vi.stubGlobal('history', history)
    vi.stubGlobal('document', { documentElement: root })
    vi.stubGlobal('window', {
      addEventListener: (_type: 'popstate', listener: () => void): void => {
        browser.routeListeners.add(listener)
      },
      localStorage: {
        getItem: (key: string): string | null => browser.storage.get(key) ?? null,
        setItem: (key: string, value: string): void => {
          browser.storage.set(key, value)
        },
      },
      matchMedia: () => ({
        addEventListener: (_type: 'change', listener: () => void): void => {
          browser.mediaListeners.add(listener)
        },
        matches: browser.dark,
        removeEventListener: (_type: 'change', listener: () => void): void => {
          browser.mediaListeners.delete(listener)
        },
      }),
      removeEventListener: (_type: 'popstate', listener: () => void): void => {
        browser.routeListeners.delete(listener)
      },
    })
  })

  afterEach(() => {
    for (const cleanup of hooks.cleanups.values()) {
      cleanup()
    }
  })

  it('canonicalizes the initial path and applies saved locale before authentication', () => {
    browser.storage.set('fuda:locale', 'ja')
    const io = fixture()
    const view = render(io, 'dark')
    expect({ copy: view.copy, members: view.members, route: view.route, token: view.token }).toStrictEqual({
      copy: DASH_COPY.ja,
      members: { kind: 'idle' },
      route: '/rights',
      token: null,
    })
    expect(root.lang).toBe('ja')
    expect(theme(view).mode).toBe('dark')
    expect(history.replaceState).toHaveBeenCalledExactlyOnceWith(null, '', '/rights')
    expect(io.listMembers).not.toHaveBeenCalled()
  })

  it('loads once per token and preserves the resource across navigation and appearance changes', async () => {
    const io = fixture()
    const loaded = await authenticate(io)
    expect(loaded.members).toMatchObject({
      kind: 'ready',
      rows: [{ memberId: 'alice', tier: 'VIP', uid: UID }],
    })
    loaded.onNavigate('/issue')
    language(loaded).onChange('ja')
    theme(loaded).onChange('dark')
    const changed = render(io)
    expect({ copy: changed.copy, route: changed.route, token: changed.token }).toStrictEqual({
      copy: DASH_COPY.ja,
      route: '/issue',
      token: 'secret',
    })
    expect(changed.members).toBe(loaded.members)
    expect({
      language: root.lang,
      navigation: history.pushState.mock.calls,
      storage: [...browser.storage],
      theme: root.dataset.theme,
    }).toStrictEqual({
      language: 'ja',
      navigation: [[null, '', '/issue']],
      storage: [
        ['fuda:locale', 'ja'],
        ['fuda:theme', 'dark'],
      ],
      theme: 'dark',
    })
    expect(io.listMembers).toHaveBeenCalledExactlyOnceWith('secret')
  })

  it('subscribes to history without reloading and removes the subscription on unmount', async () => {
    const io = fixture()
    await authenticate(io)
    location.pathname = '/issue'
    for (const listener of browser.routeListeners) {
      listener()
    }
    expect(render(io).route).toBe('/issue')
    expect(io.listMembers).toHaveBeenCalledOnce()
    for (const cleanup of hooks.cleanups.values()) {
      cleanup()
    }
    expect(browser.routeListeners.size).toBe(0)
    expect(browser.mediaListeners.size).toBe(0)
  })

  it('tracks live system theme only in system mode and validates locale selection', () => {
    const io = fixture()
    let view = render(io)
    language(view).onChange('invalid')
    expect(render(io).copy).toBe(DASH_COPY.en)
    browser.dark = true
    for (const listener of browser.mediaListeners) {
      listener()
    }
    expect(root.dataset.theme).toBe('dark')
    theme(view).onChange('light')
    view = render(io)
    expect({ mode: root.dataset.theme, subscriptions: browser.mediaListeners.size }).toStrictEqual({
      mode: 'light',
      subscriptions: 0,
    })
    theme(view).onChange('system')
    render(io)
    expect({ mode: root.dataset.theme, subscriptions: browser.mediaListeners.size }).toStrictEqual({
      mode: 'dark',
      subscriptions: 1,
    })
  })

  it('retains previous rows when a successful write is followed by a failed refresh', async () => {
    const io = fixture()
    const loaded = await authenticate(io)
    io.listMembers.mockResolvedValueOnce({ error: 'offline', network: true, ok: false, status: 0 })
    await loaded.onRevoke(UID)
    expect(render(io).members).toMatchObject({
      kind: 'error',
      message: 'offline',
      previousRows: [{ memberId: 'alice', uid: UID }],
    })
    expect(render(io).token).toBe('secret')
    expect(io.listMembers).toHaveBeenCalledTimes(2)
  })

  it('keeps rows and authentication without reloading after a non-401 write failure', async () => {
    const io = fixture()
    const loaded = await authenticate(io)
    io.revokeRight.mockResolvedValueOnce({ error: 'bad_uid', network: false, ok: false, status: 400 })
    await loaded.onRevoke(UID)
    expect(render(io).members).toBe(loaded.members)
    expect(render(io).token).toBe('secret')
    expect(io.listMembers).toHaveBeenCalledOnce()
  })

  it.each(['list', 'issue', 'revoke'] as const)(
    'clears protected state for %s 401 while preserving route and preferences',
    async (action) => {
      const io = fixture()
      let view = render(io)
      view.onNavigate('/issue')
      language(view).onChange('ja')
      theme(view).onChange('dark')
      view = await authenticate(io)
      if (action === 'list') {
        io.listMembers.mockResolvedValueOnce(unauthorized)
        await view.onRevoke(UID)
      } else if (action === 'issue') {
        io.issueRight.mockResolvedValueOnce(unauthorized)
        await view.onIssue({ memberId: 'alice', tier: 1, usageModel: 1 })
      } else {
        io.revokeRight.mockResolvedValueOnce(unauthorized)
        await view.onRevoke(UID)
      }
      const rejected = render(io)
      expect({
        authError: rejected.authError,
        members: rejected.members,
        token: rejected.token,
      }).toStrictEqual({
        authError: 'unauthorized',
        members: { kind: 'idle' },
        token: null,
      })
      expect(rejected.route).toBe('/issue')
      expect(rejected.copy).toBe(DASH_COPY.ja)
      expect(theme(rejected).mode).toBe('dark')
      expect(io.listMembers).toHaveBeenCalledTimes(action === 'list' ? 2 : 1)
    },
  )

  it('does not restore protected rows when an earlier load finishes after a write returns 401', async () => {
    const io = fixture()
    const pending = Promise.withResolvers<Result<MembersResponse>>()
    io.listMembers.mockReturnValueOnce(pending.promise)
    render(io).onToken('secret')
    render(io)
    io.issueRight.mockResolvedValueOnce(unauthorized)
    await render(io).onIssue({ memberId: 'alice', tier: 1, usageModel: 1 })
    pending.resolve(listSuccess)
    await setTimeout(0)
    const rejected = render(io)
    expect({ members: rejected.members, token: rejected.token }).toStrictEqual({
      members: { kind: 'idle' },
      token: null,
    })
  })

  it.each([
    { completion: 'success', result: { body: { members: [] }, ok: true } },
    { completion: 'non-401 failure', result: { error: 'offline', network: true, ok: false, status: 0 } },
  ] satisfies { completion: string; result: Result<MembersResponse> }[])(
    'keeps newer post-issue rows when the initial load finishes with $completion',
    async ({ result }) => {
      const io = fixture()
      const initial = Promise.withResolvers<Result<MembersResponse>>()
      io.listMembers.mockReturnValueOnce(initial.promise)
      render(io).onToken('secret')
      render(io)

      await render(io).onIssue({ memberId: 'alice', tier: 1, usageModel: 1 })
      const refreshed = render(io)
      expect(refreshed.members).toMatchObject({
        kind: 'ready',
        rows: [{ memberId: 'alice', tier: 'VIP', uid: UID }],
      })

      initial.resolve(result)
      await setTimeout(0)
      expect(render(io).members).toBe(refreshed.members)
      expect(io.listMembers).toHaveBeenCalledTimes(2)
    },
  )

  it('clears the current token when a superseded load returns 401 after the post-issue reload', async () => {
    const io = fixture()
    const initial = Promise.withResolvers<Result<MembersResponse>>()
    io.listMembers.mockReturnValueOnce(initial.promise)
    render(io).onToken('secret')
    render(io)
    await render(io).onIssue({ memberId: 'alice', tier: 1, usageModel: 1 })

    initial.resolve(unauthorized)
    await setTimeout(0)
    const rejected = render(io)
    expect({ authError: rejected.authError, members: rejected.members, token: rejected.token }).toStrictEqual(
      {
        authError: 'unauthorized',
        members: { kind: 'idle' },
        token: null,
      },
    )
  })

  it('ignores an earlier token load returning 401 after the replacement token has loaded', async () => {
    const io = fixture()
    const initial = Promise.withResolvers<Result<MembersResponse>>()
    io.listMembers.mockReturnValueOnce(initial.promise)
    render(io).onToken('secret')
    render(io).onToken('replacement')
    render(io)
    await setTimeout(0)
    const replaced = render(io)

    initial.resolve(unauthorized)
    await setTimeout(0)
    expect(render(io).members).toBe(replaced.members)
    expect(render(io).token).toBe('replacement')
  })

  it('keeps the replacement token load current when an earlier token issue succeeds after 401', async () => {
    const io = fixture()
    const initial = Promise.withResolvers<Result<MembersResponse>>()
    const replacement = Promise.withResolvers<Result<MembersResponse>>()
    const issue = Promise.withResolvers<Result<IssueResponse>>()
    io.listMembers.mockReturnValueOnce(initial.promise).mockReturnValueOnce(replacement.promise)
    io.issueRight.mockReturnValueOnce(issue.promise)
    render(io).onToken('secret')
    render(io)
    const pendingWrite = render(io).onIssue({ memberId: 'alice', tier: 1, usageModel: 1 })

    initial.resolve(unauthorized)
    await setTimeout(0)
    expect(render(io).token).toBeNull()
    render(io).onToken('replacement')
    render(io)

    issue.resolve({
      body: {
        holder: `0x${'11'.repeat(20)}`,
        level: 'bearer',
        passUrls: { apple: '/apple', google: '/google', web: '/pass' },
        qr: `fuda:v1:${UID}`,
        uid: UID,
      },
      ok: true,
    })
    await pendingWrite
    replacement.resolve(listSuccess)
    await setTimeout(0)

    const loaded = render(io)
    expect(loaded.token).toBe('replacement')
    expect(loaded.members).toMatchObject({ kind: 'ready', rows: [{ memberId: 'alice', uid: UID }] })
    expect(io.listMembers.mock.calls).toStrictEqual([['secret'], ['replacement']])
  })
})
