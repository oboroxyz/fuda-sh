// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import type { IssuerMeResponse, IssuerPassesResponse, IssuerView } from '@fuda/sdk'
import { render } from 'hono/jsx/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App.tsx'
import { DEFAULT_OPERATOR_IO } from './operator-io.ts'
import type { OperatorIo } from './operator-io.ts'
import { saveOperatorToken } from './operator-session.ts'
import { membershipCard, passesResponse, ticketCard } from './test/management-fixtures.ts'

// docs/adr/0009-several-issuers-per-account.md — switching profile keeps the
// session token, so nothing a page loaded for the previous profile may survive.

const issuerView = (id: string, handle: string, name: string): IssuerView => ({
  brandColor: '#112233',
  createdAt: 1,
  handle,
  id,
  logoUrl: null,
  name,
  operatorAddress: `0x${'11'.repeat(20)}`,
  tagline: '',
})
const coffee: IssuerMeResponse = {
  cards: [membershipCard],
  ens: null,
  issuer: issuerView('issuer-1', 'coffee', 'Coffee'),
  publicUrl: 'https://fuda.sh/@coffee',
}
const bar: IssuerMeResponse = {
  cards: [{ ...ticketCard, id: 'card-9', slug: 'night', title: 'Bar night' }],
  ens: null,
  issuer: issuerView('issuer-2', 'bar', 'Bar'),
  publicUrl: 'https://fuda.sh/@bar',
}
const empty: IssuerPassesResponse = {
  cardStats: [],
  page: { number: 1, size: 1, total: 0 },
  passes: [],
  summary: { active: 0, claimedLast30Days: 0, stamps: 0, total: 0, unknown: 0 },
}

let root: HTMLDivElement

const fixture = () => {
  let active = coffee
  return {
    ...DEFAULT_OPERATOR_IO,
    issuerMe: vi
      .fn<OperatorIo['issuerMe']>()
      .mockImplementation(async () => await Promise.resolve({ body: active, ok: true })),
    listPasses: vi
      .fn<OperatorIo['listPasses']>()
      .mockImplementation(
        async () => await Promise.resolve({ body: active === coffee ? passesResponse : empty, ok: true }),
      ),
    ownedIssuers: vi.fn<OperatorIo['ownedIssuers']>().mockResolvedValue({
      body: {
        activeIssuerId: 'issuer-1',
        issuers: [
          { handle: 'coffee', id: 'issuer-1', logoUrl: null, name: 'Coffee' },
          { handle: 'bar', id: 'issuer-2', logoUrl: null, name: 'Bar' },
        ],
      },
      ok: true,
    }),
    switchIssuer: vi.fn<OperatorIo['switchIssuer']>().mockImplementation(async () => {
      active = bar
      return await Promise.resolve({ body: bar, ok: true })
    }),
  }
}

const statValues = (): string[] => [...root.querySelectorAll('.dash-stat dd')].map((dd) => dd.textContent)

const buttonWith = (text: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find((button) => button.textContent.includes(text))
  if (found === undefined) {
    throw new Error(`missing button ${text}`)
  }
  return found
}

describe('switching profile', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState(null, '', '/cards')
    saveOperatorToken('session')
    root = document.createElement('div')
    document.body.append(root)
  })
  afterEach(() => {
    render(null, root)
    root.remove()
  })

  it('shows the new profile’s pass and stamp numbers, never the previous one’s', async () => {
    const operator = fixture()
    render(<App initialTheme="light" operatorIo={operator} />, root)
    await vi.waitFor(() => {
      expect(statValues()).toStrictEqual(['43', '31', '108', '7'])
    })
    await vi.waitFor(() => {
      expect(root.textContent).toContain('@bar')
    })
    buttonWith('@bar').click()
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Bar night')
    })
    await vi.waitFor(() => {
      expect(statValues()).toStrictEqual(['0', '0', '0', '0'])
    })
    expect(operator.listPasses).toHaveBeenCalledTimes(2)
  })
})
