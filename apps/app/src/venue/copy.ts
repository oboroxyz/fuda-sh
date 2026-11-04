import type { Copy } from '@fuda/i18n'
import type { CardCategory } from '@fuda/sdk'

import type { CardFailure } from '../api.ts'

export interface VenueCopy {
  appleWallet: string
  browserPass: string
  saveBackup: string
  saveBackupHint: string
  category: Record<CardCategory, { label: string; noun: string; role: string }>
  closedCard: (name: string, noun: string) => string
  defaultUnavailable: string
  failure: Record<CardFailure, string>
  claimPasskeyNote: string
  enterWithPasskey: string
  getCard: (noun: string) => string
  getWithPasskey: (noun: string) => string
  keptOnAccount: (noun: string) => string
  needsAccount: string
  passkeyBackupHint: string
  passkeyEntryNote: string
  signInToGet: (noun: string) => string
  getFreeCard: (noun: string) => string
  gettingCard: string
  googleWallet: string
  heldCard: string
  issued: (date: string) => string
  keepOpen: string
  loading: string
  noCard: string
  noCardAtAddress: (name: string) => string
  noCards: (name: string) => string
  noSignUp: string
  notFound: string
  notHandingOut: string
  pickCard: string
  qrLabel: (name: string, noun: string) => string
  savedOnDevice: (noun: string) => string
  seeAllCards: (name: string) => string
  showQr: string
  tryAgain: string
  verifyHuman: string
  verifyingHuman: string
  verifiedHuman: string
  alreadyVerifiedHuman: string
  // The hand-off to the verifier: the member opens the link (or scans the code
  // from another device) while this page keeps waiting for the answer. Neither
  // string names the verifier — the app the member opens introduces itself.
  continueVerification: string
  verificationQrLabel: string
}

