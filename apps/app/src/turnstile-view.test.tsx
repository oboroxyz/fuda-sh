// @vitest-environment happy-dom
import { mount, settle } from '@fuda/ui/test'
import type { JSX } from 'preact'
import { useRef, useState } from 'preact/hooks'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestClaimToken } from './turnstile.ts'
import type { TurnstileApi } from './turnstile.ts'

const View = (): JSX.Element => {
  const [revision, setRevision] = useState(0)
  const host = useRef<HTMLDivElement>(null)
  return (
    <>
      <div ref={host} />
      <button
        onClick={() => {
          void requestClaimToken('test-site', host.current)
        }}
      >
        claim
      </button>
      <button
        onClick={() => {
          setRevision(revision + 1)
        }}
      >
        {revision}
      </button>
    </>
  )
}
describe('Turnstile across rerenders', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shares its script across claims and removes each completed widget', async () => {
    vi.spyOn(HTMLScriptElement.prototype, 'src', 'set').mockImplementation(function captureScript(
      this: HTMLScriptElement,
      value: string,
    ) {
      this.dataset.turnstileSrc = value
    })
    const options: Parameters<TurnstileApi['render']>[1][] = []
    const remove = vi.fn<TurnstileApi['remove']>()
    window.turnstile = {
      remove,
      render: (_host, input) => {
        options.push(input)
        return String(options.length)
      },
    }
    const view = mount(<View />)
    const buttons = view.host.querySelectorAll('button')
    await settle(() => {
      buttons[0]?.click()
    })
    const script = document.head.querySelector<HTMLScriptElement>('script[data-turnstile-src*="turnstile"]')
    if (script === null) {
      throw new Error('Script was not requested')
    }
    await settle(() => {
      script.dispatchEvent(new Event('load'))
    })
    await settle(() => {
      buttons[1]?.click()
    })
    expect(options).toHaveLength(1)
    await settle(() => {
      options[0]?.callback('first')
    })
    await settle(() => {
      buttons[0]?.click()
    })
    expect(document.head.querySelectorAll('script[data-turnstile-src*="turnstile"]')).toHaveLength(1)
    await settle(() => {
      options[1]?.callback('second')
    })
    expect(remove.mock.calls).toStrictEqual([['1'], ['2']])
    view.dispose()
    script.remove()
    delete window.turnstile
  })
})
