// @vitest-environment happy-dom
import { pick } from '@fuda/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DASH_COPY } from './copy.ts'
import type { MemberRowView } from './members-view.ts'
import { RightsList } from './RightsList.tsx'
import type { RightsListProps } from './RightsList.tsx'
import { cleanup, mount, spacedText } from './test/render.tsx'

const UID = `0x${'ab'.repeat(32)}` as const
const SIGNED_UID = `0x${'cd'.repeat(32)}` as const
const THIRD_UID = `0x${'ef'.repeat(32)}` as const

const publicPasses = (uid: string) => ({
  apple: `https://api.fuda.sh/pass/${uid}/apple.pkpass`,
  google: `https://api.fuda.sh/pass/${uid}/google`,
  web: `https://api.fuda.sh/pass/${uid}`,
})

const rows: readonly MemberRowView[] = [
  {
    holder: `0x${'11'.repeat(20)}`,
    holderShort: '0x1111…1111',
    human: false,
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
    human: false,
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
    human: false,
    level: 'signed',
    memberId: 'carol',
    passUrls: publicPasses(THIRD_UID),
    qr: `fuda:v1:${THIRD_UID}`,
    status: 'active',
    tier: 'GENERAL',
    uid: THIRD_UID,
  },
]

const show = (overrides: Partial<RightsListProps> = {}): HTMLElement => {
  const value: RightsListProps = {
    copy: pick(DASH_COPY, 'en').rights,
    onRequestRevoke: (): void => {},
    onToggleQr: (): void => {},
    openQr: null,
    revokingUid: null,
    rows,
    ...overrides,
  }
  return mount(() => <RightsList {...value} />)
}
const buttons = (scope: ParentNode): HTMLButtonElement[] => [
  ...scope.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
]
const records = (scope: ParentNode, uid: string): Element[] => [
  ...scope.querySelectorAll(`[data-right-uid="${uid}"]`),
]
const panelIds = (scope: ParentNode): string[] => [...scope.querySelectorAll('[id]')].map((node) => node.id)
const layout = (host: HTMLElement, testId: string): Element =>
  host.querySelector(`[data-testid="${testId}"]`)!
const headers = (scope: Element): string[] => [...scope.querySelectorAll('th')].map(spacedText)
const colspans = (scope: Element): string[] =>
  [...scope.querySelectorAll('td[colspan]')].map((node) => node.getAttribute('colspan') ?? '')
const isQrButton = (node: HTMLButtonElement): boolean => ['Show QR', 'Hide QR'].includes(spacedText(node))

