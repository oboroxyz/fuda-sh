// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppView } from './AppView.tsx'
import type { AppViewProps } from './AppView.tsx'
import { API_BASE_URL } from './config.ts'
import { DASH_COPY } from './copy.ts'
import type { MembersState } from './members-state.ts'
import { buttonNamed, cleanup, linkNamed, mount, spacedText } from './test/render.tsx'

const issuer = {
  brandColor: '#6F4320',
  createdAt: 1_757_000_000,
  handle: 'wassie-coffee',
  id: 'issuer-1',
  logoUrl: null,
  name: 'Wassie Coffee',
  operatorAddress: `0x${'ab'.repeat(20)}`,
  tagline: 'Omotesando · Coffee shop',
} as const

const card = {
  category: 'membership',
  claimFrom: null,
  claimUntil: null,
  claimable: true,
  description: '',
  id: 'card-1',
  slug: 'membership-card',
  title: 'Membership Card',
  validFrom: null,
  validUntil: null,
  validityDays: null,
} as const

const operatorSession: AppViewProps['session'] = {
  authError: null,
  members: { kind: 'idle' },
  operator: {
    cards: [card],
    ens: {
      claimTxHash: `0x${'aa'.repeat(32)}`,
      expiry: null,
      name: 'wassie-coffee.fuda.eth',
      status: 'claimed',
    },
    issuer,
    publicUrl: 'https://fuda.sh/@wassie-coffee',
  },
  token: 'session',
}

const members: MembersState = {
  kind: 'ready',
  rows: [
    {
      holder: null,
      holderShort: null,
      human: false,
      level: 'private',
      memberId: 'alice',
      passUrls: null,
      qr: `fuda:v1:0x${'ab'.repeat(32)}`,
      status: 'active',
      tier: 'GENERAL',
      uid: `0x${'ab'.repeat(32)}`,
    },
  ],
}
const adminSession: AppViewProps['session'] = {
  authError: null,
  members,
  operator: null,
  token: 'secret',
}

const props: AppViewProps = {
  appearance: undefined,
  authError: null,
  cardDraft: null,
  cardManagement: {
    load: vi.fn<AppViewProps['cardManagement']['load']>(),
    save: vi.fn<AppViewProps['cardManagement']['save']>(),
  },
  copy: DASH_COPY.en,
  createFailure: null,
  creating: false,
  ens: null,
  graphEndpoint: 'https://index.example/rights',
  integrations: {
    load: vi.fn<AppViewProps['integrations']['load']>(),
    save: vi.fn<AppViewProps['integrations']['save']>(),
  },
  loadPasses: vi.fn<AppViewProps['loadPasses']>(),
  members,
  onChangeCardDraft: vi.fn<AppViewProps['onChangeCardDraft']>(),
  onCheckHandle: vi.fn<AppViewProps['onCheckHandle']>(),
  onCheckSlug: vi.fn<AppViewProps['onCheckSlug']>(),
  onCommitLogo: vi.fn<AppViewProps['onCommitLogo']>().mockResolvedValue(true),
  onCreate: vi.fn<AppViewProps['onCreate']>(),
  onCreateVenue: vi.fn<AppViewProps['onCreateVenue']>(),
  onDefaultCard: vi.fn<AppViewProps['onDefaultCard']>().mockResolvedValue(true),
  onEditProfile: vi.fn<AppViewProps['onEditProfile']>(),
  onIssue: vi.fn<AppViewProps['onIssue']>(),
  onNavigate: vi.fn<AppViewProps['onNavigate']>(),
  onPasskey: vi.fn<AppViewProps['onPasskey']>(),
  onRestore: vi.fn<AppViewProps['onRestore']>(),
  onRevoke: vi.fn<AppViewProps['onRevoke']>(),
  onSignOut: vi.fn<AppViewProps['onSignOut']>(),
  onToken: vi.fn<AppViewProps['onToken']>(),
  onUpdateVenue: vi.fn<AppViewProps['onUpdateVenue']>().mockResolvedValue(true),
  receiveAtReception: vi.fn<AppViewProps['receiveAtReception']>(),
  restoreState: null,
  route: '/',
  session: adminSession,
  signInError: null,
  signingIn: false,
  stampSettings: {
    load: vi.fn<AppViewProps['stampSettings']['load']>(),
    save: vi.fn<AppViewProps['stampSettings']['save']>(),
  },
}

