import type { Hex } from '@fuda/sdk'
import { describe, expect, it, vi } from 'vitest'

import { syncMemberPasses } from './member-pass-sync.ts'
import type { PassSyncIo } from './member-pass-sync.ts'

const uidOf = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`
const HOLDER: Hex = `0x${'00'.repeat(20)}`
const entry = (n: number) => ({ addedAt: n, holder: HOLDER, uid: uidOf(n) })

const io = (listed: number[]) => ({
  link: vi.fn<PassSyncIo['link']>(async () => await Promise.resolve({ body: { linked: 0 }, ok: true })),
  list: vi.fn<PassSyncIo['list']>(
    async () => await Promise.resolve({ body: { passes: listed.map((n) => entry(n)) }, ok: true }),
  ),
})

describe(syncMemberPasses, () => {
  it('sends what this device remembers and answers only what it did not know', async () => {
    const fake = io([1, 2])
    const fresh = await syncMemberPasses([entry(1)], fake)
    expect(fake.link).toHaveBeenCalledWith([uidOf(1)])
    expect(fresh.map(({ uid }) => uid)).toStrictEqual([uidOf(2)])
  })

  it('links nothing when this device remembers nothing', async () => {
    const fake = io([1])
    await expect(syncMemberPasses([], fake)).resolves.toHaveLength(1)
    expect(fake.link).not.toHaveBeenCalled()
  })

  it('sends a long list in parts the api accepts', async () => {
    const fake = io([])
    await syncMemberPasses(
      Array.from({ length: 120 }, (_, i) => entry(i + 1)),
      fake,
    )
    expect(fake.link.mock.calls.map(([uids]) => uids.length)).toStrictEqual([50, 50, 20])
  })

  it('answers nothing new when the list cannot be read', async () => {
    const fake = io([])
    fake.list.mockResolvedValue({ error: 'internal', network: false, ok: false, status: 500 })
    await expect(syncMemberPasses([entry(1)], fake)).resolves.toStrictEqual([])
  })
})
