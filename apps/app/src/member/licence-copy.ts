import type { Copy } from '@fuda/i18n'
import type { RequirementDetail } from '@fuda/sdk'

interface LicenceCopy {
  activePass: string
  requires: string
  apply: string
  signIn: string
  address: string
  copy: string
  copied: string
  copyFailed: string
  receiveAgain: string
  receiveAgainNote: string
  receive: string
  publicAddress: string
  agreement: string
  details: Record<RequirementDetail, string>
}

export const LICENCE_COPY = {
  en: {
    activePass: 'Works while your licence agreement is active.',
    address:
      'Give this licence address to the asset owner. Once they grant your agreement, receive your pass here.',
    agreement: 'View licence agreement',
    apply: 'Apply with your passkey',
    copied: 'Address copied',
    copy: 'Copy address',
    copyFailed: 'Could not copy. Select the address and copy it.',
    details: {
      'agreement-inactive':
        'Your licence agreement is no longer active. Ask the asset owner, then try again.',
      'no-agreement':
        'No active licence agreement was found. Ask the asset owner to grant one, then try again.',
      'not-granted':
        'The asset owner needs to grant your agreement. An agreement you acquired yourself does not qualify.',
      'registry-not-allowed': 'This licence registry is no longer accepted.',
      'wrong-terms':
        'Your agreement has different terms from those this card requires. Ask the asset owner, then try again.',
    },
    publicAddress: 'Your licence address is public on chain.',
    receive: 'Receive pass',
    receiveAgain: 'Receive pass again',
    receiveAgainNote:
      'Use this if the gate says your licence agreement is inactive after the asset owner grants a new one.',
    requires: 'This card requires a licence agreement granted by the asset owner.',
    signIn: 'Sign in to apply',
  },
  ja: {
    activePass: 'ライセンス契約が有効な間、使えます。',
    address:
      'このライセンス用アドレスを権利者に伝えてください。契約が付与されたら、ここでパスを受け取れます。',
    agreement: 'ライセンス契約を見る',
    apply: 'パスキーで申し込む',
    copied: 'コピーしました',
    copy: 'アドレスをコピー',
    copyFailed: 'コピーできませんでした。アドレスを選択してコピーしてください。',
    details: {
      'agreement-inactive': 'ライセンス契約は現在無効です。権利者に確認してから、もう一度お試しください。',
      'no-agreement':
        '有効なライセンス契約が見つかりません。権利者に付与を依頼してから、もう一度お試しください。',
      'not-granted': '権利者による契約の付与が必要です。自分で取得した契約では受け取れません。',
      'registry-not-allowed': 'このライセンス登録先は現在受け付けていません。',
      'wrong-terms':
        'このカードに必要な条件と契約の条件が異なります。権利者に確認してから、もう一度お試しください。',
    },
    publicAddress: 'ライセンス用アドレスはチェーン上で公開されます。',
    receive: 'パスを受け取る',
    receiveAgain: 'パスをもう一度受け取る',
    receiveAgainNote:
      '権利者が新しい契約を付与した後もゲートでライセンス契約が無効と表示される場合に使ってください。',
    requires: 'このカードを受け取るには、権利者から付与されたライセンス契約が必要です。',
    signIn: 'サインインして申し込む',
  },
} satisfies Copy<LicenceCopy>
