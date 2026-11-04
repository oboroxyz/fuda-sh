// @vitest-environment happy-dom
import { pick } from '@fuda/i18n'
import { createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DASH_COPY } from './copy.ts'
import type { MemberRowView } from './members-view.ts'
import { RevokeDialog } from './RevokeDialog.tsx'
import type { RevokeDialogProps } from './RevokeDialog.tsx'
import { cleanup, mount, spacedText } from './test/render.tsx'

const UID = `0x${'ab'.repeat(32)}` as const
const row: MemberRowView = {
  holder: `0x${'12'.repeat(20)}`,
  holderShort: '0x1212…1212',
  human: false,
  level: 'signed',
  memberId: '',
  passUrls: { apple: '/apple', google: '/google', web: '/web' },
  qr: `fuda:v1:${UID}`,
  status: 'active',
  tier: 'GENERAL',
  uid: UID,
}

const props = (overrides: Partial<RevokeDialogProps> = {}): RevokeDialogProps => ({
  busy: false,
  copy: pick(DASH_COPY, 'en').revoke,
  error: null,
  onCancel: (): void => {},
  onConfirm: (): void => {},
  target: row,
  ...overrides,
})

const show = (overrides: Partial<RevokeDialogProps> = {}): HTMLElement => {
  const value = props(overrides)
  return mount(() => <RevokeDialog {...value} />)
}

const actionButtons = (host: HTMLElement): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
]

const dialogOf = (host: HTMLElement): HTMLDialogElement => host.querySelector('dialog')!

describe('revoke dialog', () => {
  afterEach(cleanup)

  it('identifies the right accessibly and puts safe Cancel before confirmation', () => {
    const host = show({ error: 'RPC unavailable' })
    const dialog = dialogOf(host)
    const heading = host.querySelector('h2')!
    const uid = host.querySelector('code')!
    expect({
      labelledBy: dialog.getAttribute('aria-labelledby'),
      modal: dialog.getAttribute('aria-modal'),
      uid: uid.getAttribute('title'),
    }).toStrictEqual({ labelledBy: heading.id, modal: 'true', uid: UID })
    expect(spacedText(host)).toMatch(/No member ID.*0x1212…1212.*signed/u)
    expect(
      [...uid.querySelectorAll('span')].map((node) => [node.getAttribute('aria-hidden'), node.textContent]),
    ).toStrictEqual([
      [null, UID],
      ['true', '0xabababab…'],
    ])
    expect(actionButtons(host).map(spacedText)).toStrictEqual(['Cancel', 'Revoke right'])
    expect(spacedText(host)).toContain('Revoke failed: RPC unavailable')
  })

  it('opens modally and focuses Cancel, then closes when the target clears', () => {
    const [target, setTarget] = createSignal<MemberRowView | null>(row)
    const value = props()
    const host = mount(() => <RevokeDialog {...value} target={target()} />)
    const dialog = dialogOf(host)
    const [cancel] = actionButtons(host)

    expect(dialog.open).toBe(true)
    expect(document.activeElement).toBe(cancel)

    setTarget(null)
    expect(dialog.open).toBe(false)
  })

  it('blocks Escape, backdrop, close and actions while busy', () => {
    const onCancel = vi.fn<() => void>()
    const onConfirm = vi.fn<() => void>()
    const host = show({ busy: true, onCancel, onConfirm })
    const dialog = dialogOf(host)
    const buttons = actionButtons(host)

    const escape = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(escape)
    dialog.click()
    dialog.close()
    for (const button of buttons) {
      button.click()
    }

    expect(buttons.map((button) => [button.disabled, spacedText(button)])).toStrictEqual([
      [true, 'Cancel'],
      [true, 'Revoking'],
    ])
    expect(escape.defaultPrevented).toBe(true)
    expect(onCancel).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
    // A close while busy reopens the dialog: the revoke is still in flight.
    expect(dialog.open).toBe(true)
  })

  it.each([
    ['en', 'Revoking'],
    ['ja', '取り消し中'],
  ] as const)('announces the revoke busy state in a localized live region in %s', (locale, message) => {
    const busy = show({ busy: true, copy: DASH_COPY[locale].revoke })
    const status = busy.querySelector('[role="status"]')

    expect(spacedText(status)).toBe(message)
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(actionButtons(busy).every((button) => button.disabled)).toBe(true)

    const idle = show({ copy: DASH_COPY[locale].revoke })
    expect(spacedText(idle.querySelector('[role="status"]'))).toBe('')
  })

  it('routes idle Cancel, Escape and backdrop to cancellation and disables revoked confirmation', () => {
    const onCancel = vi.fn<() => void>()
    const onConfirm = vi.fn<() => void>()
    const host = show({ onCancel, onConfirm, target: { ...row, status: 'revoked' } })
    const dialog = dialogOf(host)
    const [cancel, confirm] = actionButtons(host)

    cancel.click()
    confirm.click()
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
    dialog.click()

    expect(onCancel).toHaveBeenCalledTimes(3)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(confirm.disabled).toBe(true)
  })
})
