/** @jsxImportSource hono/jsx/dom */
import { pick } from '@fuda/i18n'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { describe, expect, it } from 'vitest'

import { DASH_COPY } from './copy.ts'
import { completeMembersLoad } from './members-state.ts'
import type { MembersState } from './members-state.ts'
import type { MemberRowView } from './members-view.ts'
import { OverviewPage } from './OverviewPage.tsx'
import { findViewNodes, viewText, walkView } from './test/test-view.ts'

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

  it.each([
    { kind: 'ready', rows: [] },
    { kind: 'error', message: 'D1_OFFLINE', previousRows: null },
  ] satisfies MembersState[])(
    'shows the configured Graph URL without claiming connectivity when $kind',
    (state) => {
      const graphEndpoint = `https://graph.example/${'a'.repeat(80)}`
      const view = OverviewPage({ apiBaseUrl: 'x', copy, graphEndpoint, state })
      const graphCard = findViewNodes(view, 'div').find((node) =>
        findViewNodes(node, 'dt').some((term) => viewText(term) === 'Graph index'),
      )
      const endpoint = findViewNodes(graphCard, 'dd').find((node) => viewText(node) === graphEndpoint)

      expect(viewText(graphCard)).toContain(`Graph index Configured ${graphEndpoint}`)
      expect(viewText(graphCard)).not.toContain('Connected')
      expect(endpoint?.props.class).toContain('break-all')
    },
  )

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

  it.each([
    [
      'en',
      'Could not load rights',
      'Showing last loaded values',
      'Total rights 3 Active rights 2 Revoked rights 1',
    ],
    [
      'ja',
      '権利を読み込めませんでした',
      '最後に読み込んだ値を表示中',
      '権利の合計 3 有効な権利 2 取り消した権利 1',
    ],
  ] as const)(
    'explains initial and refresh load failures in %s while preserving the last counts',
    (locale, errorPrefix, stale, counts) => {
      const render = (previousRows: readonly MemberRowView[] | null): JSX.Element =>
        OverviewPage({
          apiBaseUrl: 'x',
          copy: DASH_COPY[locale].overview,
          graphEndpoint: '',
          state: { kind: 'error', message: 'D1_UNAVAILABLE [42]', previousRows },
        })
      const initial = render(null)
      const refreshed = render(rows)

      for (const view of [initial, refreshed]) {
        const alert = walkView(view).find((node) => node.props.role === 'alert')
        expect(viewText(alert)).toBe(`${errorPrefix}: D1_UNAVAILABLE [42]`)
      }
      expect(
        findViewNodes(initial, 'div')
          .filter((node) => node.props.class === 'stat-value')
          .map(viewText),
      ).toStrictEqual(['—', '—', '—'])
      expect(viewText(initial)).not.toContain(stale)
      expect(viewText(refreshed)).toContain(stale)
      expect(viewText(refreshed)).toContain(counts)
    },
  )
})
