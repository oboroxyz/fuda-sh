import type { Copy } from '@fuda/i18n'
import type { CardCategory } from '@fuda/sdk'

import type { CardFailure } from '../api.ts'

export interface VenueCopy {
  appleWallet: string
  backToCards: string
  browserPass: string
  category: Record<CardCategory, { label: string; noun: string; role: string }>
  closedCard: (name: string, noun: string) => string
  defaultUnavailable: string
  failure: Record<CardFailure, string>
  getCard: (noun: string) => string
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
}

export const VENUE_COPY = {
  en: {
    appleWallet: 'Add to Apple Wallet',
    backToCards: 'Back to cards',
    browserPass: 'Open pass in browser',
    category: {
      membership: { label: 'Membership', noun: 'membership card', role: 'MEMBER' },
      ticket: { label: 'Ticket', noun: 'ticket', role: 'TICKET' },
    },
    closedCard: (name, noun) => `${name} is not handing out this ${noun} right now.`,
    defaultUnavailable: 'The featured card is not available right now. You can check the other cards below.',
    failure: {
      card_closed: 'This card is no longer being handed out.',
      chain_error: 'Cards cannot be issued right now. Please try again later.',
      network: 'Could not reach fuda. Check your connection and try again.',
      no_signer: 'Cards cannot be issued right now. Please try again later.',
      not_found: 'This card is no longer available.',
      rate_limited: 'Too many cards were requested from this device. Please try again later.',
    },
    getCard: (noun) => `Get this ${noun}`,
    getFreeCard: (noun) => `Get your free ${noun}`,
    gettingCard: 'Getting your card…',
    googleWallet: 'Add to Google Wallet',
    heldCard: 'You have this card · Show it',
    issued: (date) => `Issued ${date}`,
    keepOpen: 'Please keep this page open.',
    loading: 'Loading card…',
    noCard: 'No card here',
    noCardAtAddress: (name) => `${name} has no card at this address.`,
    noCards: (name) => `${name} has no cards to hand out right now.`,
    noSignUp: 'No sign-up · No app install',
    notFound: 'There is no card at this address. Check the link you were given.',
    notHandingOut: 'Not being handed out right now',
    pickCard: 'Pick a card',
    qrLabel: (name, noun) => `Your ${noun} QR code for ${name}`,
    savedOnDevice: (noun) => `No name or contact details required. This ${noun} is saved on this device.`,
    seeAllCards: (name) => `See all cards from ${name}`,
    showQr: 'Show this code when you use your card.',
    tryAgain: 'Try again',
  },
  ja: {
    appleWallet: 'Apple Walletに追加',
    backToCards: 'カード一覧に戻る',
    browserPass: 'ブラウザーでパスを開く',
    category: {
      membership: { label: '会員証', noun: '会員証', role: '会員' },
      ticket: { label: 'チケット', noun: 'チケット', role: 'チケット' },
    },
    closedCard: (name, noun) => `${name}は現在この${noun}を配布していません。`,
    defaultUnavailable: 'おすすめのカードは現在配布していません。ほかのカードは下の一覧で確認できます。',
    failure: {
      card_closed: 'このカードの配布は終了しました。',
      chain_error: '現在カードを発行できません。しばらくしてからもう一度お試しください。',
      network: 'fudaに接続できませんでした。通信状況を確認して、もう一度お試しください。',
      no_signer: '現在カードを発行できません。しばらくしてからもう一度お試しください。',
      not_found: 'このカードは利用できなくなりました。',
      rate_limited:
        'この端末からのカード発行リクエストが多すぎます。しばらくしてからもう一度お試しください。',
    },
    getCard: (noun) => `この${noun}を受け取る`,
    getFreeCard: (noun) => `無料の${noun}を受け取る`,
    gettingCard: 'カードを受け取り中…',
    googleWallet: 'Google Walletに追加',
    heldCard: '受け取り済み · カードを表示',
    issued: (date) => `発行日 ${date}`,
    keepOpen: 'このページを開いたままお待ちください。',
    loading: 'カードを読み込み中…',
    noCard: 'カードが見つかりません',
    noCardAtAddress: (name) => `このアドレスに${name}のカードはありません。`,
    noCards: (name) => `${name}が現在配布しているカードはありません。`,
    noSignUp: '登録不要 · アプリのインストール不要',
    notFound: 'このアドレスにカードはありません。案内されたリンクを確認してください。',
    notHandingOut: '現在配布していません',
    pickCard: 'カードを選ぶ',
    qrLabel: (name, noun) => `${name}の${noun}のQRコード`,
    savedOnDevice: (noun) => `氏名や連絡先は不要です。この${noun}はこの端末に保存されています。`,
    seeAllCards: (name) => `${name}のカードをすべて見る`,
    showQr: 'カードを使うときに、このコードを提示してください。',
    tryAgain: 'もう一度試す',
  },
} satisfies Copy<VenueCopy>
