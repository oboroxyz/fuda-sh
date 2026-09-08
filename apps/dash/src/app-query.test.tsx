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
import { EnsClaim } from './EnsClaim.tsx'
import type { EnsClaimProps } from './EnsClaim.tsx'
import { DEFAULT_OPERATOR_IO } from './operator-io.ts'
import type { OperatorIo } from './operator-io.ts'
import { findViewNodes, viewProps } from './test/test-view.ts'

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
    window.history.replaceState(null, '', '/published')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.body.append(root)
  })

  afterEach(async () => {
    removeMounted?.()
    await setTimeout(0)
    root.replaceChildren()
    root.remove()
    vi.restoreAllMocks()
  })

  it('refreshes an active operator after focus without another passkey ceremony', async () => {
    const operator = operatorIo()
    await start(operator)
    refocus()
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
      id: 'card-1',
      perk: '',
      reward: '',
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
