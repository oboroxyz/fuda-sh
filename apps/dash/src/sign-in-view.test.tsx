// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DASH_COPY } from './copy.ts'
import { SignIn } from './SignIn.tsx'
import { cleanup, mount } from './test/render.tsx'

const renderSignIn = (busy: 'create' | 'signin' | 'wallet' | null = null) => {
  const handlers = {
    onCancel: vi.fn<() => void>(),
    onCreate: vi.fn<() => void>(),
    onSignIn: vi.fn<() => void>(),
    onToken: vi.fn<(token: string) => void>(),
    onWallet: vi.fn<() => void>(),
  }
  const host = mount(
    <SignIn appearance={<aside />} busy={busy} copy={DASH_COPY.en.auth} error={null} {...handlers} />,
  )
  const button = (name: string): HTMLButtonElement =>
    [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === name)!
  return { button, handlers, host }
}

describe('the operator sign-in screen', () => {
  afterEach(cleanup)

  it('leads with a passkey and offers a wallet as a link', () => {
    const { button, handlers } = renderSignIn()
    button('Sign in with Passkey').click()
    button('Create a passkey').click()
    button('Sign in with a wallet').click()
    expect(handlers.onSignIn).toHaveBeenCalledOnce()
    expect(handlers.onCreate).toHaveBeenCalledOnce()
    expect(handlers.onWallet).toHaveBeenCalledOnce()
    expect(button('Sign in with Passkey').className).toContain('btn-primary')
    expect(button('Sign in with a wallet').className).not.toContain('btn')
  })

  it('offers a cancel while a ceremony runs and holds the other methods', () => {
    const { button, handlers } = renderSignIn('create')
    expect(button('Creating…').disabled).toBe(true)
    expect(button('Sign in with Passkey').disabled).toBe(true)
    expect(button('Sign in with a wallet').disabled).toBe(true)
    button('Cancel').click()
    expect(handlers.onCancel).toHaveBeenCalledOnce()
  })

  it('has no cancel while nothing runs', () => {
    const { button } = renderSignIn()
    expect(button('Cancel')).toBeUndefined()
  })
})
