import { pick } from '@fuda/i18n'
import type { Copy, Locale } from '@fuda/i18n'

interface EntryCopy {
  signedTitle: string
  passkeyEntryTitle: string
  passkeyEntryIntro: string
  enterWithPasskey: string
  signedIntro: string
  signedUnreadable: string
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
    enterWithPasskey: 'Enter with your passkey',
    networkBanner: 'network error — the gate fails closed',
    passkeyEntryIntro: 'Confirm with your passkey, then show the result to the staff.',
    passkeyEntryTitle: 'Enter with your passkey',
    passkeyWallet: (uid: string) => `Passkey wallet: sign for ${uid}`,
    scanner: {
      cameraUnavailable: 'camera unavailable — paste below',
      check: 'Check',
      placeholder: 'paste fuda:v1:… or 0x…',
    },
    signedIntro: 'Scan or paste your pass, then confirm entry with your wallet.',
    signedTitle: 'Enter with your wallet',
    signedUnreadable: 'This is not a fuda pass code.',
    signing: 'Signing…',
    tryAgain: 'tap to try again',
    verdict: { ADMIT: 'ADMIT', REJECT: 'REJECT' },
  },
  ja: {
    browserWallet: (uid: string) => `ブラウザーのウォレットで署名：${uid}`,
    enterWithPasskey: 'パスキーで入場する',
    networkBanner: '通信エラーのため、入場を確認できません',
    passkeyEntryIntro: 'パスキーで確認して、結果の画面をスタッフに見せてください。',
    passkeyEntryTitle: 'パスキーで入場',
    passkeyWallet: (uid: string) => `パスキーウォレットで署名：${uid}`,
    scanner: {
      cameraUnavailable: 'カメラを利用できません。下の欄に貼り付けてください',
      check: '確認',
      placeholder: 'fuda:v1:… または 0x… を貼り付け',
    },
    signedIntro: 'パスを読み取るか貼り付けて、ウォレットで入場を承認してください。',
    signedTitle: 'ウォレットで入場',
    signedUnreadable: 'fuda のパスのコードではありません。',
    signing: '署名中…',
    tryAgain: 'タップしてもう一度試す',
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
    LEVEL_REQUIRED: 'この権利はコードだけでは入場できません。',
    NOT_FOUND: '権利が見つかりません。',
    NOT_YET_VALID: 'まだ有効期間が始まっていません。',
    NO_DELEGATION: '発行権限を確認できません。',
    REVOKED: 'この権利は取り消されています。',
    'Rights discovery is not configured.': '権利の検索が設定されていません。',
    'The passkey for this pass was not used. Try again on a device that has it.':
      'このパスのパスキーが使われませんでした。パスキーのある端末でもう一度お試しください。',
    'The passkey that opens this pass was not used. Try again on a device that has it.':
      'このパスを開くパスキーが使われませんでした。パスキーのある端末でもう一度お試しください。',
    'This pass is not on this account. Sign in with the account that received it.':
      'このアカウントにはこのパスがありません。受け取ったアカウントでサインインしてください。',
    UNKNOWN_USAGE_MODEL: '対応していない利用方式です。',
    WRONG_SCHEMA: '対応していない権利です。',
    WRONG_VENUE: 'この発行元のパスではありません。',
    bad_challenge: '入場確認の有効期限が切れているか、内容が無効です。',
    bad_input: '入力内容を確認してください。',
    bad_qr: 'QRコードが無効です。',
    bad_response: 'サーバーの応答を読み取れませんでした。',
    bad_signature: '署名を確認できません。',
    bad_uid: '権利のIDが無効です。',
    chain_error: '権利を確認できませんでした。',
    internal: 'サーバーでエラーが発生しました。',
    'network error': '通信エラーが発生しました。',
    not_found: '権利が見つかりません。',
    rate_limited: '操作が集中しています。少し待ってからお試しください。',
    rpc_unavailable: '権利の確認先に接続できません。',
    'signing failed': '署名に失敗しました。',
    'something went wrong': '処理に失敗しました。',
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
