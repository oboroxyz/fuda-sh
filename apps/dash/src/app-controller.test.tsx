/** @jsxImportSource hono/jsx/dom */
import { setTimeout } from 'node:timers/promises'

import type {
  IssuerCreateResponse,
  IssuerMeResponse,
  IssueResponse,
  MembersResponse,
  RevokeResponse,
} from '@fuda/sdk'
import { LanguageSwitcher, ThemeToggle } from '@fuda/ui'
import type { LanguageSwitcherProps, ThemeToggleProps } from '@fuda/ui'
import type * as HonoDom from 'hono/jsx/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Result } from './api.ts'
import type { DashIo, DesignIo } from './app-actions.ts'
import { App } from './App.tsx'
import type { AppProps } from './App.tsx'
import { AppView } from './AppView.tsx'
import type { AppViewProps } from './AppView.tsx'
import { API_BASE_URL } from './config.ts'
import { DASH_COPY } from './copy.ts'
import type { ClaimIo } from './ens-claim.ts'
import { EnsClaim } from './EnsClaim.tsx'
import type { EnsClaimProps } from './EnsClaim.tsx'
import type { LogoSet } from './logo.ts'
import { DEFAULT_OPERATOR_IO } from './operator-io.ts'
import type { OperatorIo } from './operator-io.ts'
import type { SignInOutcome } from './operator-sign-in.ts'
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
const issueSuccess: Result<IssueResponse> = {
  body: {
    holder: `0x${'11'.repeat(20)}`,
    level: 'bearer',
    passUrls: { apple: '/apple', google: '/google', web: '/pass' },
    qr: `fuda:v1:${UID}`,
    uid: UID,
  },
  ok: true,
}
const revokeSuccess: Result<RevokeResponse> = { body: { revoked: true, uid: UID }, ok: true }

const operatorIssuer: IssuerMeResponse = {
  cards: [
    {
      category: 'membership',
      claimFrom: null,
      claimUntil: null,
      claimable: true,
      description: '',
      id: 'card_1',
      slug: 'membership-card',
      title: 'Membership Card',
      validFrom: null,
      validUntil: null,
      validityDays: null,
    },
  ],
  ens: { claimTxHash: null, expiry: null, name: 'wassie-coffee.fuda.eth', status: 'unclaimed' },
  issuer: {
    brandColor: '#6F4320',
    createdAt: 1_757_000_000,
    handle: 'wassie-coffee',
    id: 'issuer_1',
    logoUrl: null,
    name: 'Wassie Coffee',
    operatorAddress: `0x${'11'.repeat(20)}`,
    tagline: '',
  },
  publicUrl: 'https://fuda.sh/@wassie-coffee',
}

const createResponse: IssuerCreateResponse = {
  cards: [],
  ens: operatorIssuer.ens,
  issuer: operatorIssuer.issuer,
  publicUrl: operatorIssuer.publicUrl,
}

