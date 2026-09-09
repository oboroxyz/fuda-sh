// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { setTimeout } from 'node:timers/promises'

import type { IssuerMeResponse, IssuerView } from '@fuda/sdk'
import { render } from 'hono/jsx/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App.tsx'
import { DASH_COPY } from './copy.ts'
import * as logoTools from './logo.ts'
import { DEFAULT_OPERATOR_IO } from './operator-io.ts'
import type { OperatorIo } from './operator-io.ts'
import { saveOperatorToken } from './operator-session.ts'

const issuer: IssuerView = {
  brandColor: '#112233',
  createdAt: 1,
  handle: 'coffee',
  id: 'issuer-1',
  logoUrl: '/old-logo.png',
  name: 'Fuda Coffee Roasters',
  operatorAddress: `0x${'11'.repeat(20)}`,
  tagline: 'A specialty coffee shop in Shibuya',
}
const operatorState: IssuerMeResponse = {
  cards: [],
  ens: { claimTxHash: null, expiry: null, name: 'coffee.fuda.eth', status: 'claimed' },
  issuer,
  publicUrl: 'https://fuda.sh/@coffee',
}

const fixture = () => {
  let savedIssuer = issuer
  return {
    ...DEFAULT_OPERATOR_IO,
    checkSlug: vi.fn<OperatorIo['checkSlug']>().mockResolvedValue({
      body: { available: true, slug: 'coffee-club', valid: true },
      ok: true,
    }),
    design: {
      ...DEFAULT_OPERATOR_IO.design,
      commitLogo: vi.fn<OperatorIo['design']['commitLogo']>().mockImplementation(async () => {
        savedIssuer = { ...savedIssuer, logoUrl: '/new-logo.png' }
        return await Promise.resolve({ body: { issuer: savedIssuer }, ok: true })
      }),
      createCard: vi.fn<OperatorIo['design']['createCard']>().mockImplementation(
        async (_token, body) =>
          await Promise.resolve({
            body: {
              card: { ...body, claimable: true, id: 'card-1' },
              issuer: savedIssuer,
              publicUrl: operatorState.publicUrl,
            },
            ok: true,
          }),
      ),
      uploadLogo: vi.fn<OperatorIo['design']['uploadLogo']>().mockResolvedValue({
        body: { expiresAt: 100, logoUploadId: 'upload-1' },
        ok: true,
      }),
    },
    issuerMe: vi
      .fn<OperatorIo['issuerMe']>()
      .mockImplementation(
        async () => await Promise.resolve({ body: { ...operatorState, issuer: savedIssuer }, ok: true }),
      ),
    updateIssuer: vi.fn<OperatorIo['updateIssuer']>().mockImplementation(async (_token, body) => {
      savedIssuer = { ...savedIssuer, ...body }
      return await Promise.resolve({ body: { issuer: savedIssuer }, ok: true })
    }),
  }
}

let root: HTMLDivElement
const link = (text: string): HTMLAnchorElement => {
  const found = [...root.querySelectorAll('a')].find((element) => element.textContent === text)
  if (found === undefined) {
    throw new Error(`Missing link: ${text}`)
  }
  return found
}
const type = async (selector: string, value: string): Promise<void> => {
  const field = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await setTimeout(0)
}
const select = async (selector: string, value: string): Promise<void> => {
  const field = root.querySelector<HTMLSelectElement>(selector)!
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await setTimeout(0)
}
const start = async (operator: OperatorIo, path = '/cards/new'): Promise<void> => {
  window.history.replaceState(null, '', path)
  saveOperatorToken('session')
  render(<App initialTheme="light" operatorIo={operator} />, root)
  await vi.waitFor(() => {
    expect(root.querySelector('form')).not.toBeNull()
  })
}
const editProfile = async (): Promise<void> => {
  link('Edit profile').click()
  await vi.waitFor(() => {
    expect(root.querySelector('input[name="name"]')).not.toBeNull()
  })
}
const returnToCard = async (source = 'nav'): Promise<void> => {
  const cards = root.querySelector<HTMLAnchorElement>(`${source} a[href="/cards"]`)!
  const click = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true })
  cards.dispatchEvent(click)
  if (!click.defaultPrevented) {
    throw new Error('Card navigation would reload the document and discard the draft')
  }
  await vi.waitFor(() => {
    expect(window.location.pathname).toBe('/cards')
  })
  const create =
    root.querySelector<HTMLAnchorElement>('main a[href="/cards/new"]') ??
    [...root.querySelectorAll('button')].find(
      (button) => button.textContent === DASH_COPY.en.published.createFirst,
    )
  if (create === undefined) {
    throw new Error('Missing card creation action')
  }
  create.click()
  await vi.waitFor(() => {
    expect(root.querySelector('#card-title')).not.toBeNull()
  })
}

