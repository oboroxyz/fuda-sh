// @vitest-environment happy-dom
import { mount, settle } from '@fuda/ui/test'
import type { JSX } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterContext, SharedContext } from 'void-preact'

import SignInPage from '../pages/signin.tsx'
import { memberPasskeys } from './member/auth.ts'

type Outcome = Awaited<ReturnType<typeof memberPasskeys.signIn>>

const visit = vi.fn<() => Promise<void>>(async () => {})
const router = {
  _hoverDelay: 0,
  flush: () => {},
  flushAll: () => {},
  params: {},
  path: '/signin',
  prefetch: visit,
  query: new URLSearchParams(),
  refresh: visit,
  url: new URL('http://localhost/signin'),
  visit,
}
const Page = (): JSX.Element => (
  <RouterContext.Provider value={router}>
    <SharedContext.Provider value={{ locale: 'en', theme: 'light' }}>
      <SignInPage />
    </SharedContext.Provider>
  </RouterContext.Provider>
)

describe('sign-in ceremony lifetime', () => {
  beforeEach(() => {
    vi.spyOn(memberPasskeys, 'signIn')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    visit.mockClear()
  })

  it.each(['cancel', 'unmount'] as const)(
    'blocks a second ceremony and ignores completion after %s',
    async (leave) => {
      const pending = Promise.withResolvers<Outcome>()
      vi.mocked(memberPasskeys.signIn).mockReturnValue(pending.promise)
      const view = mount(<Page />)
      const button = view.host.querySelector('button')
      await settle(() => {
        button?.click()
        button?.click()
      })
      expect(memberPasskeys.signIn).toHaveBeenCalledOnce()
      view.update(<Page />)
      expect(memberPasskeys.signIn).toHaveBeenCalledOnce()
      if (leave === 'unmount') {
        view.dispose()
      } else {
        const cancel = [...view.host.querySelectorAll('button')].find((item) => item.textContent === 'Cancel')
        if (cancel === undefined) {
          throw new Error('Cancel was not offered')
        }
        await settle(() => {
          cancel?.click()
        })
      }
      await settle(() => {
        pending.resolve({ ok: true, session: { ok: true } })
      })
      expect(visit).not.toHaveBeenCalled()
      view.dispose()
    },
  )

  it('navigates once after a current successful ceremony', async () => {
    vi.mocked(memberPasskeys.signIn).mockResolvedValue({ ok: true, session: { ok: true } })
    const view = mount(<Page />)
    await settle(() => view.host.querySelector('button')?.click())
    expect(visit).toHaveBeenCalledExactlyOnceWith('/rights', { replace: true })
    view.dispose()
  })
})
