// @vitest-environment happy-dom
import { mount, settle } from '@fuda/ui-preact/test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmAction } from './ConfirmAction.tsx'

const disposers: (() => void)[] = []

describe(ConfirmAction, () => {
  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose()
    }
  })

  it('cancels without action, restores focus, and confirms only an open dialog', async () => {
    const confirm = vi.fn<() => void>()
    const { dispose, host } = mount(
      <ConfirmAction
        label="Sign out"
        title="Leave?"
        description="Sign out of this device."
        cancelLabel="Cancel"
        confirmLabel="Confirm"
        onConfirm={confirm}
      />,
    )
    disposers.push(dispose)
    const dialog = host.querySelector('dialog')!
    const buttons = host.querySelectorAll('button')
    await settle(() => {
      buttons[0].click()
    })
    expect(document.activeElement).toBe(buttons[1])
    await settle(() => {
      buttons[1].click()
    })
    expect(dialog.open).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(buttons[0])
    })
    await settle(() => {
      buttons[0].click()
      dialog.click()
    })
    expect(dialog.open).toBe(false)
    await settle(() => {
      buttons[0].click()
      buttons[2].click()
      buttons[2].click()
    })
    expect(confirm).toHaveBeenCalledOnce()
  })

  it('labels the dialog by ids that stay stable across a rerender', () => {
    const view = (
      <ConfirmAction
        label="Sign out"
        title="Leave?"
        description="Sign out of this device."
        cancelLabel="Cancel"
        confirmLabel="Confirm"
        onConfirm={() => {}}
      />
    )
    const mounted = mount(view)
    disposers.push(mounted.dispose)
    const dialog = mounted.host.querySelector('dialog')!
    const labelled = dialog.getAttribute('aria-labelledby')
    const described = dialog.getAttribute('aria-describedby')
    expect(labelled).not.toBe(described)
    expect(mounted.host.querySelector(`[id="${labelled}"]`)?.textContent).toBe('Leave?')
    expect(mounted.host.querySelector(`[id="${described}"]`)?.textContent).toBe('Sign out of this device.')
    mounted.update(view)
    expect(dialog.getAttribute('aria-labelledby')).toBe(labelled)
  })
})
