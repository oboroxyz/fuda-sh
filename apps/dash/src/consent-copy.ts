import type { Copy } from '@fuda/i18n'

export interface ConsentCopy {
  title: string
  signInHint: string
  signIn: string
  signingIn: string
  signInFailed: string
  loading: string
  wants: string
  redirectsTo: string
  chooseIssuer: string
  permissions: string
  scopes: Record<'cards:read' | 'cards:write', string>
  approve: string
  approving: string
  deny: string
  noIssuer: string
  createIssuer: string
  failures: Record<string, string>
  unknownFailure: string
}

export const CONSENT_COPY = {
  en: {
    approve: 'Approve',
    approving: 'Approving…',
    chooseIssuer: 'Use it for',
    createIssuer: 'Open the dashboard',
    deny: 'Cancel',
    failures: {
      bad_redirect_uri: 'This app sent a return address it did not register. Nothing was approved.',
      invalid_client: 'This app is not registered with fuda.',
      invalid_request: 'The approval request is incomplete. Ask the app to try again.',
      invalid_scope: 'The app asked for a permission fuda does not offer.',
      not_app_owner: 'Only the account that registered this app can approve it.',
      not_found: 'That profile is not yours.',
    },
    loading: 'Checking the request…',
    noIssuer: 'Create your profile in the fuda dashboard first, then approve the app.',
    permissions: 'It will be able to',
    redirectsTo: 'Returns to',
    scopes: { 'cards:read': 'See your cards', 'cards:write': 'Create cards' },
    signIn: 'Sign in with passkey',
    signInFailed: 'Sign-in did not finish. Try again.',
    signInHint: 'Sign in to fuda to approve this app.',
    signingIn: 'Waiting for your passkey…',
    title: 'Approve an app',
    unknownFailure: 'The request could not be checked. Try again.',
    wants: 'wants to work with your fuda profile.',
  },
  ja: {
    approve: '承認する',
    approving: '承認しています…',
    chooseIssuer: '使うプロフィール',
    createIssuer: 'ダッシュボードを開く',
    deny: 'キャンセル',
    failures: {
      bad_redirect_uri: 'このアプリは登録していない戻り先を指定しました。承認は行っていません。',
      invalid_client: 'このアプリは fuda に登録されていません。',
      invalid_request: '承認のリクエストが不完全です。アプリからやり直してください。',
      invalid_scope: 'fuda が提供していない権限を求められました。',
      not_app_owner: 'このアプリを承認できるのは、登録したアカウントだけです。',
      not_found: 'そのプロフィールはこのアカウントのものではありません。',
    },
    loading: 'リクエストを確認しています…',
    noIssuer: '先に fuda のダッシュボードでプロフィールを作成してから、アプリを承認してください。',
    permissions: 'できること',
    redirectsTo: '戻り先',
    scopes: { 'cards:read': 'カードを見る', 'cards:write': 'カードを作る' },
    signIn: 'パスキーでサインイン',
    signInFailed: 'サインインが完了しませんでした。もう一度お試しください。',
    signInHint: 'このアプリを承認するには fuda にサインインしてください。',
    signingIn: 'パスキーを待っています…',
    title: 'アプリの承認',
    unknownFailure: 'リクエストを確認できませんでした。もう一度お試しください。',
    wants: 'があなたの fuda プロフィールを使おうとしています。',
  },
} satisfies Copy<ConsentCopy>
