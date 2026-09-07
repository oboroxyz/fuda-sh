/** @jsxImportSource hono/jsx/dom */
import { describe, expect, it, vi } from 'vitest'

import { AppView } from './App.tsx'
import type { AppViewProps } from './App.tsx'
import { CardDesigner } from './CardDesigner.tsx'
import { API_BASE_URL } from './config.ts'
import { DASH_COPY } from './copy.ts'
import { DashboardShell } from './DashboardShell.tsx'
import { IssueForm } from './IssueForm.tsx'
import type { MembersState } from './members-state.ts'
import { OnChainStatus } from './OnChainStatus.tsx'
import { OverviewPage } from './OverviewPage.tsx'
import { PublishedCard } from './PublishedCard.tsx'
import { RightsPage } from './RightsPage.tsx'
import { SignIn } from './SignIn.tsx'
import { findViewNodes, viewProps } from './test/test-view.ts'

const issuer = {
  brandColor: '#6F4320',
  createdAt: 1_757_000_000,
  handle: 'wassie-coffee',
  id: 'issuer-1',
  name: 'Wassie Coffee',
  operatorAddress: `0x${'ab'.repeat(20)}`,
  tagline: 'Omotesando · Coffee shop',
} as const

const card = {
  category: 'membership',
  id: 'card-1',
  perk: '',
  reward: '',
  slug: 'membership-card',
  title: 'Membership Card',
  validityDays: null,
} as const

const operatorSession: AppViewProps['session'] = {
  authError: null,
  members: { kind: 'idle' },
  operator: { cards: [card], issuer, publicUrl: 'https://fuda.sh/@wassie-coffee' },
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
  copy: DASH_COPY.en,
  createFailure: null,
  creating: false,
  graphEndpoint: 'https://index.example/rights',
  members,
  onCheckHandle: vi.fn<AppViewProps['onCheckHandle']>(),
  onCheckSlug: vi.fn<AppViewProps['onCheckSlug']>(),
  onCreate: vi.fn<AppViewProps['onCreate']>(),
  onIssue: vi.fn<AppViewProps['onIssue']>(),
  onNavigate: vi.fn<AppViewProps['onNavigate']>(),
  onPasskey: vi.fn<AppViewProps['onPasskey']>(),
  onRevoke: vi.fn<AppViewProps['onRevoke']>(),
  onSignOut: vi.fn<AppViewProps['onSignOut']>(),
  onToken: vi.fn<AppViewProps['onToken']>(),
  route: '/',
  session: adminSession,
  signInError: null,
  signingIn: false,
}

describe(AppView, () => {
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
    const view = AppView({ ...props, route: '/published', session: operatorSession })
    expect(viewProps(findViewNodes(view, PublishedCard)[0])).toMatchObject({
      cards: [card],
      issuer,
      publicUrl: 'https://fuda.sh/@wassie-coffee',
    })
    expect(findViewNodes(view, CardDesigner)).toHaveLength(0)
    expect(viewProps(findViewNodes(view, DashboardShell)[0])).toMatchObject({ hasIssuer: true })
  })

  it('opens the designer in card mode when a venue adds another card', () => {
    const view = AppView({ ...props, route: '/new', session: operatorSession })
    expect(viewProps(findViewNodes(view, CardDesigner)[0])).toMatchObject({
      issuer,
      onCheckSlug: props.onCheckSlug,
      onSubmit: props.onCreate,
    })
    expect(findViewNodes(view, PublishedCard)).toHaveLength(0)
  })

  it('opens the designer in venue mode while the operator has no venue', () => {
    const empty: AppViewProps['session'] = {
      ...operatorSession,
      operator: { cards: [], issuer: null, publicUrl: null },
    }
    const view = AppView({ ...props, route: '/new', session: empty })
    expect(viewProps(findViewNodes(view, CardDesigner)[0]).issuer).toBeNull()
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
