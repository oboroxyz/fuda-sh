// @vitest-environment happy-dom
import { mount, settle } from '@fuda/ui/test'
import type { JSX } from 'preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSignOut } from './page-context.tsx'

const View = (): JSX.Element => <button onClick={useSignOut()}>Sign out</button>

describe('member sign-out boundary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('ends the session before leaving the document that owns member data', async () => {
    const pending = Promise.withResolvers<Response>()
    const fetch = vi.fn<typeof globalThis.fetch>(async () => await pending.promise)
    vi.stubGlobal('fetch', fetch)
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
    const view = mount(<View />)
    await settle(() => view.host.querySelector('button')?.click())
    expect(assign).not.toHaveBeenCalled()
    await settle(() => {
      pending.resolve(Response.json({ ok: true }))
    })
    expect(fetch).toHaveBeenCalledWith('/session/sign-out', expect.objectContaining({ method: 'POST' }))
    await vi.waitFor(() => {
      expect(assign).toHaveBeenCalledExactlyOnceWith('/')
    })
    view.dispose()
  })
})
