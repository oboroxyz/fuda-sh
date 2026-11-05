// @vitest-environment happy-dom
import { mount, settle } from '@fuda/ui-preact/test'
import type { JSX } from 'preact'
import { describe, expect, it } from 'vitest'

import { useLoad } from './use-load.ts'

describe('metadata request ownership', () => {
  it('keeps the new result when an older load finishes after refetch', async () => {
    const first = Promise.withResolvers<string>()
    const second = Promise.withResolvers<string>()
    const requests = [first.promise, second.promise]
    const View = (): JSX.Element => {
      const request = useLoad(async () => await (requests.shift() ?? Promise.resolve('unexpected')))
      return (
        <button
          onClick={() => {
            void request.refetch()
          }}
        >
          {request.data ?? 'loading'}
        </button>
      )
    }
    const view = mount(<View />)
    await settle(() => view.host.querySelector('button')?.click())
    await settle(() => {
      second.resolve('new')
    })
    expect(view.host.textContent).toBe('new')
    await settle(() => {
      first.resolve('old')
    })
    expect(view.host.textContent).toBe('new')
    view.dispose()
  })
})
