// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { setTimeout } from 'node:timers/promises'

import type { AuthorizePreviewResponse } from '@fuda/sdk'
import { render } from 'hono/jsx/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CONSENT_COPY } from './consent-copy.ts'
import { deniedRedirect, readAuthorizeRequest } from './consent.ts'
import { OAuthConsentPage } from './OAuthConsentPage.tsx'
import type { ConsentIo } from './OAuthConsentPage.tsx'

const SEARCH =
  '?response_type=code&client_id=app_1&redirect_uri=https%3A%2F%2Fshop.figma.site%2F&scope=cards%3Awrite' +
  `&state=s1&code_challenge=${'c'.repeat(43)}&code_challenge_method=S256`

const PREVIEW: AuthorizePreviewResponse = {
  app: { clientId: 'app_1', name: 'Shop app' },
  issuers: [
    { handle: 'wassie-coffee', id: 'issuer-1', logoUrl: null, name: 'Wassie Coffee' },
    { handle: 'wassie-bar', id: 'issuer-2', logoUrl: null, name: 'Wassie Bar' },
  ],
  redirectUri: 'https://shop.figma.site/',
  scope: ['cards:write'],
}

let root: HTMLDivElement

const ioWith = (overrides: Partial<ConsentIo> = {}): ConsentIo => ({
  approve: vi.fn<ConsentIo['approve']>().mockResolvedValue({
    body: { redirectTo: 'https://shop.figma.site/?code=abc&state=s1' },
    ok: true,
  }),
  assign: vi.fn<ConsentIo['assign']>(),
  clearToken: vi.fn<ConsentIo['clearToken']>(),
  preview: vi.fn<ConsentIo['preview']>().mockResolvedValue({ body: PREVIEW, ok: true }),
  readToken: () => 'session',
  saveToken: vi.fn<ConsentIo['saveToken']>(),
  signIn: vi.fn<ConsentIo['signIn']>().mockResolvedValue({ ok: true, token: 'fresh' }),
  ...overrides,
})

const show = async (io: ConsentIo, search = SEARCH): Promise<void> => {
  render(
    <OAuthConsentPage
      copy={CONSENT_COPY.en}
      dashboardUrl="/"
      io={io}
      request={readAuthorizeRequest(search)}
    />,
    root,
  )
  await setTimeout(0)
}

const buttonNamed = (name: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent.includes(name))
  if (found === undefined) {
    throw new Error(`missing button ${name}`)
  }
  return found
}

describe(OAuthConsentPage, () => {
  beforeEach(() => {
    root = document.createElement('div')
    document.body.append(root)
  })
  afterEach(() => {
    root.remove()
  })

  it('approves for the chosen issuer and leaves for the redirect the api built', async () => {
    const io = ioWith()
    await show(io)
    expect(root.textContent).toContain('Shop app')
    root.querySelector<HTMLInputElement>('input[value="issuer-2"]')?.click()
    await setTimeout(0)
    buttonNamed('Approve').click()
    await setTimeout(0)
    expect(io.approve).toHaveBeenCalledWith('session', {
      clientId: 'app_1',
      codeChallenge: 'c'.repeat(43),
      codeChallengeMethod: 'S256',
      issuerId: 'issuer-2',
      redirectUri: 'https://shop.figma.site/',
      scope: 'cards:write',
      state: 's1',
    })
    expect(io.assign).toHaveBeenCalledWith('https://shop.figma.site/?code=abc&state=s1')
  })

  it('sends a refusal back with access_denied and the state', async () => {
    const io = ioWith()
    await show(io)
    buttonNamed('Cancel').click()
    expect(io.assign).toHaveBeenCalledWith('https://shop.figma.site/?error=access_denied&state=s1')
  })

  it('asks for the passkey when there is no session, then checks the request', async () => {
    const io = ioWith({ readToken: () => null })
    await show(io)
    expect(io.preview).not.toHaveBeenCalled()
    buttonNamed('Sign in with passkey').click()
    await setTimeout(0)
    await setTimeout(0)
    expect(io.saveToken).toHaveBeenCalledWith('fresh')
    expect(io.preview).toHaveBeenCalledOnce()
  })

  it('shows a rejected request and never redirects', async () => {
    const io = ioWith({
      preview: vi.fn<ConsentIo['preview']>().mockResolvedValue({
        error: 'bad_redirect_uri',
        network: false,
        ok: false,
        status: 400,
      }),
    })
    await show(io)
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(CONSENT_COPY.en.failures.bad_redirect_uri)
    expect(root.querySelectorAll('button')).toHaveLength(0)
    expect(io.assign).not.toHaveBeenCalled()
  })

  it('refuses a request without a PKCE challenge before asking the api', async () => {
    const io = ioWith()
    await show(io, SEARCH.replace(/&code_challenge=[^&]*/u, ''))
    expect(io.preview).not.toHaveBeenCalled()
    expect(root.textContent).toContain(CONSENT_COPY.en.failures.invalid_request)
  })
})

describe(deniedRedirect, () => {
  it('keeps the registered query and leaves out an empty state', () => {
    expect(deniedRedirect('https://shop.example/cb?x=1', '')).toBe(
      'https://shop.example/cb?x=1&error=access_denied',
    )
  })
})
