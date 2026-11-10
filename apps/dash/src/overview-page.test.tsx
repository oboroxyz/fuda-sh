// @vitest-environment happy-dom
import { pick } from '@fuda/i18n'
import { afterEach, describe, expect, it } from 'vitest'

import { DASH_COPY } from './copy.ts'
import type { MembersState } from './members-state.ts'
import type { MemberRowView } from './members-view.ts'
import { OverviewPage } from './OverviewPage.tsx'
import type { OverviewPageProps } from './OverviewPage.tsx'
import { cleanup, mount, spacedText } from './test/render.tsx'

const UID = `0x${'ab'.repeat(32)}` as const
const copy = pick(DASH_COPY, 'en').overview

const show = (props: OverviewPageProps): HTMLElement => mount(<OverviewPage {...props} />)
const shown = (props: OverviewPageProps): string => spacedText(show(props))

const rows: readonly MemberRowView[] = [
  {
    holder: `0x${'11'.repeat(20)}`,
    holderShort: '0x1111…1111',
    human: false,
    level: 'bearer',
    memberId: 'alice',
    passUrls: { apple: '/apple', google: '/google', web: '/web' },
    qr: `fuda:v1:${UID}`,
    status: 'active',
    tier: 'GENERAL',
    uid: UID,
  },
  {
    holder: `0x${'22'.repeat(20)}`,
    holderShort: '0x2222…2222',
    human: false,
    level: 'signed',
    memberId: 'bob',
    passUrls: { apple: '/apple', google: '/google', web: '/web' },
    qr: `fuda:v1:${UID}`,
    status: 'active',
    tier: 'VIP',
    uid: UID,
  },
  {
    holder: null,
    holderShort: null,
    human: false,
    level: 'signed',
    memberId: 'carol',
    passUrls: { apple: '/apple', google: '/google', web: '/web' },
    qr: `fuda:v1:${UID}`,
    status: 'revoked',
    tier: 'GENERAL',
    uid: UID,
  },
]

describe(OverviewPage, () => {
  afterEach(cleanup)

  it('shows populated member counts and configured client status', () => {
    const ready: MembersState = { kind: 'ready', rows }

    expect(shown({ apiBaseUrl: 'https://api.fuda.sh', copy, graphEndpoint: '', state: ready })).toContain(
      'Total rights 3 Active rights 2 Revoked rights 1',
    )
    expect(shown({ apiBaseUrl: 'https://api.fuda.sh', copy, graphEndpoint: '', state: ready })).toContain(
      'API Connected https://api.fuda.sh Graph index Not configured',
    )
  })

  it('shows zero counts only after a successful empty response', () => {
    const ready: MembersState = { kind: 'ready', rows: [] }

    expect(shown({ apiBaseUrl: 'x', copy, graphEndpoint: 'https://graph.example', state: ready })).toContain(
      'Total rights 0 Active rights 0 Revoked rights 0',
    )
  })

  it.each([
    { kind: 'ready', rows: [] },
    { kind: 'error', message: 'D1_OFFLINE' },
  ] satisfies MembersState[])(
    'shows the configured Graph URL without claiming connectivity when $kind',
    (state) => {
      const graphEndpoint = `https://graph.example/${'a'.repeat(80)}`
      const host = show({ apiBaseUrl: 'x', copy, graphEndpoint, state })
      const graphCard = [...host.querySelectorAll('dl > div')].find(
        (node) => spacedText(node.querySelector('dt')) === 'Graph index',
      )
      const endpoint = [...(graphCard?.querySelectorAll('dd') ?? [])].find(
        (node) => spacedText(node) === graphEndpoint,
      )

      expect(spacedText(graphCard)).toContain(`Graph index Configured ${graphEndpoint}`)
      expect(spacedText(graphCard)).not.toContain('Connected')
      expect(endpoint?.className).toContain('break-all')
    },
  )

  it('does not invent zero counts after an error', () => {
    const failed: MembersState = { kind: 'error', message: 'fetch failed' }
    const text = shown({ apiBaseUrl: 'x', copy, graphEndpoint: 'https://graph.example', state: failed })

    expect(text).toContain('API Unavailable x')
    expect(text).not.toContain('Total rights 0')
  })

  it.each([
    ['en', 'Could not load rights'],
    ['ja', '権利を読み込めませんでした'],
  ] as const)('explains a load failure in %s without counts', (locale, errorPrefix) => {
    const host = show({
      apiBaseUrl: 'x',
      copy: DASH_COPY[locale].overview,
      graphEndpoint: '',
      state: { kind: 'error', message: 'D1_UNAVAILABLE [42]' },
    })

    expect(spacedText(host.querySelector('[role="alert"]'))).toBe(
      `${errorPrefix}: ${locale === 'ja' ? '処理を完了できませんでした。もう一度お試しください。' : 'Something went wrong. Try again.'} (D1_UNAVAILABLE [42])`,
    )
    expect([...host.querySelectorAll('.stat-value')].map(spacedText)).toStrictEqual(['—', '—', '—'])
  })
})