export const VENUE_COPY = {
  en: {
    alreadyVerifiedHuman: 'This person already has a verified pass',
    appleWallet: 'Add to Apple Wallet',
    browserPass: 'Open pass in browser',
    category: {
      membership: { label: 'Membership', noun: 'membership card', role: 'MEMBER' },
      ticket: { label: 'Ticket', noun: 'ticket', role: 'TICKET' },
    },
    claimPasskeyNote:
      'This pass is tied to your passkey, so only you can use it. A photo of it will not get anyone in.',
    closedCard: (name, noun) => `${name} is not handing out this ${noun} right now.`,
    continueVerification: 'Continue verification',
    defaultUnavailable: 'The featured card is not available right now. You can check the other cards below.',
    enterWithPasskey: 'Enter with your passkey',
    failure: {
      card_closed: 'This card is no longer being handed out.',
      card_sold_out: 'All of these cards have been handed out.',
      chain_error: 'Cards cannot be issued right now. Please try again later.',
      network: 'Could not reach fuda. Check your connection and try again.',
      no_signer: 'Cards cannot be issued right now. Please try again later.',
      not_found: 'This card is no longer available.',
      passkey_cancelled: 'No passkey was used, so no card was issued. You can try again.',
      passkey_refused: 'That passkey is not on your account. Choose one you sign in with.',
      rate_limited: 'Too many cards were requested from this device. Please try again later.',
      signed_out: 'Please sign in again to get this card.',
    },
    getCard: (noun) => `Get this ${noun}`,
    getFreeCard: (noun) => `Get your free ${noun}`,
    getWithPasskey: (noun) => `Get this ${noun} with your passkey`,
    gettingCard: 'Getting your card…',
    googleWallet: 'Add to Google Wallet',
    heldCard: 'You have this card · Show it',
    issued: (date) => `Issued ${date}`,
    keepOpen: 'Please keep this page open.',
    keptOnAccount: (noun) => `This ${noun} is kept on your fuda account.`,
    loading: 'Loading card…',
    needsAccount: 'Needs a fuda account: a passkey, with no email.',
    noCard: 'No card here',
    noCardAtAddress: (name) => `${name} has no card at this address.`,
    noCards: (name) => `${name} has no cards to hand out right now.`,
    noSignUp: 'No sign-up · No app install',
    notFound: 'There is no card at this address. Check the link you were given.',
    notHandingOut: 'Not being handed out right now',
    passkeyBackupHint:
      'A backup keeps this pass’s record, but you still need your passkey to enter. If you lose the passkey, ask the shop for a new pass.',
    passkeyEntryNote:
      'Tap this at the door and show the result. There is no code to show and no Wallet pass, because a code alone would not get anyone in.',
    pickCard: 'Pick a card',
    qrLabel: (name, noun) => `Your ${noun} QR code for ${name}`,
    saveBackup: 'Save a backup of this pass',
    saveBackupHint: 'Keep it somewhere safe. Anyone who has it can use this pass.',
    savedOnDevice: (noun) => `No name or contact details required. This ${noun} is saved on this device.`,
    seeAllCards: (name) => `See all cards from ${name}`,
    showQr: 'Show this code when you use your card.',
    signInToGet: (noun) => `Sign in to get this ${noun}`,
    tryAgain: 'Try again',
    verificationQrLabel: 'QR code to continue verification',
    verifiedHuman: 'Verified Human',
    verifyHuman: "Verify you're human",
    verifyingHuman: 'Verifying…',
  },
  ja: {
    alreadyVerifiedHuman: 'この方はすでに確認済みのパスをお持ちです',
    appleWallet: 'Apple Walletに追加',
    browserPass: 'ブラウザーでパスを開く',
    category: {
      membership: { label: '会員証', noun: '会員証', role: '会員' },
      ticket: { label: 'チケット', noun: 'チケット', role: 'チケット' },
    },
    claimPasskeyNote:
      'このパスはあなたのパスキーにひも付くため、本人しか使えません。写真では入場できません。',
    closedCard: (name, noun) => `${name}は現在この${noun}を配布していません。`,
    continueVerification: '確認を続ける',
    defaultUnavailable: 'おすすめのカードは現在配布していません。ほかのカードは下の一覧で確認できます。',
    enterWithPasskey: 'パスキーで入場する',
    failure: {
      card_closed: 'このカードの配布は終了しました。',
      card_sold_out: 'このカードは上限枚数に達しました。',
      chain_error: '現在カードを発行できません。しばらくしてからもう一度お試しください。',
      network: 'fudaに接続できませんでした。通信状況を確認して、もう一度お試しください。',
      no_signer: '現在カードを発行できません。しばらくしてからもう一度お試しください。',
      not_found: 'このカードは利用できなくなりました。',
      passkey_cancelled: 'パスキーを使わなかったため、カードは発行されていません。もう一度お試しください。',
      passkey_refused:
        'そのパスキーはこのアカウントのものではありません。サインインに使うパスキーを選んでください。',
      rate_limited:
        'この端末からのカード発行リクエストが多すぎます。しばらくしてからもう一度お試しください。',
      signed_out: 'カードを受け取るには、もう一度サインインしてください。',
    },
    getCard: (noun) => `この${noun}を受け取る`,
    getFreeCard: (noun) => `無料の${noun}を受け取る`,
    getWithPasskey: (noun) => `パスキーでこの${noun}を受け取る`,
    gettingCard: 'カードを受け取り中…',
    googleWallet: 'Google Walletに追加',
    heldCard: '受け取り済み · カードを表示',
    issued: (date) => `発行日 ${date}`,
    keepOpen: 'このページを開いたままお待ちください。',
    keptOnAccount: (noun) => `この${noun}は fuda のアカウントに保存されています。`,
    loading: 'カードを読み込み中…',
    needsAccount: 'fuda のアカウントが必要です(パスキーのみ、メールアドレスは不要)。',
    noCard: 'カードが見つかりません',
    noCardAtAddress: (name) => `このアドレスに${name}のカードはありません。`,
    noCards: (name) => `${name}が現在配布しているカードはありません。`,
    noSignUp: '登録不要 · アプリのインストール不要',
    notFound: 'このアドレスにカードはありません。案内されたリンクを確認してください。',
    notHandingOut: '現在配布していません',
    passkeyBackupHint:
      '控えにはパスの記録が残りますが、入場にはパスキーが必要です。パスキーをなくした場合は、お店で新しいパスを発行してもらってください。',
    passkeyEntryNote:
      '入口でこのボタンを押して、結果の画面を見せてください。コードだけでは入場できないため、提示するコードや Wallet のパスはありません。',
    pickCard: 'カードを選ぶ',
    qrLabel: (name, noun) => `${name}の${noun}のQRコード`,
    saveBackup: 'パスの控えを保存',
    saveBackupHint: '安全な場所に保管してください。控えを持つ人は、このパスを使えます。',
    savedOnDevice: (noun) => `氏名や連絡先は不要です。この${noun}はこの端末に保存されています。`,
    seeAllCards: (name) => `${name}のカードをすべて見る`,
    showQr: 'カードを使うときに、このコードを提示してください。',
    signInToGet: (noun) => `サインインしてこの${noun}を受け取る`,
    tryAgain: 'もう一度試す',
    verificationQrLabel: '確認を続けるためのQRコード',
    // Not 本人確認: in Japanese that is the KYC / identity-document phrase, and
    // it would promise an identity check this badge deliberately does not make.
    // What is confirmed is that a real person holds the pass and cannot confirm
    // a second one, so the wording says human, not identity.
    verifiedHuman: '人間であることを確認済み',
    verifyHuman: '人間であることを確認する',
    verifyingHuman: '確認中…',
  },
} satisfies Copy<VenueCopy>
