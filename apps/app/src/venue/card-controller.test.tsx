// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import type { PublicVenue } from '@fuda/sdk'
import { render, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readCard, rememberCard } from '../card-memory.ts'
import { readPassMemory } from '../pass-memory.ts'
import { CardScreen } from './CardScreen.tsx'
import type { CardScreenIo } from './CardScreen.tsx'

const venue: PublicVenue = {
  brandColor: '#ffffff',
  cards: [
    {
      category: 'membership',
      claimFrom: null,
      claimUntil: null,
      claimable: true,
      id: 'one',
      perk: 'A cup on your birthday',
      reward: '',
      slug: 'regular',
      title: 'Regulars',
      validFrom: null,
      validUntil: null,
      validityDays: null,
    },
  ],
  handle: 'garden-cafe',
  logoUrl: null,
  name: 'Garden Cafe',
  tagline: '',
}

const io = (): CardScreenIo => ({
  appleAvailable: async () => await Promise.resolve(false),
  fetchVenue: async () => await Promise.resolve({ body: venue, ok: true }),
  googleSaveUrl: async () => await Promise.resolve(null),
  issueCard: vi.fn<CardScreenIo['issueCard']>(
    async () => await Promise.resolve({ error: 'offline', network: true, ok: false, status: 0 }),
  ),
})

describe('venue controller', () => {
  afterEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
  })

  it('opens a saved card without issuing again', async () => {
    rememberCard(
      venue.handle,
      'regular',
      { holder: `0x${'11'.repeat(20)}`, memberNumber: 'qj2yxphepdrka', uid: `0x${'ab'.repeat(32)}` },
      localStorage,
    )
    const host = document.createElement('div')
    document.body.replaceChildren(host)
    const deps = io()
    render(<CardScreen handle={venue.handle} slug={null} io={deps} storage={localStorage} />, host)
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Your card is ready')
    })
    expect(deps.issueCard).not.toHaveBeenCalled()
    expect(host.querySelector('a[href="/@garden-cafe"]')).not.toBeNull()
    expect(host.querySelector('a[href="/"]')).toBeNull()
    render(<></>, host)
  })

  it('issues once when the primary action is clicked twice before rendering', async () => {
    const host = document.createElement('div')
    const deps = io()
    render(<CardScreen handle={venue.handle} slug={null} io={deps} storage={localStorage} />, host)
    await vi.waitFor(() => {
      expect(host.querySelector('button')).not.toBeNull()
    })
    const button = host.querySelector('button')!
    button.click()
    button.click()
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Could not reach fuda')
    })
    expect(deps.issueCard).toHaveBeenCalledOnce()
    render(<></>, host)
  })

  it.each(['success', 'failure'])(
    'preserves the new route after late issuance %s and retains successful passes',
    async (outcome) => {
      const pending = Promise.withResolvers<Awaited<ReturnType<CardScreenIo['issueCard']>>>()
      const deps = { ...io(), issueCard: async () => await pending.promise }
      const host = document.createElement('div')
      const RouteHost = (): JSX.Element => {
        const [slug, setSlug] = useState<string | null>(null)
        return (
          <>
            <button
              data-route
              type="button"
              onClick={() => {
                setSlug('missing')
              }}
            >
              Change route
            </button>
            <CardScreen handle={venue.handle} slug={slug} io={deps} />
          </>
        )
      }
      render(<RouteHost />, host)
      await vi.waitFor(() => {
        expect(host.querySelector('main button')).not.toBeNull()
      })
      host.querySelector<HTMLButtonElement>('main button')!.click()
      host.querySelector<HTMLButtonElement>('[data-route]')!.click()
      await vi.waitFor(() => {
        expect(host.textContent).toContain('No card here')
      })
      const uid = `0x${'ab'.repeat(32)}` as const
      pending.resolve(
        outcome === 'failure'
          ? { error: 'offline', network: true, ok: false, status: 0 }
          : {
              body: {
                holder: `0x${'11'.repeat(20)}`,
                level: 'bearer',
                memberNumber: 'qj2yxphepdrka',
                passUrls: { apple: `/pass/${uid}/apple`, google: `/pass/${uid}/google`, web: `/pass/${uid}` },
                qr: `fuda:${uid}`,
                uid,
              },
              ok: true,
            },
      )
      await pending.promise
      // oxlint-disable-next-line promise/avoid-new -- allow the DOM render queue to flush before asserting that a late response stayed absent
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20)
      })
      expect(host.textContent).toContain('No card here')
      expect(readCard(venue.handle, 'regular')?.uid ?? null).toBe(outcome === 'success' ? uid : null)
      expect(readPassMemory().map((pass) => pass.uid)).toStrictEqual(outcome === 'success' ? [uid] : [])
      render(<></>, host)
    },
  )
})
