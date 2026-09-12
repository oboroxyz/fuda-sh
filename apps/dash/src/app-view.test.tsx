/** @jsxImportSource hono/jsx/dom */
import { describe, expect, it, vi } from 'vitest'

import { AppView } from './AppView.tsx'
import type { AppViewProps } from './AppView.tsx'
import { CardDesigner } from './CardDesigner.tsx'
import { CardDetailPage } from './CardDetailPage.tsx'
import { CardEditPage } from './CardEditPage.tsx'
import { API_BASE_URL } from './config.ts'
import { DASH_COPY } from './copy.ts'
import { DashboardShell } from './DashboardShell.tsx'
import { IssueForm } from './IssueForm.tsx'
import { IssuerPassesPage } from './IssuerPassesPage.tsx'
import type { MembersState } from './members-state.ts'
import { OnChainStatus } from './OnChainStatus.tsx'
import { OverviewPage } from './OverviewPage.tsx'
import { PublishedCard } from './PublishedCard.tsx'
import { RightsPage } from './RightsPage.tsx'
import { SignIn } from './SignIn.tsx'
import { SignOutButton } from './SignOutButton.tsx'
import { findViewNodes, viewProps, viewText, walkView } from './test/test-view.ts'
import { VenuePage } from './VenuePage.tsx'

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
  appearance: <div>Appearance controls</div>,
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

