// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { setTimeout } from 'node:timers/promises'

import { render, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PrivateScreen } from './PrivateScreen.tsx'

vi.mock(import('../config.ts'), () => ({
  API_BASE_URL: 'http://localhost:8787',
  APP_ORIGIN: globalThis.location.origin,
  GRAPH_RIGHTS_ENDPOINT: 'https://graph.example/rights',
  RP_ID: 'localhost',
}))

const root = document.createElement('div')
type PrivateIo = NonNullable<Parameters<typeof PrivateScreen>[0]['io']>

const Harness = ({ io }: { io: PrivateIo }): JSX.Element => {
  const [mounted, setMounted] = useState(true)
  return (
    <>
      {mounted ? <PrivateScreen io={io} /> : null}
      <button
        type="button"
        onClick={() => {
          setMounted(false)
        }}
      >
        Leave screen
      </button>
    </>
  )
}

const click = (label: string): void => {
  const button = [...root.querySelectorAll('button')].find((node) => node.textContent?.includes(label))
  if (button === undefined) {
    throw new Error(`missing ${label}`)
  }
  button.click()
}

describe('PrivateScreen lifetime', () => {
  afterEach(() => {
    render(<div />, root)
    root.replaceChildren()
  })

  it('does not derive keys after an in-flight PRF screen unmounts and remounts locked', async () => {
    const pending = Promise.withResolvers<{ ok: true; output: Uint8Array }>()
    const keysFromPrf = vi.fn<(output: Uint8Array) => { metaAddress: string }>(() => ({
      metaAddress: '0x01',
    }))
    const loadPasskey = vi.fn<(rpId: string) => Promise<{ ok: true; output: Uint8Array }>>(
      async () => await pending.promise,
    )
    const io = {
      fetchRows: async () => await Promise.resolve([]),
      passkeys: async () =>
        await Promise.resolve({
          createPasskey: async () => await pending.promise,
          loadPasskey,
        }),
      stealth: async () =>
        await Promise.resolve({
          discover: vi.fn<() => never[]>(),
          keysFromPrf,
          stealthSigner: vi.fn<() => () => Promise<never>>(),
        }),
    }
    render(<Harness io={io as never} />, root)
    await setTimeout(0)
    click('Use existing passkey')
    await vi.waitFor(() => {
      expect(loadPasskey).toHaveBeenCalledOnce()
    })

    click('Leave screen')
    await setTimeout(0)
    pending.resolve({ ok: true, output: new Uint8Array(32) })
    await setTimeout(0)

    expect(keysFromPrf).not.toHaveBeenCalled()
    render(<Harness io={io as never} />, root)
    expect(root.textContent).toContain('Use existing passkey')
    expect(root.textContent).not.toContain('Your meta-address')
  })

  it('does not discover passes after an in-flight announcement read unmounts', async () => {
    const pending = Promise.withResolvers<never[]>()
    const discover = vi.fn<() => never[]>(() => [])
    const fetchRows = vi.fn<(endpoint: string, from: bigint) => Promise<never[]>>(
      async () => await pending.promise,
    )
    const keys = { metaAddress: '0x01' }
    const io = {
      fetchRows,
      passkeys: async () =>
        await Promise.resolve({
          createPasskey: async () => await Promise.resolve({ ok: true, output: new Uint8Array(32) }),
          loadPasskey: async () => await Promise.resolve({ ok: true, output: new Uint8Array(32) }),
        }),
      stealth: async () =>
        await Promise.resolve({
          discover,
          keysFromPrf: () => keys,
          stealthSigner: vi.fn<() => () => Promise<never>>(),
        }),
    }
    render(<Harness io={io as never} />, root)
    await setTimeout(0)
    click('Use existing passkey')
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Discover my passes')
    })
    click('Discover my passes')
    await vi.waitFor(() => {
      expect(fetchRows).toHaveBeenCalledWith('https://graph.example/rights', 0n)
    })

    click('Leave screen')
    await setTimeout(0)
    pending.resolve([])
    await setTimeout(0)

    expect(discover).not.toHaveBeenCalled()
  })
})
