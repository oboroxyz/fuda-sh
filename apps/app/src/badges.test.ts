import type { Hex } from '@fuda/sdk'
import { describe, expect, it, vi } from 'vitest'

import { requestHumanBadge } from './badges.ts'
import type { BadgeState, HumanBadgeContext, HumanBadgeIo } from './badges.ts'

// Uppercase on purpose: the api compares the proof's signal to the uid for
// exact equality and rejects a mismatch, so the signal bound into the proof
// must be the same lowercase form the api normalizes to.
const UID: Hex = `0x${'AB'.repeat(32)}`
const LOWER_UID = UID.toLowerCase() as Hex

const CONTEXT: HumanBadgeContext = {
  action: 'ethtokyo2026-human',
  app_id: 'app_test',
  rp_context: {
    created_at: 1_790_000_000,
    expires_at: 1_790_000_300,
    nonce: '0x01',
    rp_id: 'rp_test',
    signature: '0x02',
  },
}

const PROOF = { proof: 'fake-proof' }

const BADGE = { at: 1_790_000_001, kind: 'human' as const, verifier: 'world' }

const fakeIo = (overrides: Partial<HumanBadgeIo> = {}): HumanBadgeIo => ({
  context: vi.fn<HumanBadgeIo['context']>(async () => await Promise.resolve({ body: CONTEXT, ok: true })),
  open: vi.fn<HumanBadgeIo['open']>(async () => await Promise.resolve({ result: PROOF, success: true })),
  submit: vi.fn<HumanBadgeIo['submit']>(
    async () => await Promise.resolve({ body: { badge: BADGE }, ok: true }),
  ),
  ...overrides,
})

const statesOf = async (io: HumanBadgeIo, uid: Hex = UID): Promise<BadgeState['kind'][]> => {
  const seen: BadgeState['kind'][] = []
  await requestHumanBadge(io, uid, (state) => {
    seen.push(state.kind)
  })
  return seen
}

describe(requestHumanBadge, () => {
  it('walks idle -> opening -> waiting -> done on success', async () => {
    const io = fakeIo()
    await expect(statesOf(io)).resolves.toStrictEqual(['idle', 'opening', 'waiting', 'done'])
  })

  it('opens with the lowercase uid as the preset signal, and submits {uid, payload}', async () => {
    const io = fakeIo()
    await requestHumanBadge(io, UID, () => {})
    expect(io.context).toHaveBeenCalledWith()
    expect(io.open).toHaveBeenCalledWith(CONTEXT, LOWER_UID, expect.any(Function))
    expect(io.submit).toHaveBeenCalledWith(LOWER_UID, PROOF)
  })

  // The page must be able to render the hand-off while it keeps polling: this
  // is the whole reason `open` reports the connector URI instead of navigating.
  it('reports the connector URI on the waiting state, without ending the wait', async () => {
    const io = fakeIo({
      open: vi.fn<HumanBadgeIo['open']>(async (_context, _uid, onConnect) => {
        onConnect('https://world.org/verify?t=wld&i=abc')
        return await Promise.resolve({ result: PROOF, success: true })
      }),
    })
    const seen: BadgeState[] = []
    await requestHumanBadge(io, UID, (state) => {
      seen.push(state)
    })
    expect(seen.map((state) => state.kind)).toStrictEqual(['idle', 'opening', 'waiting', 'waiting', 'done'])
    expect(seen.at(2)).toStrictEqual({ connectorUri: null, kind: 'waiting' })
    expect(seen.at(3)).toStrictEqual({
      connectorUri: 'https://world.org/verify?t=wld&i=abc',
      kind: 'waiting',
    })
    expect(io.submit).toHaveBeenCalledWith(LOWER_UID, PROOF)
  })

  it('maps an already_badged 409 from the submit call to taken', async () => {
    const io = fakeIo({
      submit: vi.fn<HumanBadgeIo['submit']>(
        async () =>
          await Promise.resolve({ error: 'already_badged', network: false, ok: false, status: 409 }),
      ),
    })
    await expect(statesOf(io)).resolves.toStrictEqual(['idle', 'opening', 'waiting', 'taken'])
  })

  it.each(['user_rejected', 'cancelled'])(
    'maps the %s cancellation to idle and submits nothing',
    async (code) => {
      const io = fakeIo({
        open: vi.fn<HumanBadgeIo['open']>(async () => await Promise.resolve({ error: code, success: false })),
      })
      await expect(statesOf(io)).resolves.toStrictEqual(['idle', 'opening', 'waiting', 'idle'])
      expect(io.submit).not.toHaveBeenCalled()
    },
  )

  // The likelier path to "already verified" than the api's 409: a 4.0 nullifier
  // is stable and the protocol treats a second uniqueness proof of the same
  // action as a replay, so World App usually refuses before a proof exists to
  // submit. The member must see the same answer either way, not a generic
  // failure.
  it.each(['nullifier_replayed', 'max_verifications_reached'])(
    'maps the %s answer from World App to taken, and submits nothing',
    async (code) => {
      const io = fakeIo({
        open: vi.fn<HumanBadgeIo['open']>(async () => await Promise.resolve({ error: code, success: false })),
      })
      await expect(statesOf(io)).resolves.toStrictEqual(['idle', 'opening', 'waiting', 'taken'])
      expect(io.submit).not.toHaveBeenCalled()
    },
  )

  it('maps any other World App failure to error', async () => {
    const io = fakeIo({
      open: vi.fn<HumanBadgeIo['open']>(
        async () => await Promise.resolve({ error: 'world_id_4_not_available', success: false }),
      ),
    })
    await expect(statesOf(io)).resolves.toStrictEqual(['idle', 'opening', 'waiting', 'error'])
    expect(io.submit).not.toHaveBeenCalled()
  })

  it('maps a 501 from the context call to unavailable, without opening World App', async () => {
    const io = fakeIo({
      context: vi.fn<HumanBadgeIo['context']>(
        async () =>
          await Promise.resolve({ error: 'badges_not_configured', network: false, ok: false, status: 501 }),
      ),
    })
    await expect(statesOf(io)).resolves.toStrictEqual(['idle', 'opening', 'unavailable'])
    expect(io.open).not.toHaveBeenCalled()
    expect(io.submit).not.toHaveBeenCalled()
  })

  it('maps any other submit failure to error', async () => {
    const io = fakeIo({
      submit: vi.fn<HumanBadgeIo['submit']>(
        async () => await Promise.resolve({ error: 'bad_input', network: false, ok: false, status: 400 }),
      ),
    })
    await expect(statesOf(io)).resolves.toStrictEqual(['idle', 'opening', 'waiting', 'error'])
  })
})
