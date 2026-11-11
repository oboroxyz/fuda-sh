import { setTimeout as delay } from 'node:timers/promises'

import type { Locale } from '@fuda/i18n'
// @vitest-environment happy-dom
import type { PassBackup, PublicVenue } from '@fuda/sdk'
import { mount as mountView } from '@fuda/ui/test'
import type { ComponentChild, JSX } from 'preact'
import { useState } from 'preact/hooks'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readCard, rememberCard } from '../card-memory.ts'
import { readPassMemory } from '../pass-memory.ts'
import { CardScreen } from './CardScreen.tsx'
import type { CardScreenIo, CardSensitiveIo } from './CardScreen.tsx'
import { VenueLayout } from './VenueLayout.tsx'

const disposers: (() => void)[] = []
const render = (View: () => ComponentChild, host: HTMLElement): void => {
  if (!host.isConnected) {
    document.body.append(host)
  }
  disposers.push(mountView(<View />, host).dispose)
}
const unmountAll = (): void => {
  for (const dispose of disposers.splice(0)) {
    dispose()
  }
}

const venue: PublicVenue = {
  brandColor: '#ffffff',
  cards: [
    {
      category: 'membership',
      claimFrom: null,
      claimUntil: null,
      claimable: true,
      description: 'A cup on your birthday',
      id: 'one',
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
  claimToken: async () => await Promise.resolve({ ok: true, token: null }),
  claimWithPasskey: vi.fn<CardScreenIo['claimWithPasskey']>(
    async () => await Promise.resolve({ failure: 'network', ok: false }),
  ),
  fetchBackup: async () =>
    await Promise.resolve({ error: 'not_found', network: false, ok: false, status: 404 }),
  fetchVenue: async () => await Promise.resolve({ body: venue, ok: true }),
  googleSaveUrl: async () => await Promise.resolve(null),
  issueCard: vi.fn<CardScreenIo['issueCard']>(
    async () => await Promise.resolve({ error: 'offline', network: true, ok: false, status: 0 }),
  ),
})

const landed = async (host: HTMLElement): Promise<void> => {
  await vi.waitFor(() => {
    expect(host.textContent).toContain('only you can use it')
  })
}

const claimOn = async (host: HTMLElement): Promise<void> => {
  await vi.waitFor(() => {
    expect(host.querySelector('.venue-primary button')).not.toBeNull()
  })
  host.querySelector<HTMLButtonElement>('.venue-primary button')?.click()
}

const openBotCheck = async (deps: CardScreenIo, locale: Locale = 'en'): Promise<HTMLDivElement> => {
  const host = document.createElement('div')
  render(
    () => <CardScreen handle={venue.handle} slug={null} io={deps} locale={locale} storage={localStorage} />,
    host,
  )
  await vi.waitFor(() => {
    expect(host.querySelector('button')).not.toBeNull()
  })
  return host
}

describe('venue controller', () => {
  describe('a Sensitive card', () => {
    const UID = `0x${'ab'.repeat(32)}` as const
    const [regular] = venue.cards
    const sensitiveVenue: PublicVenue = {
      ...venue,
      cards: regular === undefined ? [] : [{ ...regular, identity: 'sensitive' }],
    }
    const issued = {
      body: {
        holder: `0x${'00'.repeat(20)}`,
        level: 'signed',
        memberNumber: 'qj2yxphepdrka',
        passUrls: { apple: 'https://a/apple', google: 'https://a/google', web: 'https://a/web' },
        qr: `fuda:v1:${UID}`,
        uid: UID,
      },
      ok: true,
      saved: 'vault',
    } as const
    const open = (sensitive?: CardSensitiveIo): HTMLDivElement => {
      globalThis.history.replaceState(null, '', `/@${venue.handle}/regular?source=flyer`)
      const host = document.createElement('div')
      const screenIo: CardScreenIo = {
        ...io(),
        fetchVenue: async () => await Promise.resolve({ body: sensitiveVenue, ok: true }),
      }
      render(
        () => (
          <CardScreen
            locale="en"
            handle={venue.handle}
            slug="regular"
            io={screenIo}
            sensitive={sensitive}
            signedIn
          />
        ),
        host,
      )
      return host
    }
    afterEach(() => {
      vi.doUnmock('../member/sensitive.ts')
      localStorage.clear()
      globalThis.history.replaceState(null, '', '/')
    })

    it('shows entry and no QR, Wallet or backup, and keeps nothing on the device', async () => {
      const claim = vi.fn<CardSensitiveIo['claim']>(async () => await Promise.resolve(issued))
      const host = open({ addPasskey: vi.fn<CardSensitiveIo['addPasskey']>(), claim })
      await claimOn(host)
      await vi.waitFor(() => {
        expect(host.querySelector(`a[href="/signed?uid=${UID}"]`)).not.toBeNull()
      })
      expect(claim.mock.calls[0]?.[0]).toMatchObject({
        slug: 'regular',
        source: 'flyer',
        venue: venue.handle,
      })
      expect(host.querySelector('.venue-qr')).toBeNull()
      expect(host.querySelector('a[download]')).toBeNull()
      expect(readPassMemory()).toStrictEqual([])
      expect(readCard(venue.handle, 'regular')).toBeNull()
    })

    it('says so when a pass was issued but is not on the list yet', async () => {
      const claim = vi.fn<CardSensitiveIo['claim']>(
        async () => await Promise.resolve({ ...issued, saved: 'device' as const }),
      )
      const host = open({ addPasskey: vi.fn<CardSensitiveIo['addPasskey']>(), claim })
      await claimOn(host)
      await vi.waitFor(() => {
        expect(host.textContent).toContain('could not be added to your list yet')
      })
      expect(host.querySelector(`a[href="/signed?uid=${UID}"]`)).not.toBeNull()
      expect(host.querySelector('.venue-primary button')).toBeNull()
      expect(host.textContent).not.toContain('Try again')
      expect(claim).toHaveBeenCalledOnce()
    })

    it('offers no entry when an issued pass could not be kept anywhere', async () => {
      const claim = vi.fn<CardSensitiveIo['claim']>(
        async () => await Promise.resolve({ ...issued, saved: 'lost' as const }),
      )
      const host = open({ addPasskey: vi.fn<CardSensitiveIo['addPasskey']>(), claim })
      await claimOn(host)
      await vi.waitFor(() => {
        expect(host.textContent).toContain('cannot be used')
      })
      expect(host.querySelector(`a[href="/signed?uid=${UID}"]`)).toBeNull()
      expect(host.textContent).not.toContain('kept on this device')
      expect(claim).toHaveBeenCalledOnce()
    })

    it('reports a network error when the Sensitive module cannot load', async () => {
      vi.doMock(import('../member/sensitive.ts'), () => {
        throw new Error('chunk unavailable')
      })
      const host = open()
      await claimOn(host)
      await vi.waitFor(() => {
        expect(host.textContent).toContain('connection')
        expect(host.textContent).toContain('Try again')
      })
      expect(host.querySelector(`a[href="/signed?uid=${UID}"]`)).toBeNull()
    })

    it('stops at the guidance without PRF, naming the providers that work', async () => {
      const host = open({
        addPasskey: vi.fn<CardSensitiveIo['addPasskey']>(),
        claim: async () => await Promise.resolve({ failure: 'no_prf', ok: false }),
      })
      await claimOn(host)
      await vi.waitFor(() => {
        expect(host.querySelector('[data-testid="no-prf-guidance"]')).not.toBeNull()
      })
      expect(host.textContent).toContain('iCloud Keychain')
      expect(host.textContent).toContain('Google Password Manager')
    })

    it('starts one add ceremony and disables both actions while it runs', async () => {
      const pending = Promise.withResolvers<Awaited<ReturnType<CardSensitiveIo['addPasskey']>>>()
      const addPasskey = vi.fn<CardSensitiveIo['addPasskey']>(async () => await pending.promise)
      const claim = vi.fn<CardSensitiveIo['claim']>().mockResolvedValue({ failure: 'no_prf', ok: false })
      const host = open({ addPasskey, claim })
      await claimOn(host)
      await vi.waitFor(() => {
        expect(host.querySelector('[data-testid="no-prf-guidance"] .btn-primary')).not.toBeNull()
      })
      const add = host.querySelector<HTMLButtonElement>('[data-testid="no-prf-guidance"] .btn-primary')!
      add.click()
      add.click()
      expect(addPasskey).toHaveBeenCalledOnce()
      await vi.waitFor(() => {
        const buttons = host.querySelectorAll<HTMLButtonElement>('[data-testid="no-prf-guidance"] button')
        expect([...buttons].every((button) => button.disabled)).toBe(true)
      })
      pending.resolve({ ok: false })
    })

    it('shows a failed add and lets the member retry saving a passkey', async () => {
      const addPasskey = vi
        .fn<CardSensitiveIo['addPasskey']>()
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ credentialId: 'new-passkey', ok: true })
      const claim = vi
        .fn<CardSensitiveIo['claim']>()
        .mockResolvedValueOnce({ failure: 'no_prf', ok: false })
        .mockResolvedValueOnce(issued)
      const host = open({ addPasskey, claim })
      await claimOn(host)
      await vi.waitFor(() => {
        expect(host.querySelector('[data-testid="no-prf-guidance"] .btn-primary')).not.toBeNull()
      })
      host.querySelector<HTMLButtonElement>('[data-testid="no-prf-guidance"] .btn-primary')!.click()
      await vi.waitFor(() => {
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not save your passkey')
      })
      expect(claim).toHaveBeenCalledOnce()
      host.querySelector<HTMLButtonElement>('[data-testid="no-prf-guidance"] .btn-primary')!.click()
      await vi.waitFor(() => {
        expect(host.querySelector(`a[href="/signed?uid=${UID}"]`)).not.toBeNull()
      })
      expect(addPasskey).toHaveBeenCalledTimes(2)
    })

    it.each(['success', 'failure'])('ignores add %s after navigation to another card', async (outcome) => {
      const pending = Promise.withResolvers<Awaited<ReturnType<CardSensitiveIo['addPasskey']>>>()
      const claim = vi.fn<CardSensitiveIo['claim']>().mockResolvedValue({ failure: 'no_prf', ok: false })
      const sensitive = { addPasskey: async () => await pending.promise, claim }
      const screenIo: CardScreenIo = {
        ...io(),
        fetchVenue: async () =>
          await Promise.resolve({
            body: {
              ...sensitiveVenue,
              cards: [
                ...sensitiveVenue.cards,
                { ...sensitiveVenue.cards[0], slug: 'other', title: 'Other card' },
              ],
            },
            ok: true,
          }),
      }
      const host = document.createElement('div')
      const RouteHost = (): JSX.Element => {
        const [slug, setSlug] = useState('regular')
        return (
          <>
            <button
              type="button"
              data-route
              onClick={() => {
                setSlug('other')
              }}
            >
              Change card
            </button>
            <CardScreen
              handle={venue.handle}
              slug={slug}
              io={screenIo}
              sensitive={sensitive}
              locale="en"
              signedIn
            />
          </>
        )
      }
      render(() => <RouteHost />, host)
      await claimOn(host)
      await vi.waitFor(() => {
        expect(host.querySelector('[data-testid="no-prf-guidance"] .btn-primary')).not.toBeNull()
      })
      host.querySelector<HTMLButtonElement>('[data-testid="no-prf-guidance"] .btn-primary')!.click()
      host.querySelector<HTMLButtonElement>('[data-route]')!.click()
      await vi.waitFor(() => {
        expect(host.querySelector('main')?.textContent).toContain('Other card')
        expect(host.querySelector('[data-testid="no-prf-guidance"]')).toBeNull()
      })
      pending.resolve(outcome === 'success' ? { credentialId: 'new-passkey', ok: true } : { ok: false })
      await pending.promise
      await delay(0)
      expect(claim).toHaveBeenCalledOnce()
      expect(host.querySelector('main')?.textContent).toContain('Other card')
      expect(host.querySelector('[role="alert"]')).toBeNull()
    })

    it('asks the new passkey next, once the guidance has saved one', async () => {
      const claim = vi
        .fn<CardSensitiveIo['claim']>()
        .mockResolvedValueOnce({ failure: 'no_prf', ok: false })
        .mockResolvedValueOnce(issued)
      const addPasskey = vi.fn<CardSensitiveIo['addPasskey']>(
        async () => await Promise.resolve({ credentialId: 'new-passkey', ok: true }),
      )
      const host = open({ addPasskey, claim })
      await claimOn(host)
      await vi.waitFor(() => {
        expect(host.querySelector('[data-testid="no-prf-guidance"] .btn-primary')).not.toBeNull()
      })
      host.querySelector<HTMLButtonElement>('[data-testid="no-prf-guidance"] .btn-primary')?.click()
      await vi.waitFor(() => {
        expect(host.querySelector(`a[href="/signed?uid=${UID}"]`)).not.toBeNull()
      })
      expect(claim.mock.calls[1]?.[1]).toBe('new-passkey')
    })

    it('says when a passkey holding a copy could not open it', async () => {
      const host = open({
        addPasskey: vi.fn<CardSensitiveIo['addPasskey']>(),
        claim: async () => await Promise.resolve({ failure: 'secret_unopenable', ok: false }),
      })
      await claimOn(host)
      await vi.waitFor(() => {
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not open your passes')
      })
    })
  })

  describe('a card bound to a passkey', () => {
    const UID = `0x${'ef'.repeat(32)}` as const
    const [regular] = venue.cards
    const passkeyVenue: PublicVenue = {
      ...venue,
      cards: regular === undefined ? [] : [{ ...regular, identity: 'passkey' }],
    }
    const issued = {
      body: {
        holder: `0x${'00'.repeat(20)}`,
        level: 'signed',
        memberNumber: 'qj2yxphepdrka',
        passUrls: { apple: 'https://a/apple', google: 'https://a/google', web: 'https://a/web' },
        qr: `fuda:v1:${UID}`,
        uid: UID,
      },
      ok: true,
    } as const
    const deps = (over: Partial<CardScreenIo> = {}): CardScreenIo => ({
      ...io(),
      fetchVenue: async () => await Promise.resolve({ body: passkeyVenue, ok: true }),
      ...over,
    })
    const open = (screenIo: CardScreenIo, signedIn: boolean): HTMLDivElement => {
      globalThis.history.replaceState(null, '', `/@${venue.handle}/regular?source=flyer`)
      const host = document.createElement('div')
      render(
        () => (
          <CardScreen locale="en" handle={venue.handle} slug="regular" io={screenIo} signedIn={signedIn} />
        ),
        host,
      )
      return host
    }
    afterEach(() => {
      localStorage.clear()
      globalThis.history.replaceState(null, '', '/')
    })

    it('sends someone signed out to sign in, and back to this address', async () => {
      const screenIo = deps()
      const host = open(screenIo, false)
      await landed(host)
      const link = host.querySelector<HTMLAnchorElement>('.venue-primary a')
      expect(link?.getAttribute('href')).toBe(
        `/signin?return=${encodeURIComponent(`/@${venue.handle}/regular?source=flyer`)}`,
      )
      expect(screenIo.claimWithPasskey).not.toHaveBeenCalled()
    })

    it('claims with the passkey and shows an entry action instead of a QR or Wallet', async () => {
      const claimWithPasskey = vi.fn<CardScreenIo['claimWithPasskey']>(
        async () => await Promise.resolve(issued),
      )
      const issueCard = vi.fn<CardScreenIo['issueCard']>()
      const googleSaveUrl = vi.fn<CardScreenIo['googleSaveUrl']>(async () => await Promise.resolve(null))
      const host = open(deps({ claimWithPasskey, googleSaveUrl, issueCard }), true)
      await landed(host)
      host.querySelector<HTMLButtonElement>('.venue-primary button')?.click()
      await vi.waitFor(() => {
        expect(host.querySelector(`a[href="/signed?uid=${UID}"]`)).not.toBeNull()
      })
      expect(claimWithPasskey).toHaveBeenCalledWith(venue.handle, 'regular', 'flyer', null)
      expect(issueCard).not.toHaveBeenCalled()
      expect(googleSaveUrl).not.toHaveBeenCalled()
      expect(host.querySelector('.venue-qr')).toBeNull()
    })

    it('says why there is no code or Wallet pass, and what a backup does not do', async () => {
      rememberCard(venue.handle, 'regular', {
        holder: `0x${'00'.repeat(20)}`,
        memberNumber: 'qj2yxphepdrka',
        uid: UID,
      })
      const host = open(deps(), true)
      await vi.waitFor(() => {
        expect(host.textContent).toContain('no Wallet pass')
      })
      expect(host.textContent).toContain('you still need your passkey to enter')
    })

    it('offers sign-in again when the api says the session is gone', async () => {
      const host = open(
        deps({
          claimToken: async () => await Promise.resolve({ ok: true, token: null }),
          claimWithPasskey: async () => await Promise.resolve({ failure: 'signed_out', ok: false }),
        }),
        true,
      )
      await landed(host)
      host.querySelector<HTMLButtonElement>('.venue-primary button')?.click()
      await vi.waitFor(() => {
        expect(host.querySelector('.venue-primary a[href^="/signin"]')).not.toBeNull()
      })
    })

    it('says so when the prompt is dismissed', async () => {
      const host = open(
        deps({
          claimToken: async () => await Promise.resolve({ ok: true, token: null }),
          claimWithPasskey: async () => await Promise.resolve({ failure: 'passkey_cancelled', ok: false }),
        }),
        true,
      )
      await landed(host)
      host.querySelector<HTMLButtonElement>('.venue-primary button')?.click()
      await vi.waitFor(() => {
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('No passkey was used')
      })
    })

    it('shows a held pass without a QR', async () => {
      rememberCard(venue.handle, 'regular', {
        holder: `0x${'00'.repeat(20)}`,
        memberNumber: 'qj2yxphepdrka',
        uid: UID,
      })
      const host = open(deps(), true)
      await vi.waitFor(() => {
        expect(host.querySelector(`a[href="/signed?uid=${UID}"]`)).not.toBeNull()
      })
      expect(host.querySelector('.venue-qr')).toBeNull()
    })
  })

  describe('a link that names a pass', () => {
    const UID = `0x${'cd'.repeat(32)}` as const
    const backup = (over: Partial<PassBackup> = {}): PassBackup => ({
      attestation: null,
      handle: venue.handle,
      holder: `0x${'00'.repeat(20)}`,
      memberNumber: 'qj2yxphepdrka',
      passkey: false,
      proof: null,
      qr: `fuda:v1:${UID}`,
      restoreUrl: null,
      slug: 'regular',
      uid: UID,
      version: 1,
      ...over,
    })
    const open = (deps: CardScreenIo): HTMLDivElement => {
      globalThis.history.replaceState(null, '', `/@${venue.handle}/regular?uid=${UID}&source=qr`)
      const host = document.createElement('div')
      render(() => <CardScreen handle={venue.handle} slug="regular" io={deps} locale="en" />, host)
      return host
    }

    afterEach(() => {
      globalThis.history.replaceState(null, '', '/')
    })

    it('shows that pass on a new device without offering a second one', async () => {
      const deps = {
        ...io(),
        fetchBackup: vi.fn<CardScreenIo['fetchBackup']>(
          async () => await Promise.resolve({ body: backup(), ok: true }),
        ),
      }
      const host = open(deps)
      await vi.waitFor(() => {
        expect(host.querySelector('.venue-qr')).not.toBeNull()
      })
      expect(deps.issueCard).not.toHaveBeenCalled()
      expect(localStorage.getItem('fuda.passes.v1')).toContain(UID)
    })

    it('takes the uid out of the address and keeps the rest', async () => {
      const deps = {
        ...io(),
        fetchBackup: vi.fn<CardScreenIo['fetchBackup']>(
          async () => await Promise.resolve({ body: backup(), ok: true }),
        ),
      }
      open(deps)
      await vi.waitFor(() => {
        expect(globalThis.location.search).toBe('?source=qr')
      })
    })

    it.each([
      ['another venue', { handle: 'other-shop' }],
      ['another card', { slug: 'other-card' }],
    ])('ignores a pass from %s', async (_label, over) => {
      const deps = {
        ...io(),
        fetchBackup: vi.fn<CardScreenIo['fetchBackup']>(
          async () => await Promise.resolve({ body: backup(over), ok: true }),
        ),
      }
      const host = open(deps)
      await vi.waitFor(() => {
        expect(deps.fetchBackup).toHaveBeenCalledWith(UID)
        expect(host.querySelector('.venue-qr')).toBeNull()
      })
      expect(localStorage.getItem('fuda.passes.v1') ?? '').not.toContain(UID)
    })

    it('ignores a uid the api does not know', async () => {
      const host = open(io())
      await vi.waitFor(() => {
        expect(globalThis.location.search).toBe('?source=qr')
      })
      expect(host.querySelector('.venue-qr')).toBeNull()
    })
  })

  afterEach(() => {
    unmountAll()
    document.body.replaceChildren()
    localStorage.clear()
  })

  it('shows an accessible fuda icon and no return link', () => {
    const host = document.createElement('div')
    render(
      () => (
        <VenueLayout>
          <p>Card content</p>
        </VenueLayout>
      ),
      host,
    )
    expect(host.querySelector('header svg[role="img"]')?.getAttribute('aria-label')).toBe('fuda.')
    expect(host.querySelector('header a')).toBeNull()
    unmountAll()
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
    render(
      () => <CardScreen handle={venue.handle} slug={null} io={deps} storage={localStorage} locale="en" />,
      host,
    )
    await vi.waitFor(() => {
      expect(host.querySelector('.venue-qr [role="img"]')).not.toBeNull()
    })
    expect(deps.issueCard).not.toHaveBeenCalled()
    expect(host.querySelector('a[href="/"]')).toBeNull()
    unmountAll()
  })

  it('issues once when the primary action is clicked twice before rendering', async () => {
    const host = document.createElement('div')
    const deps = io()
    render(
      () => <CardScreen handle={venue.handle} slug={null} io={deps} storage={localStorage} locale="en" />,
      host,
    )
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
    unmountAll()
  })

  describe('the bot check on claim', () => {
    const claimed = {
      body: {
        holder: `0x${'11'.repeat(20)}` as const,
        level: 'bearer' as const,
        memberNumber: 'qj2yxphepdrka',
        passUrls: { apple: '/a', google: '/g', web: '/w' },
        qr: `fuda:${'ab'.repeat(32)}`,
        uid: `0x${'ab'.repeat(32)}` as const,
      },
      ok: true as const,
    }

    afterEach(() => {
      unmountAll()
    })

    it('runs the check only when the member taps, and sends its token with the claim', async () => {
      const deps = {
        ...io(),
        claimToken: vi.fn<CardScreenIo['claimToken']>(
          async () => await Promise.resolve({ ok: true, token: 'tok-1' }),
        ),
        issueCard: vi.fn<CardScreenIo['issueCard']>(async () => await Promise.resolve(claimed)),
      }
      const host = await openBotCheck(deps)
      expect(deps.claimToken).not.toHaveBeenCalled()
      host.querySelector('button')!.click()
      await vi.waitFor(() => {
        expect(host.querySelector('.venue-qr')).not.toBeNull()
      })
      expect(deps.claimToken).toHaveBeenCalledWith(host.querySelector('.venue-bot-check'))
      expect(deps.issueCard).toHaveBeenCalledWith('garden-cafe', 'regular', null, 'tok-1')
    })

    it('offers a retry in plain English when the api refuses the token, with a new token', async () => {
      const tokens = ['used-up', 'fresh']
      const deps = {
        ...io(),
        claimToken: vi.fn<CardScreenIo['claimToken']>(
          async () => await Promise.resolve({ ok: true, token: tokens.shift() ?? null }),
        ),
        issueCard: vi
          .fn<CardScreenIo['issueCard']>()
          .mockResolvedValueOnce({ error: 'bot_check_failed', network: false, ok: false, status: 403 })
          .mockResolvedValueOnce(claimed),
      }
      const host = await openBotCheck(deps)
      host.querySelector('button')!.click()
      await vi.waitFor(() => {
        expect(host.textContent).toContain('We could not confirm that you are a person. Please try again.')
      })
      host.querySelector<HTMLButtonElement>('button.btn:not(.btn-primary)')!.click()
      await vi.waitFor(() => {
        expect(host.querySelector('.venue-qr')).not.toBeNull()
      })
      expect(deps.issueCard.mock.calls.map((call) => call[3])).toStrictEqual(['used-up', 'fresh'])
    })

    it('says so in Japanese, and does not claim when the widget itself fails', async () => {
      const deps = {
        ...io(),
        claimToken: vi.fn<CardScreenIo['claimToken']>(async () => await Promise.resolve({ ok: false })),
      }
      const host = await openBotCheck(deps, 'ja')
      host.querySelector('button')!.click()
      await vi.waitFor(() => {
        expect(host.textContent).toContain(
          '人による操作であることを確認できませんでした。もう一度お試しください。',
        )
      })
      expect(host.textContent).toContain('もう一度試す')
      expect(deps.issueCard).not.toHaveBeenCalled()
    })

    it('tells the member to try again when the check is down', async () => {
      const deps = {
        ...io(),
        claimToken: vi.fn<CardScreenIo['claimToken']>(
          async () => await Promise.resolve({ ok: true, token: 'tok' }),
        ),
        issueCard: vi.fn<CardScreenIo['issueCard']>(
          async () => await Promise.resolve({ error: 'api 503', network: true, ok: false, status: 503 }),
        ),
      }
      const host = await openBotCheck(deps)
      host.querySelector('button')!.click()
      await vi.waitFor(() => {
        expect(host.textContent).toContain(
          'We could not run the check that you are a person right now. Please try again.',
        )
      })
    })
  })

  it('keeps a saved card and pending wallet check when its language changes', async () => {
    vi.stubGlobal('navigator', { userAgent: 'iPhone' })
    rememberCard(
      venue.handle,
      'regular',
      { holder: `0x${'11'.repeat(20)}`, memberNumber: 'qj2yxphepdrka', uid: `0x${'ab'.repeat(32)}` },
      localStorage,
      Date.UTC(2026, 0, 31, 23, 59),
    )
    const wallet = Promise.withResolvers<boolean>()
    const deps = {
      ...io(),
      appleAvailable: vi.fn<CardScreenIo['appleAvailable']>(async () => await wallet.promise),
      fetchVenue: vi.fn<CardScreenIo['fetchVenue']>(
        async () => await Promise.resolve({ body: venue, ok: true }),
      ),
    }
    const host = document.createElement('div')
    const LocaleHost = (): JSX.Element => {
      const [locale, setLocale] = useState<Locale>('en')
      return (
        <>
          <button
            data-locale
            type="button"
            onClick={() => {
              setLocale('ja')
            }}
          >
            Japanese
          </button>
          <CardScreen handle={venue.handle} slug={null} io={deps} locale={locale} />
        </>
      )
    }
    render(() => <LocaleHost />, host)
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Issued Jan 31, 2026')
    })
    const qr = host.querySelector('.venue-qr [role="img"]')?.innerHTML
    host.querySelector<HTMLButtonElement>('[data-locale]')!.click()
    await vi.waitFor(() => {
      expect(host.textContent).toContain('発行日 2026/01/31')
    })
    expect(host.textContent).toMatch(/QJ2Y-XPHE-PDRKA.*発行日 2026\/01\/31/u)
    expect({
      label: host.querySelector('.venue-qr [role="img"]')?.getAttribute('aria-label'),
      markup: host.querySelector('.venue-qr [role="img"]')?.innerHTML,
    }).toStrictEqual({ label: 'Garden Cafeの会員証のQRコード', markup: qr })
    wallet.resolve(true)
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Apple Walletに追加')
    })
    expect(deps.fetchVenue).toHaveBeenCalledOnce()
    expect(deps.appleAvailable).toHaveBeenCalledOnce()
    expect(deps.issueCard).not.toHaveBeenCalled()
    unmountAll()
  })

  it('changes language during issuance without restarting the request or clearing its error', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<CardScreenIo['issueCard']>>>()
    const deps = {
      ...io(),
      fetchVenue: vi.fn<CardScreenIo['fetchVenue']>(
        async () => await Promise.resolve({ body: venue, ok: true }),
      ),
      issueCard: vi.fn<CardScreenIo['issueCard']>(async () => await pending.promise),
    }
    const host = document.createElement('div')
    const LocaleHost = (): JSX.Element => {
      const [locale, setLocale] = useState<Locale>('en')
      return (
        <>
          <button
            data-locale
            type="button"
            onClick={() => {
              setLocale(locale === 'en' ? 'ja' : 'en')
            }}
          >
            Change language
          </button>
          <CardScreen handle={venue.handle} slug={null} io={deps} locale={locale} />
        </>
      )
    }
    render(() => <LocaleHost />, host)
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Get your free membership card')
    })
    host.querySelector<HTMLButtonElement>('main button')!.click()
    host.querySelector<HTMLButtonElement>('[data-locale]')!.click()
    await vi.waitFor(() => {
      expect(host.textContent).toContain('カードを受け取り中…')
    })
    expect(host.querySelector<HTMLButtonElement>('main button')?.disabled).toBe(true)
    expect(host.textContent).toContain('A cup on your birthday')
    pending.resolve({ error: 'offline', network: true, ok: false, status: 0 })
    await vi.waitFor(() => {
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('fudaに接続できませんでした')
    })
    host.querySelector<HTMLButtonElement>('[data-locale]')!.click()
    await vi.waitFor(() => {
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not reach fuda')
    })
    expect(deps.fetchVenue).toHaveBeenCalledOnce()
    expect(deps.issueCard).toHaveBeenCalledOnce()
    unmountAll()
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
            <CardScreen handle={venue.handle} slug={slug} io={deps} locale="en" />
          </>
        )
      }
      render(() => <RouteHost />, host)
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
      unmountAll()
    },
  )
})