describe(AppView, () => {
  it.each(['loading', 'failed'] as const)(
    'keeps sign-in and protected pages hidden while restoration is %s',
    (restoreState) => {
      const view = AppView({ ...props, restoreState, session: { ...adminSession, token: null } })
      expect(findViewNodes(view, SignIn)).toHaveLength(0)
      expect(findViewNodes(view, DashboardShell)).toHaveLength(0)
      const buttons = walkView(view)
        .map((node) => viewProps(node))
        .filter((node) => node.type === 'button')
      expect(viewProps(findViewNodes(view, SignOutButton)[0]).onSignOut).toBe(props.onSignOut)
      expect(buttons.some((button) => button.onClick === props.onRestore)).toBe(restoreState === 'failed')
    },
  )

  it('gates protected pages while retaining the requested route and appearance', () => {
    const requested: AppViewProps = { ...props, route: '/issue', session: { ...adminSession, token: null } }
    const view = AppView(requested)
    expect(findViewNodes(view, SignIn)).toHaveLength(1)
    expect(viewProps(findViewNodes(view, SignIn)[0])).toMatchObject({
      appearance: props.appearance,
      copy: DASH_COPY.en.auth,
      error: null,
      onToken: props.onToken,
    })
    expect(findViewNodes(view, DashboardShell)).toHaveLength(0)
    expect(findViewNodes(view, IssueForm)).toHaveLength(0)
    expect(requested.route).toBe('/issue')
  })

  it('translates the unauthorized error using the selected copy', () => {
    const signedOut = {
      authError: 'unauthorized',
      session: { ...adminSession, token: null },
    } as const
    const english = AppView({ ...props, ...signedOut })
    const japanese = AppView({ ...props, ...signedOut, copy: DASH_COPY.ja })
    expect(viewProps(findViewNodes(english, SignIn)[0]).error).toBe(DASH_COPY.en.auth.unauthorized)
    expect(viewProps(findViewNodes(japanese, SignIn)[0]).error).toBe(DASH_COPY.ja.auth.unauthorized)
    expect(signedOut.session.token).toBeNull()
  })

  it('composes overview only at the root with resource and connection inputs', () => {
    const view = AppView(props)
    expect(viewProps(findViewNodes(view, DashboardShell)[0])).toMatchObject({
      appearance: props.appearance,
      copy: DASH_COPY.en,
      onNavigate: props.onNavigate,
      route: '/',
    })
    expect(viewProps(findViewNodes(view, OverviewPage)[0])).toStrictEqual({
      apiBaseUrl: API_BASE_URL,
      copy: DASH_COPY.en.overview,
      graphEndpoint: props.graphEndpoint,
      state: members,
    })
    expect(findViewNodes(view, IssueForm)).toHaveLength(0)
    expect(findViewNodes(view, RightsPage)).toHaveLength(0)
    expect(findViewNodes(view, OnChainStatus)).toHaveLength(0)
  })

  it('composes rights with its separate chain lookup and revoke action', () => {
    const view = AppView({ ...props, route: '/rights' })
    expect(viewProps(findViewNodes(view, RightsPage)[0])).toStrictEqual({
      copy: DASH_COPY.en,
      graphEndpoint: props.graphEndpoint,
      members,
      onRevoke: props.onRevoke,
    })
    expect(findViewNodes(view, OverviewPage)).toHaveLength(0)
    expect(findViewNodes(view, IssueForm)).toHaveLength(0)
  })

  it('routes to the existing issue form with its level controls', () => {
    const view = AppView({ ...props, route: '/issue' })
    expect(viewProps(findViewNodes(view, IssueForm)[0])).toStrictEqual({
      copy: DASH_COPY.en.issue,
      onIssue: props.onIssue,
    })
    expect(findViewNodes(view, OverviewPage)).toHaveLength(0)
    expect(findViewNodes(view, RightsPage)).toHaveLength(0)
  })

  it('lists the venue cards for an operator session on the card route', () => {
    const view = AppView({ ...props, route: '/cards', session: operatorSession })
    expect(viewProps(findViewNodes(view, PublishedCard)[0])).toMatchObject({
      cards: [card],
      issuer,
      onDefaultCard: props.onDefaultCard,
      publicUrl: 'https://fuda.sh/@wassie-coffee',
    })
    expect(findViewNodes(view, CardDesigner)).toHaveLength(0)
    expect(viewProps(findViewNodes(view, DashboardShell)[0])).toMatchObject({ hasIssuer: true })
  })

  it('selects a Card by slug and uses its slug for the settings link', () => {
    const view = AppView({ ...props, route: '/cards/membership-card', session: operatorSession })
    expect(viewProps(findViewNodes(view, CardDetailPage)[0]).card).toStrictEqual(card)
    const list = AppView({ ...props, route: '/cards', session: operatorSession })
    const published = viewProps(findViewNodes(list, PublishedCard)[0])
    const onSettings = published.onSettings as (cardId: string) => void
    onSettings(card.id)
    expect(props.onNavigate).toHaveBeenCalledWith('/cards/membership-card/edit')
    const missing = AppView({ ...props, route: '/cards/not-my-card', session: operatorSession })
    expect(viewProps(findViewNodes(missing, CardDetailPage)[0]).card).toBeNull()
  })

  it('identifies the selected Card on a direct settings route', () => {
    const view = AppView({ ...props, route: '/cards/card-1/stamps', session: operatorSession })
    expect(viewProps(findViewNodes(view, CardEditPage)[0])).toMatchObject({
      card,
      settings: props.stampSettings,
    })
    expect(findViewNodes(view, VenuePage)).toHaveLength(0)
    const missing = AppView({ ...props, route: '/cards/foreign-card/stamps', session: operatorSession })
    expect(viewProps(findViewNodes(missing, CardEditPage)[0]).card).toBeNull()
  })

  it('opens the shared editor and the operator pass list on their direct routes', () => {
    const edit = AppView({ ...props, route: '/cards/membership-card/edit', session: operatorSession })
    expect(viewProps(findViewNodes(edit, CardEditPage)[0])).toMatchObject({
      card,
      load: props.cardManagement.load,
      save: props.cardManagement.save,
      settings: props.stampSettings,
    })
    const passes = AppView({ ...props, route: '/passes', session: operatorSession })
    expect(viewProps(findViewNodes(passes, IssuerPassesPage)[0])).toMatchObject({
      cards: [card],
      load: props.loadPasses,
    })
  })

  it('opens the designer in card mode when a venue adds another card', () => {
    const view = AppView({ ...props, route: '/cards/new', session: operatorSession })
    expect(viewProps(findViewNodes(view, CardDesigner)[0])).toMatchObject({
      issuer,
      onCheckSlug: props.onCheckSlug,
      onSubmit: props.onCreate,
    })
    expect(findViewNodes(view, PublishedCard)).toHaveLength(0)
  })

  it('explains the ENS prerequisite on the new-card page and links to venue settings', () => {
    const session: AppViewProps['session'] = {
      authError: null,
      members: { kind: 'idle' },
      operator: {
        cards: [card],
        ens: {
          claimTxHash: null,
          expiry: null,
          name: 'wassie-coffee.fuda.eth',
          status: 'unclaimed' as const,
        },
        issuer,
        publicUrl: 'https://fuda.sh/@wassie-coffee',
      },
      token: 'session',
    }
    const view = AppView({ ...props, route: '/cards/new', session })
    expect(findViewNodes(view, CardDesigner)).toHaveLength(0)
    expect(findViewNodes(view, VenuePage)).toHaveLength(0)
    expect(viewText(view)).toContain('Claim your ENS name first')
    expect(findViewNodes(view, 'a').map((link) => link.props.href)).toStrictEqual(['/profile'])
  })

  it('explains unavailable ENS configuration on /cards/new in the selected language', () => {
    const session: AppViewProps['session'] = {
      ...operatorSession,
      operator: { cards: [card], ens: null, issuer, publicUrl: 'https://fuda.sh/@wassie-coffee' },
    }
    const view = AppView({ ...props, copy: DASH_COPY.ja, route: '/cards/new', session })
    expect(viewText(view)).toContain(DASH_COPY.ja.ens.requiredTitle)
    expect(viewText(view)).toContain(DASH_COPY.ja.venue.ensUnavailable)
    expect(findViewNodes(view, 'a').map((link) => link.props.href)).toStrictEqual(['/profile'])
    expect(findViewNodes(view, CardDesigner)).toHaveLength(0)
  })

  it('opens the dedicated venue form while the operator has no venue', () => {
    const empty: AppViewProps['session'] = {
      ...operatorSession,
      operator: { cards: [], ens: null, issuer: null, publicUrl: null },
    }
    const view = AppView({ ...props, route: '/start', session: empty })
    expect(viewProps(findViewNodes(view, VenuePage)[0]).issuer).toBeNull()
    expect(findViewNodes(view, CardDesigner)).toHaveLength(0)
    expect(viewProps(findViewNodes(view, DashboardShell)[0])).toMatchObject({ hasIssuer: false })
  })

  it('changes page and navigation copy without changing route or member resource', () => {
    const view = AppView({ ...props, copy: DASH_COPY.ja, route: '/rights' })
    const shell = viewProps(findViewNodes(view, DashboardShell)[0])
    const page = viewProps(findViewNodes(view, RightsPage)[0])
    expect(shell).toMatchObject({ copy: DASH_COPY.ja, route: '/rights' })
    expect(page.copy).toBe(DASH_COPY.ja)
    expect(page.members).toBe(members)
  })
})
