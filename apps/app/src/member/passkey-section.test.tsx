// @vitest-environment happy-dom
import { mount, settle } from '@fuda/ui/test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PasskeySection } from './PasskeySection.tsx'
import * as sensitive from './sensitive.ts'

describe('member passkey section', () => {
  afterEach(() => vi.restoreAllMocks())

  it('loads metadata once, adds once per user event and refetches after the add', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        await Promise.resolve(
          Response.json({ passkeys: [{ backedUp: false, createdAt: 1, holdsSecret: false, id: 'first' }] }),
        ),
    )
    vi.stubGlobal('fetch', fetch)
    const pending = Promise.withResolvers<sensitive.AddWithSecret>()
    vi.spyOn(sensitive, 'addPasskeyKeepingSecret').mockReturnValue(pending.promise)
    const view = mount(<PasskeySection locale="en" />)
    await vi.waitFor(() => {
      expect(view.host.querySelector('li')).not.toBeNull()
    })
    expect(sensitive.addPasskeyKeepingSecret).not.toHaveBeenCalled()
    await settle(() => {
      view.host.querySelector('button.btn-outline')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      view.host.querySelector('button.btn-outline')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await vi.waitFor(() => {
      expect(sensitive.addPasskeyKeepingSecret).toHaveBeenCalledOnce()
    })
    view.update(<PasskeySection locale="ja" />)
    expect([
      vi.mocked(sensitive.addPasskeyKeepingSecret).mock.calls.length,
      fetch.mock.calls.length,
    ]).toStrictEqual([1, 1])
    pending.resolve({ holdsSecret: false, ok: true })
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2)
    })
    view.dispose()
  })
})
