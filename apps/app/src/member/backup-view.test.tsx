// @vitest-environment happy-dom
import { mount, settle } from '@fuda/ui-preact/test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readPassMemory } from '../pass-memory.ts'
import { PassBackupSection } from './PassBackupSection.tsx'

const uid = `0x${'ab'.repeat(32)}` as const
const holder = `0x${'00'.repeat(20)}` as const

describe('backup restoration event', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it.each([false, true])(
    'restores the chosen pass once and preserves it through a rerender, passkey=%s',
    async (passkey) => {
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () => await Promise.resolve(Response.json({ holder, passkey, uid })),
      )
      vi.stubGlobal('fetch', fetch)
      const view = mount(<PassBackupSection locale="en" />)
      expect(fetch).not.toHaveBeenCalled()
      const input = view.host.querySelector('input')
      if (input === null) {
        throw new Error('Backup input missing')
      }
      const file = new File([JSON.stringify({ uid, version: 1 })], 'fictional-pass.json', {
        type: 'application/json',
      })
      Object.defineProperty(input, 'files', { value: [file] })
      await settle(() => {
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await vi.waitFor(() => {
        expect(view.host.querySelector('.alert-success')).not.toBeNull()
      })
      expect(readPassMemory()).toMatchObject([{ holder, uid }])
      expect(view.host.textContent?.includes('entering still takes the passkey')).toBe(passkey)
      view.update(<PassBackupSection locale="ja" />)
      expect(fetch).toHaveBeenCalledOnce()
      view.dispose()
    },
  )
})
