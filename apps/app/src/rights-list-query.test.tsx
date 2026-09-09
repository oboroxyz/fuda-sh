// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { setTimeout } from 'node:timers/promises'

import type { GraphRight, Hex, VerifyResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { render, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MemberPassListIo } from './member-pass-list.ts'
import { memberPassListQueryOptions } from './member-pass-query.ts'
import { RightsList } from './member/RightsList.tsx'
import { PASS_MEMORY_KEY } from './pass-memory.ts'

vi.mock(import('./config.ts'), () => ({
  API_BASE_URL: 'https://api.example',
  GRAPH_RIGHTS_ENDPOINT: 'https://graph.example',
}))

const holderA = `0x${'11'.repeat(20)}` as const
const holderB = `0x${'22'.repeat(20)}` as const
const uidA = `0x${'aa'.repeat(32)}` as const
const uidB = `0x${'bb'.repeat(32)}` as const
const publicPreview: Result<VerifyResponse> = {
  body: {
    decision: 'ADMIT',
    entitlement: {
      holder: holderA,
      issuer: holderB,
      level: 1,
      schemaVersion: 1,
      tier: 2,
      usageModel: 1,
      validFrom: 0,
      validUntil: 999,
    },
    reason: 'OK',
  },
  ok: true,
}
const right = (id: Hex, holder: Hex): GraphRight => ({
  delegation: { active: true, id: uidA, issuer: holderB, name: 'root', revokedAt: null },
  holder,
  id,
  issuer: holderB,
  level: 1,
  metaURI: '',
  refUID: uidA,
  revokedAt: null,
  schemaVersion: 1,
  serial: uidA,
  tier: 2,
  usageModel: 1,
  validFrom: 0n,
  validUntil: 999n,
})
const fixture = () => ({
  appleAvailable: vi.fn<MemberPassListIo['appleAvailable']>().mockResolvedValue(false),
  fetchRights: vi.fn<MemberPassListIo['fetchRights']>().mockResolvedValue([]),
  googleHref: vi.fn<MemberPassListIo['googleHref']>().mockResolvedValue(null),
  stampSummary: vi.fn<MemberPassListIo['stampSummary']>().mockResolvedValue(null),
  verify: vi.fn<MemberPassListIo['verify']>().mockResolvedValue(publicPreview),
})
const root = document.createElement('div')
let removeMounted: (() => void) | undefined

const Mount = ({ children }: { children: JSX.Element }): JSX.Element | null => {
  const [mounted, setMounted] = useState(true)
  removeMounted = () => {
    setMounted(false)
  }
  return mounted ? children : null
}

const mount = (child: JSX.Element): void => {
  render(<Mount>{child}</Mount>, root)
}

const lookup = async (holder: Hex): Promise<void> => {
  if (root.querySelector('input') === null) {
    const disclosure = [...root.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Look up another public address'),
    )
    disclosure?.click()
    await setTimeout(0)
  }
  const input = root.querySelector('input')
  const form = root.querySelector('form')
  if (input === null || form === null) {
    throw new Error('Missing holder lookup')
  }
  input.value = holder
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await setTimeout(0)
  form.dispatchEvent(new CustomEvent('submit', { bubbles: true, cancelable: true, detail: {} }))
}

describe('member pass query lifecycle', () => {
  beforeEach(() => {
    // oxlint-disable-next-line unicorn/prefer-dom-node-append -- Worker HTMLRewriter types overload append; appendChild retains the DOM signature.
    document.body.appendChild(root)
    localStorage.clear()
    removeMounted = undefined
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  afterEach(async () => {
    removeMounted?.()
    await setTimeout(0)
    root.replaceChildren()
    root.remove()
    vi.restoreAllMocks()
  })

  it('uses a complete normalized public-data cache key', () => {
    const key = memberPassListQueryOptions(
      {
        addresses: [holderB.toUpperCase() as Hex, holderA],
        apiEndpoint: 'https://api.example',
        graphEndpoint: 'https://graph.example',
        memory: [{ addedAt: 7, holder: holderB.toUpperCase() as Hex, uid: uidB.toUpperCase() as Hex }],
      },
      fixture(),
    ).queryKey

    expect(key).toStrictEqual([
      'member-passes',
      'https://api.example',
      'https://graph.example',
      [holderA, holderB],
      [{ addedAt: 7, holder: holderB, uid: uidB }],
    ])
    expect(() => JSON.stringify(key)).not.toThrow()
  })

  it('refreshes stale public status on focus and replaces ACTIVE with REVOKED', async () => {
    const io = fixture()
    mount(
      <RightsList
        injected={null}
        io={io}
        memory={[{ addedAt: 1, holder: holderA, uid: uidA }]}
        queryUid={null}
      />,
    )
    await vi.waitFor(() => {
      expect(root.textContent).toContain('ACTIVE')
    })
    const refreshed = Promise.withResolvers<Result<VerifyResponse>>()
    io.verify.mockReturnValue(refreshed.promise)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000)
    window.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => {
      expect(io.verify).toHaveBeenCalledTimes(2)
    })
    expect(root.textContent).toContain('ACTIVE')
    refreshed.resolve({ body: { decision: 'REJECT', reason: 'REVOKED' }, ok: true })
    await vi.waitFor(() => {
      expect(root.textContent).toContain('REVOKED')
    })
    expect(root.textContent).not.toContain('ACTIVE')
  })

  it('does not replace the current holder set with an older pending list', async () => {
    const io = fixture()
    const pending = Promise.withResolvers<GraphRight[]>()
    io.fetchRights
      .mockReturnValueOnce(pending.promise)
      .mockImplementation(
        async (holder) => await Promise.resolve(holder === holderB ? [right(uidB, holderB)] : []),
      )
    mount(<RightsList injected={null} io={io} memory={[]} queryUid={null} />)
    await lookup(holderA)
    await vi.waitFor(() => {
      expect(io.fetchRights).toHaveBeenCalledWith(holderA)
    })
    await lookup(holderB)
    await vi.waitFor(() => {
      expect(root.textContent).toContain(uidB)
    })
    pending.resolve([right(uidA, holderA)])
    await setTimeout(25)
    expect(root.textContent).toContain(uidB)
    expect(root.textContent).not.toContain(uidA)
  })

  it('does not remember a query pass whose recovery finishes after unmount', async () => {
    const io = fixture()
    const pending = Promise.withResolvers<Result<VerifyResponse>>()
    io.verify.mockReturnValue(pending.promise)
    mount(<RightsList injected={null} io={io} memory={[]} queryUid={uidA} />)
    await vi.waitFor(() => {
      expect(io.verify).toHaveBeenCalledWith(uidA)
    })
    removeMounted?.()
    await setTimeout(0)
    pending.resolve(publicPreview)
    await setTimeout(25)
    expect(localStorage.getItem(PASS_MEMORY_KEY)).toBeNull()
  })

  it('remembers a query pass once while its list continues to refresh on focus', async () => {
    const io = fixture()
    mount(<RightsList injected={null} io={io} memory={[]} queryUid={uidA} />)
    await vi.waitFor(() => {
      expect(root.textContent).toContain('ACTIVE')
      expect(localStorage.getItem(PASS_MEMORY_KEY)).not.toBeNull()
    })
    await setTimeout(25)
    const callsBeforeFocus = io.verify.mock.calls.length
    const remembered = localStorage.getItem(PASS_MEMORY_KEY)

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000)
    window.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => {
      expect(io.verify).toHaveBeenCalledTimes(callsBeforeFocus + 1)
    })
    await setTimeout(25)
    expect(localStorage.getItem(PASS_MEMORY_KEY)).toBe(remembered)
  })
})
