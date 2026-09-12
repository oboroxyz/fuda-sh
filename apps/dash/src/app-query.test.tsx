// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import { setTimeout } from 'node:timers/promises'

import type { IssuerMeResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { render, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DashIo } from './app-actions.ts'
import { App } from './App.tsx'
import type { AppViewProps } from './AppView.tsx'
import { EMPTY_FORM } from './card-designer.ts'
import { readPendingEnsClaim, writePendingEnsClaim } from './ens-pending.ts'
import { EnsClaim } from './EnsClaim.tsx'
import type { EnsClaimProps } from './EnsClaim.tsx'
import { DEFAULT_OPERATOR_IO } from './operator-io.ts'
import type { OperatorIo } from './operator-io.ts'
import { membershipCard, passesResponse } from './test/management-fixtures.ts'
import { findViewNodes, viewProps } from './test/test-view.ts'
import { EMPTY_VENUE_FORM } from './venue.ts'

const output = vi.hoisted(() => ({ current: null as AppViewProps | null }))
vi.mock(import('./AppView.tsx'), () => ({
  AppView: (props: AppViewProps): JSX.Element => {
    output.current = props
    return <div />
  },
}))

const issuer: IssuerMeResponse = {
  cards: [],
  ens: null,
  issuer: {
    brandColor: '#112233',
    createdAt: 1,
    handle: 'coffee',
    id: 'issuer-1',
    logoUrl: null,
    name: 'Coffee',
    operatorAddress: `0x${'11'.repeat(20)}`,
    tagline: '',
  },
  publicUrl: 'https://fuda.sh/@coffee',
}
const updated: IssuerMeResponse = { ...issuer, publicUrl: 'https://fuda.sh/@new-coffee' }
const expired = { error: 'unauthorized', network: false, ok: false, status: 401 } as const
const io: DashIo = {
  issueRight: vi.fn<DashIo['issueRight']>(),
  listMembers: vi.fn<DashIo['listMembers']>().mockResolvedValue({ body: { members: [] }, ok: true }),
  revokeRight: vi.fn<DashIo['revokeRight']>(),
}
const view = (): AppViewProps => {
  if (output.current === null) {
    throw new Error('App did not render')
  }
  return output.current
}
const operatorIo = () => ({
  ...DEFAULT_OPERATOR_IO,
  issuerMe: vi.fn<OperatorIo['issuerMe']>().mockResolvedValue({ body: updated, ok: true }),
  signIn: vi.fn<OperatorIo['signIn']>().mockResolvedValue({ issuer, ok: true, token: 'session' }),
  signOut: vi.fn<OperatorIo['signOut']>().mockResolvedValue({ body: { loggedOut: true }, ok: true }),
})

const root = document.createElement('div')
let removeMounted: (() => void) | undefined

const Mount = ({ children }: { children: JSX.Element }): JSX.Element | null => {
  const [mounted, setMounted] = useState(true)
  removeMounted = () => {
    setMounted(false)
  }
  return mounted ? children : null
}

const start = async (operator: OperatorIo): Promise<void> => {
  render(
    <Mount>
      <App initialTheme="light" io={io} operatorIo={operator} />
    </Mount>,
    root,
  )
  await vi.waitFor(() => {
    expect(output.current).not.toBeNull()
  })
  view().onPasskey()
  await vi.waitFor(() => {
    expect(view().session.token).toBe('session')
  })
}
const refocus = (): void => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000)
  window.dispatchEvent(new Event('visibilitychange'))
}

