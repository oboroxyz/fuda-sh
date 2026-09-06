/** @jsxImportSource hono/jsx/dom */
import { pick } from '@fuda/i18n'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { describe, expect, it } from 'vitest'

import { DASH_COPY } from './copy.ts'
import type { MemberRowView } from './members-view.ts'
import { RightsList } from './RightsList.tsx'
import { findViewNodes, viewProps, viewText, walkView } from './test/test-view.ts'

const UID = `0x${'ab'.repeat(32)}` as const
const SIGNED_UID = `0x${'cd'.repeat(32)}` as const
const PRIVATE_UID = `0x${'ef'.repeat(32)}` as const

const publicPasses = (uid: string) => ({
  apple: `https://api.fuda.sh/pass/${uid}/apple.pkpass`,
  google: `https://api.fuda.sh/pass/${uid}/google`,
  web: `https://api.fuda.sh/pass/${uid}`,
})

const rows: readonly MemberRowView[] = [
  {
    holder: `0x${'11'.repeat(20)}`,
    holderShort: '0x1111…1111',
    level: 'bearer',
    memberId: 'alice',
    passUrls: publicPasses(UID),
    qr: `fuda:v1:${UID}`,
    status: 'active',
    tier: 'VIP',
    uid: UID,
  },
  {
    holder: `0x${'22'.repeat(20)}`,
    holderShort: '0x2222…2222',
    level: 'signed',
    memberId: 'bob',
    passUrls: publicPasses(SIGNED_UID),
    qr: `fuda:v1:${SIGNED_UID}`,
    status: 'revoked',
    tier: 'GENERAL',
    uid: SIGNED_UID,
  },
  {
    holder: null,
    holderShort: null,
    level: 'private',
    memberId: 'carol',
    passUrls: null,
    qr: `fuda:v1:${PRIVATE_UID}`,
    status: 'active',
    tier: 'GENERAL',
    uid: PRIVATE_UID,
  },
]

const buttons = (view: JSX.Element) => walkView(view).filter((node) => viewProps(node).type === 'button')
const records = (view: JSX.Element, uid: string) =>
  walkView(view).filter((node) => viewProps(node)['data-right-uid'] === uid)

describe(RightsList, () => {
  it('renders the same public and private rights in desktop and mobile records', () => {
    const view = RightsList({
      copy: pick(DASH_COPY, 'en').rights,
      onRequestRevoke: (): void => {},
      onToggleQr: (): void => {},
      openQr: UID,
      revokingUid: null,
      rows,
    })
    const table = walkView(view).find((node) => viewProps(node)['data-testid'] === 'rights-table')
    const cards = walkView(view).find((node) => viewProps(node)['data-testid'] === 'rights-cards')

    const publicLinks = findViewNodes(view, 'a').map((node) => String(viewProps(node).href))
    const privateRecords = records(view, PRIVATE_UID)

    expect({
      cards: { class: viewProps(cards!).class, exists: cards !== undefined },
      private: {
        anchorCount: privateRecords.flatMap(findViewNodes).filter((node) => node.tag === 'a').length,
        recordCount: privateRecords.length,
        showsFallback: privateRecords.map(viewText).join(' ').includes('—'),
      },
      public: {
        includesPrivatePass: publicLinks.includes(`https://api.fuda.sh/pass/${PRIVATE_UID}`),
        links: publicLinks.length,
      },
      table: { class: viewProps(table!).class, exists: table !== undefined },
    }).toStrictEqual({
      cards: { class: 'flex flex-col gap-3 lg:hidden', exists: true },
      private: { anchorCount: 0, recordCount: 2, showsFallback: true },
      public: { includesPrivatePass: false, links: 12 },
      table: { class: 'hidden lg:block', exists: true },
    })
  })

  it('keeps a short UID visible while exposing the full UID and accessible QR state', () => {
    const view = RightsList({
      copy: pick(DASH_COPY, 'en').rights,
      onRequestRevoke: (): void => {},
      onToggleQr: (): void => {},
      openQr: UID,
      revokingUid: null,
      rows,
    })
    const uidCodes = findViewNodes(view, 'code')
    const qrButtons = buttons(view).filter((node) => ['Show QR', 'Hide QR'].includes(viewText(node)))
    const revokeButtons = buttons(view).filter((node) => viewText(node) === 'Revoke')

    expect({
      qr: {
        controls: qrButtons.map((node) => viewProps(node)['aria-controls']),
        expanded: qrButtons.filter((node) => viewProps(node)['aria-expanded'] === true).length,
        hideLabel: qrButtons.filter((node) => viewText(node) === 'Hide QR').length,
        total: qrButtons.length,
      },
      revoked: revokeButtons.map((node) => viewProps(node).disabled),
      uid: {
        hasShortenedValue: uidCodes.map(viewText).some((text) => text.includes(`${UID.slice(0, 10)}…`)),
        titles: uidCodes.map((node) => viewProps(node).title),
      },
    }).toStrictEqual({
      qr: {
        controls: [
          `right-qr-${UID}`,
          `right-qr-${SIGNED_UID}`,
          `right-qr-${PRIVATE_UID}`,
          `right-qr-${UID}`,
          `right-qr-${SIGNED_UID}`,
          `right-qr-${PRIVATE_UID}`,
        ],
        expanded: 2,
        hideLabel: 2,
        total: 6,
      },
      revoked: [false, true, false, false, true, false],
      uid: {
        hasShortenedValue: true,
        titles: [UID, SIGNED_UID, PRIVATE_UID, UID, SIGNED_UID, PRIVATE_UID],
      },
    })
  })
})
