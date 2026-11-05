// @vitest-environment happy-dom
import { mount, settle } from '@fuda/ui-preact/test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PasskeySection } from './PasskeySection.tsx'
import type { PasskeySectionCopy, PasskeySectionProps } from './PasskeySection.tsx'

const COPY: PasskeySectionCopy = {
  add: 'Add',
  adding: 'Adding',
  cancel: 'Keep',
  created: 'Added {date}',
  failures: {
    cancelled: 'cancelled',
    limit: 'limit',
    network: 'network',
    rejected: 'rejected',
    remove: 'could not remove',
    unavailable: 'unavailable',
  },
  hint: 'hint',
  loadFailed: 'load failed',
  name: 'Passkey {number}',
  remove: 'Remove',
  removeTitle: 'Remove?',
  removeWarning: 'warning',
  synced: 'synced',
  title: 'Passkeys',
}

const PASSKEY = (id: string) => ({ backedUp: id === 'a', createdAt: 1, id })

const disposers: (() => void)[] = []

const render = (io: Partial<PasskeySectionProps['io']>): HTMLElement => {
  const mounted = mount(
    <PasskeySection
      copy={COPY}
      formatDate={() => 'today'}
      io={{
        add: async () => await Promise.resolve({ ok: true as const }),
        list: async () => await Promise.resolve([PASSKEY('a')]),
        remove: async () => await Promise.resolve(true),
        ...io,
      }}
    />,
  )
  disposers.push(mounted.dispose)
  return mounted.host
}

describe(PasskeySection, () => {
  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose()
    }
  })

  it('lists the passkeys, and offers no removal of the last one', async () => {
    const host = render({})
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Passkey 1')
    })
    expect(host.textContent).toContain('Added today · synced')
    expect(host.querySelector('dialog')).toBeNull()
  })

  it('shows the new passkey after adding one', async () => {
    const list = vi
      .fn<PasskeySectionProps['io']['list']>()
      .mockResolvedValueOnce([PASSKEY('a')])
      .mockResolvedValueOnce([PASSKEY('a'), PASSKEY('b')])
    const host = render({ list })
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Passkey 1')
    })
    await settle(() => {
      host.querySelector<HTMLButtonElement>('button.btn-outline.w-full')?.click()
    })
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Passkey 2')
    })
  })

  it('says why an add did not finish and keeps the list', async () => {
    const host = render({
      add: async () => await Promise.resolve({ failure: 'limit' as const, ok: false as const }),
    })
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Passkey 1')
    })
    await settle(() => {
      host.querySelector<HTMLButtonElement>('button.btn-outline.w-full')?.click()
    })
    await vi.waitFor(() => {
      expect(host.querySelector('.alert-error')?.textContent).toBe('limit')
    })
    expect(host.textContent).toContain('Passkey 1')
  })

  it('says when the list could not be read', async () => {
    const host = render({ list: async () => await Promise.reject(new Error('down')) })
    await vi.waitFor(() => {
      expect(host.querySelector('.alert-error')?.textContent).toBe('load failed')
    })
  })

  it('starts one ceremony for a double click, and none from a rerender', async () => {
    const ceremony = Promise.withResolvers<{ ok: true }>()
    const add = vi.fn<PasskeySectionProps['io']['add']>(async () => await ceremony.promise)
    const host = render({ add })
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Passkey 1')
    })
    const button = host.querySelector<HTMLButtonElement>('button.btn-outline.w-full')!
    await settle(() => {
      button.click()
      button.click()
    })
    expect(add).toHaveBeenCalledOnce()
    expect(button.textContent).toBe('Adding')
    ceremony.resolve({ ok: true })
    await vi.waitFor(() => {
      expect(button.textContent).toBe('Add')
    })
    expect(add).toHaveBeenCalledOnce()
  })

  it('writes nothing after it unmounts while a list is pending', async () => {
    const pending = Promise.withResolvers<ReturnType<typeof PASSKEY>[]>()
    const list = vi.fn<PasskeySectionProps['io']['list']>(async () => await pending.promise)
    const mounted = mount(
      <PasskeySection
        copy={COPY}
        formatDate={() => 'today'}
        io={{
          add: async () => await Promise.resolve({ ok: true as const }),
          list,
          remove: async () => await Promise.resolve(true),
        }}
      />,
    )
    mounted.dispose()
    pending.resolve([PASSKEY('a')])
    await settle()
    expect(mounted.host.textContent).toBe('')
  })
})
