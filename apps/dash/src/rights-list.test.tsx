/** @jsxImportSource hono/jsx/dom */
import { pick } from '@fuda/i18n'
import { describe, expect, it, vi } from 'vitest'

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

const buttons = (view: unknown) => walkView(view).filter((node) => viewProps(node).type === 'button')
const records = (view: unknown, uid: string) =>
  walkView(view).filter((node) => viewProps(node)['data-right-uid'] === uid)
const panelIds = (view: unknown): string[] =>
  walkView(view)
    .map((node) => viewProps(node).id)
    .filter((id): id is string => typeof id === 'string')

describe(RightsList, () => {
  it('passes the invoking button from currentTarget for table and card revoke actions', () => {
    vi.stubGlobal('HTMLButtonElement', Object)
    const onRequestRevoke = vi.fn<(row: MemberRowView, invoker: HTMLButtonElement) => void>()
    const view = RightsList({
      copy: pick(DASH_COPY, 'en').rights,
      onRequestRevoke,
      onToggleQr: (): void => {},
      openQr: null,
      revokingUid: null,
      rows: [rows[0]],
    })
    const [tableRevoke, cardRevoke] = buttons(view).filter((node) => viewText(node) === 'Revoke')
    const tableButton = { id: 'table-button' } as HTMLButtonElement
    const cardButton = { id: 'card-button' } as HTMLButtonElement
    const nestedTarget = { id: 'nested-label' } as HTMLSpanElement
    ;(viewProps(tableRevoke).onClick as (event: MouseEvent) => void)({
      currentTarget: tableButton,
      target: nestedTarget,
    } as unknown as MouseEvent)
    ;(viewProps(cardRevoke).onClick as (event: MouseEvent) => void)({
      currentTarget: cardButton,
      target: nestedTarget,
    } as unknown as MouseEvent)
    expect(onRequestRevoke).toHaveBeenNthCalledWith(1, rows[0], tableButton)
    expect(onRequestRevoke).toHaveBeenNthCalledWith(2, rows[0], cardButton)
  })

  it('renders the same public and private rights in desktop and mobile records without private pass anchors', () => {
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
        anchorCount: privateRecords.flatMap((record) => findViewNodes(record, 'a')).length,
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
    const table = walkView(view).find((node) => viewProps(node)['data-testid'] === 'rights-table')
    const cards = walkView(view).find((node) => viewProps(node)['data-testid'] === 'rights-cards')
    const tableQrButtons = buttons(table!).filter((node) => ['Show QR', 'Hide QR'].includes(viewText(node)))
    const cardQrButtons = buttons(cards!).filter((node) => ['Show QR', 'Hide QR'].includes(viewText(node)))

    expect({
      qr: {
        cardControls: cardQrButtons.map((node) => viewProps(node)['aria-controls']),
        cardPanels: panelIds(cards!),
        controls: qrButtons.map((node) => viewProps(node)['aria-controls']),
        expanded: qrButtons.filter((node) => viewProps(node)['aria-expanded'] === true).length,
        hideLabel: qrButtons.filter((node) => viewText(node) === 'Hide QR').length,
        tableControls: tableQrButtons.map((node) => viewProps(node)['aria-controls']),
        tablePanels: panelIds(table!),
        total: qrButtons.length,
        uniquePanels: new Set([...panelIds(table!), ...panelIds(cards!)]).size,
      },
      revoked: revokeButtons.map((node) => viewProps(node).disabled),
      uid: {
        hasShortenedValue: uidCodes.map(viewText).some((text) => text.includes(`${UID.slice(0, 10)}…`)),
        titles: uidCodes.map((node) => viewProps(node).title),
      },
    }).toStrictEqual({
      qr: {
        cardControls: [
          `right-cards-qr-${UID}`,
          `right-cards-qr-${SIGNED_UID}`,
          `right-cards-qr-${PRIVATE_UID}`,
        ],
        cardPanels: [`right-cards-qr-${UID}`],
        controls: [
          `right-table-qr-${UID}`,
          `right-table-qr-${SIGNED_UID}`,
          `right-table-qr-${PRIVATE_UID}`,
          `right-cards-qr-${UID}`,
          `right-cards-qr-${SIGNED_UID}`,
          `right-cards-qr-${PRIVATE_UID}`,
        ],
        expanded: 2,
        hideLabel: 2,
        tableControls: [
          `right-table-qr-${UID}`,
          `right-table-qr-${SIGNED_UID}`,
          `right-table-qr-${PRIVATE_UID}`,
        ],
        tablePanels: [`right-table-qr-${UID}`],
        total: 6,
        uniquePanels: 2,
      },
      revoked: [false, true, false, false, true, false],
      uid: {
        hasShortenedValue: true,
        titles: [UID, SIGNED_UID, PRIVATE_UID, UID, SIGNED_UID, PRIVATE_UID],
      },
    })
  })
})
