// @vitest-environment happy-dom
import { SharedContext } from '@void/solid'
import { createStore } from 'solid-js/store'
import type { SetStoreFunction } from 'solid-js/store'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Layout from '../pages/layout.tsx'
import type { DashShared } from './server/session.ts'
import { setSessionVersion } from './session-request.ts'

let shared: DashShared
let setShared: SetStoreFunction<DashShared>
vi.mock(import('./session-request.ts'), async (original) => ({
  ...(await original()),
  setSessionVersion: vi.fn<(value: string | null) => void>(),
}))

describe('dashboard session boundary', () => {
  let dispose: (() => void) | undefined
  let host: HTMLDivElement | undefined
  afterEach(() => {
    dispose?.()
    host?.remove()
    vi.restoreAllMocks()
  })

  it('reloads instead of blessing an old form with a refreshed session identifier', () => {
    ;[shared, setShared] = createStore<DashShared>({
      locale: 'en',
      operator: null,
      restoreFailed: false,
      sessionVersion: 'original',
      surface: null,
      theme: 'system',
    })
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    host = document.createElement('div')
    document.body.append(host)
    const context = {
      ...shared,
      get sessionVersion() {
        return shared.sessionVersion
      },
    }
    dispose = render(
      () => (
        <SharedContext.Provider value={context}>
          <Layout>
            <input value="old store draft" />
          </Layout>
        </SharedContext.Provider>
      ),
      host,
    )
    expect(setSessionVersion).toHaveBeenLastCalledWith('original')
    setShared('sessionVersion', 'new-session')
    expect(reload).toHaveBeenCalledOnce()
    expect(setSessionVersion).toHaveBeenLastCalledWith('original')
  })
})
