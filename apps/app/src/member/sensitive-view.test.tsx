// @vitest-environment happy-dom
import { mount, settle } from '@fuda/ui-preact/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as sensitive from './sensitive.ts'
import { SensitivePasses } from './SensitivePasses.tsx'

const secret = new Uint8Array(32)
const entry = {
  cardTitle: 'A Sensitive card',
  salt: `0x${'11'.repeat(32)}`,
  uid: `0x${'22'.repeat(32)}`,
  venue: 'fictional-venue',
} as const
const disposers: (() => void)[] = []

describe('Sensitive screen ownership', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => await Promise.resolve(Response.json({ copies: [{}] }))),
    )
    vi.spyOn(sensitive, 'openMemberSecret').mockResolvedValue({ kind: 'open', secret })
    vi.spyOn(sensitive, 'readVaultEntries').mockResolvedValue({ entries: [entry], ok: true, version: 1 })
  })
  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose()
    }
    vi.restoreAllMocks()
  })

  it('opens the vault only in a user event, keeps it across rerenders and drops it on unmount', async () => {
    const view = mount(<SensitivePasses locale="en" />)
    disposers.push(view.dispose)
    await vi.waitFor(() => {
      expect(view.host.querySelector('button')).not.toBeNull()
    })
    expect(
      [sensitive.openMemberSecret, sensitive.readVaultEntries].map(
        (call) => vi.mocked(call).mock.calls.length,
      ),
    ).toStrictEqual([0, 0])
    await settle(() => {
      view.host.querySelector('button')?.click()
      view.host.querySelector('button')?.click()
    })
    await vi.waitFor(() => {
      expect(view.host.textContent).toContain(entry.cardTitle)
    })
    expect(vi.mocked(sensitive.readVaultEntries).mock.calls).toStrictEqual([
      [sensitive.defaultSensitiveIo, secret],
    ])
    view.update(<SensitivePasses locale="ja" />)
    expect([
      view.host.textContent?.includes(entry.cardTitle),
      vi.mocked(sensitive.openMemberSecret).mock.calls.length,
      vi.mocked(sensitive.readVaultEntries).mock.calls.length,
    ]).toStrictEqual([true, 1, 1])
    view.dispose()
    const again = mount(<SensitivePasses locale="en" />)
    disposers.push(again.dispose)
    await vi.waitFor(() => {
      expect(again.host.querySelector('button')).not.toBeNull()
    })
    expect([
      again.host.textContent?.includes(entry.cardTitle),
      vi.mocked(sensitive.openMemberSecret).mock.calls.length,
    ]).toStrictEqual([false, 1])
  })

  it('ignores a vault that opens after unmount', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof sensitive.openMemberSecret>>>()
    vi.mocked(sensitive.openMemberSecret).mockReturnValue(pending.promise)
    const view = mount(<SensitivePasses locale="en" />)
    await vi.waitFor(() => {
      expect(view.host.querySelector('button')).not.toBeNull()
    })
    await settle(() => view.host.querySelector('button')?.click())
    view.dispose()
    await settle(() => {
      pending.resolve({ kind: 'open', secret })
    })
    expect(view.host.textContent).toBe('')
  })
})
