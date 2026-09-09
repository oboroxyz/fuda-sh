// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { render } from 'hono/jsx/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DASH_COPY } from './copy.ts'
import * as logoTools from './logo.ts'
import { VenuePage } from './VenuePage.tsx'
import type { VenuePageProps } from './VenuePage.tsx'

const png = new Blob(['image'], { type: 'image/png' })
const variants = { logo1x: png, logo2x: png, logo3x: png, master: png }
const props = (): VenuePageProps => ({
  busy: false,
  canCreateCard: false,
  copy: DASH_COPY.en,
  ens: null,
  failure: null,
  issuer: {
    brandColor: '#5CF794',
    createdAt: 1,
    handle: 'coffee',
    id: 'issuer-1',
    logoUrl: null,
    name: 'Coffee',
    operatorAddress: `0x${'ab'.repeat(20)}`,
    tagline: '',
  },
  onCheckHandle: vi.fn<VenuePageProps['onCheckHandle']>().mockResolvedValue('available'),
  onCommitLogo: vi.fn<VenuePageProps['onCommitLogo']>().mockResolvedValue(true),
  onCreate: vi.fn<VenuePageProps['onCreate']>(),
  onNewCard: vi.fn<VenuePageProps['onNewCard']>(),
  publicUrl: null,
  stampSettings: {
    load: vi.fn<VenuePageProps['stampSettings']['load']>().mockResolvedValue({
      body: { dailyLimit: 1, enabled: false, goal: 10 },
      ok: true,
    }),
    save: vi.fn<VenuePageProps['stampSettings']['save']>(),
  },
})

let root: HTMLDivElement

const pickImage = (): void => {
  const input = root.querySelector<HTMLInputElement>('input[type=file]')!
  const transfer = new DataTransfer()
  transfer.items.add(new File(['image'], 'logo.png', { type: 'image/png' }))
  input.files = transfer.files
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const button = (label: string): HTMLButtonElement =>
  [...root.querySelectorAll('button')].find((element) => element.textContent === label)!

describe('venue logo preview', () => {
  beforeEach(() => {
    root = document.createElement('div')
    document.body.append(root)
    vi.spyOn(logoTools, 'generateLogoSet').mockResolvedValue({ ok: true, variants })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:logo-preview')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    render(<></>, root)
    root.remove()
    vi.restoreAllMocks()
  })

  it('previews a replacement locally and uploads only when the operator confirms', async () => {
    const input = props()
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
    render(<VenuePage {...input} />, root)
    pickImage()
    await vi.waitFor(() => {
      expect(root.querySelector('img[src="blob:logo-preview"]')).not.toBeNull()
    })
    expect(input.onCommitLogo).not.toHaveBeenCalled()
    button('Upload logo').click()
    await vi.waitFor(() => {
      expect(input.onCommitLogo).toHaveBeenCalledExactlyOnceWith(variants)
    })
    await vi.waitFor(() => {
      expect(root.querySelector('img[src="blob:logo-preview"]')).toBeNull()
    })
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:logo-preview')
  })

  it('discards a replacement without uploading it', async () => {
    const input = props()
    render(<VenuePage {...input} />, root)
    pickImage()
    await vi.waitFor(() => {
      expect(root.querySelector('img[src="blob:logo-preview"]')).not.toBeNull()
    })
    button('Remove').click()
    await vi.waitFor(() => {
      expect(root.querySelector('img[src="blob:logo-preview"]')).toBeNull()
    })
    expect(input.onCommitLogo).not.toHaveBeenCalled()
  })

  it('keeps the preview available to retry a failed upload', async () => {
    const input = props()
    vi.spyOn(input, 'onCommitLogo').mockResolvedValue(false)
    render(<VenuePage {...input} />, root)
    pickImage()
    await vi.waitFor(() => {
      expect(root.querySelector('img[src="blob:logo-preview"]')).not.toBeNull()
    })
    button('Upload logo').click()
    await vi.waitFor(() => {
      expect(root.textContent).toContain(DASH_COPY.en.logo.updateFailed)
    })
    expect(root.querySelector('img[src="blob:logo-preview"]')).not.toBeNull()
    expect(button('Upload logo').disabled).toBe(false)
  })
})