describe('dashboard query lifecycle', () => {
  beforeEach(() => {
    output.current = null
    removeMounted = undefined
    window.localStorage.clear()
    window.history.replaceState(null, '', '/cards')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.body.append(root)
  })

  afterEach(async () => {
    // Dispose session queries before unmount so queued effects cannot refresh
    // an earlier test's controller into the shared AppView capture.
    if (output.current !== null && output.current.session.token !== null) {
      output.current.onSignOut()
      await vi.waitUntil(() => view().session.token === null)
    }
    removeMounted?.()
    await setTimeout(0)
    render(null, root)
    root.remove()
    vi.restoreAllMocks()
  })

  it('updates the Card list after an edit and keeps the edit route selected', async () => {
    const owned: IssuerMeResponse = { ...issuer, cards: [membershipCard] }
    const card = { ...membershipCard, lockScreen: false, title: 'Updated title', venue: null }
    const operator = {
      ...operatorIo(),
      issuerMe: vi.fn<OperatorIo['issuerMe']>().mockResolvedValue({ body: owned, ok: true }),
      signIn: vi.fn<OperatorIo['signIn']>().mockResolvedValue({ issuer: owned, ok: true, token: 'session' }),
      updateCard: vi.fn<OperatorIo['updateCard']>().mockResolvedValue({ body: { card }, ok: true }),
    }
    await start(operator)
    view().onNavigate('/cards/membership/edit')
    await vi.waitFor(() => {
      expect(view().route).toBe('/cards/membership/edit')
    })
    await view().cardManagement.save('card-1', {
      category: 'membership',
      claimFrom: null,
      claimUntil: null,
      description: '',
      lockScreen: false,
      title: 'Updated title',
      validFrom: null,
      validUntil: null,
      validityDays: null,
    })
    await vi.waitFor(() => {
      expect(view().session.operator?.cards[0]?.title).toBe('Updated title')
    })
    expect(view().route).toBe('/cards/membership/edit')
    expect(location.pathname).toBe('/cards/membership/edit')
  })

  it.each(['membership', null] as const)(
    'saves default Card %s into the active issuer cache',
    async (slug) => {
      const changedIssuer = { ...issuer.issuer, defaultCardSlug: slug }
      const save = vi
        .fn<OperatorIo['updateDefaultCard']>()
        .mockResolvedValue({ body: { issuer: changedIssuer }, ok: true })
      const operator = { ...operatorIo(), updateDefaultCard: save } as OperatorIo
      await start(operator)

      await expect(view().onDefaultCard(slug)).resolves.toBe(true)

      expect(save).toHaveBeenCalledExactlyOnceWith('session', { slug })
      await vi.waitFor(() => {
        expect(view().session.operator?.issuer).toStrictEqual(changedIssuer)
      })
    },
  )

  it.each(['default-first', 'profile-first'])(
    'preserves concurrent default Card and profile writes: %s',
    async (order) => {
      const defaultWrite = Promise.withResolvers<{
        body: { issuer: typeof issuer.issuer & { defaultCardSlug: string } }
        ok: true
      }>()
      const profileWrite = Promise.withResolvers<Awaited<ReturnType<OperatorIo['updateIssuer']>>>()
      const profile = { brandColor: '#0073EB', name: 'New Coffee', tagline: 'New tagline' }
      const save = vi.fn<OperatorIo['updateDefaultCard']>().mockReturnValue(defaultWrite.promise)
      const operator = { ...operatorIo(), updateDefaultCard: save } as OperatorIo
      vi.spyOn(operator, 'updateIssuer').mockReturnValue(profileWrite.promise)
      await start(operator)

      const savingDefault = view().onDefaultCard('membership')
      const savingProfile = view().onUpdateVenue(profile)
      const resolveDefault = (): void => {
        defaultWrite.resolve({
          body: { issuer: { ...issuer.issuer, defaultCardSlug: 'membership' } },
          ok: true,
        })
      }
      const resolveProfile = (): void => {
        profileWrite.resolve({ body: { issuer: { ...issuer.issuer, ...profile } }, ok: true })
      }
      if (order === 'default-first') {
        resolveDefault()
        await savingDefault
        resolveProfile()
      } else {
        resolveProfile()
        await savingProfile
        resolveDefault()
      }
      await Promise.all([savingDefault, savingProfile])

      await vi.waitFor(() => {
        expect(view().session.operator?.issuer).toStrictEqual({
          ...issuer.issuer,
          ...profile,
          defaultCardSlug: 'membership',
        })
      })
    },
  )

  it('ends an expired session and ignores a default Card response after sign-out', async () => {
    const late = Promise.withResolvers<{
      body: { issuer: typeof issuer.issuer & { defaultCardSlug: string } }
      ok: true
    }>()
    const save = vi
      .fn<OperatorIo['updateDefaultCard']>()
      .mockResolvedValueOnce(expired)
      .mockReturnValueOnce(late.promise)
    const operator = { ...operatorIo(), updateDefaultCard: save } as OperatorIo
    await start(operator)

    await expect(view().onDefaultCard('membership')).resolves.toBe(false)
    await vi.waitFor(() => {
      expect(view().session.token).toBeNull()
    })
    view().onPasskey()
    await vi.waitFor(() => {
      expect(view().session.token).toBe('session')
    })
    const saving = view().onDefaultCard('membership')
    view().onSignOut()
    late.resolve({
      body: { issuer: { ...issuer.issuer, defaultCardSlug: 'membership' } },
      ok: true,
    })
    await expect(saving).resolves.toBe(false)
    expect(view().session.operator).toBeNull()
  })

  it.each([
    { outcome: 'success', token: 'session' },
    { outcome: 'unauthorized', token: null },
  ] as const)(
    'handles a superseded Card save returning $outcome after a newer edit',
    async ({ outcome, token }) => {
      const pending = Promise.withResolvers<Awaited<ReturnType<OperatorIo['updateCard']>>>()
      const owned: IssuerMeResponse = { ...issuer, cards: [membershipCard] }
      const card = { ...membershipCard, lockScreen: false, title: 'New edit', venue: null }
      const operator = {
        ...operatorIo(),
        issuerMe: vi.fn<OperatorIo['issuerMe']>().mockResolvedValue({ body: owned, ok: true }),
        signIn: vi
          .fn<OperatorIo['signIn']>()
          .mockResolvedValue({ issuer: owned, ok: true, token: 'session' }),
        updateCard: vi
          .fn<OperatorIo['updateCard']>()
          .mockReturnValueOnce(pending.promise)
          .mockResolvedValue({ body: { card }, ok: true }),
      }
      await start(operator)
      const body = {
        category: 'membership' as const,
        claimFrom: null,
        claimUntil: null,
        description: '',
        lockScreen: false,
        title: 'Old edit',
        validFrom: null,
        validUntil: null,
        validityDays: null,
      }
      view().onNavigate('/cards/membership/edit')
      await vi.waitFor(() => {
        expect(view().route).toBe('/cards/membership/edit')
      })
      const old = view().cardManagement.save('card-1', body)
      view().onNavigate('/cards')
      await vi.waitFor(() => {
        expect(view().route).toBe('/cards')
      })
      view().onNavigate('/cards/membership/edit')
      await vi.waitFor(() => {
        expect(view().route).toBe('/cards/membership/edit')
      })
      await view().cardManagement.save('card-1', { ...body, title: 'New edit' })
      await vi.waitFor(() => {
        expect(view().session.operator?.cards[0]?.title).toBe('New edit')
      })
      pending.resolve(
        outcome === 'unauthorized'
          ? expired
          : {
              body: { card: { ...card, title: 'Old edit' } },
              ok: true,
            },
      )
      await old
      await setTimeout(0)
      const expectedOperator = outcome === 'success' ? { ...owned, cards: [card] } : null
      await vi.waitFor(() => {
        expect(view().session.token).toBe(token)
        expect(view().session.operator).toStrictEqual(expectedOperator)
      })
    },
  )

  it('discards a late Card update after sign-out', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<OperatorIo['updateCard']>>>()
    const operator = {
      ...operatorIo(),
      updateCard: vi.fn<OperatorIo['updateCard']>().mockReturnValue(pending.promise),
    }
    await start(operator)
    const result = view().cardManagement.save('card-1', {
      category: 'membership',
      claimFrom: null,
      claimUntil: null,
      description: '',
      lockScreen: false,
      title: 'Old edit',
      validFrom: null,
      validUntil: null,
      validityDays: null,
    })
    view().onSignOut()
    pending.resolve({
      body: { card: { ...membershipCard, lockScreen: false, title: 'Old edit', venue: null } },
      ok: true,
    })
    await result
    await vi.waitFor(() => {
      expect(view().session.token).toBeNull()
    })
    expect(view().session.operator).toBeNull()
  })

  it('invalidates an expired session from the pass list and ignores a replaced-session failure', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<OperatorIo['listPasses']>>>()
    const listPasses = vi
      .fn<OperatorIo['listPasses']>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ body: passesResponse, ok: true })
      .mockResolvedValue(expired)
    const operator = { ...operatorIo(), listPasses }
    await start(operator)
    const old = view().loadPasses({ page: 1, pageSize: 25 })
    view().onSignOut()
    await vi.waitFor(() => {
      expect(view().session.token).toBeNull()
    })
    view().onPasskey()
    await vi.waitFor(() => {
      expect(view().session.token).toBe('session')
    })
    pending.resolve(expired)
    await old
    expect(view().session.token).toBe('session')
    await view().loadPasses({ page: 1, pageSize: 25 })
    await view().loadPasses({ page: 1, pageSize: 25 })
    await vi.waitFor(() => {
      expect(view().session.token).toBeNull()
    })
  })

  it('refreshes an active operator after focus without another passkey ceremony', async () => {
    const operator = operatorIo()
    await start(operator)
    refocus()
    await vi.waitFor(() => {
      expect(operator.issuerMe).toHaveBeenCalledWith('session')
    })
    await vi.waitFor(() => {
      expect(view().session.operator?.publicUrl).toBe('https://fuda.sh/@new-coffee')
    })
    expect(operator.signIn).toHaveBeenCalledOnce()
  })

  it('ends the session when background revalidation returns 401', async () => {
    const operator = operatorIo()
    operator.issuerMe.mockResolvedValue(expired)
    await start(operator)
    refocus()
    await vi.waitFor(() => {
      expect(view().session).toMatchObject({ authError: 'unauthorized', token: null })
    })
  })

  it.each(['sign-out', 'unauthorized'])(
    'discards the profile-return card draft after %s, even when the same token signs in again',
    async (reason) => {
      const operator = operatorIo()
      await start(operator)
      view().onEditProfile({ ...EMPTY_FORM, title: 'Previous session draft' })
      await vi.waitFor(() => {
        expect(view().cardDraft?.title).toBe('Previous session draft')
      })
      if (reason === 'sign-out') {
        view().onSignOut()
      } else {
        operator.issuerMe.mockResolvedValue(expired)
        refocus()
      }
      await vi.waitFor(() => {
        expect(view().session.token).toBeNull()
      })
      operator.issuerMe.mockResolvedValue({ body: issuer, ok: true })
      view().onPasskey()
      await vi.waitFor(() => {
        expect(view().session.token).toBe('session')
      })
      expect(view().cardDraft).toBeNull()
    },
  )

  it('keeps the operator visible when background revalidation fails', async () => {
    const operator = operatorIo()
    operator.issuerMe.mockResolvedValue({ error: 'offline', network: true, ok: false, status: 503 })
    await start(operator)
    refocus()
    await vi.waitFor(() => {
      expect(operator.issuerMe).toHaveBeenCalledWith('session')
    })
    expect(view().session).toMatchObject({ operator: issuer, token: 'session' })
  })

  it('ignores an old background read after replacement with the same token', async () => {
    const operator = operatorIo()
    const pending = Promise.withResolvers<Result<IssuerMeResponse>>()
    operator.issuerMe.mockReturnValue(pending.promise)
    await start(operator)
    refocus()
    await vi.waitFor(() => {
      expect(operator.issuerMe).toHaveBeenCalledWith('session')
    })
    view().onSignOut()
    await vi.waitFor(() => {
      expect(view().session.token).toBeNull()
    })
    operator.signIn.mockResolvedValue({ issuer: updated, ok: true, token: 'session' })
    view().onPasskey()
    await vi.waitFor(() => {
      expect(view().session.operator).toStrictEqual(updated)
    })
    pending.resolve({ body: issuer, ok: true })
    await setTimeout(25)
    expect(view().session.operator).toStrictEqual(updated)
  })

  it('keeps a successful create when an older issuer read finishes afterward', async () => {
    const operator = operatorIo()
    const pending = Promise.withResolvers<Result<IssuerMeResponse>>()
    operator.issuerMe.mockReturnValue(pending.promise)
    const card = {
      category: 'membership' as const,
      claimFrom: null,
      claimUntil: null,
      claimable: true,
      description: '',
      id: 'card-1',
      slug: 'membership-card',
      title: 'Membership',
      validFrom: null,
      validUntil: null,
      validityDays: null,
    }
    operator.design = {
      ...operator.design,
      createCard: vi.fn<OperatorIo['design']['createCard']>().mockResolvedValue({
        body: { card, issuer: issuer.issuer, publicUrl: issuer.publicUrl },
        ok: true,
      }),
    }
    await start(operator)
    refocus()
    await vi.waitFor(() => {
      expect(operator.issuerMe).toHaveBeenCalledWith('session')
    })
    view().onCreate('card', { ...EMPTY_FORM, slug: 'membership-card', title: 'Membership' }, null)
    await vi.waitFor(() => {
      expect(view().session.operator?.cards).toStrictEqual([card])
    })
    pending.resolve({ body: issuer, ok: true })
    await setTimeout(25)
    expect(view().session.operator?.cards).toStrictEqual([card])
  })

  it('registers a venue with zero cards and stays on the venue route for ENS', async () => {
    const operator = operatorIo()
    const unregistered: IssuerMeResponse = { cards: [], ens: null, issuer: null, publicUrl: null }
    const registered: IssuerMeResponse = {
      ...issuer,
      ens: { claimTxHash: null, expiry: null, name: 'coffee.fuda.eth', status: 'unclaimed' },
    }
    operator.signIn.mockResolvedValue({ issuer: unregistered, ok: true, token: 'session' })
    operator.design = {
      ...operator.design,
      createIssuer: vi
        .fn<OperatorIo['design']['createIssuer']>()
        .mockResolvedValue({ body: registered, ok: true }),
    }
    await start(operator)
    view().onCreateVenue({ ...EMPTY_VENUE_FORM, handle: 'coffee', name: 'Coffee' }, null)
    await vi.waitFor(() => {
      expect(view().session.operator).toStrictEqual(registered)
      expect(view().route).toBe('/profile')
    })
  })

  it.each([
    {
      ens: {
        claimTxHash: `0x${'bb'.repeat(32)}`,
        expiry: null,
        name: 'coffee.fuda.eth',
        status: 'claimed' as const,
      },
      label: 'already claimed',
    },
    {
      ens: { claimTxHash: null, expiry: null, name: 'new-coffee.fuda.eth', status: 'unclaimed' as const },
      label: 'a changed name',
    },
  ] satisfies { ens: IssuerMeResponse['ens']; label: string }[])(
    'discards a stored receipt when the server reports $label',
    async ({ ens }) => {
      const pending = { name: 'coffee.fuda.eth', txHash: `0x${'aa'.repeat(32)}` as const }
      writePendingEnsClaim(issuer.issuer.id, pending)
      const operator = operatorIo()
      operator.signIn.mockResolvedValue({ issuer: { ...issuer, ens }, ok: true, token: 'session' })
      await start(operator)
      expect(readPendingEnsClaim(issuer.issuer.id)).toBeNull()
      expect((viewProps(findViewNodes(view().ens, EnsClaim)[0]) as unknown as EnsClaimProps).state.kind).toBe(
        ens.status === 'claimed' ? 'claimed' : 'unclaimed',
      )
    },
  )

  it('resumes a stored receipt only when it matches the current unclaimed ENS name', async () => {
    const pending = { name: 'coffee.fuda.eth', txHash: `0x${'aa'.repeat(32)}` as const }
    writePendingEnsClaim(issuer.issuer.id, pending)
    const operator = operatorIo()
    operator.signIn.mockResolvedValue({
      issuer: {
        ...issuer,
        ens: { claimTxHash: null, expiry: null, name: pending.name, status: 'unclaimed' },
      },
      ok: true,
      token: 'session',
    })
    await start(operator)
    expect(
      (viewProps(findViewNodes(view().ens, EnsClaim)[0]) as unknown as EnsClaimProps).state,
    ).toMatchObject({ kind: 'failed', ...pending })
  })

  it('keeps every card when cards are created one after another', async () => {
    const operator = operatorIo()
    const cards = ['membership', 'summer'].map((slug, index) => ({
      category: 'membership' as const,
      claimFrom: null,
      claimUntil: null,
      claimable: true,
      description: '',
      id: `card-${index}`,
      slug,
      title: slug,
      validFrom: null,
      validUntil: null,
      validityDays: null,
    }))
    operator.signIn.mockResolvedValue({
      issuer: {
        ...issuer,
        ens: {
          claimTxHash: `0x${'aa'.repeat(32)}`,
          expiry: null,
          name: 'coffee.fuda.eth',
          status: 'claimed',
        },
      },
      ok: true,
      token: 'session',
    })
    operator.design = {
      ...operator.design,
      createCard: vi
        .fn<OperatorIo['design']['createCard']>()
        .mockResolvedValueOnce({
          body: { card: cards[0], issuer: issuer.issuer, publicUrl: issuer.publicUrl },
          ok: true,
        })
        .mockResolvedValueOnce({
          body: { card: cards[1], issuer: issuer.issuer, publicUrl: issuer.publicUrl },
          ok: true,
        }),
    }
    await start(operator)
    view().onCreate('card', { ...EMPTY_FORM, slug: cards[0].slug, title: cards[0].title }, null)
    await vi.waitFor(() => {
      expect(view().session.operator?.cards).toHaveLength(1)
    })
    view().onCreate('card', { ...EMPTY_FORM, slug: cards[1].slug, title: cards[1].title }, null)
    await vi.waitFor(() => {
      expect(view().session.operator?.cards).toStrictEqual(cards)
    })
  })

  it('keeps a committed logo when an older issuer read finishes afterward', async () => {
    const operator = operatorIo()
    const pending = Promise.withResolvers<Result<IssuerMeResponse>>()
    operator.issuerMe.mockReturnValue(pending.promise)
    const changedIssuer = { ...issuer.issuer, logoUrl: 'https://api.fuda.sh/logo/new' }
    operator.design = {
      ...operator.design,
      commitLogo: vi.fn<OperatorIo['design']['commitLogo']>().mockResolvedValue({
        body: { issuer: changedIssuer },
        ok: true,
      }),
      uploadLogo: vi.fn<OperatorIo['design']['uploadLogo']>().mockResolvedValue({
        body: { expiresAt: 100, logoUploadId: 'upload' },
        ok: true,
      }),
    }
    await start(operator)
    refocus()
    await vi.waitFor(() => {
      expect(operator.issuerMe).toHaveBeenCalledWith('session')
    })
    const blob = new Blob(['logo'], { type: 'image/png' })
    await expect(
      view().onCommitLogo({ logo1x: blob, logo2x: blob, logo3x: blob, master: blob }),
    ).resolves.toBe(true)
    await vi.waitFor(() => {
      expect(view().session.operator?.issuer?.logoUrl).toBe(changedIssuer.logoUrl)
    })
    pending.resolve({ body: issuer, ok: true })
    await setTimeout(25)
    expect(view().session.operator?.issuer?.logoUrl).toBe(changedIssuer.logoUrl)
  })

  it('keeps a saved venue profile when an older issuer read finishes', async () => {
    const operator = operatorIo()
    const pending = Promise.withResolvers<Result<IssuerMeResponse>>()
    const body = { brandColor: '#0073EB', name: 'New Coffee', tagline: 'New tagline' }
    const changedIssuer = { ...issuer.issuer, ...body }
    operator.issuerMe.mockReturnValue(pending.promise)
    vi.spyOn(operator, 'updateIssuer').mockResolvedValue({
      body: { issuer: changedIssuer },
      ok: true,
    })
    await start(operator)
    refocus()
    await vi.waitFor(() => {
      expect(operator.issuerMe).toHaveBeenCalledExactlyOnceWith('session')
    })

    await expect(view().onUpdateVenue(body)).resolves.toBe(true)
    expect(operator.updateIssuer).toHaveBeenCalledExactlyOnceWith('session', body)
    await vi.waitFor(() => {
      expect(view().session.operator).toStrictEqual({ ...issuer, issuer: changedIssuer })
    })
    pending.resolve({ body: issuer, ok: true })
    await setTimeout(25)
    expect(view().session.operator?.issuer).toStrictEqual(changedIssuer)
  })

  it.each(['profile-first', 'logo-first'])('preserves both concurrent venue writes: %s', async (order) => {
    const operator = operatorIo()
    const profileWrite = Promise.withResolvers<Awaited<ReturnType<OperatorIo['updateIssuer']>>>()
    const logoWrite = Promise.withResolvers<Awaited<ReturnType<OperatorIo['design']['commitLogo']>>>()
    const body = { brandColor: '#0073EB', name: 'New Coffee', tagline: 'New tagline' }
    const logoUrl = 'https://api.fuda.sh/logo/new'
    vi.spyOn(operator, 'updateIssuer').mockReturnValue(profileWrite.promise)
    operator.design = {
      ...operator.design,
      commitLogo: vi.fn<OperatorIo['design']['commitLogo']>().mockReturnValue(logoWrite.promise),
      uploadLogo: vi.fn<OperatorIo['design']['uploadLogo']>().mockResolvedValue({
        body: { expiresAt: 100, logoUploadId: 'upload' },
        ok: true,
      }),
    }
    await start(operator)
    const savingProfile = view().onUpdateVenue(body)
    const blob = new Blob(['logo'], { type: 'image/png' })
    const savingLogo = view().onCommitLogo({ logo1x: blob, logo2x: blob, logo3x: blob, master: blob })
    const resolveProfile = (): void => {
      profileWrite.resolve({ body: { issuer: { ...issuer.issuer, ...body } }, ok: true })
    }
    const resolveLogo = (): void => {
      logoWrite.resolve({ body: { issuer: { ...issuer.issuer, logoUrl } }, ok: true })
    }
    if (order === 'profile-first') {
      resolveProfile()
      await savingProfile
      resolveLogo()
    } else {
      resolveLogo()
      await savingLogo
      resolveProfile()
    }
    await Promise.all([savingProfile, savingLogo])
    await vi.waitFor(() => {
      expect(view().session.operator?.issuer).toStrictEqual({ ...issuer.issuer, ...body, logoUrl })
    })
  })

  it.each(['success', 'failure'])('retains confirmed ENS state after issuer refresh $0', async (refresh) => {
    const operator = operatorIo()
    const tx = `0x${'aa'.repeat(32)}` as const
    const ens = { claimTxHash: tx, expiry: null, name: 'coffee.fuda.eth', status: 'claimed' as const }
    operator.signIn.mockResolvedValue({
      issuer: { ...issuer, ens: { ...ens, claimTxHash: null, status: 'unclaimed' } },
      ok: true,
      token: 'session',
    })
    operator.issuerMe.mockResolvedValue(
      refresh === 'success'
        ? { body: { ...updated, ens }, ok: true }
        : { error: 'forbidden', network: false, ok: false, status: 403 },
    )
    operator.claim = () => ({
      confirmClaim: vi
        .fn<ReturnType<OperatorIo['claim']>['confirmClaim']>()
        .mockResolvedValue({ body: ens, ok: true }),
      requestVoucher: vi.fn<ReturnType<OperatorIo['claim']>['requestVoucher']>().mockResolvedValue({
        body: {
          chainId: 11_155_111,
          name: ens.name,
          voucher: {
            deadline: 100,
            expiry: 200,
            issuer: `0x${'11'.repeat(20)}`,
            label: 'coffee',
            nonce: '1',
            registrar: `0x${'22'.repeat(20)}`,
            signature: `0x${'aa'.repeat(65)}`,
          },
        },
        ok: true,
      }),
      submitClaim: vi.fn<ReturnType<OperatorIo['claim']>['submitClaim']>().mockResolvedValue(tx),
    })
    await start(operator)
    const ensView = viewProps(findViewNodes(view().ens, EnsClaim)[0]) as unknown as EnsClaimProps
    ensView.onClaim()
    await vi.waitFor(() => {
      expect(operator.issuerMe).toHaveBeenCalledExactlyOnceWith('session')
      expect(view().session.operator).toStrictEqual({ ...(refresh === 'success' ? updated : issuer), ens })
    })
    await setTimeout(25)
    const confirmedView = viewProps(findViewNodes(view().ens, EnsClaim)[0]) as unknown as EnsClaimProps
    expect(confirmedView.state).toMatchObject({ kind: 'claimed', name: ens.name })
  })
})
