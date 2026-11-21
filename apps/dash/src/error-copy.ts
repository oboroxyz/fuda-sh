import { pick } from '@fuda/i18n'
import type { Copy, Locale } from '@fuda/i18n'

export const DASH_ERROR_COPY = {
  already_claimed: { en: 'This name has already been claimed.', ja: 'この名前はすでに取得済みです。' },
  app_limit: { en: 'You have reached the app limit.', ja: '登録できるアプリの上限に達しています。' },
  bad_address: { en: 'Check the wallet address.', ja: 'ウォレットのアドレスを確認してください。' },
  bad_challenge: {
    en: 'Sign in again. The sign-in request has expired.',
    ja: 'サインインの有効期限が切れました。もう一度サインインしてください。',
  },
  bad_handle: { en: 'Check the profile link.', ja: 'プロフィールのリンクを確認してください。' },
  bad_input: { en: 'Check the information you entered.', ja: '入力内容を確認してください。' },
  bad_qr: { en: 'This QR code could not be read.', ja: 'このQRコードは読み取れません。' },
  bad_redirect_uri: { en: 'Check the app return URL.', ja: 'アプリの戻り先URLを確認してください。' },
  bad_response: {
    en: 'The server response could not be read. Try again.',
    ja: 'サーバーの応答を読み取れませんでした。もう一度お試しください。',
  },
  bad_signature: {
    en: 'The signature could not be verified. Sign in again.',
    ja: '署名を確認できませんでした。もう一度サインインしてください。',
  },
  bad_slug: { en: 'Check the card link.', ja: 'カードのリンクを確認してください。' },
  bad_uid: { en: 'The pass ID is invalid.', ja: 'パスのIDが無効です。' },
  bad_upload: { en: 'Choose the logo image again.', ja: 'ロゴの画像を選び直してください。' },
  card_sold_out: {
    en: 'This card has reached its issue limit.',
    ja: 'このカードは発行枚数の上限に達しています。',
  },
  chain_error: {
    en: 'The pass service could not complete the request. Try again.',
    ja: 'パスの処理を完了できませんでした。もう一度お試しください。',
  },
  claim_failed: {
    en: 'The name could not be claimed. Try again.',
    ja: '名前を取得できませんでした。もう一度お試しください。',
  },
  claim_unconfirmed: {
    en: 'The name claim has not been confirmed yet. Try again shortly.',
    ja: '名前の取得をまだ確認できません。少し待ってからお試しください。',
  },
  client_ip_required: {
    en: 'The connection could not be verified. Try again.',
    ja: '接続を確認できませんでした。もう一度お試しください。',
  },
  ens_not_configured: {
    en: 'Name registration is not available yet.',
    ja: '名前の登録はまだ利用できません。',
  },
  ens_persistence_failed: {
    en: 'The name could not be saved. Try again.',
    ja: '名前を保存できませんでした。もう一度お試しください。',
  },
  handle_taken: {
    en: 'This profile link is already used. Choose another.',
    ja: 'このプロフィールのリンクはすでに使われています。別のリンクを選んでください。',
  },
  holder_must_claim: {
    en: 'The member must receive this pass themselves.',
    ja: 'メンバー本人がパスを受け取ってください。',
  },
  integrations_not_supported: {
    en: 'This card does not support integrations.',
    ja: 'このカードでは連携を利用できません。',
  },
  internal: {
    en: 'Something went wrong. Try again.',
    ja: '処理を完了できませんでした。もう一度お試しください。',
  },
  invalid_client: { en: 'This app could not be found.', ja: 'このアプリが見つかりません。' },
  invalid_grant: {
    en: 'This app approval has expired. Connect the app again.',
    ja: 'アプリの承認の有効期限が切れました。もう一度連携してください。',
  },
  invalid_request: {
    en: 'The app approval request is invalid. Open the app link again.',
    ja: 'アプリの承認内容が無効です。アプリのリンクを開き直してください。',
  },
  invalid_scope: {
    en: 'Check the permissions requested by the app.',
    ja: 'アプリが求める権限を確認してください。',
  },
  invalid_target: { en: 'Choose the profile to connect.', ja: '連携するプロフィールを選んでください。' },
  issuer_limit: {
    en: 'You have reached the profile limit.',
    ja: '作成できるプロフィールの上限に達しています。',
  },
  media_not_configured: {
    en: 'Logo uploads are not available yet.',
    ja: 'ロゴのアップロードはまだ利用できません。',
  },
  no_signer: { en: 'Pass processing is not available yet.', ja: 'パスを処理する準備ができていません。' },
  not_app_owner: {
    en: 'Only the app owner can approve this connection.',
    ja: 'この連携を承認できるのは、アプリを登録した方だけです。',
  },
  not_delegated: {
    en: 'This profile does not have permission to register a name.',
    ja: 'このプロフィールには名前を登録する権限がありません。',
  },
  not_found: { en: 'The requested information could not be found.', ja: 'お探しの情報が見つかりません。' },
  rate_limited: {
    en: 'Too many requests. Wait a moment and try again.',
    ja: '操作が集中しています。少し待ってからお試しください。',
  },
  requirement_unmet: { en: 'The pass requirement is not met.', ja: 'パスの必要条件を満たしていません。' },
  session_changed: {
    en: 'The profile changed in another tab. Reload this page.',
    ja: '別のタブでプロフィールが切り替わりました。このページを再読み込みしてください。',
  },
  slug_taken: {
    en: 'This card link is already used. Choose another.',
    ja: 'このカードのリンクはすでに使われています。別のリンクを選んでください。',
  },
  stamps_not_supported: {
    en: 'Stamps are available for membership cards only.',
    ja: 'スタンプはメンバーカードでのみ利用できます。',
  },
  unauthorized: { en: 'Sign in again.', ja: 'もう一度サインインしてください。' },
  unsupported_grant_type: {
    en: 'This app connection method is not supported.',
    ja: 'このアプリの連携方法には対応していません。',
  },
  upload_not_found: {
    en: 'The logo upload has expired. Choose the image again.',
    ja: 'ロゴのアップロードの有効期限が切れました。画像を選び直してください。',
  },
  wallet_required: { en: 'Connect a wallet to continue.', ja: '続けるにはウォレットを接続してください。' },
} satisfies Record<string, Copy<string>>

const UNKNOWN_ERROR_COPY = {
  en: 'Something went wrong. Try again.',
  ja: '処理を完了できませんでした。もう一度お試しください。',
} satisfies Copy<string>

export const dashMessage = (code: string, locale: Locale): string => {
  const copy = Object.entries(DASH_ERROR_COPY).find(([key]) => key === code)?.[1]
  return copy === undefined ? `${pick(UNKNOWN_ERROR_COPY, locale)} (${code})` : pick(copy, locale)
}
