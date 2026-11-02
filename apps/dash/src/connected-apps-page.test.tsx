// @vitest-environment happy-dom
import { setTimeout } from 'node:timers/promises'

import type { JSX } from 'solid-js'
import { render as solidRender } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { APPS_COPY } from './apps-copy.ts'
import { ConnectedAppsPage, redirectLines } from './ConnectedAppsPage.tsx'
import type { ConnectedAppsIo } from './ConnectedAppsPage.tsx'

const disposers: (() => void)[] = []
const render = (view: () => JSX.Element, host: HTMLElement): void => {
  disposers.push(solidRender(view, host))
}
let root: HTMLDivElement

const APP = { clientId: 'app_1', createdAt: 1, name: 'Shop app', redirectUris: ['https://shop.figma.site/'] }
const GRANT = {
  appName: 'Shop app',
  clientId: 'app_1',
  createdAt: 1,
  expiresAt: 2_000_000_000,
  id: 'grant-1',
  issuer: { handle: 'wassie-coffee', id: 'issuer-1', logoUrl: null, name: 'Wassie Coffee' },
  lastUsedAt: null,
  scope: ['cards:read' as const, 'cards:write' as const],
}

const ioWith = (): ConnectedAppsIo => ({
  activity: vi.fn<ConnectedAppsIo['activity']>().mockResolvedValue({
    body: {
      events: [
        {
          action: 'revoke_pass',
          appName: 'Agent',
          createdAt: 1_800_000_000,
          error: null,
          id: 'event-1',
          issuerHandle: 'coffee',
          subject: 'uid-1',
        },
        {
          action: 'issue_pass',
          appName: 'Agent',
          createdAt: 1_800_000_000,
          error: 'card_sold_out',
          id: 'event-2',
          issuerHandle: 'coffee',
          subject: 'card-1',
        },
      ],
    },
    ok: true,
  }),
  grants: vi.fn<ConnectedAppsIo['grants']>().mockResolvedValue({ body: { grants: [GRANT] }, ok: true }),
  list: vi.fn<ConnectedAppsIo['list']>().mockResolvedValue({ body: { apps: [APP] }, ok: true }),
  register: vi.fn<ConnectedAppsIo['register']>().mockResolvedValue({
    error: 'bad_redirect_uri',
    network: false,
    ok: false,
    status: 400,
  }),
  remove: vi.fn<ConnectedAppsIo['remove']>().mockResolvedValue({ body: { deleted: true }, ok: true }),
  revoke: vi.fn<ConnectedAppsIo['revoke']>().mockResolvedValue({ body: { revoked: true }, ok: true }),
})

const buttonNamed = (name: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent === name)
  if (found === undefined) {
    throw new Error(`missing button ${name}`)
  }
  return found
}

describe(ConnectedAppsPage, () => {
  beforeEach(() => {
    root = document.createElement('div')
    document.body.append(root)
  })
  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose()
    }
    root.remove()
  })

  it('lists apps with their client id and the live approvals', async () => {
    render(() => <ConnectedAppsPage copy={APPS_COPY.en} io={ioWith()} />, root)
    await setTimeout(0)
    expect(root.textContent).toContain('app_1')
    expect(root.textContent).toContain('Wassie Coffee')
  })

  it('shows when an approval was last used, and what apps did, including failures', async () => {
    render(() => <ConnectedAppsPage copy={APPS_COPY.en} io={ioWith()} />, root)
    await setTimeout(0)
    expect(root.textContent).toContain('Not used yet')
    expect(root.textContent).toContain('Revoked a pass')
    expect(root.textContent).toContain('uid-1')
    expect(root.textContent).toContain('Failed (card_sold_out)')
  })

  it('revokes an approval, and deletes an app only on the second press', async () => {
    const io = ioWith()
    render(() => <ConnectedAppsPage copy={APPS_COPY.en} io={io} />, root)
    await setTimeout(0)
    buttonNamed('Revoke').click()
    await setTimeout(0)
    buttonNamed('Delete').click()
    await setTimeout(0)
    expect(io.remove).not.toHaveBeenCalled()
    buttonNamed(APPS_COPY.en.confirmDelete).click()
    await setTimeout(0)
    expect([io.revoke, io.remove].map((fn) => vi.mocked(fn).mock.calls)).toStrictEqual([
      [['grant-1']],
      [['app_1']],
    ])
  })

  it('explains a refused return address', async () => {
    const io = ioWith()
    render(() => <ConnectedAppsPage copy={APPS_COPY.en} io={io} />, root)
    await setTimeout(0)
    const name = root.querySelector('input')
    const uris = root.querySelector('textarea')
    if (name === null || uris === null) {
      throw new Error('missing form')
    }
    name.value = 'Shop'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    uris.value = 'http://shop.example/\n'
    uris.dispatchEvent(new Event('input', { bubbles: true }))
    await setTimeout(0)
    root
      .querySelector('form')
      ?.dispatchEvent(new CustomEvent('submit', { bubbles: true, cancelable: true, detail: {} }))
    await setTimeout(0)
    expect(io.register).toHaveBeenCalledWith({ name: 'Shop', redirectUris: ['http://shop.example/'] })
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      APPS_COPY.en.registerFailed.bad_redirect_uri,
    )
  })
})

describe(redirectLines, () => {
  it('reads one trimmed address per non-empty line', () => {
    expect(redirectLines(' https://a.example/ \n\nhttps://b.example/cb\n')).toStrictEqual([
      'https://a.example/',
      'https://b.example/cb',
    ])
  })
})
