// @vitest-environment happy-dom
/** @jsxImportSource hono/jsx/dom */
import type { IssuerPassesResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { render } from 'hono/jsx/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DASH_COPY } from './copy.ts'
import type { PassesLoad } from './issuer-passes-state.ts'
import { IssuerPassesPage } from './IssuerPassesPage.tsx'
import { membershipCard, passesResponse, ticketCard } from './test/management-fixtures.ts'

let root: HTMLDivElement

const start = (load: PassesLoad): void => {
  render(
    <IssuerPassesPage cards={[membershipCard, ticketCard]} copy={DASH_COPY.en.management} load={load} />,
    root,
  )
}
const button = (label: string) =>
  [...root.querySelectorAll('button')].find((node) => node.textContent === label)!
const row = () => root.querySelector('tbody tr')

describe('Issuer pass list', () => {
  beforeEach(() => {
    root = document.createElement('div')
    document.body.append(root)
  })
  afterEach(() => {
    render(null, root)
    root.remove()
  })

  it('shows full-venue metrics and claim, stamp and address data without treating passes as unique people', async () => {
    start(vi.fn<PassesLoad>().mockResolvedValue({ body: passesResponse, ok: true }))
    await vi.waitFor(() => {
      expect(row()?.textContent).toContain('ABCDEFGHJKLM')
    })
    expect([...root.querySelectorAll('dd')].map((node) => node.textContent)).toStrictEqual([
      '43',
      '31',
      '108',
      '7',
    ])
    expect(row()?.textContent).toContain('Coffee membership')
    expect(row()?.textContent).toContain(`0x${'12'.repeat(20)}`)
    expect(row()?.textContent).toContain('No expiry')
  })

  it('explains aggregate limits and keeps pass credentials private', async () => {
    start(vi.fn<PassesLoad>().mockResolvedValue({ body: passesResponse, ok: true }))
    await vi.waitFor(() => {
      expect(row()).not.toBeNull()
    })
    expect(root.textContent).toContain('Repeat claims may belong to the same person')
    expect(root.textContent).toContain('3 passes have no recorded validity')
    expect(root.querySelector('a[href*="/pass/"]')).toBeNull()
  })

  it('paginates with filtered totals and resets to page one when a filter changes', async () => {
    const load = vi.fn<PassesLoad>().mockImplementation(
      async (query) =>
        await Promise.resolve({
          body: { ...passesResponse, page: { number: query.page, size: 25, total: 43 } },
          ok: true,
        }),
    )
    start(load)
    await vi.waitFor(() => {
      expect(row()).not.toBeNull()
    })
    button('Next').click()
    await vi.waitFor(() => {
      expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 25 }))
    })
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Page 2 of 2')
    })
    const filter = root.querySelector<HTMLSelectElement>('[name=cardId]')!
    filter.value = 'card-2'
    filter.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => {
      expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ cardId: 'card-2', page: 1 }))
    })
  })

  it('ignores stale results after filtering while a previous request is pending', async () => {
    const pending = Promise.withResolvers<Result<IssuerPassesResponse>>()
    const load = vi
      .fn<PassesLoad>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({
        body: { ...passesResponse, page: { number: 1, size: 25, total: 0 }, passes: [] },
        ok: true,
      })
    start(load)
    await vi.waitFor(() => {
      expect(load).toHaveBeenCalledOnce()
    })
    const filter = root.querySelector<HTMLSelectElement>('[name=status]')!
    filter.value = 'revoked'
    filter.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => {
      expect(root.textContent).toContain('No passes match')
    })
    pending.resolve({ body: passesResponse, ok: true })
    await vi.waitFor(() => {
      expect(root.textContent).not.toContain('ABCDEFGHJKLM')
    })
    expect(root.querySelector('tbody tr')).toBeNull()
  })

  it('debounces member searches and offers a retry after network failure', async () => {
    const load = vi
      .fn<PassesLoad>()
      .mockResolvedValueOnce({ error: 'offline', network: true, ok: false, status: 0 })
      .mockResolvedValue({ body: passesResponse, ok: true })
    start(load)
    await vi.waitFor(() => {
      expect(root.querySelector('[role=alert]')?.textContent).toContain('Could not load')
    })
    button('Try again').click()
    await vi.waitFor(() => {
      expect(row()).not.toBeNull()
    })
    const search = root.querySelector<HTMLInputElement>('input[type=search]')!
    search.value = 'ABC'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    search.value = 'ABCDEFGH'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => {
      expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, q: 'ABCDEFGH' }))
    })
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('renders unknown expiry and absent addresses without inventing values', async () => {
    start(
      vi.fn<PassesLoad>().mockResolvedValue({
        body: {
          ...passesResponse,
          passes: [
            {
              ...passesResponse.passes[0],
              holder: null,
              status: 'unknown',
              validFrom: null,
              validUntil: null,
            },
          ],
        },
        ok: true,
      }),
    )
    await vi.waitFor(() => {
      expect(row()?.textContent).toContain('Not recorded')
    })
    expect(row()?.textContent).toContain('Unconfirmed')
    expect(row()?.textContent).not.toContain('No expiry')
  })
})
