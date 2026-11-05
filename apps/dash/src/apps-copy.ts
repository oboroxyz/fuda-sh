import type { Copy } from '@fuda/i18n'
import type { ConnectedAppScope } from '@fuda/sdk'

import { dashMessage } from './error-copy.ts'

export interface AppsCopy {
  errorMessage: (code: string) => string
  title: string
  description: string
  registerTitle: string
  nameLabel: string
  redirectLabel: string
  redirectHint: string
  register: string
  registering: string
  registerFailed: Record<'bad_redirect_uri' | 'app_limit' | 'other', string>
  appsTitle: string
  noApps: string
  clientId: string
  redirectUris: string
  deleteApp: string
  confirmDelete: string
  grantsTitle: string
  noGrants: string
  grantFor: string
  expires: string
  lastUsed: string
  neverUsed: string
  revoke: string
  activityTitle: string
  activityHint: string
  noActivity: string
  activityFailed: string
  actions: Record<string, string>
  scopes: Record<ConnectedAppScope, string>
  loading: string
  loadFailed: string
  retry: string
  actionFailed: string
}

/* oxlint-disable eslint/sort-keys -- translation objects follow the page's reading order */
export const APPS_COPY = {
  en: {
    errorMessage: (code: string) => dashMessage(code, 'en'),
    title: 'Apps',
    description:
      'Apps you build, for example in Figma Make, can create cards for your profile once you approve them. Only this account can approve its own apps.',
    registerTitle: 'Register an app',
    nameLabel: 'App name',
    redirectLabel: 'Return addresses',
    redirectHint:
      'One per line: the exact page fuda sends you back to after approval, e.g. https://your-app.figma.site/. https only, or http on localhost.',
    register: 'Register',
    registering: 'Registering…',
    registerFailed: {
      bad_redirect_uri:
        'A return address is not a full https URL (http only on localhost), or is listed twice.',
      app_limit: 'This account already has the most apps it can register. Delete one first.',
      other: 'The app was not registered. Check the name and try again.',
    },
    appsTitle: 'Registered apps',
    noApps: 'No apps yet.',
    clientId: 'Client ID',
    redirectUris: 'Return addresses',
    deleteApp: 'Delete',
    confirmDelete: 'Delete and end its approvals',
    grantsTitle: 'Approvals',
    noGrants: 'No app is approved right now.',
    grantFor: 'for',
    expires: 'Expires',
    lastUsed: 'Last used',
    neverUsed: 'Not used yet',
    revoke: 'Revoke',
    activityTitle: 'Recent activity',
    activityHint: 'The latest changes your approved apps tried to make.',
    noActivity: 'No app has changed anything yet.',
    activityFailed: 'Failed',
    actions: {
      create_card: 'Created a card',
      issue_pass: 'Issued a pass',
      revoke_pass: 'Revoked a pass',
      update_card_limits: 'Changed card limits',
    },
    scopes: {
      'cards:read': 'See cards',
      'cards:write': 'Create cards',
      'passes:issue': 'Issue passes',
      'passes:read': 'See passes',
      'passes:revoke': 'Revoke passes',
    },
    loading: 'Loading…',
    loadFailed: 'Apps could not be loaded.',
    retry: 'Retry',
    actionFailed: 'That did not go through. Try again.',
  },
  ja: {
    errorMessage: (code: string) => dashMessage(code, 'ja'),
    title: 'アプリ連携',
    description:
      'Figma Make などで作ったアプリは、承認するとこのプロフィールのカードを作れるようになります。承認できるのは、アプリを登録したこのアカウントだけです。',
    registerTitle: 'アプリを登録',
    nameLabel: 'アプリ名',
    redirectLabel: '戻り先',
    redirectHint:
      '1 行に 1 つ。承認後に fuda が戻るページを正確に入力します（例：https://your-app.figma.site/）。https のみ、localhost だけは http も使えます。',
    register: '登録する',
    registering: '登録しています…',
    registerFailed: {
      bad_redirect_uri:
        '戻り先が https の完全な URL になっていないか（http は localhost のみ）、同じものが重複しています。',
      app_limit: 'このアカウントで登録できるアプリの上限に達しています。先に 1 つ削除してください。',
      other: 'アプリを登録できませんでした。名前を確認してもう一度お試しください。',
    },
    appsTitle: '登録済みのアプリ',
    noApps: 'まだアプリはありません。',
    clientId: 'クライアント ID',
    redirectUris: '戻り先',
    deleteApp: '削除',
    confirmDelete: '削除して承認もすべて取り消す',
    grantsTitle: '承認中のアプリ',
    noGrants: '承認中のアプリはありません。',
    grantFor: '対象',
    expires: '有効期限',
    lastUsed: '最終利用',
    neverUsed: '未使用',
    revoke: '取り消す',
    activityTitle: '最近の操作',
    activityHint: '承認したアプリが行おうとした最近の変更です。',
    noActivity: 'アプリによる変更はまだありません。',
    activityFailed: '失敗',
    actions: {
      create_card: 'カードを作成',
      issue_pass: 'パスを発行',
      revoke_pass: 'パスを失効',
      update_card_limits: 'カードの上限を変更',
    },
    scopes: {
      'cards:read': 'カードを見る',
      'cards:write': 'カードを作る',
      'passes:issue': 'パスを発行する',
      'passes:read': 'パスを見る',
      'passes:revoke': 'パスを失効する',
    },
    loading: '読み込んでいます…',
    loadFailed: 'アプリを読み込めませんでした。',
    retry: '再読み込み',
    actionFailed: '完了しませんでした。もう一度お試しください。',
  },
} satisfies Copy<AppsCopy>
/* oxlint-enable eslint/sort-keys */
