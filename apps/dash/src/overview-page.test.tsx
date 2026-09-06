/** @jsxImportSource hono/jsx/dom */
import { pick } from '@fuda/i18n'
import { describe, expect, it } from 'vitest'

import { DASH_COPY } from './copy.ts'
import { completeMembersLoad } from './members-state.ts'
import type { MembersState } from './members-state.ts'
import type { MemberRowView } from './members-view.ts'
import { OverviewPage } from './OverviewPage.tsx'
import { viewText } from './test/test-view.ts'

const UID = `0x${'ab'.repeat(32)}` as const
const copy = pick(DASH_COPY, 'en').overview

const rows: readonly MemberRowView[] = [
  {
    holder: `0x${'11'.repeat(20)}`,
    holderShort: '0x1111…1111',
    level: 'bearer',
    memberId: 'alice',
    passUrls: null,
    qr: `fuda:v1:${UID}`,
    status: 'active',
    tier: 'GENERAL',
    uid: UID,
  },
  {
    holder: `0x${'22'.repeat(20)}`,
    holderShort: '0x2222…2222',
    level: 'signed',
    memberId: 'bob',
    passUrls: null,
    qr: `fuda:v1:${UID}`,
    status: 'active',
    tier: 'VIP',
    uid: UID,
  },
  {
    holder: null,
    holderShort: null,
    level: 'private',
    memberId: 'carol',
    passUrls: null,
    qr: `fuda:v1:${UID}`,
    status: 'revoked',
    tier: 'GENERAL',
    uid: UID,
  },
]

describe(OverviewPage, () => {
  it('shows populated member counts and configured client status', () => {
    const ready = completeMembersLoad(rows)

    expect(
      viewText(OverviewPage({ apiBaseUrl: 'https://api.fuda.sh', copy, graphEndpoint: '', state: ready })),
    ).toContain('Total rights 3 Active rights 2 Revoked rights 1')
    expect(
      viewText(OverviewPage({ apiBaseUrl: 'https://api.fuda.sh', copy, graphEndpoint: '', state: ready })),
    ).toContain('API Connected https://api.fuda.sh Graph index Not configured')
  })

  it('shows zero counts only after a successful empty response', () => {
    const ready = completeMembersLoad([])

    expect(
      viewText(OverviewPage({ apiBaseUrl: 'x', copy, graphEndpoint: 'https://graph.example', state: ready })),
    ).toContain('Total rights 0 Active rights 0 Revoked rights 0')
  })

  it('uses checking status and no numeric counts during the initial load', () => {
    const loading: MembersState = { kind: 'loading', previousRows: null }
    const text = viewText(OverviewPage({ apiBaseUrl: 'x', copy, graphEndpoint: '', state: loading }))

    expect(text).toContain('API Checking x Graph index Not configured')
    expect(text).not.toContain('Total rights 0')
  })

  it('does not invent zero counts after an initial error', () => {
    const initialError: MembersState = { kind: 'error', message: 'fetch failed', previousRows: null }

    expect(
      viewText(
        OverviewPage({ apiBaseUrl: 'x', copy, graphEndpoint: 'https://graph.example', state: initialError }),
      ),
    ).not.toContain('Total rights 0')
  })

  it('labels retained values while refreshing', () => {
    const refreshing: MembersState = { kind: 'loading', previousRows: rows }

    expect(viewText(OverviewPage({ apiBaseUrl: 'x', copy, graphEndpoint: '', state: refreshing }))).toContain(
      'Refreshing rights',
    )
  })

  it('labels retained values as stale after a failed refresh', () => {
    const staleError: MembersState = { kind: 'error', message: 'fetch failed', previousRows: rows }

    expect(viewText(OverviewPage({ apiBaseUrl: 'x', copy, graphEndpoint: '', state: staleError }))).toContain(
      'Showing last loaded values',
    )
  })
})