const logo: LogoSet = {
  logo1x: new Blob([new Uint8Array(1)], { type: 'image/png' }),
  logo2x: new Blob([new Uint8Array(2)], { type: 'image/png' }),
  logo3x: new Blob([new Uint8Array(3)], { type: 'image/png' }),
  master: new Blob([new Uint8Array(4)], { type: 'image/png' }),
}

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
const sessionKey = `fuda:dash:operator:${API_BASE_URL}`
const remount = (): void => {
  for (const cleanup of hooks.cleanups.values()) {
    cleanup()
  }
  hooks.cleanups.clear()
  hooks.slots.clear()
  hooks.effects.length = 0
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

const render = (
  io: DashIo,
  initialTheme: AppProps['initialTheme'] = 'system',
  operatorIo?: OperatorIo,
): AppViewProps => {
  hooks.index = 0
  const view = App({ initialTheme, io, operatorIo })
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
const authenticateOperator = async (io: DashIo, operatorIo: OperatorIo): Promise<AppViewProps> => {
  render(io, 'system', operatorIo).onPasskey()
  await setTimeout(0)
  return render(io, 'system', operatorIo)
}
const ensPropsOf = (view: AppViewProps): EnsClaimProps => {
  if (view.ens === null) {
    throw new Error('expected ENS view')
  }
  return viewProps(findViewNodes(view.ens, EnsClaim)[0]) as unknown as EnsClaimProps
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
        removeItem: (key: string): void => {
          browser.storage.delete(key)
        },
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
    expect({
      copy: view.copy,
      members: view.members,
      route: view.route,
      token: view.session.token,
    }).toStrictEqual({
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
    expect({ copy: changed.copy, route: changed.route, token: changed.session.token }).toStrictEqual({
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

  it.each([
    { issuer: operatorIssuer, name: 'registered venue', path: '/cards' },
    {
      issuer: { cards: [], ens: null, issuer: null, publicUrl: null } as IssuerMeResponse,
      name: 'new operator',
      path: '/start',
    },
  ])('restores a $name after reload without a new passkey ceremony', async ({ issuer, path }) => {
    const io = fixture()
    const operatorIo = {
      ...DEFAULT_OPERATOR_IO,
      issuerMe: vi.fn<OperatorIo['issuerMe']>().mockResolvedValue({ body: issuer, ok: true }),
      signIn: vi.fn<OperatorIo['signIn']>().mockResolvedValue({ issuer, ok: true, token: 'saved-token' }),
    }
    await authenticateOperator(io, operatorIo)
    remount()
    const pending = render(io, 'system', operatorIo)
    expect(pending.restoreState).toBe('loading')
    await setTimeout(0)
    const restored = render(io, 'system', operatorIo)
    expect({
      operator: restored.session.operator,
      restoring: restored.restoreState,
      route: restored.route,
      token: restored.session.token,
    }).toStrictEqual({ operator: issuer, restoring: null, route: path, token: 'saved-token' })
    expect(operatorIo.issuerMe).toHaveBeenCalledExactlyOnceWith('saved-token')
    expect(operatorIo.signIn).toHaveBeenCalledOnce()
    expect(io.listMembers).not.toHaveBeenCalled()
  })

  it('replaces a restored legacy Card URL with its slug without adding a history entry', async () => {
    browser.storage.set(sessionKey, 'saved-token')
    location.pathname = '/cards/card_1/stamps'
    const io = fixture()
    const operatorIo = {
      ...DEFAULT_OPERATOR_IO,
      issuerMe: vi.fn<OperatorIo['issuerMe']>().mockResolvedValue({ body: operatorIssuer, ok: true }),
    }
    render(io, 'system', operatorIo)
    await setTimeout(0)
    render(io, 'system', operatorIo)
    const restored = render(io, 'system', operatorIo)
    expect(restored.route).toBe('/cards/membership-card/edit')
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/cards/membership-card/edit')
    expect(history.pushState).not.toHaveBeenCalled()
  })

  it('clears an expired saved session', async () => {
    browser.storage.set(sessionKey, 'expired')
    const io = fixture()
    const operatorIo = {
      ...DEFAULT_OPERATOR_IO,
      issuerMe: vi.fn<OperatorIo['issuerMe']>().mockResolvedValue(unauthorized),
    }
    render(io, 'system', operatorIo)
    await setTimeout(0)
    const view = render(io, 'system', operatorIo)
    expect(view.session).toMatchObject({ authError: 'unauthorized', token: null })
    expect(view.restoreState).toBeNull()
    expect(browser.storage.has(sessionKey)).toBe(false)
  })

  it.each(['network', 'server', 'throw'])(
    'retains the saved session on %s failure and retries restoration',
    async (failure) => {
      browser.storage.set(sessionKey, 'saved-token')
      const io = fixture()
      const issuerMe = vi.fn<OperatorIo['issuerMe']>()
      if (failure === 'throw') {
        issuerMe.mockRejectedValueOnce(new Error('offline'))
      } else {
        issuerMe.mockResolvedValueOnce({
          error: 'unavailable',
          network: failure === 'network',
          ok: false,
          status: failure === 'network' ? 0 : 503,
        })
      }
      issuerMe.mockResolvedValueOnce({ body: operatorIssuer, ok: true })
      const operatorIo = { ...DEFAULT_OPERATOR_IO, issuerMe }
      render(io, 'system', operatorIo)
      await setTimeout(0)
      const failed = render(io, 'system', operatorIo)
      expect(failed.restoreState).toBe('failed')
      expect(failed.session.token).toBeNull()
      expect(browser.storage.get(sessionKey)).toBe('saved-token')
      failed.onRestore()
      await setTimeout(0)
      expect(render(io, 'system', operatorIo).session.operator).toStrictEqual(operatorIssuer)
    },
  )

  it.each(['sign-out', 'admin'])(
    'ignores a late restoration after %s and removes the saved credential',
    async (replacement) => {
      browser.storage.set(sessionKey, 'saved-token')
      const io = fixture()
      const pending = Promise.withResolvers<Result<IssuerMeResponse>>()
      const operatorIo = {
        ...DEFAULT_OPERATOR_IO,
        issuerMe: vi.fn<OperatorIo['issuerMe']>().mockReturnValue(pending.promise),
        signOut: vi.fn<OperatorIo['signOut']>().mockResolvedValue({ body: { loggedOut: true }, ok: true }),
      }
      const view = render(io, 'system', operatorIo)
      if (replacement === 'sign-out') {
        view.onSignOut()
      } else {
        view.onToken('admin-token')
      }
      pending.resolve({ body: operatorIssuer, ok: true })
      await setTimeout(0)
      const next = render(io, 'system', operatorIo)
      expect(next.session.token).toBe(replacement === 'admin' ? 'admin-token' : null)
      expect(next.session.operator).toBeNull()
      expect(browser.storage.has(sessionKey)).toBe(false)
    },
  )

  it.each(['logout', 'unauthorized'])('does not restore a session ended by %s', async (reason) => {
    const io = fixture()
    const operatorIo: OperatorIo = {
      ...DEFAULT_OPERATOR_IO,
      checkHandle: vi.fn<OperatorIo['checkHandle']>().mockResolvedValue(unauthorized),
      signIn: vi
        .fn<OperatorIo['signIn']>()
        .mockResolvedValue({ issuer: operatorIssuer, ok: true, token: 'saved-token' }),
      signOut: vi.fn<OperatorIo['signOut']>().mockResolvedValue({ body: { loggedOut: true }, ok: true }),
    }
    const view = await authenticateOperator(io, operatorIo)
    expect(browser.storage.get(sessionKey)).toBe('saved-token')
    if (reason === 'logout') {
      view.onSignOut()
    } else {
      await view.onCheckHandle('coffee')
    }
    remount()
    const fresh = render(io, 'system', operatorIo)
    expect({
      restoring: fresh.restoreState,
      stored: browser.storage.has(sessionKey),
      token: fresh.session.token,
    }).toStrictEqual({ restoring: null, stored: false, token: null })
  })

  it('still signs in and out when browser storage is blocked', async () => {
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new Error('storage blocked')
      },
    })
    const io = fixture()
    const operatorIo: OperatorIo = {
      ...DEFAULT_OPERATOR_IO,
      signIn: vi
        .fn<OperatorIo['signIn']>()
        .mockResolvedValue({ issuer: operatorIssuer, ok: true, token: 'memory-token' }),
      signOut: vi.fn<OperatorIo['signOut']>().mockResolvedValue({ body: { loggedOut: true }, ok: true }),
    }
    const view = await authenticateOperator(io, operatorIo)
    expect(view.session.token).toBe('memory-token')
    view.onSignOut()
    expect(render(io, 'system', operatorIo).session.token).toBeNull()
  })

  it.each([
    { next: 'new-tab-token', result: { body: operatorIssuer, ok: true } as Result<IssuerMeResponse> },
    { next: null, result: { body: operatorIssuer, ok: true } as Result<IssuerMeResponse> },
    { next: 'new-tab-token', result: unauthorized },
  ])('ignores restoration when another tab changes the saved token ($next)', async ({ next, result }) => {
    browser.storage.set(sessionKey, 'old-token')
    const pending = Promise.withResolvers<Result<IssuerMeResponse>>()
    const io = fixture()
    const operatorIo = {
      ...DEFAULT_OPERATOR_IO,
      issuerMe: vi.fn<OperatorIo['issuerMe']>().mockReturnValue(pending.promise),
    }
    render(io, 'system', operatorIo)
    if (next === null) {
      browser.storage.delete(sessionKey)
    } else {
      browser.storage.set(sessionKey, next)
    }
    pending.resolve(result)
    await setTimeout(0)
    const view = render(io, 'system', operatorIo)
    expect({ saved: browser.storage.get(sessionKey) ?? null, token: view.session.token }).toStrictEqual({
      saved: next,
      token: null,
    })
  })

  it('does not erase another tab login when an older active session expires', async () => {
    const io = fixture()
    const operatorIo: OperatorIo = {
      ...DEFAULT_OPERATOR_IO,
      checkHandle: vi.fn<OperatorIo['checkHandle']>().mockResolvedValue(unauthorized),
      signIn: vi
        .fn<OperatorIo['signIn']>()
        .mockResolvedValue({ issuer: operatorIssuer, ok: true, token: 'old-token' }),
    }
    const view = await authenticateOperator(io, operatorIo)
    browser.storage.set(sessionKey, 'new-tab-token')
    await view.onCheckHandle('coffee')
    expect(browser.storage.get(sessionKey)).toBe('new-tab-token')
    expect(render(io, 'system', operatorIo).session.token).toBeNull()
  })

  it('does not persist admin credentials across reload', async () => {
    const io = fixture()
    await authenticate(io)
    remount()
    expect(render(io).session.token).toBeNull()
    expect(browser.storage.has(sessionKey)).toBe(false)
  })

  it('uses the operator sign-in dependency without loading admin members', async () => {
    const io = fixture()
    const operatorIo: OperatorIo = {
      ...DEFAULT_OPERATOR_IO,
      signIn: vi.fn<OperatorIo['signIn']>().mockResolvedValue({
        issuer: { cards: [], ens: null, issuer: null, publicUrl: null },
        ok: true,
        token: 'operator-token',
      }),
    }
    render(io, 'system', operatorIo).onPasskey()
    await setTimeout(0)
    const view = render(io, 'system', operatorIo)
    expect(view.session.token).toBe('operator-token')
    expect(view.route).toBe('/start')
    expect(io.listMembers).not.toHaveBeenCalled()
    expect(operatorIo.signIn).toHaveBeenCalledOnce()
  })

  it('does not restore an operator after a replacement admin session', async () => {
    const io = fixture()
    const pending = Promise.withResolvers<SignInOutcome>()
    const operatorIo: OperatorIo = {
      ...DEFAULT_OPERATOR_IO,
      signIn: async () => await pending.promise,
    }
    render(io, 'system', operatorIo).onPasskey()
    render(io, 'system', operatorIo).onToken('replacement')
    render(io, 'system', operatorIo)
    pending.resolve({
      issuer: { cards: [], ens: null, issuer: null, publicUrl: null },
      ok: true,
      token: 'old-operator',
    })
    await setTimeout(0)
    const view = render(io, 'system', operatorIo)
    expect(view.session.token).toBe('replacement')
    expect(view.session.operator).toBeNull()
    expect(view.signingIn).toBe(false)
    expect(view.route).not.toBe('/cards/new')
  })

  it('does not let an old sign-in failure clear replacement busy state', async () => {
    const io = fixture()
    const pending = Promise.withResolvers<SignInOutcome>()
    const operatorIo: OperatorIo = { ...DEFAULT_OPERATOR_IO, signIn: async () => await pending.promise }
    render(io, 'system', operatorIo).onPasskey()
    render(io, 'system', operatorIo).onToken('replacement')
    pending.resolve({ failure: 'network', ok: false })
    await setTimeout(0)
    const view = render(io, 'system', operatorIo)
    expect({ error: view.signInError, signingIn: view.signingIn, token: view.session.token }).toStrictEqual({
      error: null,
      signingIn: false,
      token: 'replacement',
    })
  })

  it.each([
    { completion: 'success', outcome: { body: createResponse, ok: true } },
    {
      completion: 'session failure',
      outcome: { error: 'unauthorized', network: false, ok: false, status: 401 },
    },
  ] satisfies { completion: string; outcome: Awaited<ReturnType<DesignIo['createIssuer']>> }[])(
    'does not let an old create $completion affect a replacement session',
    async ({ outcome }) => {
      const io = fixture()
      const pending = Promise.withResolvers<Awaited<ReturnType<DesignIo['createIssuer']>>>()
      const operatorIo: OperatorIo = {
        ...DEFAULT_OPERATOR_IO,
        design: { ...DEFAULT_OPERATOR_IO.design, createIssuer: async () => await pending.promise },
      }
      render(io, 'system', operatorIo).onToken('old')
      render(io, 'system', operatorIo).onCreateVenue(
        { brandColor: '#6F4320', handle: 'old-venue', name: 'Old Venue', tagline: '' },
        null,
      )
      expect(render(io, 'system', operatorIo).creating).toBe(true)

      render(io, 'system', operatorIo).onToken('replacement')
      pending.resolve(outcome)
      await setTimeout(0)
      const view = render(io, 'system', operatorIo)
      expect({
        createFailure: view.createFailure,
        creating: view.creating,
        operator: view.session.operator,
        route: view.route,
        token: view.session.token,
      }).toStrictEqual({
        createFailure: null,
        creating: false,
        operator: null,
        route: '/rights',
        token: 'replacement',
      })
    },
  )

  it.each([
    { completion: 'success', result: { body: { expiresAt: 1_757_000_900, logoUploadId: 'up_1' }, ok: true } },
    { completion: 'session failure', result: unauthorized },
  ] satisfies { completion: string; result: Awaited<ReturnType<DesignIo['uploadLogo']>> }[])(
    'returns false and preserves the replacement session after an old logo $completion',
    async ({ result }) => {
      const io = fixture()
      const pending = Promise.withResolvers<Awaited<ReturnType<DesignIo['uploadLogo']>>>()
      const operatorIo: OperatorIo = {
        ...DEFAULT_OPERATOR_IO,
        design: { ...DEFAULT_OPERATOR_IO.design, uploadLogo: async () => await pending.promise },
        signIn: vi
          .fn<OperatorIo['signIn']>()
          .mockResolvedValue({ issuer: operatorIssuer, ok: true, token: 'old' }),
      }
      const view = await authenticateOperator(io, operatorIo)
      const applying = view.onCommitLogo(logo)
      render(io, 'system', operatorIo).onToken('replacement')
      pending.resolve(result)
      await expect(applying).resolves.toBe(false)
      render(io, 'system', operatorIo)
      const replacement = render(io, 'system', operatorIo)
      expect({
        operator: replacement.session.operator,
        route: replacement.route,
        token: replacement.session.token,
      }).toStrictEqual({ operator: null, route: '/', token: 'replacement' })
    },
  )

  it.each(['success', 'unauthorized'])(
    'ignores a venue update finishing with %s after the session is replaced',
    async (completion) => {
      const io = fixture()
      const pending = Promise.withResolvers<Awaited<ReturnType<OperatorIo['updateIssuer']>>>()
      const body = { brandColor: '#0073EB', name: 'New Coffee', tagline: '' }
      const operatorIo: OperatorIo = {
        ...DEFAULT_OPERATOR_IO,
        signIn: vi
          .fn<OperatorIo['signIn']>()
          .mockResolvedValue({ issuer: operatorIssuer, ok: true, token: 'old' }),
        updateIssuer: async () => await pending.promise,
      }
      const view = await authenticateOperator(io, operatorIo)
      const updating = view.onUpdateVenue(body)
      render(io, 'system', operatorIo).onToken('replacement')
      pending.resolve(
        completion === 'unauthorized'
          ? unauthorized
          : { body: { issuer: { ...operatorIssuer.issuer, ...body } }, ok: true },
      )
      await expect(updating).resolves.toBe(false)
      const replacement = render(io, 'system', operatorIo)
      expect(replacement.session.operator).toBeNull()
      expect(replacement.session.token).toBe('replacement')
      expect(replacement.session.authError).toBeNull()
    },
  )

  it('ends the current operator session when a venue update is unauthorized', async () => {
    const io = fixture()
    const operatorIo: OperatorIo = {
      ...DEFAULT_OPERATOR_IO,
      signIn: vi
        .fn<OperatorIo['signIn']>()
        .mockResolvedValue({ issuer: operatorIssuer, ok: true, token: 'session' }),
      updateIssuer: vi.fn<OperatorIo['updateIssuer']>().mockResolvedValue(unauthorized),
    }
    const view = await authenticateOperator(io, operatorIo)
    await expect(view.onUpdateVenue({ brandColor: '#0073EB', name: 'Coffee', tagline: '' })).resolves.toBe(
      false,
    )
    const expired = render(io, 'system', operatorIo)
    expect(expired.session.operator).toBeNull()
    expect(expired.session.token).toBeNull()
    expect(expired.session.authError).toBe('unauthorized')
  })

  it('clears the local operator session before delayed remote sign-out completes', async () => {
    const io = fixture()
    const pending = Promise.withResolvers<Awaited<ReturnType<OperatorIo['signOut']>>>()
    const operatorIo: OperatorIo = {
      ...DEFAULT_OPERATOR_IO,
      signIn: vi
        .fn<OperatorIo['signIn']>()
        .mockResolvedValue({ issuer: operatorIssuer, ok: true, token: 'old' }),
      signOut: vi.fn<OperatorIo['signOut']>().mockReturnValue(pending.promise),
    }
    const view = await authenticateOperator(io, operatorIo)
    view.onSignOut()
    expect(render(io).session).toMatchObject({ operator: null, token: null })
    render(io).onToken('replacement')
    pending.resolve({ body: { loggedOut: true }, ok: true })
    await setTimeout(0)
    expect(render(io).session).toMatchObject({ operator: null, token: 'replacement' })
    expect(operatorIo.signOut).toHaveBeenCalledExactlyOnceWith('old')
  })

  it.each([
    {
      completion: 'voucher failure',
      confirm: null,
      voucher: { error: 'ens_not_configured', network: false, ok: false, status: 400 },
    },
    {
      completion: 'voucher success and confirm success',
      confirm: {
        body: { claimTxHash: UID, expiry: null, name: 'wassie-coffee.fuda.eth', status: 'claimed' },
        ok: true,
      },
      voucher: {
        body: {
          chainId: 11_155_111,
          name: 'wassie-coffee.fuda.eth',
          voucher: {
            deadline: 1_757_000_900,
            expiry: 1_757_001_000,
            issuer: `0x${'11'.repeat(20)}`,
            label: 'wassie-coffee',
            nonce: '1',
            registrar: `0x${'22'.repeat(20)}`,
            signature: `0x${'aa'.repeat(65)}`,
          },
        },
        ok: true,
      },
    },
    {
      completion: 'voucher success and confirm failure',
      confirm: { error: 'not_confirmed', network: false, ok: false, status: 409 },
      voucher: {
        body: {
          chainId: 11_155_111,
          name: 'wassie-coffee.fuda.eth',
          voucher: {
            deadline: 1_757_000_900,
            expiry: 1_757_001_000,
            issuer: `0x${'11'.repeat(20)}`,
            label: 'wassie-coffee',
            nonce: '1',
            registrar: `0x${'22'.repeat(20)}`,
            signature: `0x${'aa'.repeat(65)}`,
          },
        },
        ok: true,
      },
    },
  ] satisfies {
    completion: string
    confirm: Awaited<ReturnType<ClaimIo['confirmClaim']>> | null
    voucher: Awaited<ReturnType<ClaimIo['requestVoucher']>>
  }[])('keeps replacement-operator ENS state after old $completion', async ({ confirm, voucher }) => {
    const io = fixture()
    const request = Promise.withResolvers<Awaited<ReturnType<ClaimIo['requestVoucher']>>>()
    const confirmation = Promise.withResolvers<Awaited<ReturnType<ClaimIo['confirmClaim']>>>()
    const claim: ClaimIo = {
      confirmClaim: vi.fn<ClaimIo['confirmClaim']>().mockReturnValue(confirmation.promise),
      requestVoucher: async () => await request.promise,
      submitClaim: vi.fn<ClaimIo['submitClaim']>().mockResolvedValue(UID),
    }
    const operatorIo: OperatorIo = {
      ...DEFAULT_OPERATOR_IO,
      claim: () => claim,
      signIn: vi
        .fn<OperatorIo['signIn']>()
        .mockResolvedValueOnce({ issuer: operatorIssuer, ok: true, token: 'old' })
        .mockResolvedValueOnce({ issuer: operatorIssuer, ok: true, token: 'replacement' }),
    }
    const view = await authenticateOperator(io, operatorIo)
    ensPropsOf(view).onClaim()
    render(io, 'system', operatorIo).onToken('replacement')
    render(io, 'system', operatorIo).onPasskey()
    await setTimeout(0)
    const replacement = render(io, 'system', operatorIo)
    expect(ensPropsOf(replacement).state).toStrictEqual({ kind: 'unclaimed' })

    request.resolve(voucher)
    await setTimeout(0)
    if (confirm !== null) {
      confirmation.resolve(confirm)
      await setTimeout(0)
    }
    expect(ensPropsOf(render(io, 'system', operatorIo)).state).toStrictEqual({ kind: 'unclaimed' })
  })

  it('initializes ENS claim state from a claimed sign-in issuer', async () => {
    const io = fixture()
    const claimed: IssuerMeResponse = {
      ...operatorIssuer,
      ens: { claimTxHash: UID, expiry: null, name: 'wassie-coffee.fuda.eth', status: 'claimed' },
    }
    const operatorIo: OperatorIo = {
      ...DEFAULT_OPERATOR_IO,
      signIn: vi
        .fn<OperatorIo['signIn']>()
        .mockResolvedValue({ issuer: claimed, ok: true, token: 'operator-token' }),
    }
    const view = await authenticateOperator(io, operatorIo)
    const { ens } = view
    expect(ens).not.toBeNull()
    if (ens === null) {
      throw new Error('expected ENS view')
    }
    expect((viewProps(findViewNodes(ens, EnsClaim)[0]) as unknown as EnsClaimProps).state).toStrictEqual({
      claimTxHash: UID,
      kind: 'claimed',
      name: 'wassie-coffee.fuda.eth',
    })
  })

  it('does not navigate after unmount when sign-in completes', async () => {
    const io = fixture()
    const pending = Promise.withResolvers<SignInOutcome>()
    const operatorIo: OperatorIo = { ...DEFAULT_OPERATOR_IO, signIn: async () => await pending.promise }
    render(io, 'system', operatorIo).onPasskey()
    for (const cleanup of hooks.cleanups.values()) {
      cleanup()
    }
    pending.resolve({ issuer: operatorIssuer, ok: true, token: 'old-operator' })
    await setTimeout(0)
    expect({ navigation: history.pushState.mock.calls, token: render(io).session.token }).toStrictEqual({
      navigation: [],
      token: null,
    })
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
    expect(render(io).session.token).toBe('secret')
    expect(io.listMembers).toHaveBeenCalledTimes(2)
  })

  it('keeps rows and authentication without reloading after a non-401 write failure', async () => {
    const io = fixture()
    const loaded = await authenticate(io)
    io.revokeRight.mockResolvedValueOnce({ error: 'bad_uid', network: false, ok: false, status: 400 })
    await loaded.onRevoke(UID)
    expect(render(io).members).toBe(loaded.members)
    expect(render(io).session.token).toBe('secret')
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
        token: rejected.session.token,
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
    expect({ members: rejected.members, token: rejected.session.token }).toStrictEqual({
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
    expect({
      authError: rejected.authError,
      members: rejected.members,
      token: rejected.session.token,
    }).toStrictEqual({
      authError: 'unauthorized',
      members: { kind: 'idle' },
      token: null,
    })
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
    expect(render(io).session.token).toBe('replacement')
  })

  it('reloads a replacement session even when it reuses the same token', async () => {
    const io = fixture()
    const first = Promise.withResolvers<Result<MembersResponse>>()
    const second = Promise.withResolvers<Result<MembersResponse>>()
    io.listMembers.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    render(io).onToken('same-token')
    render(io)
    render(io).onToken('same-token')
    render(io)
    expect(io.listMembers.mock.calls).toStrictEqual([['same-token'], ['same-token']])

    first.resolve(unauthorized)
    await setTimeout(0)
    expect(render(io).session.token).toBe('same-token')

    second.resolve(listSuccess)
    await setTimeout(0)
    expect(render(io).members).toMatchObject({ kind: 'ready', rows: [{ memberId: 'alice', uid: UID }] })
    expect(io.listMembers).toHaveBeenCalledTimes(2)
  })

  it.each([
    { completion: 'success', result: issueSuccess },
    { completion: '401', result: unauthorized },
  ] satisfies { completion: string; result: Awaited<ReturnType<DashIo['issueRight']>> }[])(
    'ignores an old same-token issue $completion after replacement',
    async ({ result }) => {
      const io = fixture()
      const pending = Promise.withResolvers<Awaited<ReturnType<DashIo['issueRight']>>>()
      io.issueRight.mockReturnValueOnce(pending.promise)
      render(io).onToken('same-token')
      const old = render(io)
      const operation = old.onIssue({ memberId: 'alice', tier: 1, usageModel: 1 })
      render(io).onToken('same-token')
      render(io)
      await setTimeout(0)
      const replacementBefore = render(io)
      const membersBefore = replacementBefore.members
      const loadsBefore = io.listMembers.mock.calls.length
      pending.resolve(result)
      await expect(operation).resolves.toBe(result)
      await setTimeout(0)
      const replacement = render(io)
      expect({
        authError: replacement.authError,
        operator: replacement.session.operator,
        route: replacement.route,
        token: replacement.session.token,
      }).toStrictEqual({
        authError: null,
        operator: null,
        route: '/rights',
        token: 'same-token',
      })
      expect(replacement.members).toBe(membersBefore)
      expect(io.listMembers).toHaveBeenCalledTimes(loadsBefore)
    },
  )

  it.each([
    { completion: 'success', result: revokeSuccess },
    { completion: '401', result: unauthorized },
  ] satisfies { completion: string; result: Awaited<ReturnType<DashIo['revokeRight']>> }[])(
    'ignores an old same-token revoke $completion after replacement',
    async ({ result }) => {
      const io = fixture()
      const pending = Promise.withResolvers<Awaited<ReturnType<DashIo['revokeRight']>>>()
      io.revokeRight.mockReturnValueOnce(pending.promise)
      render(io).onToken('same-token')
      const old = render(io)
      const operation = old.onRevoke(UID)
      render(io).onToken('same-token')
      render(io)
      await setTimeout(0)
      const replacementBefore = render(io)
      const membersBefore = replacementBefore.members
      const loadsBefore = io.listMembers.mock.calls.length
      pending.resolve(result)
      await expect(operation).resolves.toBe(result)
      await setTimeout(0)
      const replacement = render(io)
      expect({
        authError: replacement.authError,
        operator: replacement.session.operator,
        route: replacement.route,
        token: replacement.session.token,
      }).toStrictEqual({
        authError: null,
        operator: null,
        route: '/rights',
        token: 'same-token',
      })
      expect(replacement.members).toBe(membersBefore)
      expect(io.listMembers).toHaveBeenCalledTimes(loadsBefore)
    },
  )

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
    expect(render(io).session.token).toBeNull()
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
    expect(loaded.session.token).toBe('replacement')
    expect(loaded.members).toMatchObject({ kind: 'ready', rows: [{ memberId: 'alice', uid: UID }] })
    expect(io.listMembers.mock.calls).toStrictEqual([['secret'], ['replacement']])
  })
})
