/** @jsxImportSource hono/jsx/dom */
import { describe, expect, it, vi } from 'vitest'

import { AppView } from './App.tsx'
import type { AppViewProps } from './App.tsx'
import { API_BASE_URL } from './config.ts'
import { DASH_COPY } from './copy.ts'
import { DashboardShell } from './DashboardShell.tsx'
import { IssueForm } from './IssueForm.tsx'
import type { MembersState } from './members-state.ts'
import { OnChainStatus } from './OnChainStatus.tsx'
import { OverviewPage } from './OverviewPage.tsx'
import { RightsPage } from './RightsPage.tsx'
import { findViewNodes, viewProps } from './test/test-view.ts'
import { TokenGate } from './TokenGate.tsx'

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
const props: AppViewProps = {
  appearance: <div>Appearance controls</div>,
  authError: null,
  copy: DASH_COPY.en,
  graphEndpoint: 'https://index.example/rights',
  members,
  onIssue: vi.fn<AppViewProps['onIssue']>(),
  onNavigate: vi.fn<AppViewProps['onNavigate']>(),
  onRevoke: vi.fn<AppViewProps['onRevoke']>(),
  onToken: vi.fn<AppViewProps['onToken']>(),
  route: '/',
  token: 'secret',
}

describe(AppView, () => {
  it('gates protected pages while retaining the requested route and appearance', () => {
    const requested: AppViewProps = { ...props, route: '/issue', token: null }
    const view = AppView(requested)
    expect(findViewNodes(view, TokenGate)).toHaveLength(1)
    expect(viewProps(findViewNodes(view, TokenGate)[0])).toMatchObject({
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
    const session = { authError: 'unauthorized', token: null } as const
    const english = AppView({ ...props, ...session })
    const japanese = AppView({ ...props, ...session, copy: DASH_COPY.ja })
    expect(viewProps(findViewNodes(english, TokenGate)[0]).error).toBe(DASH_COPY.en.auth.unauthorized)
    expect(viewProps(findViewNodes(japanese, TokenGate)[0]).error).toBe(DASH_COPY.ja.auth.unauthorized)
    expect(session).toStrictEqual({ authError: 'unauthorized', token: null })
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

  it('changes page and navigation copy without changing route or member resource', () => {
    const view = AppView({ ...props, copy: DASH_COPY.ja, route: '/rights' })
    const shell = viewProps(findViewNodes(view, DashboardShell)[0])
    const page = viewProps(findViewNodes(view, RightsPage)[0])
    expect(shell).toMatchObject({ copy: DASH_COPY.ja, route: '/rights' })
    expect(page.copy).toBe(DASH_COPY.ja)
    expect(page.members).toBe(members)
  })
})
