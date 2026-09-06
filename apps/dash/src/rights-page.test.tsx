/** @jsxImportSource hono/jsx/dom */
import { setTimeout } from 'node:timers/promises'

import { pick } from '@fuda/i18n'
import type { RevokeResponse } from '@fuda/sdk'
import type * as HonoDom from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Result } from './api.ts'
import { DASH_COPY } from './copy.ts'
import type { MembersState } from './members-state.ts'
import type { MemberRowView } from './members-view.ts'
import { OnChainStatus } from './OnChainStatus.tsx'
import { RevokeDialog } from './RevokeDialog.tsx'
import type { RevokeDialogProps } from './RevokeDialog.tsx'
import { RightsList } from './RightsList.tsx'
import type { RightsListProps } from './RightsList.tsx'
import { RightsPage } from './RightsPage.tsx'
import { findViewNodes, viewProps, viewText, walkView } from './test/test-view.ts'

// Only the hook scheduler is controlled: page, child views, filtering and flight guard stay real.
const hooks = vi.hoisted(() => ({
  cleanups: [] as (() => void)[],
  effects: [] as Parameters<typeof HonoDom.useEffect>[0][],
  index: 0,
  slots: new Map<number, unknown>(),
}))
vi.mock(import('hono/jsx/dom'), async (importOriginal) => ({
  ...(await importOriginal()),
  useEffect: (
    effect: Parameters<typeof HonoDom.useEffect>[0],
    dependencies: readonly unknown[] = [],
  ): void => {
    const { index } = hooks
    hooks.index += 1
    const previous = hooks.slots.get(index) as unknown[] | undefined
    if (
      previous === undefined ||
      dependencies.some((value, position) => !Object.is(value, previous[position]))
    ) {
      hooks.effects.push(effect)
      hooks.slots.set(index, dependencies)
    }
  },
  useRef: <T,>(initial: T): { current: T } => {
    const { index } = hooks
    hooks.index += 1
    if (!hooks.slots.has(index)) {
      hooks.slots.set(index, { current: initial })
    }
    return hooks.slots.get(index) as { current: T }
  },
  useState: (<T,>(initial: T): [T, (value: T) => void] => {
    const { index } = hooks
    hooks.index += 1
    if (!hooks.slots.has(index)) {
      hooks.slots.set(index, initial)
    }
    return [
      hooks.slots.get(index) as T,
      (value): void => {
        hooks.slots.set(index, value)
      },
    ]
  }) as typeof HonoDom.useState,
}))

