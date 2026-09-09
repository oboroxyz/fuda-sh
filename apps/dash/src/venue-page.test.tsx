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
    tagline: 'Fresh coffee',
  },
  onCheckHandle: vi.fn<VenuePageProps['onCheckHandle']>().mockResolvedValue('available'),
  onCommitLogo: vi.fn<VenuePageProps['onCommitLogo']>().mockResolvedValue(true),
  onCreate: vi.fn<VenuePageProps['onCreate']>(),
  onNewCard: vi.fn<VenuePageProps['onNewCard']>(),
  onUpdate: vi.fn<VenuePageProps['onUpdate']>().mockResolvedValue(true),
  publicUrl: 'https://fuda.test/@coffee',
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

// Hono's form action listener reads detail on synthetic (untrusted) submissions.
const submitForm = (label: string): void => {
  button(label).form!.dispatchEvent(
    new CustomEvent('submit', { bubbles: true, cancelable: true, detail: {} }),
  )
}

const field = (name: string): HTMLInputElement =>
  root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!

const typeField = (name: string, value: string): void => {
  const input = field(name)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('venue registration and details', () => {
  beforeEach(() => {
    root = document.createElement('div')
    document.body.append(root)
  })

  afterEach(() => {
    render(<></>, root)
    root.remove()
    vi.restoreAllMocks()
  })

  it('starts with only handle, name and optional tagline, with only an unobtrusive optional label', () => {
    render(<VenuePage {...props()} issuer={null} />, root)

    expect([...root.querySelectorAll('input')].map((input) => input.name)).toStrictEqual([
      'handle',
      'name',
      'tagline',
    ])
    expect(['handle', 'name', 'tagline'].map((name) => field(name).required)).toStrictEqual([
      true,
      true,
      false,
    ])
    expect(root.textContent).not.toContain('Required')
    expect(field('tagline').closest('label')?.textContent).toContain('(optional)')
    expect(button('Register venue').disabled).toBe(true)
  })

  it('registers without a tagline, custom colour or logo', async () => {
    const input = props()
    render(<VenuePage {...input} issuer={null} />, root)
    typeField('handle', 'new-coffee')
    typeField('name', 'New Coffee')
    await vi.waitFor(() => {
      expect(button('Register venue').disabled).toBe(false)
    })
    submitForm('Register venue')
    expect(input.onCreate).toHaveBeenCalledExactlyOnceWith(
      { brandColor: '#0073EB', handle: 'new-coffee', name: 'New Coffee', tagline: '' },
      null,
    )
  })

  it('shows the saved venue name and public link before editable name and tagline', () => {
    render(<VenuePage {...props()} />, root)
    expect(root.querySelector('input[name="handle"]')).toBeNull()
    const form = field('name').closest('form')!
    expect([form.querySelector('p')?.textContent, field('name').value]).toStrictEqual(['Coffee', 'Coffee'])
    const link = form.querySelector('a')!
    expect(link).toMatchObject({
      href: 'https://fuda.test/@coffee',
      rel: 'noopener noreferrer',
      target: '_blank',
      textContent: 'https://fuda.test/@coffee',
    })
    expect(form.textContent).not.toMatch(/Venue handle|cannot be changed|read.only/iu)
    expect([field('name').required, field('tagline').required]).toStrictEqual([true, false])
  })

  it('saves the name and clears an optional tagline without sending the handle', async () => {
    const input = props()
    render(<VenuePage {...input} />, root)
    typeField('name', 'New Coffee')
    typeField('tagline', '')
    await vi.waitFor(() => {
      expect(button('Save venue').disabled).toBe(false)
    })
    submitForm('Save venue')
    await vi.waitFor(() => {
      expect(input.onUpdate).toHaveBeenCalledExactlyOnceWith({
        brandColor: '#5CF794',
        name: 'New Coffee',
        tagline: '',
      })
    })
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Venue saved.')
    })
  })

  it('keeps unsaved text after a failed update and permits retry', async () => {
    const input = props()
    vi.spyOn(input, 'onUpdate').mockResolvedValue(false)
    render(<VenuePage {...input} />, root)
    typeField('name', 'New Coffee')
    await vi.waitFor(() => {
      expect(button('Save venue').disabled).toBe(false)
    })
    submitForm('Save venue')
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Could not save the venue.')
    })
    expect(field('name').value).toBe('New Coffee')
    expect(button('Save venue').disabled).toBe(false)
  })
})

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
