// @vitest-environment happy-dom
import type { IssueResponse } from '@fuda/sdk'
import { createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Result } from './api.ts'
import { DASH_COPY } from './copy.ts'
import type { IssueForm as Form } from './issue-form.ts'
import { IssueForm, IssueFormView } from './IssueForm.tsx'
import type { IssueFormViewProps } from './IssueForm.tsx'
import { graphOnChainStatusIo } from './on-chain-status.ts'
import { OnChainStatus } from './OnChainStatus.tsx'
import { QrBlock } from './QrBlock.tsx'
import { SignIn } from './SignIn.tsx'
import { cleanup, flush, mount, spacedText, typeInto } from './test/render.tsx'

const copy = DASH_COPY.ja.issue
const UID = `0x${'aa'.repeat(32)}` as const
const holder = `0x${'11'.repeat(20)}` as const
const qr = `fuda:v1:${UID}`
const form: Form = {
  holder: '',
  level: 'bearer',
  memberId: 'alice',
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
const view = (patch: Partial<IssueFormViewProps> = {}): HTMLElement => {
  const value: IssueFormViewProps = {
    body,
    busy: false,
    copy,
    form,
    onChange: (): void => {},
    onSubmit: (): void => {},
    result: null,
    ...patch,
  }
  return mount(() => <IssueFormView {...value} />)
}
const submitButton = (host: ParentNode): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>('button[type="submit"]')!
const submit = (host: ParentNode): void => {
  host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}
const liveStatus = (host: ParentNode): Element | undefined =>
  [...host.querySelectorAll('[role="status"]')].find((node) => spacedText(node) !== '')

describe('localized operation views', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([
    ['bearer', 'メンバー ID', 'Bearer — アプリ不要のデバイスウォレットパス'],
    ['signed', '保有者アドレス', 'Signed — ゲートでメンバーのウォレットが署名'],
  ] as const)('labels every %s control and explains the selected level', (level, identity, description) => {
    const host = view({ form: { ...form, level } })
    const labels = [...host.querySelectorAll('label')]
    expect(labels.map(spacedText)).toStrictEqual(
      expect.arrayContaining([identity, '権利レベル', 'ティア', '利用モデル']),
    )
    const controls = [...host.querySelectorAll('input, select')]
    expect({
      described: [...host.querySelectorAll('p')].map(spacedText).join(' ').includes(description),
      labelled: controls.every((control) =>
        labels.some((label) => label.htmlFor === control.id && control.id !== ''),
      ),
    }).toStrictEqual({ described: true, labelled: true })
  })

  it('blocks invalid and busy submissions and uses the busy label', () => {
    const onSubmit = vi.fn<() => void>()
    for (const props of [
      { body: null, busy: false },
      { body, busy: true },
    ]) {
      const host = view({ ...props, onSubmit })
      expect(submitButton(host).disabled).toBe(true)
      submit(host)
    }
    expect(onSubmit).not.toHaveBeenCalled()
    expect(spacedText(submitButton(view({ busy: true })))).toBe('発行中')
    expect(submitButton(view()).disabled).toBe(false)
  })

  it.each([
    ['en', 'Issuing'],
    ['ja', '発行中'],
  ] as const)('announces the issue busy state in a localized live region in %s', (locale, message) => {
    const busy = view({ busy: true, copy: DASH_COPY[locale].issue })
    const status = busy.querySelector('[role="status"]')

    expect(spacedText(status)).toBe(message)
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(submitButton(busy).disabled).toBe(true)
    expect(liveStatus(view({ copy: DASH_COPY[locale].issue }))).toBeUndefined()
  })

  it.each(['bearer', 'signed'] as const)(
    'announces %s success and preserves holder, pass URL and QR payload',
    (level) => {
      const host = view({ result: { body: { ...publicBody, level }, ok: true } })
      const status = liveStatus(host)!
      const image = host.querySelector('div[role="img"]')
      expect({
        live: status.getAttribute('aria-live'),
        pass: host.querySelector('a')?.getAttribute('href'),
        qr: { label: image?.getAttribute('aria-label'), payload: image?.nextElementSibling?.textContent },
        status: spacedText(status).includes(`発行しました ${level}`) && spacedText(status).includes(holder),
      }).toStrictEqual({
        live: 'polite',
        pass: `https://api.fuda.sh/pass/${UID}`,
        qr: { label: '発行した権利の QR', payload: qr },
        status: true,
      })
    },
  )

  it('explains unknown errors in Japanese and retains their support code', () => {
    const host = view({ result: { error: 'RPC_DENIED [42]', network: false, ok: false, status: 503 } })
    expect(spacedText(host.querySelector('[role="alert"]'))).toBe(
      '発行に失敗しました: 処理を完了できませんでした。もう一度お試しください。 (RPC_DENIED [42])',
    )
  })

  it('retranslates a visible API error when the operator changes language', async () => {
    const [locale, setLocale] = createSignal<'en' | 'ja'>('en')
    const onIssue = vi.fn<() => Promise<Result<IssueResponse>>>().mockResolvedValue({
      error: 'bad_input',
      network: false,
      ok: false,
      status: 400,
    })
    const host = mount(() => <IssueForm copy={DASH_COPY[locale()].issue} onIssue={onIssue} />)
    typeInto(host.querySelector<HTMLInputElement>('#issue-member-id')!, 'alice')
    submit(host)
    await vi.waitFor(() => {
      expect(spacedText(host.querySelector('[role="alert"]'))).toBe(
        'Issue failed: Check the information you entered.',
      )
    })
    setLocale('ja')
    await flush()
    expect(spacedText(host.querySelector('[role="alert"]'))).toBe(
      '発行に失敗しました: 入力内容を確認してください。',
    )
  })

  it('labels the QR image and retains the entire readable payload', () => {
    const host = mount(() => <QrBlock label="発行した権利の QR" qr={qr} />)
    const image = host.querySelector('div[role="img"]')!
    expect(image.getAttribute('aria-label')).toBe('発行した権利の QR')
    expect(image.innerHTML).toContain('<svg')
    expect(host.querySelector('code')?.textContent).toBe(qr)
  })

  it.each(['  token  ', ''])(
    'labels the token, exposes appearance and error, and accepts trimmed value %j',
    (value) => {
      const onToken = vi.fn<(token: string) => void>()
      const host = mount(() => (
        <SignIn
          appearance={<aside>appearance controls</aside>}
          copy={DASH_COPY.ja.auth}
          error="権限がありません: UNAUTHORIZED"
          busy={null}
          onCancel={(): void => {}}
          onCreate={(): void => {}}
          onSignIn={(): void => {}}
          onToken={onToken}
          onWallet={(): void => {}}
        />
      ))
      const password = host.querySelector<HTMLInputElement>('input[type="password"]')!
      const label = host.querySelector('label')!
      expect({ label: spacedText(label), target: label.htmlFor }).toStrictEqual({
        label: '管理トークン',
        target: password.id,
      })
      expect(spacedText(host.querySelector('[role="alert"]'))).toContain('UNAUTHORIZED')
      expect({
        hasAppearance: spacedText(host).includes('appearance controls'),
        passwordId: password.id,
      }).toStrictEqual({ hasAppearance: true, passwordId: 'admin-token' })
      expect(spacedText(host.querySelector('form'))).not.toContain('appearance controls')
      typeInto(password, value)
      submit(host)
      expect(onToken).toHaveBeenCalledExactlyOnceWith(value.trim())
    },
  )

  it('renders the brand mark before the centered dashboard title', () => {
    const host = mount(() => (
      <SignIn
        appearance={<aside />}
        copy={DASH_COPY.en.auth}
        error={null}
        busy={null}
        onCancel={(): void => {}}
        onCreate={(): void => {}}
        onSignIn={(): void => {}}
        onToken={(): void => {}}
        onWallet={(): void => {}}
      />
    ))
    const logo = host.querySelector('svg[aria-label="fuda."]')!
    const title = host.querySelector('h1')!
    const order = [...host.querySelectorAll('svg[aria-label="fuda."], h1')]

    expect({
      logoBeforeTitle: order[0] === logo && order[1] === title,
      logoClass: logo.getAttribute('class'),
      title: spacedText(title),
      titleClass: title.className,
    }).toStrictEqual({
      logoBeforeTitle: true,
      logoClass: 'dash-auth-logo',
      title: 'fuda. dashboard',
      titleClass: 'dash-auth-title',
    })
  })

  it('submits once before rerender, clears busy after an API error, and allows retry', async () => {
    const pending = Promise.withResolvers<Result<IssueResponse>>()
    const onIssue = vi
      .fn<(payload: Record<string, string | number>) => Promise<Result<IssueResponse>>>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ body: publicBody, ok: true })
    const host = mount(() => <IssueForm copy={copy} onIssue={onIssue} />)
    typeInto(host.querySelector<HTMLInputElement>('#issue-member-id')!, ' alice ')

    submit(host)
    submit(host)
    expect(onIssue).toHaveBeenCalledExactlyOnceWith(body)
    expect(submitButton(host).disabled).toBe(true)

    pending.resolve({ error: 'RPC_DENIED [42]', network: false, ok: false, status: 503 })
    await vi.waitFor(() => {
      expect(submitButton(host).disabled).toBe(false)
    })
    expect(spacedText(host.querySelector('[role="alert"]'))).toContain('RPC_DENIED [42]')

    submit(host)
    await vi.waitFor(() => {
      expect(spacedText(liveStatus(host))).toContain(holder)
    })
    expect(onIssue).toHaveBeenCalledTimes(2)
  })

  it('queries the injected Graph endpoint and holder with localized loading and empty states', async () => {
    const pending = Promise.withResolvers<[]>()
    const rights = vi.spyOn(graphOnChainStatusIo, 'rightsByHolder').mockReturnValue(pending.promise)
    const host = mount(() => (
      <OnChainStatus copy={DASH_COPY.ja.chain} endpoint="https://index.example/rights" />
    ))
    expect([...host.querySelectorAll('label')].map(spacedText)).toContain('保有者アドレス')

    typeInto(host.querySelector<HTMLInputElement>('#chain-holder')!, holder)
    submit(host)
    expect(rights).toHaveBeenCalledExactlyOnceWith('https://index.example/rights', holder)
    expect({ disabled: submitButton(host).disabled, label: spacedText(submitButton(host)) }).toStrictEqual({
      disabled: true,
      label: '検索中',
    })

    pending.resolve([])
    await vi.waitFor(() => {
      expect(spacedText(host)).toContain('オンチェーン権利が見つかりません。')
    })
    expect(submitButton(host).disabled).toBe(false)
  })

  it.each([
    ['', 'オンチェーンステータスが設定されていません。'],
    ['https://index.example/rights', 'チェーン検索に失敗しました。'],
  ])(
    'renders localized configuration or unknown-error fallback for endpoint %j',
    async (endpoint, message) => {
      const rights = vi.spyOn(graphOnChainStatusIo, 'rightsByHolder').mockRejectedValue('offline')
      const host = mount(() => <OnChainStatus copy={DASH_COPY.ja.chain} endpoint={endpoint} />)
      submit(host)
      await vi.waitFor(() => {
        expect(spacedText(host.querySelector('[role="alert"]'))).toBe(message)
      })
      expect(rights).toHaveBeenCalledTimes(endpoint === '' ? 0 : 1)
      expect(submitButton(host).disabled).toBe(false)
    },
  )

  it.each([
    ['', 'On-chain status is not configured.', 'オンチェーンステータスが設定されていません。'],
    ['https://index.example/rights', 'Chain lookup failed.', 'チェーン検索に失敗しました。'],
  ])(
    'retranslates internal Graph errors after a language change for endpoint %j',
    async (endpoint, english, japanese) => {
      vi.spyOn(graphOnChainStatusIo, 'rightsByHolder').mockRejectedValue('offline')
      const [language, setLanguage] = createSignal<'en' | 'ja'>('en')
      const host = mount(() => <OnChainStatus copy={DASH_COPY[language()].chain} endpoint={endpoint} />)
      const alertText = (): string => spacedText(host.querySelector('[role="alert"]'))
      submit(host)
      await vi.waitFor(() => {
        expect(alertText()).toBe(english)
      })
      setLanguage('ja')
      expect(alertText()).toBe(japanese)
      setLanguage('en')
      expect(alertText()).toBe(english)
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
    const [language, setLanguage] = createSignal<'en' | 'ja'>('en')
    const host = mount(() => (
      <OnChainStatus copy={DASH_COPY[language()].chain} endpoint="https://index.example/rights" />
    ))
    submit(host)
    setLanguage('ja')
    expect(spacedText(host.querySelector('[role="status"]'))).toBe('オンチェーンステータスを読み込み中です。')
    pending.reject(failure)
    await flush()
    await vi.waitFor(() => {
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(message)
    })
  })
})