describe(RightsList, () => {
  afterEach(cleanup)

  it('passes the localized QR label and full payload in both layouts', () => {
    const host = show({ copy: DASH_COPY.ja.rights, openQr: UID })
    expect(
      [...host.querySelectorAll('div[role="img"]')].map((node) => ({
        label: node.getAttribute('aria-label'),
        qr: node.nextElementSibling?.textContent,
      })),
    ).toStrictEqual([
      { label: '権利識別子の QR', qr: `fuda:v1:${UID}` },
      { label: '権利識別子の QR', qr: `fuda:v1:${UID}` },
    ])
  })

  it('passes the invoking button for table and card revoke actions', () => {
    const onRequestRevoke = vi.fn<(row: MemberRowView, invoker: HTMLButtonElement) => void>()
    const host = show({ onRequestRevoke, rows: [rows[0]] })
    const [tableRevoke, cardRevoke] = buttons(host).filter((node) => spacedText(node) === 'Revoke')
    tableRevoke.click()
    cardRevoke.click()
    expect(onRequestRevoke).toHaveBeenNthCalledWith(1, rows[0], tableRevoke)
    expect(onRequestRevoke).toHaveBeenNthCalledWith(2, rows[0], cardRevoke)
  })

  it('renders the same rights in desktop and mobile records', () => {
    const host = show({ openQr: UID })
    const table = layout(host, 'rights-table')
    const cards = layout(host, 'rights-cards')
    const links = [...host.querySelectorAll('a')].map((node) => node.getAttribute('href'))

    expect({
      cards: cards.className,
      links: links.length,
      records: records(host, THIRD_UID).length,
      table: table.className,
    }).toStrictEqual({ cards: 'rights-cards', links: 18, records: 2, table: 'rights-table' })
  })

  it('names the verified human column in both layouts and locales, chips only a badged right, and keeps the QR row spanning every column', () => {
    const badged: MemberRowView = { ...rows[0], human: true }
    const [, plain] = rows
    const overrides = { openQr: badged.uid, rows: [badged, plain] }
    const host = show(overrides)
    const japanese = show({ ...overrides, copy: DASH_COPY.ja.rights })
    const table = layout(host, 'rights-table')
    const cards = layout(host, 'rights-cards')
    // The affirmative is the neutral chip the gate already uses for this claim;
    // the status chip is badge-success / badge-error, so it cannot be mistaken for it.
    const chips = (scope: ParentNode, uid: string): string[] =>
      records(scope, uid)
        .flatMap((record) => [...record.querySelectorAll('span')])
        .filter((node) => node.className === 'badge badge-neutral')
        .map(spacedText)
    const fallbacks = (scope: ParentNode, uid: string): number =>
      records(scope, uid)
        .flatMap((record) => [...record.querySelectorAll('span')])
        .filter((node) => node.className === 'opacity-50' && spacedText(node) === '—').length

    expect({
      cards: { badged: chips(cards, badged.uid), plainFallbacks: fallbacks(cards, plain.uid) },
      headers: headers(table),
      japanese: {
        chips: chips(layout(japanese, 'rights-cards'), badged.uid),
        headers: headers(layout(japanese, 'rights-table')),
      },
      qrColspans: colspans(table),
      table: {
        badged: chips(table, badged.uid),
        plain: chips(table, plain.uid),
        plainFallbacks: fallbacks(table, plain.uid),
      },
    }).toStrictEqual({
      // The badged right carries the chip in the card layout too: a column added
      // only to the table would vanish on the phone an operator works from.
      cards: { badged: ['Verified human'], plainFallbacks: 1 },
      headers: ['Member', 'Holder', 'Level', 'Tier', 'Status', 'Verified human', 'UID', 'Passes', 'Revoke'],
      japanese: {
        chips: ['人間であることを確認済み'],
        headers: [
          'メンバー',
          '保有者',
          'レベル',
          'ティア',
          'ステータス',
          '人間であることを確認済み',
          'UID',
          'パス',
          '取り消す',
        ],
      },
      // One span per column, so the QR disclosure row cannot drift from the header.
      qrColspans: ['9'],
      table: { badged: ['Verified human'], plain: [], plainFallbacks: 1 },
    })
  })

  it('omits the verified human column while no listed right carries the badge', () => {
    const host = show({ openQr: rows[0].uid })
    const table = layout(host, 'rights-table')
    const cards = layout(host, 'rights-cards')
    expect({
      cardTerms: [...cards.querySelectorAll('dt')]
        .map(spacedText)
        .filter((term) => term === 'Verified human'),
      headers: [...table.querySelectorAll('th')].map(spacedText),
      qrColspans: [...table.querySelectorAll('td[colspan]')].map((node) => node.getAttribute('colspan')),
    }).toStrictEqual({
      // Badges are optional: a deployment without a verifier shows the list it always had.
      cardTerms: [],
      headers: ['Member', 'Holder', 'Level', 'Tier', 'Status', 'UID', 'Passes', 'Revoke'],
      qrColspans: ['8'],
    })
  })

  it('keeps a short UID visible while exposing the full UID and accessible QR state', () => {
    const host = show({ openQr: UID })
    const uidCodes = [...host.querySelectorAll('code[title]')]
    const qrButtons = buttons(host).filter(isQrButton)
    const revokeButtons = buttons(host).filter((node) => spacedText(node) === 'Revoke')
    const table = layout(host, 'rights-table')
    const cards = layout(host, 'rights-cards')
    const tableQrButtons = buttons(table).filter(isQrButton)
    const cardQrButtons = buttons(cards).filter(isQrButton)

    expect({
      qr: {
        cardControls: cardQrButtons.map((node) => node.getAttribute('aria-controls')),
        cardPanels: panelIds(cards),
        controls: qrButtons.map((node) => node.getAttribute('aria-controls')),
        expanded: qrButtons.filter((node) => node.getAttribute('aria-expanded') === 'true').length,
        hideLabel: qrButtons.filter((node) => spacedText(node) === 'Hide QR').length,
        tableControls: tableQrButtons.map((node) => node.getAttribute('aria-controls')),
        tablePanels: panelIds(table),
        total: qrButtons.length,
        uniquePanels: new Set([...panelIds(table), ...panelIds(cards)]).size,
      },
      revoked: revokeButtons.map((node) => node.disabled),
      uid: {
        hasShortenedValue: uidCodes.map(spacedText).some((text) => text.includes(`${UID.slice(0, 10)}…`)),
        titles: uidCodes.map((node) => node.getAttribute('title')),
      },
    }).toStrictEqual({
      qr: {
        cardControls: [
          `right-cards-qr-${UID}`,
          `right-cards-qr-${SIGNED_UID}`,
          `right-cards-qr-${THIRD_UID}`,
        ],
        cardPanels: [`right-cards-qr-${UID}`],
        controls: [
          `right-table-qr-${UID}`,
          `right-table-qr-${SIGNED_UID}`,
          `right-table-qr-${THIRD_UID}`,
          `right-cards-qr-${UID}`,
          `right-cards-qr-${SIGNED_UID}`,
          `right-cards-qr-${THIRD_UID}`,
        ],
        expanded: 2,
        hideLabel: 2,
        tableControls: [
          `right-table-qr-${UID}`,
          `right-table-qr-${SIGNED_UID}`,
          `right-table-qr-${THIRD_UID}`,
        ],
        tablePanels: [`right-table-qr-${UID}`],
        total: 6,
        uniquePanels: 2,
      },
      revoked: [false, true, false, false, true, false],
      uid: {
        hasShortenedValue: true,
        titles: [UID, SIGNED_UID, THIRD_UID, UID, SIGNED_UID, THIRD_UID],
      },
    })
  })
})