const UID = `0x${'ab'.repeat(32)}` as const
const row: MemberRowView = {
  holder: null,
  holderShort: null,
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
const focusState = { activeElement: null as { focus: () => void } | null }
const headingElement = {
  focus: (): void => {
    focusState.activeElement = headingElement
  },
}

const makeButton = () => {
  const button = {
    disabled: false,
    focus: (): void => {
      if (!button.disabled && button.isConnected) {
        focusState.activeElement = button
      }
    },
    isConnected: true,
  }
  return button
}

const render = (
  members: MembersState = ready,
  onRevoke: (uid: string) => Promise<Result<RevokeResponse>> = async () => await Promise.resolve(success),
): JSX.Element => {
  hooks.index = 0
  const view = RightsPage({ copy, graphEndpoint: 'https://index.example/rights', members, onRevoke })
  const headingRef = viewProps(findViewNodes(view, 'h1')[0]).ref as
    | { current: HTMLHeadingElement | null }
    | undefined
  if (headingRef !== undefined) {
    headingRef.current = headingElement as HTMLHeadingElement
  }
  for (const effect of hooks.effects.splice(0)) {
    const cleanup = effect()
    if (cleanup !== undefined) {
      hooks.cleanups.push(cleanup)
    }
  }
  return view
}
const dialogProps = (view: unknown): RevokeDialogProps =>
  viewProps(findViewNodes(view, RevokeDialog)[0]) as unknown as RevokeDialogProps
const listProps = (view: unknown): RightsListProps =>
  viewProps(findViewNodes(view, RightsList)[0]) as unknown as RightsListProps
const field = (view: unknown, label: string) =>
  walkView(view).find((node) => viewProps(node)['aria-label'] === label)!
const input = (view: unknown, label: string, value: string): void => {
  ;(viewProps(field(view, label)).onInput as (event: Event) => void)({
    currentTarget: { value },
  } as unknown as Event)
}
const requestRevoke = (view: unknown, invoker = makeButton()): void => {
  const list = RightsList(listProps(view))
  const revoke = walkView(list).find(
    (node) => viewProps(node).type === 'button' && viewText(node) === 'Revoke',
  )!
  ;(viewProps(revoke).onClick as (event: MouseEvent) => void)({
    currentTarget: invoker,
    target: invoker,
  } as unknown as MouseEvent)
}

describe('rights page', () => {
  beforeEach(() => {
    hooks.index = 0
    hooks.slots.clear()
    hooks.effects.length = 0
    hooks.cleanups.length = 0
    focusState.activeElement = null
    vi.stubGlobal('document', focusState)
    vi.stubGlobal('HTMLElement', Object)
    vi.stubGlobal('HTMLButtonElement', Object)
    vi.stubGlobal('HTMLInputElement', Object)
    vi.stubGlobal('HTMLSelectElement', Object)
  })

  it('distinguishes source-empty from filtered-empty and clears filters without loading', () => {
    const empty = render({ kind: 'ready', rows: [] })
    expect(viewText(empty)).toContain('No rights have been issued.')
    expect(viewText(empty)).not.toContain('No rights match these filters.')
    const populated = render()
    input(populated, 'Search rights', 'nobody')
    const filtered = render()
    expect(viewText(filtered)).toContain('No rights match these filters.')
    expect(viewText(filtered)).not.toContain('No rights have been issued.')
    const clear = walkView(filtered).find(
      (node) => viewProps(node).type === 'button' && viewText(node) === 'Clear filters',
    )!
    ;(viewProps(clear).onClick as () => void)()
    expect({
      query: viewProps(field(render(), 'Search rights')).value,
      rows: listProps(render()).rows,
    }).toStrictEqual({ query: '', rows: [row] })
  })

  it('preserves rights during refresh and errors while keeping chain lookup separate', () => {
    const initial = render({ kind: 'loading', previousRows: null })
    expect({
      empty: viewText(initial).includes('No rights have been issued.'),
      loading: viewText(initial).includes('Refreshing rights'),
    }).toStrictEqual({ empty: false, loading: true })
    const error = render({ kind: 'error', message: 'D1 unavailable', previousRows: null })
    expect({
      error: viewText(error).includes('D1 unavailable'),
      lists: findViewNodes(error, RightsList).length,
    }).toStrictEqual({ error: true, lists: 0 })
    const refreshing = render({ kind: 'loading', previousRows: [row] })
    expect({
      refreshing: viewText(refreshing).includes('Refreshing rights'),
      rows: listProps(refreshing).rows,
    }).toStrictEqual({ refreshing: true, rows: [row] })
    const stale = render({ kind: 'error', message: 'D1 offline', previousRows: [row] })
    expect({ error: viewText(stale).includes('D1 offline'), rows: listProps(stale).rows }).toStrictEqual({
      error: true,
      rows: [row],
    })
    const sections = findViewNodes(stale, 'section')
    const chainSection = sections.find(
      (section) =>
        findViewNodes(section, OnChainStatus).length === 1 && findViewNodes(section, RightsList).length === 0,
    )
    expect({
      props: viewProps(findViewNodes(stale, OnChainStatus)[0]),
      separate: chainSection !== undefined,
    }).toMatchObject({
      props: { copy: copy.chain, endpoint: 'https://index.example/rights' },
      separate: true,
    })
  })

  it('connects confirmation to the UID, suppresses immediate duplicates, and closes on success', async () => {
    const pending = Promise.withResolvers<Result<RevokeResponse>>()
    const onRevoke = vi.fn<(uid: string) => Promise<Result<RevokeResponse>>>(
      async () => await pending.promise,
    )
    const state: MembersState = { kind: 'ready', rows: [row] }
    requestRevoke(render(state, onRevoke))
    const confirmation = dialogProps(render(state, onRevoke))
    expect(confirmation.target).toStrictEqual(row)
    confirmation.onConfirm()
    confirmation.onConfirm()
    confirmation.onCancel()
    expect(onRevoke).toHaveBeenCalledExactlyOnceWith(UID)
    const busy = dialogProps(render(state, onRevoke))
    expect({ busy: busy.busy, target: busy.target }).toStrictEqual({ busy: true, target: row })
    expect(listProps(render(state, onRevoke)).revokingUid).toBe(UID)
    pending.resolve(success)
    await vi.waitFor(() => {
      expect(dialogProps(render(state, onRevoke)).target).toBeNull()
    })
    expect(dialogProps(render(state, onRevoke)).busy).toBe(false)
  })

  it('keeps raw non-401 errors in the dialog, clears busy, and allows a successful retry', async () => {
    const onRevoke = vi
      .fn<(uid: string) => Promise<Result<RevokeResponse>>>()
      .mockResolvedValueOnce({ error: 'RPC says: denied [42]', network: false, ok: false, status: 503 })
      .mockResolvedValueOnce(success)
    const state: MembersState = { kind: 'ready', rows: [row] }
    requestRevoke(render(state, onRevoke))
    dialogProps(render(state, onRevoke)).onConfirm()
    await vi.waitFor(() => {
      expect(dialogProps(render(state, onRevoke)).error).toBe('RPC says: denied [42]')
    })
    const failed = dialogProps(render(state, onRevoke))
    expect(failed.target).toStrictEqual(row)
    expect(failed.busy).toBe(false)
    expect(viewText(RevokeDialog(failed))).toContain('Revoke failed: RPC says: denied [42]')
    failed.onConfirm()
    expect(dialogProps(render(state, onRevoke)).error).toBeNull()
    await vi.waitFor(() => {
      expect(dialogProps(render(state, onRevoke)).target).toBeNull()
    })
    expect(onRevoke).toHaveBeenCalledTimes(2)
  })

  it('restores the actual clicked invoker when pointer activation left another element focused', async () => {
    const previous = makeButton()
    const invoker = makeButton()
    focusState.activeElement = previous
    requestRevoke(render(), invoker)
    dialogProps(render()).onCancel()
    void render()
    await Promise.resolve()
    expect(focusState.activeElement).toBe(invoker)
    focusState.activeElement = previous
    requestRevoke(render(), invoker)
    dialogProps(render()).onConfirm()
    await vi.waitFor(() => {
      expect(dialogProps(render()).target).toBeNull()
    })
    await Promise.resolve()
    expect(focusState.activeElement).toBe(invoker)
  })

  it.each([
    { filter: 'all', listCount: 1, reason: 'disabled after revocation' },
    { filter: 'active', listCount: 0, reason: 'removed by the Active filter' },
  ])('focuses the Rights heading when the invoker is $reason', async ({ filter, listCount }) => {
    const pending = Promise.withResolvers<Result<RevokeResponse>>()
    const onRevoke = async (): Promise<Result<RevokeResponse>> => await pending.promise
    const invoker = makeButton()
    focusState.activeElement = invoker
    input(render(ready, onRevoke), 'Filter by status', filter)
    requestRevoke(render(ready, onRevoke), invoker)
    dialogProps(render(ready, onRevoke)).onConfirm()

    const refreshed: MembersState = { kind: 'ready', rows: [{ ...row, status: 'revoked' }] }
    const reloadView = render(refreshed, onRevoke)
    const lists = findViewNodes(reloadView, RightsList)
    expect(lists).toHaveLength(listCount)
    if (lists.length === 0) {
      invoker.isConnected = false
    } else {
      const revoke = walkView(RightsList(listProps(reloadView))).find(
        (node) => viewProps(node).type === 'button' && viewText(node) === 'Revoke',
      )!
      invoker.disabled = viewProps(revoke).disabled as boolean
    }
    focusState.activeElement = null
    pending.resolve(success)
    await vi.waitFor(() => {
      expect(dialogProps(render(refreshed, onRevoke)).target).toBeNull()
    })
    await Promise.resolve()

    expect(focusState.activeElement).toBe(headingElement)
    expect(viewProps(findViewNodes(render(refreshed, onRevoke), 'h1')[0]).tabIndex).toBe(-1)
  })

  it('does not surface a second error for a 401 and ignores settlement after unmount', async () => {
    const onRevoke = vi
      .fn<(uid: string) => Promise<Result<RevokeResponse>>>()
      .mockResolvedValue({ error: 'Unauthorized', network: false, ok: false, status: 401 })
    const state: MembersState = { kind: 'ready', rows: [row] }
    requestRevoke(render(state, onRevoke))
    dialogProps(render(state, onRevoke)).onConfirm()
    await vi.waitFor(() => {
      expect(dialogProps(render(state, onRevoke)).busy).toBe(false)
    })
    expect(dialogProps(render(state, onRevoke)).error).toBeNull()
    const pending = Promise.withResolvers<Result<RevokeResponse>>()
    dialogProps(render(state, async () => await pending.promise)).onConfirm()
    for (const cleanup of hooks.cleanups) {
      cleanup()
    }
    const slots = new Map(hooks.slots)
    pending.resolve(success)
    await setTimeout()
    expect(hooks.slots).toStrictEqual(slots)
  })
})
