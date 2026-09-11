import { pick } from '@fuda/i18n'
import type { Copy, Locale } from '@fuda/i18n'

interface EntryCopy {
  privateIntro: string
  usePasskey: string
  createPasskey: string
  metaAddress: string
  copy: Record<'done' | 'failed' | 'idle', string>
  discover: string
  noPasses: string
  stealthAddress: string
  enter: string
  prf: Record<'cancelled' | 'error' | 'unsupported', string>
  signedTitle: string
  signedIntro: string
  signing: string
  passkeyWallet: (uid: string) => string
  browserWallet: (uid: string) => string
  scanner: { cameraUnavailable: string; placeholder: string; check: string }
  verdict: Record<'ADMIT' | 'REJECT', string>
  networkBanner: string
  tryAgain: string
}

export const ENTRY_COPY = {
  en: {
    browserWallet: (uid: string) => `Use browser wallet for ${uid}`,
    copy: { done: 'Copied', failed: 'Copy failed', idle: 'Copy' },
    createPasskey: 'Create passkey',
    discover: 'Discover my passes',
    enter: 'Enter',
    metaAddress: 'Your meta-address',
    networkBanner: 'network error — the gate fails closed',
    noPasses: 'No pass announced to this meta-address yet.',
    passkeyWallet: (uid: string) => `Passkey wallet: sign for ${uid}`,
    prf: {
      cancelled:
        'The passkey prompt was dismissed. If this device already holds your fuda passkey, choose "Use existing passkey" — creating a second one would give you a second meta-address.',
      error: 'The passkey ceremony failed.',
      unsupported:
        'This passkey or device cannot derive a +Private key (no PRF support). Try a platform passkey on a recent phone or browser.',
    },
    privateIntro:
      'Unlock your private rights with your fuda passkey. This is separate from the Base account you use to sign in.',
    scanner: {
      cameraUnavailable: 'camera unavailable — paste below',
      check: 'Check',
      placeholder: 'paste fuda:v1:… or 0x…',
    },
    signedIntro: 'Scan or paste your pass, then confirm entry with your wallet.',
    signedTitle: 'Enter with your wallet',
    signing: 'Signing…',
    stealthAddress: 'stealth address',
    tryAgain: 'tap to try again',
    usePasskey: 'Use existing passkey',
    verdict: { ADMIT: 'ADMIT', REJECT: 'REJECT' },
  },
  ja: {
    browserWallet: (uid: string) => `ブラウザーのウォレットで署名：${uid}`,
    copy: { done: 'コピーしました', failed: 'コピーできませんでした', idle: 'コピー' },
    createPasskey: 'パスキーを作成',
    discover: '自分の権利を探す',
    enter: '入場する',
    metaAddress: 'あなたのメタアドレス',
    networkBanner: '通信エラーのため、入場を確認できません',
    noPasses: 'このメタアドレス宛ての権利はまだありません。',
    passkeyWallet: (uid: string) => `パスキーウォレットで署名：${uid}`,
    prf: {
      cancelled:
        'パスキーの操作をキャンセルしました。この端末にfudaのパスキーがある場合は「既存のパスキーを使う」を選んでください。新しく作ると、別のメタアドレスになります。',
      error: 'パスキーの操作に失敗しました。',
      unsupported:
        'このパスキーまたは端末はPRFに対応していないため、+Privateの鍵を生成できません。新しいスマートフォンやブラウザーで端末のパスキーをお試しください。',
    },
    privateIntro:
      'fudaのパスキーで非公開の権利を確認します。サインインに使うBaseアカウントとは別のパスキーです。',
    scanner: {
      cameraUnavailable: 'カメラを利用できません。下の欄に貼り付けてください',
      check: '確認',
      placeholder: 'fuda:v1:… または 0x… を貼り付け',
    },
    signedIntro: 'パスを読み取るか貼り付けて、ウォレットで入場を承認してください。',
    signedTitle: 'ウォレットで入場',
    signing: '署名中…',
    stealthAddress: 'ステルスアドレス',
    tryAgain: 'タップしてもう一度試す',
    usePasskey: '既存のパスキーを使う',
    verdict: { ADMIT: '入場できます', REJECT: '入場できません' },
  },
} satisfies Copy<EntryCopy>

const MESSAGE_COPY: Copy<Record<string, string>> = {
  en: {},
  ja: {
    ALREADY_USED: 'すでに使用済みです。',
    BAD_CHALLENGE: '入場確認の有効期限が切れているか、内容が無効です。',
    BAD_SIGNATURE: '署名を確認できません。',
    DELEGATION_CONFIG_MISSING: '発行権限の確認が設定されていません。',
    DELEGATION_UNAVAILABLE: '発行権限を取得できません。',
    EXPIRED: '有効期限が切れています。',
    ISSUER_NOT_DELEGATED: '発行元に発行権限がありません。',
    LEVEL_REQUIRED: 'この権利にはウォレットでの署名が必要です。',
    NOT_FOUND: '権利が見つかりません。',
    NOT_YET_VALID: 'まだ有効期間が始まっていません。',
    NO_DELEGATION: '発行権限を確認できません。',
    REVOKED: 'この権利は取り消されています。',
    'Rights discovery is not configured.': '権利の検索が設定されていません。',
    UNKNOWN_USAGE_MODEL: '対応していない利用方式です。',
    WRONG_SCHEMA: '対応していない権利です。',
    bad_challenge: '入場確認の有効期限が切れているか、内容が無効です。',
    bad_input: '入力内容を確認してください。',
    bad_qr: 'QRコードが無効です。',
    bad_response: 'サーバーの応答を読み取れませんでした。',
    bad_signature: '署名を確認できません。',
    bad_uid: '権利のIDが無効です。',
    chain_error: '権利を確認できませんでした。',
    internal: 'サーバーでエラーが発生しました。',
    'network error': '通信エラーが発生しました。',
    'no credential': 'パスキーが見つかりませんでした。',
    not_found: '権利が見つかりません。',
    'passkey ceremony failed': 'パスキーの操作に失敗しました。',
    rate_limited: '操作が集中しています。少し待ってからお試しください。',
    rpc_unavailable: '権利の確認先に接続できません。',
    'signing failed': '署名に失敗しました。',
    'something went wrong': '処理に失敗しました。',
    'this passkey or platform does not support the PRF extension':
      'このパスキーまたは端末はPRFに対応していません。',
    unauthorized: 'サインインし直してください。',
    'wallet error': 'ウォレットでエラーが発生しました。',
    'wallet returned no account': 'ウォレットのアドレスを取得できませんでした。',
    'wallet returned no signature': 'ウォレットから署名を取得できませんでした。',
  },
}

// Preserve provider diagnostics and protocol codes; translate known messages at
// render time so an in-flight result follows the current language.
export const entryMessage = (message: string, locale: Locale): string => {
  const messages = pick(MESSAGE_COPY, locale)
  const translated = Object.hasOwn(messages, message) ? messages[message] : undefined
  return translated === undefined ? message : `${translated} (${message})`
}
