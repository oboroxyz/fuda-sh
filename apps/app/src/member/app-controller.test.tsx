// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { setTimeout } from 'node:timers/promises'

import type { MemberSessionResponse, MemberSignInResponse, SignInChallengeResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { render } from 'hono/jsx/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../App.tsx'
import type { MemberPassListIo } from '../member-pass-list.ts'
import type { MemberAppIo } from './auth.ts'

vi.mock(import('../config.ts'), () => ({
  API_BASE_URL: 'http://localhost:8787',
  APP_ORIGIN: globalThis.location.origin,
  GRAPH_RIGHTS_ENDPOINT: '',
  RP_ID: 'localhost',
}))

const ADDRESS = `0x${'11'.repeat(20)}` as const
const TOKEN = 'member-token'
const ok = <T,>(body: T): Result<T> => ({ body, ok: true })
const unauthorized: Result<MemberSessionResponse> = {
  error: 'unauthorized',
  network: false,
  ok: false,
  status: 401,
}
const root = document.createElement('div')

const io = (overrides: Partial<MemberAppIo> = {}): MemberAppIo => ({
  challenge: async (): Promise<Result<SignInChallengeResponse>> =>
    await Promise.resolve(ok({ message: 'Sign in to fuda', nonce: `0x${'22'.repeat(32)}` })),
  logout: async () => await Promise.resolve(ok({ loggedOut: true })),
  me: async () => await Promise.resolve(ok({ address: ADDRESS })),
  personalSign: async () => await Promise.resolve(`0x${'33'.repeat(65)}` as const),
  provider: async () => await Promise.resolve({ request: async () => await Promise.resolve([]) }),
  requestAccount: async () => await Promise.resolve(ADDRESS),
  verify: async (): Promise<Result<MemberSignInResponse>> =>
    await Promise.resolve(ok({ address: ADDRESS, token: TOKEN })),
  ...overrides,
})

const passIo = (): MemberPassListIo => ({
  appleAvailable: async () => await Promise.resolve(false),
  fetchRights: async () => await Promise.resolve([]),
  googleHref: async () => await Promise.resolve(null),
  stampSummary: async () => await Promise.resolve(null),
  verify: async () => await Promise.resolve({ error: 'not_found', network: false, ok: false, status: 404 }),
})

const mount = (memberIo: MemberAppIo = io(), memberPassIo: MemberPassListIo = passIo()): void => {
  render(<App memberIo={memberIo} memberPassIo={memberPassIo} />, root)
}

const click = (label: string): void => {
  const button = [...root.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  )
  if (button === undefined) {
    throw new Error(`Missing button: ${label}`)
  }
  button.click()
}

describe('member app controller', () => {
  beforeEach(() => {
    // oxlint-disable-next-line unicorn/prefer-dom-node-append -- Worker HTMLRewriter types overload append.
    document.body.appendChild(root)
    localStorage.clear()
    history.replaceState(null, '', '/')
  })

  afterEach(async () => {
    render(<></>, root)
    await setTimeout(0)
    root.replaceChildren()
    root.remove()
    vi.restoreAllMocks()
  })

  it('changes language without dropping the session or a public-address draft', async () => {
    localStorage.setItem('fuda:app:member:http://localhost:8787', TOKEN)
    history.replaceState(null, '', '/settings')
    const me = vi.fn<MemberAppIo['me']>(io().me)
    mount(io({ me }))
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Look up another public address')
    })
    click('Look up another public address')
    await vi.waitFor(() => {
      expect(root.querySelector('input')).not.toBeNull()
    })
    const input = root.querySelector('input')!
    input.value = '0x123'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    root
      .querySelector('form')!
      .dispatchEvent(new CustomEvent('submit', { bubbles: true, cancelable: true, detail: {} }))
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Enter a valid holder address.')
    })
    const language = root.querySelector('select[aria-label="Change language"]')
    if (!(language instanceof HTMLSelectElement)) {
      throw new Error('Missing language selector')
    }
    language.value = 'ja'
    language.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => {
      expect([
        document.documentElement.lang,
        root.querySelector('h1')?.textContent,
        root.textContent?.includes('有効な保有者のアドレスを入力してください。'),
      ]).toStrictEqual(['ja', '設定', true])
    })
    expect(root.querySelector('input')?.value).toBe('0x123')
    expect([
      localStorage.getItem('fuda:locale'),
      localStorage.getItem('fuda:app:member:http://localhost:8787'),
      me.mock.calls.length,
    ]).toStrictEqual(['ja', TOKEN, 1])
  })

  it('changes theme from Settings without ending the session', async () => {
    localStorage.setItem('fuda:app:member:http://localhost:8787', TOKEN)
    history.replaceState(null, '', '/settings')
    mount()
    await vi.waitFor(() => {
      expect(root.querySelector('select')).not.toBeNull()
    })
    const theme = root.querySelector('select[aria-label="Change theme"]')
    if (!(theme instanceof HTMLSelectElement)) {
      throw new Error('Missing theme selector')
    }
    theme.value = 'dark'
    theme.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })
    expect([
      localStorage.getItem('fuda:theme'),
      localStorage.getItem('fuda:app:member:http://localhost:8787'),
      location.pathname,
    ]).toStrictEqual(['dark', TOKEN, '/settings'])
    expect(root.querySelector('[aria-label="Appearance"]')).toBeNull()
  })

  it('persists the shared theme choice from the public top', async () => {
    localStorage.setItem('fuda:theme', 'light')
    mount()
    await vi.waitFor(() => {
      expect(root.querySelector('button[aria-label="Theme: Light"]')).not.toBeNull()
    })
    root.querySelector<HTMLButtonElement>('button[aria-label="Theme: Light"]')!.click()
    await vi.waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })
    expect(localStorage.getItem('fuda:theme')).toBe('dark')
    expect(location.pathname).toBe('/')
  })

  it('shows one public passkey sign-in action without the signed-in Dock', () => {
    mount()

    expect(root.textContent).toContain('Sign in with Passkey')
    expect(root.querySelector('[aria-label="Member navigation"]')).toBeNull()
    expect(root.querySelectorAll('main button')).toHaveLength(0)
  })

  it('gates a protected route and returns there after verified sign-in', async () => {
    history.replaceState(null, '', '/settings')
    mount()

    expect(root.textContent).toContain('Sign in with Passkey')
    expect(root.querySelector('[aria-label="Member navigation"]')).toBeNull()
    click('Sign in with Passkey')

    await vi.waitFor(() => {
      expect(location.pathname).toBe('/settings')
      expect(root.querySelector('select[aria-label="Change theme"]')).not.toBeNull()
    })
    expect(root.querySelector('[aria-label="Member navigation"]')).not.toBeNull()
    expect(localStorage.getItem('fuda:app:member:http://localhost:8787')).toBe(TOKEN)
  })

  it('shows restoration pending and clears an expired saved session', async () => {
    localStorage.setItem('fuda:app:member:http://localhost:8787', TOKEN)
    const pending = Promise.withResolvers<Result<MemberSessionResponse>>()
    history.replaceState(null, '', '/rights')
    mount(io({ me: async () => await pending.promise }))

    expect(root.textContent).toContain('Checking your session')
    pending.resolve(unauthorized)
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Sign in with Passkey')
    })
    expect(localStorage.getItem('fuda:app:member:http://localhost:8787')).toBeNull()
  })

  it('keeps a saved token after a restoration network failure and offers retry', async () => {
    localStorage.setItem('fuda:app:member:http://localhost:8787', TOKEN)
    history.replaceState(null, '', '/rights')
    mount(
      io({
        me: async () => await Promise.resolve({ error: 'offline', network: true, ok: false, status: 0 }),
      }),
    )

    await vi.waitFor(() => {
      expect(root.textContent).toContain('Could not check your session')
    })
    expect(localStorage.getItem('fuda:app:member:http://localhost:8787')).toBe(TOKEN)
    expect(root.textContent).toContain('Retry')
  })

  it('ignores a restoration response that arrives after local sign-out', async () => {
    localStorage.setItem('fuda:app:member:http://localhost:8787', TOKEN)
    const pending = Promise.withResolvers<Result<MemberSessionResponse>>()
    history.replaceState(null, '', '/rights')
    mount(io({ me: async () => await pending.promise }))

    click('Sign out locally')
    pending.resolve(ok({ address: ADDRESS }))
    await setTimeout(20)

    expect(location.pathname).toBe('/')
    expect(root.textContent).toContain('Sign in with Passkey')
    expect(root.querySelector('[aria-label="Member navigation"]')).toBeNull()
  })

  it('does not restore a token replaced in storage while the session read is pending', async () => {
    localStorage.setItem('fuda:app:member:http://localhost:8787', TOKEN)
    const pending = Promise.withResolvers<Result<MemberSessionResponse>>()
    history.replaceState(null, '', '/settings')
    mount(io({ me: async () => await pending.promise }))

    localStorage.setItem('fuda:app:member:http://localhost:8787', 'newer-token')
    pending.resolve(ok({ address: ADDRESS }))
    await setTimeout(20)

    expect(root.textContent).toContain('Sign in with Passkey')
    expect(root.textContent).not.toContain(ADDRESS)
  })

  it('validates the sign-in return query before navigating', async () => {
    history.replaceState(null, '', '/signin?return=%2Fsettings')
    mount()
    click('Sign in with Passkey')
    await vi.waitFor(() => {
      expect(location.pathname).toBe('/settings')
    })

    render(<></>, root)
    localStorage.clear()
    history.replaceState(null, '', '/signin?return=%2F%2Foutside.example%2Fprivate')
    mount()
    click('Sign in with Passkey')
    await vi.waitFor(() => {
      expect(location.pathname).toBe('/rights')
    })
  })

  it('keeps an authenticated session in memory when browser storage rejects writes', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    history.replaceState(null, '', '/settings')
    mount()
    click('Sign in with Passkey')

    await vi.waitFor(() => {
      expect(root.querySelector('select[aria-label="Change theme"]')).not.toBeNull()
    })
    expect(root.querySelector('[aria-label="Member navigation"]')).not.toBeNull()
  })

  it('keeps a blocked-storage session when private recovery navigates within the app', async () => {
    localStorage.setItem('fuda:app:member:http://localhost:8787', TOKEN)
    history.replaceState(null, '', `/rights?uid=0x${'44'.repeat(32)}`)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    mount(io(), {
      appleAvailable: async () => await Promise.resolve(false),
      fetchRights: async () => await Promise.resolve([]),
      googleHref: async () => await Promise.resolve(null),
      stampSummary: async () => await Promise.resolve(null),
      verify: async () =>
        await Promise.resolve(
          ok({
            decision: 'ADMIT',
            entitlement: {
              holder: ADDRESS,
              issuer: ADDRESS,
              level: 2,
              schemaVersion: 1,
              tier: 1,
              usageModel: 1,
              validFrom: 0,
              validUntil: 999,
            },
            reason: 'OK',
          }),
        ),
    })

    await vi.waitFor(() => {
      expect(root.textContent).toContain('Private rights')
    })
    root.querySelector<HTMLAnchorElement>('a[href="/private"]')?.click()

    await vi.waitFor(() => {
      expect(location.pathname).toBe('/private')
      expect(root.textContent).toContain('Unlock your private rights')
    })
    expect(root.textContent).not.toContain('Sign in with Passkey')
  })

  it('returns a restored session from sign-in to its validated destination', async () => {
    localStorage.setItem('fuda:app:member:http://localhost:8787', TOKEN)
    history.replaceState(null, '', `/signin?return=${encodeURIComponent(`/rights?uid=0x${'55'.repeat(32)}`)}`)
    mount()

    await vi.waitFor(() => {
      expect(`${location.pathname}${location.search}`).toBe(`/rights?uid=0x${'55'.repeat(32)}`)
    })
    expect(root.querySelector('[aria-label="Member navigation"]')).not.toBeNull()
  })

  it('keeps the session through Dock navigation and browser history', async () => {
    history.replaceState(null, '', '/settings')
    mount()
    click('Sign in with Passkey')
    await vi.waitFor(() => {
      expect(root.querySelector('select[aria-label="Change theme"]')).not.toBeNull()
    })

    const passes = root.querySelector<HTMLAnchorElement>('a[href="/rights"]')
    passes?.click()
    await vi.waitFor(() => {
      expect(location.pathname).toBe('/rights')
      expect(root.textContent).toContain('Your passes')
    })
    history.replaceState(null, '', '/settings')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await vi.waitFor(() => {
      expect(root.querySelector('select[aria-label="Change theme"]')).not.toBeNull()
    })
  })

  it('discards a pending sign-in after navigation leaves sign-in', async () => {
    const pending = Promise.withResolvers<Result<MemberSignInResponse>>()
    const signInPath = '/signin?return=%2Fsettings'
    history.replaceState(null, '', signInPath)
    mount(io({ verify: async () => await pending.promise }))
    click('Sign in with Passkey')
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Signing in')
    })

    history.pushState(null, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
    pending.resolve(ok({ address: ADDRESS, token: TOKEN }))
    await setTimeout(20)

    expect(location.pathname).toBe('/')
    expect(root.querySelector('[aria-label="Member navigation"]')).toBeNull()
    expect(localStorage.getItem('fuda:app:member:http://localhost:8787')).toBeNull()
  })

  it('updates recovery for query-only history changes and clears it from the active Dock link', async () => {
    const uidA = `0x${'aa'.repeat(32)}` as const
    const uidB = `0x${'bb'.repeat(32)}` as const
    const pendingA = Promise.withResolvers<Awaited<ReturnType<MemberPassListIo['verify']>>>()
    const verify = vi.fn<MemberPassListIo['verify']>(async (uid) => {
      if (uid === uidA) {
        return await pendingA.promise
      }
      return await Promise.resolve(ok({ decision: 'ADMIT', reason: 'OK' }))
    })
    const memberPassIo: MemberPassListIo = {
      appleAvailable: async () => await Promise.resolve(false),
      fetchRights: async () => await Promise.resolve([]),
      googleHref: async () => await Promise.resolve(null),
      stampSummary: async () => await Promise.resolve(null),
      verify,
    }
    history.replaceState(null, '', `/rights?uid=${uidA}`)
    mount(io(), memberPassIo)
    click('Sign in with Passkey')
    await vi.waitFor(() => {
      expect(verify).toHaveBeenCalledWith(uidA)
    })

    history.replaceState(null, '', `/rights?uid=${uidB}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
    await vi.waitFor(() => {
      expect(verify).toHaveBeenCalledWith(uidB)
    })
    const passes = root.querySelector<HTMLAnchorElement>('a[href="/rights"]')
    passes?.click()
    expect(location.search).toBe('')
    pendingA.resolve(ok({ decision: 'ADMIT', reason: 'OK' }))
    await setTimeout(20)
    expect(location.search).toBe('')
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('cancels an abandoned wallet request and ignores its late completion', async () => {
    const provider = Promise.withResolvers<Awaited<ReturnType<MemberAppIo['provider']>>>()
    const memberIo = io({ provider: async () => await provider.promise })
    history.replaceState(null, '', '/signin')
    mount(memberIo)
    click('Sign in with Passkey')
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Cancel')
    })
    click('Cancel')

    await vi.waitFor(() => {
      expect(root.textContent).toContain('Sign in with Passkey')
    })
    provider.resolve({ request: async () => await Promise.resolve([]) })
    await setTimeout(20)
    expect(location.pathname).toBe('/signin')
    expect(localStorage.getItem('fuda:app:member:http://localhost:8787')).toBeNull()
  })

  it('keeps a newer attempt owned when an older cancelled attempt settles', async () => {
    const signInPath = '/signin?return=%2Fsettings'
    const providerA = Promise.withResolvers<Awaited<ReturnType<MemberAppIo['provider']>>>()
    const providerB = Promise.withResolvers<Awaited<ReturnType<MemberAppIo['provider']>>>()
    const requestAccount = vi.fn<MemberAppIo['requestAccount']>(async () => await Promise.resolve(ADDRESS))
    const challenge = vi.fn<MemberAppIo['challenge']>(
      async () => await Promise.resolve(ok({ message: 'Sign in to fuda', nonce: `0x${'22'.repeat(32)}` })),
    )
    const provider = vi
      .fn<MemberAppIo['provider']>()
      .mockImplementationOnce(async () => await providerA.promise)
      .mockImplementationOnce(async () => await providerB.promise)
    history.replaceState(null, '', signInPath)
    mount(io({ challenge, provider, requestAccount }))

    click('Sign in with Passkey')
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Cancel')
    })
    click('Cancel')
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Sign in with Passkey')
    })
    click('Sign in with Passkey')
    expect(provider).toHaveBeenCalledTimes(2)
    providerA.resolve({ request: async () => await Promise.resolve([]) })
    await setTimeout(20)

    root.querySelector<HTMLAnchorElement>('a[href="/"]')?.click()
    await vi.waitFor(() => {
      expect(location.pathname).toBe('/')
    })
    history.pushState(null, '', signInPath)
    window.dispatchEvent(new PopStateEvent('popstate'))
    providerB.resolve({ request: async () => await Promise.resolve([]) })
    await setTimeout(20)

    expect(location.pathname).not.toBe('/settings')
    expect(localStorage.getItem('fuda:app:member:http://localhost:8787')).toBeNull()
    expect(requestAccount).not.toHaveBeenCalled()
    expect(challenge).not.toHaveBeenCalled()
  })

  it('uses internal top links so an in-memory-only session survives the round trip', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    history.replaceState(null, '', '/settings')
    mount()
    click('Sign in with Passkey')
    await vi.waitFor(() => {
      expect(root.querySelector('select[aria-label="Change theme"]')).not.toBeNull()
    })

    history.pushState(null, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Open your passes')
    })
    const open = [...root.querySelectorAll<HTMLAnchorElement>('a')].find((anchor) =>
      anchor.textContent?.includes('Open your passes'),
    )
    open?.click()

    await vi.waitFor(() => {
      expect(location.pathname).toBe('/rights')
      expect(root.querySelector('[aria-label="Member navigation"]')).not.toBeNull()
    })
  })

  it('renders venue routes without the member gate or Dock', () => {
    history.replaceState(null, '', '/@wassie-coffee')
    mount()

    expect(root.textContent).not.toContain('Sign in with Passkey')
    expect(root.querySelector('[aria-label="Member navigation"]')).toBeNull()
  })
})