// Each page is recognised by what an operator sees first: its heading, or the
// field it opens with.
const show = (overrides: Partial<AppViewProps> = {}): HTMLElement => {
  const value: AppViewProps = { ...props, ...overrides }
  return mount(() => <AppView {...value} appearance={<div>Appearance controls</div>} />)
}
const heading = (host: HTMLElement): string => spacedText(host.querySelector('h1'))
const isShell = (host: HTMLElement): boolean => host.querySelector('.dash-app') !== null
const isSignIn = (host: HTMLElement): boolean => host.querySelector('#admin-token') !== null

describe(AppView, () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it.each(['loading', 'failed'] as const)(
    'keeps sign-in and protected pages hidden while restoration is %s',
    (restoreState) => {
      const host = show({ restoreState, session: { ...adminSession, token: null } })
      const message =
        restoreState === 'loading' ? DASH_COPY.en.auth.restoring : DASH_COPY.en.auth.restoreFailed
      const retry = [...host.querySelectorAll('button')].find((node) => spacedText(node) === 'Try again')
      expect({
        message: spacedText(host).includes(message),
        retry: retry !== undefined,
        shell: isShell(host),
        signIn: isSignIn(host),
      }).toStrictEqual({ message: true, retry: restoreState === 'failed', shell: false, signIn: false })
      retry?.click()
      expect(props.onRestore).toHaveBeenCalledTimes(restoreState === 'failed' ? 1 : 0)
    },
  )

  it('gates protected pages while retaining the requested route and appearance', () => {
    const host = show({ route: '/issue', session: { ...adminSession, token: null } })
    expect({
      alert: host.querySelector('[role="alert"]') !== null,
      appearance: spacedText(host).includes('Appearance controls'),
      heading: heading(host),
      issueForm: host.querySelector('#issue-level') !== null,
      shell: isShell(host),
      signIn: isSignIn(host),
    }).toStrictEqual({
      alert: false,
      appearance: true,
      heading: DASH_COPY.en.auth.title,
      issueForm: false,
      shell: false,
      signIn: true,
    })
  })

  it('translates the unauthorized error using the selected copy', () => {
    const signedOut = { authError: 'unauthorized', session: { ...adminSession, token: null } } as const
    const english = show(signedOut)
    const japanese = show({ ...signedOut, copy: DASH_COPY.ja })
    expect(spacedText(english.querySelector('[role="alert"]'))).toBe(DASH_COPY.en.auth.unauthorized)
    expect(spacedText(japanese.querySelector('[role="alert"]'))).toBe(DASH_COPY.ja.auth.unauthorized)
  })

  it('composes overview only at the root with resource and connection inputs', () => {
    const host = show()
    const text = spacedText(host)
    expect({
      counts: text.includes('Total rights 1'),
      endpoints: text.includes(API_BASE_URL) && text.includes(props.graphEndpoint),
      heading: heading(host),
      otherPages: ['#issue-level', '#rights-title', '#chain-holder'].some(
        (id) => host.querySelector(id) !== null,
      ),
      shell: isShell(host),
    }).toStrictEqual({ counts: true, endpoints: true, heading: 'Overview', otherPages: false, shell: true })
  })

  it('composes rights with its separate chain lookup and revoke action', () => {
    const host = show({ route: '/rights' })
    expect(heading(host)).toBe('Rights')
    expect(host.querySelector('#chain-holder')).not.toBeNull()
    expect(host.querySelector('[data-right-uid]')).not.toBeNull()
    expect(host.querySelector('#issue-level')).toBeNull()
  })

  it('routes to the existing issue form with its level controls', () => {
    const host = show({ route: '/issue' })
    expect(heading(host)).toBe('Issue a right')
    expect(host.querySelector('#issue-level')).not.toBeNull()
    expect(host.querySelector('#rights-title')).toBeNull()
  })

  it('lists the venue cards for an operator session on the card route', () => {
    const host = show({ route: '/cards', session: operatorSession })
    expect({
      designer: host.querySelector('#card-title') !== null,
      heading: heading(host),
      lists: spacedText(host).includes(card.title),
      passesLink: host.querySelector('nav a[href="/passes"]') !== null,
    }).toStrictEqual({ designer: false, heading: 'Your Cards', lists: true, passesLink: true })
    expect(props.loadPasses).toHaveBeenCalledWith({ page: 1, pageSize: 1 })
  })

  it('selects a Card by slug and uses its slug for the settings link', () => {
    expect(heading(show({ route: '/cards/membership-card', session: operatorSession }))).toBe(card.title)
    cleanup()
    const list = show({ route: '/cards', session: operatorSession })
    linkNamed(list.querySelector('table')!, 'Edit').click()
    expect(props.onNavigate).toHaveBeenCalledWith('/cards/membership-card/edit')
    cleanup()
    expect(heading(show({ route: '/cards/not-my-card', session: operatorSession }))).toBe(
      DASH_COPY.en.stamps.cardNotFound,
    )
  })

  it('identifies the selected Card on a direct settings route', () => {
    const host = show({ route: '/cards/card-1/stamps', session: operatorSession })
    expect(props.cardManagement.load).toHaveBeenCalledWith(card.id)
    expect(host.querySelector('#venue-name')).toBeNull()
    cleanup()
    const missing = show({ route: '/cards/foreign-card/stamps', session: operatorSession })
    expect(heading(missing)).toBe(DASH_COPY.en.stamps.cardNotFound)
  })

  it('opens the shared editor and the operator pass list on their direct routes', () => {
    show({ route: '/cards/membership-card/edit', session: operatorSession })
    expect(props.cardManagement.load).toHaveBeenCalledWith(card.id)
    cleanup()
    const passes = show({ route: '/passes', session: operatorSession })
    expect(heading(passes)).toBe(DASH_COPY.en.management.passesTitle)
    expect(props.loadPasses).toHaveBeenCalledWith({ page: 1, pageSize: 25 })
    expect(spacedText(passes.querySelector('select[name="cardId"]'))).toContain(card.title)
  })

  it('opens the designer in card mode when a venue adds another card', () => {
    const host = show({ route: '/cards/new', session: operatorSession })
    expect(heading(host)).toBe('Design the card')
    expect(spacedText(host.querySelector('.dash-card-preview'))).toContain(issuer.name)
    expect(host.querySelector('table')).toBeNull()
  })

  it.each([
    {
      ens: { claimTxHash: null, expiry: null, name: 'wassie-coffee.fuda.eth', status: 'unclaimed' as const },
      name: 'an unclaimed ENS name',
    },
    { ens: null, name: 'no ENS configured' },
  ])('opens the card designer for a venue with $name', ({ ens }) => {
    const session: AppViewProps['session'] = {
      ...operatorSession,
      operator: { cards: [card], ens, issuer, publicUrl: 'https://fuda.sh/@wassie-coffee' },
    }
    const host = show({ route: '/cards/new', session })
    expect(host.querySelector('#card-title')).not.toBeNull()
    expect(heading(host)).not.toBe(DASH_COPY.en.venue.registerTitle)
  })

  it('opens the dedicated venue form while the operator has no venue', () => {
    const empty: AppViewProps['session'] = {
      ...operatorSession,
      operator: { cards: [], ens: null, issuer: null, publicUrl: null },
    }
    const host = show({ route: '/start', session: empty })
    expect(heading(host)).toBe(DASH_COPY.en.venue.registerTitle)
    expect(host.querySelector('#card-title')).toBeNull()
    expect([...host.querySelectorAll('nav a')].map((link) => link.getAttribute('href'))).toStrictEqual([
      '/start',
    ])
  })

  it('changes page and navigation copy without changing route or member resource', () => {
    const host = show({ copy: DASH_COPY.ja, route: '/rights' })
    expect(heading(host)).toBe(DASH_COPY.ja.rights.title)
    expect(host.querySelector('nav a[aria-current="page"]')?.getAttribute('href')).toBe('/rights')
    expect(host.querySelector('[data-right-uid]')).not.toBeNull()
  })

  it('signs out from the restore screen through the confirmation dialog', () => {
    const host = show({ restoreState: 'failed', session: { ...adminSession, token: null } })
    buttonNamed(host, DASH_COPY.en.auth.signOut).click()
    buttonNamed(host.querySelector('dialog')!, DASH_COPY.en.auth.signOut).click()
    expect(props.onSignOut).toHaveBeenCalledOnce()
  })
})
