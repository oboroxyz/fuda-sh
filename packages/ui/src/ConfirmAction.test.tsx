// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { render } from 'hono/jsx/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmAction } from './ConfirmAction.tsx'

describe(ConfirmAction, () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('cancels without action, restores focus, and confirms only an open dialog', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const confirm = vi.fn<() => void>()
    render(
      <ConfirmAction
        label="Sign out"
        title="Leave?"
        description="Sign out of this device."
        cancelLabel="Cancel"
        confirmLabel="Confirm"
        onConfirm={confirm}
      />,
      host,
    )
    await vi.waitFor(() => {
      expect(host.querySelector('dialog')).not.toBeNull()
    })
    const dialog = host.querySelector('dialog')!
    const buttons = host.querySelectorAll('button')
    buttons[0].click()
    expect(document.activeElement).toBe(buttons[1])
    buttons[1].click()
    expect(dialog.open).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(buttons[0])
    })
    buttons[0].click()
    dialog.click()
    expect(dialog.open).toBe(false)
    buttons[0].click()
    buttons[2].click()
    buttons[2].click()
    expect(confirm).toHaveBeenCalledOnce()
  })
})
