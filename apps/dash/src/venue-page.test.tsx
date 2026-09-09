// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { render } from 'hono/jsx/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DASH_COPY } from './copy.ts'
import { EnsClaim } from './EnsClaim.tsx'
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
  onUpdate: vi.fn<VenuePageProps['onUpdate']>().mockResolvedValue(true),
  publicUrl: 'https://fuda.test/@coffee',
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

  it('links to the card list and designer from the profile', () => {
    render(<VenuePage {...props()} canCreateCard />, root)
    expect(root.querySelector('a[href="/cards"]')?.textContent).toBe('Your cards')
    expect(root.querySelector('a[href="/cards/new"]')?.textContent).toBe('Add card')
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
    expect(button('Create profile').disabled).toBe(true)
  })

  it('registers without a tagline, custom colour or logo', async () => {
    const input = props()
    render(<VenuePage {...input} issuer={null} />, root)
    typeField('handle', 'new-coffee')
    typeField('name', 'New Coffee')
    await vi.waitFor(() => {
      expect(button('Create profile').disabled).toBe(false)
    })
    submitForm('Create profile')
    expect(input.onCreate).toHaveBeenCalledExactlyOnceWith(
      { brandColor: '#0073EB', handle: 'new-coffee', name: 'New Coffee', tagline: '' },
      null,
    )
  })

  it('shows the saved venue name and public link before editable name and tagline', () => {
    render(<VenuePage {...props()} />, root)
    expect(root.querySelector('input[name="handle"]')).toBeNull()
    const form = field('name').closest('form')!
    expect([form.querySelector('h2')?.textContent, field('name').value]).toStrictEqual(['Coffee', 'Coffee'])
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

  it.each([true, false])('shows ENS beside venue identity with claimed=%s', (claimed) => {
    const input = props()
    const onClaim = vi.fn<() => void>()
    render(
      <VenuePage
        {...input}
        ens={
          <EnsClaim
            copy={input.copy.ens}
            name="coffee.fuda.eth"
            onClaim={onClaim}
            ownerAddress={input.issuer!.operatorAddress}
            state={
              claimed
                ? { claimTxHash: null, kind: 'claimed', name: 'coffee.fuda.eth' }
                : { kind: 'unclaimed' }
            }
          />
        }
      />,
      root,
    )
    const identity = root.querySelector('a[href="https://fuda.test/@coffee"]')!.parentElement!
    expect(identity.textContent).toContain('coffee.fuda.eth')
    expect(identity.querySelector('[role="img"][aria-label="Claimed"]') !== null).toBe(claimed)
    const claimButton = identity.querySelector('button')
    expect(claimButton?.type ?? null).toBe(claimed ? null : 'button')
    claimButton?.click()
    expect(onClaim).toHaveBeenCalledTimes(claimed ? 0 : 1)
    expect(input.onUpdate).not.toHaveBeenCalled()
  })

  it('saves the name and clears an optional tagline without sending the handle', async () => {
    const input = props()
    render(<VenuePage {...input} />, root)
    typeField('name', 'New Coffee')
    typeField('tagline', '')
    await vi.waitFor(() => {
      expect(button('Save').disabled).toBe(false)
    })
    submitForm('Save')
    await vi.waitFor(() => {
      expect(input.onUpdate).toHaveBeenCalledExactlyOnceWith({
        brandColor: '#5CF794',
        name: 'New Coffee',
        tagline: '',
      })
    })
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Saved.')
    })
  })

  it('keeps unsaved text after a failed update and permits retry', async () => {
    const input = props()
    vi.spyOn(input, 'onUpdate').mockResolvedValue(false)
    render(<VenuePage {...input} />, root)
    typeField('name', 'New Coffee')
    await vi.waitFor(() => {
      expect(button('Save').disabled).toBe(false)
    })
    submitForm('Save')
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Could not save your changes.')
    })
    expect(field('name').value).toBe('New Coffee')
    expect(button('Save').disabled).toBe(false)
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
    expect(button('Save').disabled).toBe(false)
    expect(root.querySelector('input[type=file]')?.closest('form')).toBe(button('Save').form)
    submitForm('Save')
    await vi.waitFor(() => {
      expect(input.onCommitLogo).toHaveBeenCalledExactlyOnceWith(variants)
    })
    await vi.waitFor(() => {
      expect(root.querySelector('img[src="blob:logo-preview"]')).toBeNull()
    })
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:logo-preview')
  })

  it('shows only one preview and restores the saved Logo when a replacement is removed', async () => {
    const input = props()
    render(<VenuePage {...input} issuer={{ ...input.issuer!, logoUrl: '/saved-logo.png' }} />, root)
    expect(root.querySelectorAll('img')).toHaveLength(1)
    pickImage()
    await vi.waitFor(() => {
      expect(root.querySelector('img')?.src).toBe('blob:logo-preview')
    })
    expect(root.querySelectorAll('img')).toHaveLength(1)
    button('Remove').click()
    await vi.waitFor(() => {
      expect(root.querySelector('img')?.getAttribute('src')).toBe('/saved-logo.png')
    })
    expect(button('Save').disabled).toBe(true)
  })

  it('disables Save while preparing a replacement even if text has changed', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof logoTools.generateLogoSet>>>()
    vi.spyOn(logoTools, 'generateLogoSet').mockReturnValue(pending.promise)
    const input = props()
    render(<VenuePage {...input} />, root)
    typeField('name', 'New Coffee')
    pickImage()
    await vi.waitFor(() => {
      expect(button('Save').disabled).toBe(true)
    })
    submitForm('Save')
    expect(input.onUpdate).not.toHaveBeenCalled()
    pending.resolve({ ok: true, variants })
    await vi.waitFor(() => {
      expect(button('Save').disabled).toBe(false)
    })
  })

  it('retains the profile draft after Logo success and retries without uploading twice', async () => {
    const input = props()
    vi.spyOn(input, 'onUpdate').mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<VenuePage {...input} />, root)
    typeField('name', 'New Coffee')
    pickImage()
    await vi.waitFor(() => {
      expect(root.querySelector('img[src="blob:logo-preview"]')).not.toBeNull()
    })
    submitForm('Save')
    await vi.waitFor(() => {
      expect(root.textContent).toContain(DASH_COPY.en.venue.saveFailed)
    })
    expect(field('name').value).toBe('New Coffee')
    expect(input.onCommitLogo).toHaveBeenCalledOnce()
    submitForm('Save')
    await vi.waitFor(() => {
      expect(root.textContent).toContain(DASH_COPY.en.venue.saved)
    })
    expect(input.onCommitLogo).toHaveBeenCalledOnce()
    expect(input.onUpdate).toHaveBeenCalledTimes(2)
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
    submitForm('Save')
    await vi.waitFor(() => {
      expect(root.textContent).toContain(DASH_COPY.en.logo.updateFailed)
    })
    expect(root.querySelector('img[src="blob:logo-preview"]')).not.toBeNull()
    expect(button('Save').disabled).toBe(false)
    expect(input.onUpdate).not.toHaveBeenCalled()
  })
})
