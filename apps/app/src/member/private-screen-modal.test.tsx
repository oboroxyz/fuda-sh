// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { setTimeout } from 'node:timers/promises'

import { challengeMessage } from '@fuda/sdk'
import type { GraphAnnouncement, Hex } from '@fuda/sdk'
import { buildAnnouncementMetadata, generateStealthAddress } from '@fuda/stealth-address'
import { render } from 'hono/jsx/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as stealth from '../private-member.ts'
import { PrivateScreen } from './PrivateScreen.tsx'

vi.mock(import('../config.ts'), () => ({
  API_BASE_URL: 'http://localhost:8787',
  APP_ORIGIN: globalThis.location.origin,
  GRAPH_RIGHTS_ENDPOINT: 'https://graph.example/rights',
  RP_ID: 'localhost',
}))

const PRF = new Uint8Array(32).fill(42)
const UID: Hex = `0x${'ab'.repeat(32)}`
const NONCE: Hex = `0x${'cd'.repeat(16)}`
const keys = stealth.keysFromPrf(PRF)
const generated = generateStealthAddress(keys.metaAddress)
const row: GraphAnnouncement = {
  blockNumber: 1n,
  caller: `0x${'00'.repeat(20)}`,
  ephemeralPubKey: generated.ephemeralPublicKey,
  id: 'announcement',
  logIndex: 0n,
  metadata: buildAnnouncementMetadata(generated.viewTag, UID),
  schemeId: 1n,
  stealthAddress: generated.stealthAddress,
  timestamp: 0n,
  transactionHash: `0x${'00'.repeat(32)}`,
}
const credential = async () => await Promise.resolve({ ok: true as const, output: PRF })
const io = {
  fetchRows: async () => await Promise.resolve([row]),
  passkeys: async () => await Promise.resolve({ createPasskey: credential, loadPasskey: credential }),
  stealth: async () => await Promise.resolve(stealth),
}
const root = document.createElement('div')
const button = (label: string, scope: HTMLElement = root): HTMLButtonElement => {
  const match = [...scope.querySelectorAll('button')].find((node) =>
    (node.getAttribute('aria-label') ?? node.textContent)?.includes(label),
  )
  if (match === undefined) {
    throw new Error(`Missing button: ${label}`)
  }
  return match
}
const openDialog = (): HTMLDialogElement => {
  const dialog = root.querySelector<HTMLDialogElement>('dialog[open]')
  expect(dialog).not.toBeNull()
  if (dialog === null) {
    throw new Error('No open dialog')
  }
  return dialog
}
const unlock = async (): Promise<void> => {
  render(<PrivateScreen io={io} />, root)
  await setTimeout(0)
  button('Use existing passkey').click()
  await vi.waitFor(() => {
    expect(root.textContent).toContain('Your meta-address')
  })
  button('Discover my passes').click()
  await vi.waitFor(() => {
    expect(root.querySelectorAll('li')).toHaveLength(1)
  })
}

describe('Private discovery dialogs', () => {
  beforeEach(() => {
    // oxlint-disable-next-line unicorn/prefer-dom-node-append -- Worker HTMLRewriter types overload append; appendChild retains the DOM signature.
    document.body.appendChild(root)
  })
  afterEach(() => {
    render(<div />, root)
    root.replaceChildren()
    root.remove()
    vi.restoreAllMocks()
  })

  it('reveals full identifiers in details without starting entry and copies the complete meta-address', async () => {
    const network = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', network)
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await unlock()
    const list = root.querySelector('ul')
    expect(list?.textContent).not.toContain(UID)
    expect(list?.textContent).not.toContain(generated.stealthAddress)
    button('Copy').click()
    await vi.waitFor(() => {
      expect(clipboard).toHaveBeenCalledWith(keys.metaAddress)
    })
    const opener = button('Right details')
    opener.focus()
    opener.click()
    await vi.waitFor(() => {
      expect(openDialog().textContent).toContain(UID)
    })
    expect(openDialog().textContent).toContain(generated.stealthAddress)
    expect(network).not.toHaveBeenCalled()
    button('Close', openDialog()).click()
    await vi.waitFor(() => {
      expect(root.querySelector('dialog[open]')).toBeNull()
    })
    expect({ focus: document.activeElement, list: root.querySelector('ul') }).toStrictEqual({
      focus: opener,
      list,
    })
  })

  it.each(['ADMIT', 'REVOKED'] as const)(
    'keeps %s in a dismissible result dialog and permits a fresh attempt',
    async (decision) => {
      const pending = Promise.withResolvers<Response>()
      let verificationCount = 0
      let challengeCount = 0
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async (url) => {
          if (new Request(url).url.endsWith('/challenge')) {
            challengeCount += 1
            return Response.json({ challenge: challengeMessage(UID, NONCE), nonce: NONCE })
          }
          verificationCount += 1
          const response = await pending.promise
          return response.clone()
        }),
      )
      await unlock()
      const list = root.querySelector('ul')
      const opener = button('Sign & verify')
      opener.focus()
      opener.click()
      await vi.waitFor(() => {
        expect(openDialog().textContent).toContain('Signing & verifying')
      })
      await vi.waitFor(() => {
        expect(verificationCount).toBe(1)
      })
      opener.click()
      expect({ disabled: opener.disabled, requests: verificationCount }).toStrictEqual({
        disabled: true,
        requests: 1,
      })
      button('Close', openDialog()).click()
      await vi.waitFor(() => {
        expect(root.querySelector('dialog[open]')).toBeNull()
      })
      expect(document.activeElement).toBe(button('Right details'))
      pending.resolve(
        Response.json(
          decision === 'ADMIT'
            ? { decision: 'ADMIT', holder: generated.stealthAddress, path: 'signature', reason: 'OK' }
            : { decision: 'REJECT', reason: 'REVOKED' },
        ),
      )
      await vi.waitFor(() => {
        expect(opener.disabled).toBe(false)
      })
      await vi.waitFor(() => {
        expect(root.querySelector('dialog[open]')).toBeNull()
      })
      opener.click()
      await vi.waitFor(() => {
        expect(openDialog().textContent).toContain(decision)
      })
      expect(openDialog().textContent).toContain('0xabababab…ababab')
      expect(challengeCount).toBe(2)
      button('Close', openDialog()).click()
      await vi.waitFor(() => {
        expect(root.querySelector('dialog[open]')).toBeNull()
      })
      expect({ focus: document.activeElement, list: root.querySelector('ul') }).toStrictEqual({
        focus: opener,
        list,
      })
    },
  )
})
