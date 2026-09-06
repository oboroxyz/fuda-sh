/** @jsxImportSource hono/jsx/dom */
import type { IssueResponse } from '@fuda/sdk'
import type * as HonoDom from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Result } from './api.ts'
import { DASH_COPY } from './copy.ts'
import type { IssueForm as Form } from './issue-form.ts'
import { IssueForm, IssueFormView } from './IssueForm.tsx'
import type { IssueFormViewProps } from './IssueForm.tsx'
import { graphOnChainStatusIo } from './on-chain-status.ts'
import { OnChainStatus, OnChainStatusView } from './OnChainStatus.tsx'
import type { OnChainStatusViewProps } from './OnChainStatus.tsx'
import { QrBlock } from './QrBlock.tsx'
import { findViewNodes, viewProps, viewText, walkView } from './test/test-view.ts'
import { TokenGateView } from './TokenGate.tsx'

// Control hook scheduling only; form validation, callbacks and SingleFlight remain real.
const hooks = vi.hoisted(() => ({ index: 0, slots: new Map<number, unknown>() }))
vi.mock(import('hono/jsx/dom'), async (importOriginal) => ({
  ...(await importOriginal()),
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

const copy = DASH_COPY.ja.issue
const UID = `0x${'aa'.repeat(32)}` as const
const holder = `0x${'11'.repeat(20)}` as const
const qr = `fuda:v1:${UID}`
const form: Form = {
  holder: '',
  level: 'bearer',
  memberId: 'alice',
  stealthMetaAddress: '',
  tier: 1,
  usageModel: 1,
}
const body = { memberId: 'alice', tier: 1, usageModel: 1 }
const publicBody: IssueResponse = {
  holder,
  level: 'bearer',
  passUrls: { apple: '/apple', google: '/google', web: `https://api.fuda.sh/pass/${UID}` },
  qr,
  uid: UID,
}
const view = (patch: Partial<IssueFormViewProps> = {}): JSX.Element =>
  IssueFormView({
    body,
    busy: false,
    copy,
    form,
    onChange: (): void => {},
    onSubmit: (): void => {},
    result: null,
    ...patch,
  })
const submitButton = (node: unknown) => walkView(node).find((item) => item.props.type === 'submit')!

const chainText = (rendered: JSX.Element): string => {
  const props = viewProps(findViewNodes(rendered, OnChainStatusView)[0]) as unknown as OnChainStatusViewProps
  return viewText(OnChainStatusView(props))
}

describe('localized operation views', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    hooks.index = 0
    hooks.slots.clear()
  })

  it.each([
    ['bearer', 'メンバー ID', 'Bearer — アプリ不要のデバイスウォレットパス'],
    ['signed', '保有者アドレス', 'Signed — ゲートでメンバーのウォレットが署名'],
    ['private', 'ステルスメタアドレス', '+Private — メタアドレスからステルスアドレスを生成'],
  ] as const)('labels every %s control and explains the selected level', (level, identity, description) => {
    const rendered = view({ form: { ...form, level } })
    const labels = findViewNodes(rendered, 'label')
    expect(labels.map(viewText)).toStrictEqual(
      expect.arrayContaining([identity, '権利レベル', 'ティア', '利用モデル']),
    )
    const controls = walkView(rendered).filter(
      (node) => 'value' in node.props && ('onInput' in node.props || 'onChange' in node.props),
    )
    expect(
      controls.every((control) =>
        labels.some((label) => label.props.for === control.props.id && control.props.id !== undefined),
      ),
    ).toBe(true)
    expect(findViewNodes(rendered, 'p').map(viewText).join(' ')).toContain(description)
    expect(labels.map(viewText).includes('メンバー ID（任意の代表 ID）')).toBe(level === 'private')
  })

  it('blocks invalid and busy submissions and uses the busy label', () => {
    const onSubmit = vi.fn<() => void>()
    for (const props of [
      { body: null, busy: false },
      { body, busy: true },
    ]) {
      const rendered = view({ ...props, onSubmit })
      expect(submitButton(rendered).props.disabled).toBe(true)
      ;(
        walkView(rendered).find((node) => 'onSubmit' in node.props)!.props.onSubmit as (event: Event) => void
      )({ preventDefault: (): void => {} } as Event)
    }
    expect(onSubmit).not.toHaveBeenCalled()
    expect(viewText(submitButton(view({ busy: true })))).toBe('発行中')
    expect(submitButton(view()).props.disabled).toBe(false)
  })

  it.each([
    ['en', 'Issuing'],
    ['ja', '発行中'],
  ] as const)('announces the issue busy state in a localized live region in %s', (locale, message) => {
    const busy = view({ busy: true, copy: DASH_COPY[locale].issue })
    const status = walkView(busy).find((node) => node.props.role === 'status')

    expect(viewText(status)).toBe(message)
    expect(status?.props['aria-live']).toBe('polite')
    expect(submitButton(busy).props.disabled).toBe(true)
    expect(
      walkView(view({ copy: DASH_COPY[locale].issue })).filter(
        (node) => node.props.role === 'status' && viewText(node) !== '',
      ),
    ).toHaveLength(0)
  })

  it.each(['bearer', 'signed'] as const)(
    'announces %s success and preserves holder, pass URL and QR payload',
    (level) => {
      const rendered = view({ result: { body: { ...publicBody, level }, ok: true } })
      const status = walkView(rendered).find((node) => node.props.role === 'status' && viewText(node) !== '')!
      expect(status.props['aria-live']).toBe('polite')
      expect(viewText(status)).toContain(`発行しました ${level}`)
      expect(viewText(status)).toContain(holder)
      expect(findViewNodes(rendered, 'a')[0].props.href).toBe(`https://api.fuda.sh/pass/${UID}`)
      expect(findViewNodes(rendered, QrBlock)[0].props).toMatchObject({ label: '発行した権利の QR', qr })
    },
  )

  it('announces private discovery and transaction prefix without a public pass', () => {
    const rendered = view({
      result: { body: { announceTx: UID, announced: true, level: 'private', uid: UID }, ok: true },
    })
    expect(viewText(rendered)).toContain('アナウンスしました')
    expect(viewText(rendered)).toContain('メンバーがアプリで検出します。')
    expect(viewText(rendered)).toContain('トランザクション 0xaaaaaaaa…')
    expect({
      links: findViewNodes(rendered, 'a').length,
      qrs: findViewNodes(rendered, QrBlock).length,
    }).toStrictEqual({ links: 0, qrs: 0 })
    expect(
      walkView(rendered).some((node) => node.props.role === 'status' && node.props['aria-live'] === 'polite'),
    ).toBe(true)
  })

  it('retains machine errors verbatim inside localized alert context', () => {
    const rendered = view({ result: { error: 'RPC_DENIED [42]', network: false, ok: false, status: 503 } })
    const alert = walkView(rendered).find((node) => node.props.role === 'alert')!
    expect(viewText(alert)).toBe('発行に失敗しました: RPC_DENIED [42]')
  })

  it('labels the QR image and retains the entire readable payload', () => {
    const rendered = QrBlock({ label: '発行した権利の QR', qr })
    const image = walkView(rendered).find((node) => node.props.role === 'img')!
    expect(image.props['aria-label']).toBe('発行した権利の QR')
    const markup = image.props.dangerouslySetInnerHTML as { __html: string }
    expect(markup.__html).toContain('<svg')
    expect(viewText(findViewNodes(rendered, 'code')[0])).toBe(qr)
  })

  it.each(['  token  ', ''])(
    'labels the token, exposes appearance and error, and accepts trimmed value %j',
    (value) => {
      const onToken = vi.fn<(token: string) => void>()
      const rendered = TokenGateView({
        appearance: <aside>appearance controls</aside>,
        copy: DASH_COPY.ja.auth,
        error: '権限がありません: UNAUTHORIZED',
        onToken,
        onValue: (): void => {},
        value,
      })
      const password = walkView(rendered).find((node) => node.props.type === 'password')!
      const [label] = findViewNodes(rendered, 'label')
      expect({ label: viewText(label), target: label.props.for }).toStrictEqual({
        label: '管理トークン',
        target: password.props.id,
      })
      expect(viewText(walkView(rendered).find((node) => node.props.role === 'alert'))).toContain(
        'UNAUTHORIZED',
      )
      expect({
        hasAppearance: viewText(rendered).includes('appearance controls'),
        passwordId: password.props.id,
      }).toStrictEqual({ hasAppearance: true, passwordId: 'admin-token' })
      const authForm = walkView(rendered).find((node) => 'onSubmit' in node.props)!
      expect(viewText(authForm)).not.toContain('appearance controls')
      ;(authForm.props.onSubmit as (event: Event) => void)({ preventDefault: (): void => {} } as Event)
      expect(onToken).toHaveBeenCalledExactlyOnceWith(value.trim())
    },
  )

  it('submits once before rerender, clears busy after an API error, and allows retry', async () => {
    const pending = Promise.withResolvers<Result<IssueResponse>>()
    const onIssue = vi
      .fn<(payload: Record<string, string | number>) => Promise<Result<IssueResponse>>>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ body: publicBody, ok: true })
    const render = (): IssueFormViewProps => {
      hooks.index = 0
      return viewProps(
        findViewNodes(IssueForm({ copy, onIssue }), IssueFormView)[0],
      ) as unknown as IssueFormViewProps
    }
    render().onChange({ memberId: ' alice ' })
    const ready = render()
    ready.onSubmit()
    ready.onSubmit()
    expect(onIssue).toHaveBeenCalledExactlyOnceWith(body)
    expect(render().busy).toBe(true)
    pending.resolve({ error: 'RPC_DENIED [42]', network: false, ok: false, status: 503 })
    await vi.waitFor(() => {
      expect(render().busy).toBe(false)
    })
    expect(render().result).toMatchObject({ error: 'RPC_DENIED [42]', ok: false })
    render().onSubmit()
    await vi.waitFor(() => {
      expect(render().result).toStrictEqual({ body: publicBody, ok: true })
    })
    expect(onIssue).toHaveBeenCalledTimes(2)
  })

  it('queries the injected Graph endpoint and holder with localized loading and empty states', async () => {
    vi.stubGlobal('HTMLInputElement', Object)
    const pending = Promise.withResolvers<[]>()
    const rights = vi.spyOn(graphOnChainStatusIo, 'rightsByHolder').mockReturnValue(pending.promise)
    const render = (): JSX.Element => {
      hooks.index = 0
      return OnChainStatus({ copy: DASH_COPY.ja.chain, endpoint: 'https://index.example/rights' })
    }
    const initial = render()
    const input = walkView(initial).find((node) => node.props.id === 'chain-holder')!
    expect(findViewNodes(initial, 'label').map(viewText)).toContain('保有者アドレス')
    ;(input.props.onInput as (event: Event) => void)({ currentTarget: { value: holder } } as unknown as Event)
    const ready = render()
    ;(walkView(ready).find((node) => 'onSubmit' in node.props)!.props.onSubmit as (event: Event) => void)({
      preventDefault: (): void => {},
    } as Event)
    expect(rights).toHaveBeenCalledExactlyOnceWith('https://index.example/rights', holder)
    const busy = submitButton(render())
    expect({ disabled: busy.props.disabled, label: viewText(busy) }).toStrictEqual({
      disabled: true,
      label: '検索中',
    })
    pending.resolve([])
    await vi.waitFor(() => {
      const props = viewProps(
        findViewNodes(render(), OnChainStatusView)[0],
      ) as unknown as OnChainStatusViewProps
      expect(viewText(OnChainStatusView(props))).toContain('オンチェーン権利が見つかりません。')
    })
    expect(submitButton(render()).props.disabled).toBe(false)
  })

  it.each([
    ['', 'オンチェーンステータスが設定されていません。'],
    ['https://index.example/rights', 'チェーン検索に失敗しました。'],
  ])(
    'renders localized configuration or unknown-error fallback for endpoint %j',
    async (endpoint, message) => {
      const rights = vi.spyOn(graphOnChainStatusIo, 'rightsByHolder').mockRejectedValue('offline')
      const render = (): JSX.Element => {
        hooks.index = 0
        return OnChainStatus({ copy: DASH_COPY.ja.chain, endpoint })
      }
      ;(
        walkView(render()).find((node) => 'onSubmit' in node.props)!.props.onSubmit as (event: Event) => void
      )({ preventDefault: (): void => {} } as Event)
      await vi.waitFor(() => {
        const props = viewProps(
          findViewNodes(render(), OnChainStatusView)[0],
        ) as unknown as OnChainStatusViewProps
        expect(viewText(OnChainStatusView(props))).toBe(message)
      })
      expect(rights).toHaveBeenCalledTimes(endpoint === '' ? 0 : 1)
      expect(submitButton(render()).props.disabled).toBe(false)
    },
  )

  it.each([
    ['', 'On-chain status is not configured.', 'オンチェーンステータスが設定されていません。'],
    ['https://index.example/rights', 'Chain lookup failed.', 'チェーン検索に失敗しました。'],
  ])(
    'retranslates internal Graph errors after a language change for endpoint %j',
    async (endpoint, english, japanese) => {
      vi.spyOn(graphOnChainStatusIo, 'rightsByHolder').mockRejectedValue('offline')
      const render = (language: 'en' | 'ja'): JSX.Element => {
        hooks.index = 0
        return OnChainStatus({ copy: DASH_COPY[language].chain, endpoint })
      }
      ;(
        walkView(render('en')).find((node) => 'onSubmit' in node.props)!.props.onSubmit as (
          event: Event,
        ) => void
      )({ preventDefault: (): void => {} } as Event)
      await vi.waitFor(() => {
        expect(chainText(render('en'))).toBe(english)
      })
      expect(chainText(render('ja'))).toBe(japanese)
      expect(chainText(render('en'))).toBe(english)
    },
  )

  it.each([
    ['offline', 'チェーン検索に失敗しました。'],
    [new Error('RPC_DENIED [42]'), 'チェーン検索に失敗しました。 RPC_DENIED [42]'],
    [new Error('\0fuda:chain:unconfigured'), 'チェーン検索に失敗しました。 \0fuda:chain:unconfigured'],
    [new Error('\0fuda:chain:lookup-failed'), 'チェーン検索に失敗しました。 \0fuda:chain:lookup-failed'],
    [
      new Error('\0fuda:chain:external:\0fuda:chain:lookup-failed'),
      'チェーン検索に失敗しました。 \0fuda:chain:external:\0fuda:chain:lookup-failed',
    ],
  ])('uses the current language when an in-flight Graph query rejects with %j', async (failure, message) => {
    const pending = Promise.withResolvers<[]>()
    vi.spyOn(graphOnChainStatusIo, 'rightsByHolder').mockReturnValue(pending.promise)
    const render = (language: 'en' | 'ja'): JSX.Element => {
      hooks.index = 0
      return OnChainStatus({ copy: DASH_COPY[language].chain, endpoint: 'https://index.example/rights' })
    }
    ;(
      walkView(render('en')).find((node) => 'onSubmit' in node.props)!.props.onSubmit as (
        event: Event,
      ) => void
    )({ preventDefault: (): void => {} } as Event)
    expect(chainText(render('ja'))).toBe('オンチェーンステータスを読み込み中です。')
    pending.reject(failure)
    await vi.waitFor(() => {
      expect(chainText(render('ja'))).toBe(message)
    })
  })
})
