// @vitest-environment happy-dom
import { pick } from '@fuda/i18n'
import type { RevokeResponse } from '@fuda/sdk'
import { createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Result } from './api.ts'
import { DASH_COPY } from './copy.ts'
import type { MembersState } from './members-state.ts'
import type { MemberRowView } from './members-view.ts'
import { RightsPage } from './RightsPage.tsx'
import { buttonNamed, choose, cleanup, flush, mount, spacedText, typeInto } from './test/render.tsx'

const UID = `0x${'ab'.repeat(32)}` as const
const row: MemberRowView = {
  holder: null,
  holderShort: null,
  human: false,
  level: 'private',
  memberId: 'alice',
  passUrls: null,
  qr: `fuda:v1:${UID}`,
  status: 'active',
  tier: 'GENERAL',
  uid: UID,
}
const success: Result<RevokeResponse> = { body: { revoked: true, uid: UID }, ok: true }
const copy = pick(DASH_COPY, 'en')
const ready: MembersState = { kind: 'ready', rows: [row] }

type Revoke = (uid: string) => Promise<Result<RevokeResponse>>

// What a list page says about its own state: the source is empty, or the filters are.
const says = (host: HTMLElement) => ({
  empty: spacedText(host).includes('No rights have been issued.'),
  filtered: spacedText(host).includes('No rights match these filters.'),
})

interface Shown {
  host: HTMLElement
  setMembers: (next: MembersState) => void
}

const show = (
  members: MembersState = ready,
  onRevoke: Revoke = async () => await Promise.resolve(success),
  locale: 'en' | 'ja' = 'en',
): Shown => {
  const [state, setState] = createSignal(members)
  const host = mount(() => (
    <RightsPage
      copy={DASH_COPY[locale]}
      graphEndpoint="https://index.example/rights"
      members={state()}
      onRevoke={onRevoke}
    />
  ))
  return {
    host,
    setMembers: (next) => {
      setState(next)
    },
  }
}

const dialog = (host: HTMLElement): HTMLDialogElement => host.querySelector('dialog')!
const tableRevoke = (host: HTMLElement): HTMLButtonElement =>
  buttonNamed(host.querySelector('[data-testid="rights-table"]')!, 'Revoke')
const confirmButton = (host: HTMLElement): HTMLButtonElement =>
  dialog(host).querySelector<HTMLButtonElement>('.btn-error')!
const cancelButton = (host: HTMLElement): HTMLButtonElement => buttonNamed(dialog(host), 'Cancel')
const search = (host: HTMLElement): HTMLInputElement =>
  host.querySelector<HTMLInputElement>('input[aria-label="Search rights"]')!

// Whether a page in this state lists the right and shows the given message.
const page = (members: MembersState, message: string) => {
  const { host } = show(members)
  return {
    listed: host.querySelector(`[data-right-uid="${UID}"]`) !== null,
    says: spacedText(host).includes(message),
  }
}

