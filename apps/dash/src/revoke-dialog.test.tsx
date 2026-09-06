/** @jsxImportSource hono/jsx/dom */
import { pick } from '@fuda/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DASH_COPY } from './copy.ts'
import type { MemberRowView } from './members-view.ts'
import { RevokeDialog } from './RevokeDialog.tsx'
import type { RevokeDialogProps } from './RevokeDialog.tsx'
import { findViewNodes, viewProps, viewText, walkView } from './test/test-view.ts'

const effects = vi.hoisted(() => [] as (() => void)[])
vi.mock(import('hono/jsx/dom'), async (importOriginal) => ({
  ...(await importOriginal()),
  useEffect: (effect: () => void): void => {
    effects.push(effect)
  },
}))

const UID = `0x${'ab'.repeat(32)}` as const
const row: MemberRowView = {
  holder: `0x${'12'.repeat(20)}`,
  holderShort: '0x1212…1212',
  level: 'signed',
  memberId: '',
  passUrls: null,
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

const actionButtons = (view: unknown) => walkView(view).filter((node) => viewProps(node).type === 'button')

describe('revoke dialog', () => {
  beforeEach(() => {
    effects.length = 0
  })

  it('identifies the right accessibly and puts safe Cancel before confirmation', () => {
    const view = RevokeDialog(props({ error: 'RPC unavailable' }))
    const [dialog] = findViewNodes(view, 'dialog')
    const [heading] = findViewNodes(view, 'h2')
    const [uid] = findViewNodes(view, 'code')
    expect({
      labelledBy: viewProps(dialog)['aria-labelledby'],
      modal: viewProps(dialog)['aria-modal'],
      uid: viewProps(uid).title,
    }).toStrictEqual({ labelledBy: viewProps(heading).id, modal: 'true', uid: UID })
    expect(viewText(view)).toMatch(/No member ID.*0x1212…1212.*signed/u)
    expect(
      findViewNodes(uid, 'span').map((node) => [viewProps(node)['aria-hidden'], viewText(node)]),
    ).toStrictEqual([
      [undefined, UID],
      ['true', '0xabababab…'],
    ])
    expect(actionButtons(view).map(viewText)).toStrictEqual(['Cancel', 'Revoke right'])
    expect(viewText(view)).toContain('Revoke failed: RPC unavailable')
  })

  it('opens modally and focuses Cancel, then closes when the target clears', () => {
    const view = RevokeDialog(props())
    const [dialog] = findViewNodes(view, 'dialog')
    const [cancel] = actionButtons(view)
    const calls: string[] = []
    const element = {
      close: (): void => {
        calls.push('close')
      },
      open: false,
      showModal: (): void => {
        calls.push('showModal')
      },
    } as unknown as HTMLDialogElement
    ;(viewProps(dialog).ref as { current: HTMLDialogElement | null }).current = element
    ;(viewProps(cancel).ref as { current: HTMLButtonElement | null }).current = {
      focus: (): void => {
        calls.push('focusCancel')
      },
    } as unknown as HTMLButtonElement
    for (const effect of effects) {
      effect()
    }
    expect(calls).toStrictEqual(['showModal', 'focusCancel'])

    effects.length = 0
    const closed = RevokeDialog(props({ target: null }))
    element.open = true
    ;(viewProps(findViewNodes(closed, 'dialog')[0]).ref as { current: HTMLDialogElement | null }).current =
      element
    for (const effect of effects) {
      effect()
    }
    expect(calls).toStrictEqual(['showModal', 'focusCancel', 'close'])
  })

  it('blocks Escape, backdrop, close and actions while busy', () => {
    const onCancel = vi.fn<() => void>()
    const onConfirm = vi.fn<() => void>()
    const view = RevokeDialog(props({ busy: true, onCancel, onConfirm }))
    const [dialog] = findViewNodes(view, 'dialog')
    const buttons = actionButtons(view)
    const preventDefault = vi.fn<() => void>()
    const showModal = vi.fn<() => void>()
    const element = { open: false, showModal } as unknown as HTMLDialogElement
    ;(viewProps(dialog).ref as { current: HTMLDialogElement | null }).current = element
    ;(viewProps(dialog).onCancel as (event: Event) => void)({ preventDefault } as unknown as Event)
    ;(viewProps(dialog).onClick as (event: MouseEvent) => void)({
      currentTarget: element,
      target: element,
    } as unknown as MouseEvent)
    ;(viewProps(dialog).onClose as () => void)()
    for (const button of buttons) {
      ;(viewProps(button).onClick as () => void)()
    }
    expect(buttons.map((button) => [viewProps(button).disabled, viewText(button)])).toStrictEqual([
      [true, 'Cancel'],
      [true, 'Revoking'],
    ])
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(showModal).toHaveBeenCalledOnce()
  })

  it('routes idle Cancel, Escape and backdrop to cancellation and disables revoked confirmation', () => {
    const onCancel = vi.fn<() => void>()
    const onConfirm = vi.fn<() => void>()
    const view = RevokeDialog(props({ onCancel, onConfirm, target: { ...row, status: 'revoked' } }))
    const [dialog] = findViewNodes(view, 'dialog')
    const [cancel, confirm] = actionButtons(view)
    ;(viewProps(cancel).onClick as () => void)()
    ;(viewProps(confirm).onClick as () => void)()
    ;(viewProps(dialog).onCancel as (event: Event) => void)({
      preventDefault: (): void => {},
    } as unknown as Event)
    const backdrop = {} as HTMLDialogElement
    ;(viewProps(dialog).onClick as (event: MouseEvent) => void)({
      currentTarget: backdrop,
      target: backdrop,
    } as unknown as MouseEvent)
    expect(onCancel).toHaveBeenCalledTimes(3)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(viewProps(confirm).disabled).toBe(true)
  })
})
