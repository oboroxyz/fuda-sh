import type { IssuerPassStatus } from '@fuda/sdk'

export interface ManagementCopy {
  editCard: string
  editDescription: string
  save: string
  saving: string
  saved: string
  saveFailed: string
  slugHint: string
  stampOption: string
  stampHint: string
  back: string
  loading: string
  loadFailed: string
  retry: string
  refresh: string
  card: string
  type: string
  membership: string
  ticket: string
  issued: string
  active: string
  validity: string
  url: string
  actions: string
  edit: string
  searchCards: string
  searchCardsPlaceholder: string
  allTypes: string
  noCardsMatch: string
  clearFilters: string
  copyFailed: string
  passesTitle: string
  passesDescription: string
  totalPasses: string
  activePasses: string
  totalStamps: string
  recentClaims: string
  countHint: string
  snapshotHint: string
  unknownHint: string
  searchPasses: string
  searchPassesPlaceholder: string
  allCards: string
  allStatuses: string
  status: string
  member: string
  claimedAt: string
  stamps: string
  address: string
  expires: string
  notRecorded: string
  noExpiry: string
  noPasses: string
  noPassesMatch: string
  previous: string
  next: string
  page: string
  results: string
  localTime: string
  statuses: Record<IssuerPassStatus, string>
}

export const MANAGEMENT_COPY = {
  en: {
    actions: 'Actions',
    active: 'Active',
    activePasses: 'Active passes',
    address: 'Address',
    allCards: 'All cards',
    allStatuses: 'All statuses',
    allTypes: 'All types',
    back: '< Back to card',
    card: 'Card',
    claimedAt: 'Claimed',
    clearFilters: 'Clear filters',
    copyFailed: 'Could not copy the link. Select the URL to copy it.',
    countHint: 'Each issued member number counts as one pass. Repeat claims may belong to the same person.',
    edit: 'Edit',
    editCard: 'Edit card',
    editDescription:
      'Changes to validity apply to future claims. Existing passes keep their original validity.',
    expires: 'Expires',
    issued: 'Issued',
    loadFailed: 'Could not load this information.',
    loading: 'Loading…',
    localTime: 'Times are shown in your local time zone.',
    member: 'Member number',
    membership: 'Membership',
    next: 'Next',
    noCardsMatch: 'No cards match these filters.',
    noExpiry: 'No expiry',
    noPasses: 'No passes have been claimed yet.',
    noPassesMatch: 'No passes match these filters.',
    notRecorded: 'Not recorded',
    page: 'Page {page} of {pages}',
    passesDescription: 'Claims and stamp activity for this profile.',
    passesTitle: 'Passes',
    previous: 'Previous',
    recentClaims: 'Claims · last 30 days',
    refresh: 'Refresh',
    results: '{count} results',
    retry: 'Try again',
    save: 'Save card',
    saveFailed: 'Could not save the card. Your changes are still here.',
    saved: 'Card saved.',
    saving: 'Saving…',
    searchCards: 'Search cards',
    searchCardsPlaceholder: 'Card name or ID',
    searchPasses: 'Search passes',
    searchPassesPlaceholder: 'Member number, address, card or UID',
    slugHint: 'The public URL is permanent so shared links keep working.',
    snapshotHint: 'Status reflects recorded issuance, revocation and usage. It is not a live on-chain check.',
    stampHint: 'Enable stamps for this membership. Stamp settings are saved separately.',
    stampOption: 'Stamp settings (optional)',
    stamps: 'Stamps',
    status: 'Status',
    statuses: {
      active: 'Active',
      consumed: 'Used',
      expired: 'Expired',
      not_yet_valid: 'Not yet valid',
      revoked: 'Revoked',
      unknown: 'Unconfirmed',
    },
    ticket: 'Ticket',
    totalPasses: 'Total passes',
    totalStamps: 'Total stamps',
    type: 'Type',
    unknownHint: '{count} passes have no recorded validity and are excluded from the active count.',
    url: 'Public URL',
    validity: 'Claim & validity',
  },
  ja: {
    actions: '操作',
    active: '有効数',
    activePasses: '有効なパス',
    address: 'アドレス',
    allCards: 'すべてのカード',
    allStatuses: 'すべての状態',
    allTypes: 'すべての種類',
    back: '< カードに戻る',
    card: 'カード',
    claimedAt: '取得日時',
    clearFilters: '絞り込みを解除',
    copyFailed: 'リンクをコピーできませんでした。URLを選択してコピーしてください。',
    countHint: '発行された会員番号ごとに1件と数えます。同じ人による複数回の取得も含みます。',
    edit: '編集',
    editCard: 'カードを編集',
    editDescription: '有効期限の変更は、今後取得されるパスに適用されます。発行済みパスの期限は変わりません。',
    expires: '有効期限',
    issued: '発行数',
    loadFailed: '情報を読み込めませんでした。',
    loading: '読み込み中…',
    localTime: '日時はお使いの端末のタイムゾーンで表示しています。',
    member: '会員番号',
    membership: 'メンバーシップ',
    next: '次へ',
    noCardsMatch: '条件に一致するカードはありません。',
    noExpiry: '期限なし',
    noPasses: 'まだパスは取得されていません。',
    noPassesMatch: '条件に一致するパスはありません。',
    notRecorded: '未記録',
    page: '{page} / {pages} ページ',
    passesDescription: 'このプロフィールのパス取得・スタンプの状況です。',
    passesTitle: 'パス一覧',
    previous: '前へ',
    recentClaims: '直近30日の取得数',
    refresh: '更新',
    results: '{count}件',
    retry: '再試行',
    save: 'カードを保存',
    saveFailed: '保存できませんでした。入力内容は保持されています。',
    saved: 'カードを保存しました。',
    saving: '保存中…',
    searchCards: 'カードを検索',
    searchCardsPlaceholder: 'カード名・ID',
    searchPasses: 'パスを検索',
    searchPassesPlaceholder: '会員番号・アドレス・カード名・UID',
    slugHint: '共有済みのリンクを使い続けられるよう、公開URLは変更できません。',
    snapshotHint:
      '状態は記録済みの発行・失効・利用情報に基づきます。チェーン上の現在の状態を照会した結果ではありません。',
    stampHint: 'このメンバーシップでスタンプを使えます。スタンプ設定は個別に保存してください。',
    stampOption: 'スタンプ設定（任意）',
    stamps: 'スタンプ',
    status: '状態',
    statuses: {
      active: '有効',
      consumed: '使用済み',
      expired: '期限切れ',
      not_yet_valid: '有効期間前',
      revoked: '失効',
      unknown: '未確認',
    },
    ticket: 'チケット',
    totalPasses: 'パス総数',
    totalStamps: 'スタンプ総数',
    type: '種類',
    unknownHint: '{count}件は発行時の期限が未記録のため、有効数に含めていません。',
    url: '公開URL',
    validity: '取得期間・有効期限',
  },
} satisfies Record<'en' | 'ja', ManagementCopy>
