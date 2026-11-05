import { afterEach, describe, expect, it, vi } from 'vitest'
// @vitest-environment happy-dom
import { SharedContext } from 'void-preact'

import Layout from '../pages/layout.tsx'
import type { DashShared } from './server/session.ts'
import { setSessionVersion } from './session-request.ts'
import { cleanup, open } from './test/render.tsx'

vi.mock(import('./session-request.ts'), async (original) => ({
  ...(await original()),
  setSessionVersion: vi.fn<(value: string | null) => void>(),
}))

const sharedAt = (sessionVersion: string): DashShared => ({
  locale: 'en',
  operator: null,
  restoreFailed: false,
  sessionVersion,
  surface: null,
  theme: 'system',
})

const page = (sessionVersion: string) => (
  <SharedContext.Provider value={{ ...sharedAt(sessionVersion) }}>
    <Layout>
      <input value="old draft" />
    </Layout>
  </SharedContext.Provider>
)

describe('dashboard session boundary', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('records the session identifier the layout first rendered with', () => {
    open(page('original'))
    expect(setSessionVersion).toHaveBeenLastCalledWith('original')
  })

  it('keeps the same identifier across a refresh that does not change the session', () => {
    const view = open(page('original'))
    view.update(page('original'))
    expect(setSessionVersion).toHaveBeenLastCalledWith('original')
    expect(view.host.querySelector('input')).not.toBeNull()
  })

  it('reloads and drops the old form instead of blessing it with a refreshed session identifier', () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const view = open(page('original'))
    expect(view.host.querySelector('input')?.value).toBe('old draft')
    view.update(page('new-session'))
    expect(reload).toHaveBeenCalledOnce()
    expect(setSessionVersion).not.toHaveBeenCalledWith('new-session')
    expect(setSessionVersion).toHaveBeenLastCalledWith('original')
    expect(view.host.querySelector('input')).toBeNull()
  })
})