describe('rights page', () => {
  afterEach(cleanup)

  it('distinguishes source-empty from filtered-empty and clears filters without loading', () => {
    const empty = show({ kind: 'ready', rows: [] }).host
    const { host } = show()
    typeInto(search(host), 'nobody')
    const filtered = says(host)
    buttonNamed(host, 'Clear filters').click()

    expect({
      cleared: {
        query: search(host).value,
        records: host.querySelectorAll(`[data-right-uid="${UID}"]`).length,
      },
      empty: says(empty),
      filtered,
    }).toStrictEqual({
      cleared: { query: '', records: 2 },
      empty: { empty: true, filtered: false },
      filtered: { empty: false, filtered: true },
    })
  })

  it('preserves rights during refresh and errors while keeping chain lookup separate', () => {
    const stale = show({ kind: 'error', message: 'D1 offline', previousRows: [row] }).host
    // The chain lookup is its own section, outside the D1 list.
    const chain = stale.querySelector(`section[aria-label="${copy.chain.title}"]`)

    expect({
      chain: {
        lookup: chain?.querySelector('#chain-holder') !== null,
        separate: chain?.querySelector('[data-testid="rights-table"]') === null,
      },
      error: page({ kind: 'error', message: 'D1 unavailable', previousRows: null }, 'D1 unavailable'),
      initial: page({ kind: 'loading', previousRows: null }, 'Refreshing rights'),
      initialEmpty: page({ kind: 'loading', previousRows: null }, 'No rights have been issued.').says,
      refreshing: page({ kind: 'loading', previousRows: [row] }, 'Refreshing rights'),
      stale: page({ kind: 'error', message: 'D1 offline', previousRows: [row] }, 'D1 offline'),
    }).toStrictEqual({
      chain: { lookup: true, separate: true },
      error: { listed: false, says: true },
      initial: { listed: false, says: true },
      initialEmpty: false,
      refreshing: { listed: true, says: true },
      stale: { listed: true, says: true },
    })
  })

  it.each([
    ['en', 'Could not load rights', 'Showing last loaded rights; their status may be out of date.'],
    [
      'ja',
      '権利を読み込めませんでした',
      '最後に読み込んだ権利を表示中です。ステータスは最新でない可能性があります。',
    ],
  ] as const)(
    'explains initial and refresh load failures beside the retained rights in %s',
    (locale, errorPrefix, stale) => {
      const failure = { kind: 'error', message: 'D1_UNAVAILABLE [42]' } as const
      const initial = show({ ...failure, previousRows: null }, undefined, locale).host
      const refreshed = show({ ...failure, previousRows: [row] }, undefined, locale).host

      const alert = `${errorPrefix}: D1_UNAVAILABLE [42]`
      expect({
        alerts: [initial, refreshed].map((host) => spacedText(host.querySelector('[role="alert"]'))),
        initial: {
          listed: initial.querySelector('[data-testid="rights-table"]') !== null,
          stale: spacedText(initial).includes(stale),
        },
        ready: spacedText(show(ready, undefined, locale).host).includes(stale),
        refreshed: {
          listed: refreshed.querySelector(`[data-right-uid="${UID}"]`) !== null,
          stale: spacedText(refreshed.querySelector('section[aria-labelledby="rights-title"]')).includes(
            stale,
          ),
        },
      }).toStrictEqual({
        alerts: [alert, alert],
        initial: { listed: false, stale: false },
        ready: false,
        refreshed: { listed: true, stale: true },
      })
    },
  )

  it('connects confirmation to the UID, suppresses immediate duplicates, and closes on success', async () => {
    const pending = Promise.withResolvers<Result<RevokeResponse>>()
    const onRevoke = vi.fn<Revoke>(async () => await pending.promise)
    const { host } = show(ready, onRevoke)

    tableRevoke(host).click()
    expect(dialog(host).open).toBe(true)
    expect(dialog(host).querySelector('code')?.getAttribute('title')).toBe(UID)

    confirmButton(host).click()
    confirmButton(host).click()
    cancelButton(host).click()
    expect(onRevoke).toHaveBeenCalledExactlyOnceWith(UID)
    expect({
      confirm: confirmButton(host).disabled,
      open: dialog(host).open,
      revoke: tableRevoke(host).disabled,
    }).toStrictEqual({ confirm: true, open: true, revoke: true })

    pending.resolve(success)
    await vi.waitFor(() => {
      expect(dialog(host).open).toBe(false)
    })
    // Closed with no target: nothing to confirm, and Cancel is free again.
    expect({ cancel: cancelButton(host).disabled, confirm: confirmButton(host).disabled }).toStrictEqual({
      cancel: false,
      confirm: true,
    })
  })

  it('keeps raw non-401 errors in the dialog, clears busy, and allows a successful retry', async () => {
    const onRevoke = vi
      .fn<Revoke>()
      .mockResolvedValueOnce({ error: 'RPC says: denied [42]', network: false, ok: false, status: 503 })
      .mockResolvedValueOnce(success)
    const { host } = show(ready, onRevoke)

    tableRevoke(host).click()
    confirmButton(host).click()
    await vi.waitFor(() => {
      expect(spacedText(dialog(host))).toContain('Revoke failed: RPC says: denied [42]')
    })
    expect(dialog(host).open).toBe(true)
    expect(confirmButton(host).disabled).toBe(false)

    confirmButton(host).click()
    expect(dialog(host).querySelector('[role="alert"]')).toBeNull()
    await vi.waitFor(() => {
      expect(dialog(host).open).toBe(false)
    })
    expect(onRevoke).toHaveBeenCalledTimes(2)
  })

  it('restores the actual clicked invoker after cancel and after a revoke', async () => {
    const { host } = show()
    const elsewhere = document.createElement('button')
    document.body.append(elsewhere)

    elsewhere.focus()
    tableRevoke(host).click()
    cancelButton(host).click()
    await flush()
    expect(document.activeElement).toBe(tableRevoke(host))

    elsewhere.focus()
    tableRevoke(host).click()
    confirmButton(host).click()
    await vi.waitFor(() => {
      expect(dialog(host).open).toBe(false)
    })
    await flush()
    expect(document.activeElement).toBe(tableRevoke(host))
  })

  it.each([
    { filter: 'all', reason: 'disabled after revocation' },
    { filter: 'active', reason: 'removed by the Active filter' },
  ])('focuses the Rights heading when the invoker is $reason', async ({ filter }) => {
    const pending = Promise.withResolvers<Result<RevokeResponse>>()
    const { host, setMembers } = show(ready, async () => await pending.promise)
    choose(host.querySelector<HTMLSelectElement>('select[aria-label="Filter by status"]')!, filter)

    tableRevoke(host).click()
    confirmButton(host).click()
    setMembers({ kind: 'ready', rows: [{ ...row, status: 'revoked' }] })
    pending.resolve(success)
    await vi.waitFor(() => {
      expect(dialog(host).open).toBe(false)
    })
    await flush()

    const heading = host.querySelector('h1')!
    expect(document.activeElement).toBe(heading)
    expect(heading.tabIndex).toBe(-1)
  })

  it('does not surface a second error for a 401 and ignores settlement after unmount', async () => {
    const onRevoke = vi
      .fn<Revoke>()
      .mockResolvedValueOnce({ error: 'Unauthorized', network: false, ok: false, status: 401 })
    const { host } = show(ready, onRevoke)
    tableRevoke(host).click()
    confirmButton(host).click()
    await vi.waitFor(() => {
      expect(confirmButton(host).disabled).toBe(false)
    })
    expect(dialog(host).querySelector('[role="alert"]')).toBeNull()

    const pending = Promise.withResolvers<Result<RevokeResponse>>()
    onRevoke.mockReturnValueOnce(pending.promise)
    confirmButton(host).click()
    cleanup()
    pending.resolve(success)
    await flush()
    expect(document.body.childElementCount).toBe(0)
  })
})