const click = (host: HTMLElement, label: string): void => {
  const button = [...host.querySelectorAll('button')].find((node) => node.textContent?.includes(label))
  expect(button).toBeDefined()
  button?.click()
}

describe('address Card controller', () => {
  afterEach(() => {
    unmountAll()
    localStorage.clear()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })
  const address = `0x${'12'.repeat(20)}` as const
  const addressVenue: PublicVenue = {
    ...venue,
    cards: venue.cards.map((card) => ({
      ...card,
      identity: 'address',
      requirements: [
        {
          assetId: `0x${'ab'.repeat(32)}`,
          kind: 'erc8432-agreement',
          registry: address,
        },
      ],
    })),
  }
  const open = (
    licence: NonNullable<Parameters<typeof CardScreen>[0]['licence']>,
    signedIn = true,
    claimable = true,
    claimUntil: number | null = null,
  ) => {
    const deps = io()
    deps.fetchVenue = async () =>
      await Promise.resolve({
        body: {
          ...addressVenue,
          cards: addressVenue.cards.map((card) => ({ ...card, claimUntil, claimable })),
        },
        ok: true,
      })
    const host = document.createElement('div')
    render(
      () => (
        <CardScreen
          handle={venue.handle}
          slug="regular"
          io={deps}
          licence={licence}
          locale="en"
          signedIn={signedIn}
        />
      ),
      host,
    )
    return { deps, host }
  }

  it('explains the agreement and requires sign-in before applying', async () => {
    const licence = vi.fn<NonNullable<Parameters<typeof CardScreen>[0]['licence']>>()
    const { deps, host } = open(licence, false)
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Sign in to apply')
    })
    expect(host.textContent).toContain('licence agreement granted by the asset owner')
    expect(licence).not.toHaveBeenCalled()
    expect(deps.issueCard).not.toHaveBeenCalled()
  })

  it.each(['no-agreement', 'not-granted', 'wrong-terms', 'agreement-inactive'] as const)(
    'shows the address and %s, then receives a pass without a public QR',
    async (detail) => {
      const uid = `0x${'bc'.repeat(32)}` as const
      const licence = vi
        .fn<NonNullable<Parameters<typeof CardScreen>[0]['licence']>>()
        .mockResolvedValueOnce({ address, kind: 'applied' })
        .mockResolvedValueOnce({ address, detail, kind: 'unmet' })
        .mockResolvedValueOnce({
          claim: {
            body: {
              holder: address,
              level: 'signed',
              memberNumber: 'qj2yxphepdrka',
              passUrls: { apple: '', google: '', web: '' },
              qr: '',
              uid,
            },
            ok: true,
            saved: 'vault',
          },
          kind: 'received',
        })
      const { deps, host } = open(licence)
      await vi.waitFor(() => {
        expect(host.textContent).toContain('Apply with your passkey')
      })
      click(host, 'Apply with your passkey')
      click(host, 'Apply with your passkey')
      await vi.waitFor(() => {
        expect(host.textContent).toContain(address)
      })
      expect(licence).toHaveBeenCalledOnce()
      click(host, 'Receive pass')
      await vi.waitFor(() => {
        expect(host.querySelector('[role="alert"]')).not.toBeNull()
      })
      click(host, 'Receive pass')
      await vi.waitFor(() => {
        expect(host.querySelector(`a[href="/signed?uid=${uid}"]`)).not.toBeNull()
      })
      expect(licence.mock.calls.map(([input]) => input.action)).toStrictEqual(['apply', 'claim', 'claim'])
      expect(deps.issueCard).not.toHaveBeenCalled()
      expect(host.querySelector('.venue-qr')).toBeNull()
      expect(readPassMemory()).toStrictEqual([])
    },
  )

  it('offers to receive an existing pass when the Card has no capacity left', async () => {
    const licence = vi
      .fn<NonNullable<Parameters<typeof CardScreen>[0]['licence']>>()
      .mockResolvedValue({ address, detail: 'no-agreement', kind: 'unmet' })
    const { host } = open(licence, true, false)
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Receive pass')
    })
    click(host, 'Receive pass')
    await vi.waitFor(() => {
      expect(licence).toHaveBeenCalledOnce()
    })
    expect(licence.mock.calls[0]?.[0].action).toBe('claim')
  })

  it('says the Card is closed once its claim window has ended', async () => {
    const licence = vi.fn<NonNullable<Parameters<typeof CardScreen>[0]['licence']>>()
    const { host } = open(licence, true, false, 1)
    await vi.waitFor(() => {
      expect(host.querySelector('[role="status"]')).not.toBeNull()
    })
    expect(host.textContent).not.toContain('Receive pass')
  })

  it('reuses PRF guidance before retrying', async () => {
    const licence = vi
      .fn<NonNullable<Parameters<typeof CardScreen>[0]['licence']>>()
      .mockResolvedValueOnce({ failure: 'no_prf', kind: 'failed' })
      .mockResolvedValueOnce({ address, kind: 'applied' })
    const { host } = open(licence)
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Apply with your passkey')
    })
    click(host, 'Apply with your passkey')
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Save a new passkey')
    })
    expect(host.textContent).toContain('iCloud Keychain')
    click(host, 'Try again')
    await vi.waitFor(() => {
      expect(host.textContent).toContain(address)
    })
  })
})