const pickLogo = async (): Promise<void> => {
  const png = new Blob(['image'], { type: 'image/png' })
  vi.spyOn(logoTools, 'generateLogoSet').mockResolvedValue({
    ok: true,
    variants: { logo1x: png, logo2x: png, logo3x: png, master: png },
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const transfer = new DataTransfer()
  transfer.items.add(new File(['image'], 'logo.png', { type: 'image/png' }))
  const upload = root.querySelector<HTMLInputElement>('input[type=file]')!
  upload.files = transfer.files
  upload.dispatchEvent(new Event('input', { bubbles: true }))
  await vi.waitFor(() => {
    expect(root.querySelector('img[src="blob:preview"]')).not.toBeNull()
  })
}

describe('editing the profile from a card draft', () => {
  beforeEach(() => {
    window.localStorage.clear()
    root = document.createElement('div')
    document.body.append(root)
  })

  afterEach(async () => {
    render(null, root)
    await setTimeout(0)
    root.remove()
    vi.restoreAllMocks()
  })

  it('preserves card fields and uses the saved profile and logo after returning', async () => {
    const operator = fixture()
    await start(operator)
    await type('#card-title', 'Coffee Club')
    await type('#card-slug', 'custom-link')
    await type('#card-description', 'Keep this card description')
    await select('#category', 'ticket')
    await vi.waitFor(() => {
      expect(root.querySelector('#valid-until')).not.toBeNull()
    })
    await type('#claim-from', '2027-01-01T09:00')
    await type('#valid-until', '2027-12-31T18:00')
    await editProfile()
    await type('input[name="name"]', 'New Coffee Name')
    await type('input[name="tagline"]', 'New profile description')

    await pickLogo()
    root
      .querySelector('form')!
      .dispatchEvent(new CustomEvent('submit', { bubbles: true, cancelable: true, detail: {} }))
    await vi.waitFor(() => {
      expect(root.textContent).toContain(DASH_COPY.en.venue.saved)
    })
    await returnToCard('main .dash-actions')

    expect({
      category: root.querySelector<HTMLSelectElement>('#category')?.value,
      claimFrom: root.querySelector<HTMLInputElement>('#claim-from')?.value,
      description: root.querySelector<HTMLTextAreaElement>('#card-description')?.value,
      logo: root.querySelector('.dash-card-preview img')?.getAttribute('src'),
      preview: root.querySelector('.dash-card-preview')?.textContent,
      slug: root.querySelector<HTMLInputElement>('#card-slug')?.value,
      title: root.querySelector<HTMLInputElement>('#card-title')?.value,
      validUntil: root.querySelector<HTMLInputElement>('#valid-until')?.value,
    }).toMatchObject({
      category: 'ticket',
      claimFrom: '2027-01-01T09:00',
      description: 'Keep this card description',
      logo: '/new-logo.png',
      preview: expect.stringMatching(/New Coffee Name.*New profile description/u) as unknown,
      slug: 'custom-link',
      title: 'Coffee Club',
      validUntil: '2027-12-31T18:00',
    })
    await type('#card-title', 'Renamed Card')
    expect(root.querySelector<HTMLInputElement>('#card-slug')?.value).toBe('custom-link')
  })

  it('keeps the card draft and saved branding when the profile save fails', async () => {
    const operator = fixture()
    operator.updateIssuer.mockResolvedValue({ error: 'offline', network: true, ok: false, status: 503 })
    await start(operator)
    await type('#card-title', 'Unsaved Card')
    await editProfile()
    await type('input[name="name"]', 'Rejected Name')
    root
      .querySelector('form')!
      .dispatchEvent(new CustomEvent('submit', { bubbles: true, cancelable: true, detail: {} }))
    await vi.waitFor(() => {
      expect(root.textContent).toContain(DASH_COPY.en.venue.saveFailed)
    })
    await returnToCard()
    expect(root.querySelector<HTMLInputElement>('#card-title')?.value).toBe('Unsaved Card')
    expect(root.querySelector('.dash-card-preview')?.textContent).toContain(issuer.name)
    expect(root.querySelector('.dash-card-preview')?.textContent).not.toContain('Rejected Name')
  })

  it('does not offer a separate return link when editing the profile from a card draft', async () => {
    await start(fixture())
    await editProfile()
    expect(root.textContent).not.toContain('Back to card creation')
  })

  it('uses a committed logo even when saving the other profile fields fails', async () => {
    const operator = fixture()
    operator.updateIssuer.mockResolvedValue({ error: 'offline', network: true, ok: false, status: 503 })
    await start(operator)
    await editProfile()
    await type('input[name="name"]', 'Rejected Name')
    await pickLogo()
    root
      .querySelector('form')!
      .dispatchEvent(new CustomEvent('submit', { bubbles: true, cancelable: true, detail: {} }))
    await vi.waitFor(() => {
      expect(root.textContent).toContain(DASH_COPY.en.venue.saveFailed)
    })
    await returnToCard()
    expect(root.querySelector('.dash-card-preview')?.textContent).toContain(issuer.name)
    expect(root.querySelector('.dash-card-preview img')?.getAttribute('src')).toBe('/new-logo.png')
  })

  it('restores the draft through browser Back and retains further edits on the next profile visit', async () => {
    await start(fixture())
    await type('#card-title', 'First Draft')
    await editProfile()
    window.history.back()
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLInputElement>('#card-title')?.value).toBe('First Draft')
    })
    await type('#card-title', 'Revised Draft')
    await editProfile()
    await returnToCard()
    expect(root.querySelector<HTMLInputElement>('#card-title')?.value).toBe('Revised Draft')
  })

  it('keeps the latest edits when browser history revisits Profile through the card list', async () => {
    await start(fixture())
    await type('#card-title', 'First Draft')
    await editProfile()
    await returnToCard()
    await type('#card-title', 'Latest Draft')
    window.history.go(-2)
    await vi.waitFor(() => {
      expect(root.querySelector('input[name="name"]')).not.toBeNull()
    })
    await returnToCard()
    expect(root.querySelector<HTMLInputElement>('#card-title')?.value).toBe('Latest Draft')
  })

  it('clears the saved draft after successfully creating the card', async () => {
    const operator = fixture()
    await start(operator)
    await type('#card-title', 'Finished Card')
    await editProfile()
    await returnToCard()
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLButtonElement>('form button[type=submit]')?.disabled).toBe(false)
    })
    root
      .querySelector('form')!
      .dispatchEvent(new CustomEvent('submit', { bubbles: true, cancelable: true, detail: {} }))
    await vi.waitFor(() => {
      expect(window.location.pathname).toBe('/cards')
    })
    await returnToCard()
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLInputElement>('#card-title')?.value).toBe('Membership')
    })
    expect(operator.design.createCard).toHaveBeenCalledOnce()
  })
})
