// @vitest-environment happy-dom
import type { IssuerView, OperatorCardView } from '@fuda/sdk'
import { useState } from 'preact/hooks'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ArtworkSection } from './ArtworkSection.tsx'
import { DASH_COPY } from './copy.ts'
import { cleanup, mount } from './test/render.tsx'

const card: OperatorCardView = {
  artworkUrl: null,
  attendance: false,
  category: 'membership',
  claimFrom: null,
  claimUntil: null,
  claimable: true,
  description: '',
  id: 'art-card',
  identity: 'none',
  lockScreen: false,
  posterUrl: null,
  record: 'offchain',
  slug: 'coffee',
  title: 'Coffee',
  validFrom: null,
  validUntil: null,
  validityDays: null,
  venue: null,
}
const issuer: IssuerView = {
  brandColor: '#112233',
  createdAt: 1,
  handle: 'cafe',
  id: 'cafe',
  logoUrl: null,
  name: 'Cafe',
  operatorAddress: null,
  tagline: '',
}

const Editor = () => {
  const [current, setCurrent] = useState(card)
  return <ArtworkSection card={current} issuer={issuer} copy={DASH_COPY.en} onSaved={setCurrent} />
}
const choose = (host: HTMLElement, file: File) => {
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!
  const transfer = new DataTransfer()
  transfer.items.add(file)
  input.files = transfer.files
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll('button')].find((item) => item.textContent === label)!

describe.each(['artwork', 'poster'] as const)('Pass %s section', (kind) => {
  const variant = kind === 'artwork' ? 'strip3x' : 'poster3x'
  const savedUrl = `https://api.test/assets/${kind}/123/${variant}`
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('explains a refused source without sending an upload', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    const root = mount(<Editor />)
    const host = root.querySelector<HTMLElement>(`[data-testid=card-${kind}]`)!
    choose(host, new File(['text'], 'text.txt', { type: 'text/plain' }))
    await vi.waitFor(() => {
      expect(host.querySelector('[role=alert]')?.textContent).toBe(DASH_COPY.en.logo.rejections.type)
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(button(host, DASH_COPY.en.artwork.save).disabled).toBe(true)
  })

  it('refuses an undersized crop before uploading', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi
        .fn<() => Promise<{ close: () => void; height: number; width: number }>>()
        .mockResolvedValue({ close: vi.fn<() => void>(), height: 100, width: 100 }),
    )
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    const root = mount(<Editor />)
    const host = root.querySelector<HTMLElement>(`[data-testid=card-${kind}]`)!
    choose(host, new File(['png'], 'small.png', { type: 'image/png' }))
    await vi.waitFor(() => {
      expect(host.querySelector('[role=alert]')?.textContent).toBe(DASH_COPY.en[kind].tooSmall)
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('saves one prepared set, shows both Wallet layouts, and removes the saved image', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi
        .fn<() => Promise<{ close: () => void; height: number; width: number }>>()
        .mockResolvedValue({ close: vi.fn<() => void>(), height: 1344, width: 3300 }),
    )
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        context = { drawImage: vi.fn<() => void>() }
        blob = new Blob(['png'], { type: 'image/png' })
        getContext = () => this.context
        convertToBlob = async () => await Promise.resolve(this.blob)
      },
    )
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:artwork')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ card: { ...card, [kind === 'artwork' ? 'artworkUrl' : 'posterUrl']: savedUrl } }),
      )
      .mockResolvedValueOnce(Response.json({ card }))
    vi.stubGlobal('fetch', fetch)
    const root = mount(<Editor />)
    const host = root.querySelector<HTMLElement>(`[data-testid=card-${kind}]`)!
    choose(host, new File(['png'], 'art.png', { type: 'image/png' }))
    await vi.waitFor(() => {
      expect(button(host, DASH_COPY.en.artwork.save).disabled).toBe(false)
    })
    expect([...host.querySelectorAll('figcaption')].map((item) => item.textContent)).toStrictEqual(
      kind === 'artwork' ? ['Apple Wallet', 'Google Wallet'] : [],
    )
    button(host, DASH_COPY.en.artwork.save).click()
    await vi.waitFor(() => {
      expect(host.querySelector('img')?.getAttribute('src')).toContain(`/assets/${kind}/123/${variant}`)
    })
    const requestUrl = fetch.mock.calls[0]?.[0]
    expect([
      requestUrl,
      fetch.mock.calls[0]?.[1]?.body instanceof FormData,
      fetch.mock.calls[0]?.[1]?.method,
    ]).toStrictEqual([`/api/v1/issuers/me/cards/art-card/${kind}`, true, 'PUT'])
    button(host, DASH_COPY.en.logo.remove).click()
    await vi.waitFor(() => {
      expect(host.querySelector('img')).toBeNull()
    })
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'DELETE' })
  })
})
