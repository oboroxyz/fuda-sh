import type { Copy } from '@fuda/i18n'

export interface DashCopy {
  chrome: {
    brand: string
    subtitle: string
    navigation: string
    openMenu: string
    closeMenu: string
    language: string
    english: string
    japanese: string
    theme: { control: string; light: string; dark: string; system: string }
  }
  nav: { overview: string; rights: string; issue: string }
  auth: {
    title: string
    description: string
    tokenLabel: string
    tokenPlaceholder: string
    continue: string
    unauthorized: string
  }
  overview: {
    title: string
    description: string
    total: string
    active: string
    revoked: string
    api: string
    graph: string
    checking: string
    connected: string
    unavailable: string
    configured: string
    notConfigured: string
    errorPrefix: string
    refreshing: string
    stale: string
  }
  rights: {
    title: string
    description: string
    searchLabel: string
    searchPlaceholder: string
    statusFilter: string
    levelFilter: string
    all: string
    active: string
    revoked: string
    bearer: string
    signed: string
    private: string
    member: string
    holder: string
    level: string
    tier: string
    status: string
    uid: string
    passes: string
    web: string
    google: string
    apple: string
    qr: string
    hideQr: string
    revoke: string
    empty: string
    noMatches: string
    clearFilters: string
    errorPrefix: string
    refreshing: string
    stale: string
    qrLabel: string
  }
  revoke: {
    title: string
    description: string
    memberFallback: string
    cancel: string
    confirm: string
    revoking: string
    errorPrefix: string
  }
  issue: {
    title: string
    description: string
    levelLabel: string
    bearerDescription: string
    signedDescription: string
    privateDescription: string
    memberId: string
    memberIdOptional: string
    holder: string
    stealthMetaAddress: string
    tier: string
    usageModel: string
    submit: string
    submitting: string
    errorPrefix: string
    issued: string
    announced: string
    memberDiscovers: string
    transaction: string
    openPass: string
    qrLabel: string
  }
  chain: {
    title: string
    description: string
    holderLabel: string
    holderPlaceholder: string
    query: string
    querying: string
    idle: string
    loading: string
    unconfigured: string
    errorFallback: string
    empty: string
    statusHeading: string
    active: string
    revokedAt: string
    holder: string
    unresolvedDelegation: string
    delegation: string
    delegations: string
    enteredAt: string
    inactive: string
  }
}

/* oxlint-disable eslint/sort-keys -- translation objects follow the shared DashCopy UI grouping */
export const DASH_COPY = {
  en: {
    chrome: {
      brand: 'fuda dash',
      subtitle: 'Operator console',
      navigation: 'Dashboard navigation',
      openMenu: 'Open menu',
      closeMenu: 'Close menu',
      language: 'Language',
      english: 'English',
      japanese: '日本語',
      theme: { control: 'Theme', light: 'Light', dark: 'Dark', system: 'System' },
    },
    nav: { overview: 'Overview', rights: 'Rights', issue: 'Issue' },
    auth: {
      title: 'Open the operator console',
      description:
        "Enter the admin token. It stays in this tab's memory only. Leave it empty only for a local API without ADMIN_TOKEN.",
      tokenLabel: 'Admin token',
      tokenPlaceholder: 'ADMIN_TOKEN',
      continue: 'Continue',
      unauthorized: 'Unauthorized. Check the admin token.',
    },
    overview: {
      title: 'Overview',
      description: 'Current operational rights and client configuration.',
      total: 'Total rights',
      active: 'Active rights',
      revoked: 'Revoked rights',
      api: 'API',
      graph: 'Graph index',
      checking: 'Checking',
      connected: 'Connected',
      unavailable: 'Unavailable',
      configured: 'Configured',
      notConfigured: 'Not configured',
      errorPrefix: 'Could not load rights',
      refreshing: 'Refreshing rights',
      stale: 'Showing last loaded values',
    },
    rights: {
      title: 'Rights',
      description: 'Search, inspect, share, and revoke issued rights.',
      searchLabel: 'Search rights',
      searchPlaceholder: 'Member, holder, or UID',
      statusFilter: 'Filter by status',
      levelFilter: 'Filter by level',
      all: 'All',
      active: 'Active',
      revoked: 'Revoked',
      bearer: 'Bearer',
      signed: 'Signed',
      private: '+Private',
      member: 'Member',
      holder: 'Holder',
      level: 'Level',
      tier: 'Tier',
      status: 'Status',
      uid: 'UID',
      passes: 'Passes',
      web: 'Web',
      google: 'Google',
      apple: 'Apple',
      qr: 'Show QR',
      hideQr: 'Hide QR',
      revoke: 'Revoke',
      empty: 'No rights have been issued.',
      noMatches: 'No rights match these filters.',
      clearFilters: 'Clear filters',
      errorPrefix: 'Could not load rights',
      refreshing: 'Refreshing rights',
      stale: 'Showing last loaded rights; their status may be out of date.',
      qrLabel: 'Right identifier QR',
    },
    revoke: {
      title: 'Revoke this right?',
      description: 'The right will stop passing verification. Confirm the exact member and UID.',
      memberFallback: 'No member ID',
      cancel: 'Cancel',
      confirm: 'Revoke right',
      revoking: 'Revoking',
      errorPrefix: 'Revoke failed',
    },
    issue: {
      title: 'Issue a right',
      description: 'Create a Bearer, Signed, or +Private right.',
      levelLabel: 'Right level',
      bearerDescription: 'Bearer — device wallet pass, no app',
      signedDescription: "Signed — the member's wallet signs at the gate",
      privateDescription: '+Private — stealth address from a meta-address',
      memberId: 'Member ID',
      memberIdOptional: 'Member ID (optional representative ID)',
      holder: 'Holder address',
      stealthMetaAddress: 'Stealth meta-address',
      tier: 'Tier',
      usageModel: 'Usage model',
      submit: 'Issue right',
      submitting: 'Issuing',
      errorPrefix: 'Issue failed',
      issued: 'Issued',
      announced: 'Announced',
      memberDiscovers: 'The member discovers it in their app.',
      transaction: 'Transaction',
      openPass: 'Open browser pass',
      qrLabel: 'Issued right QR',
    },
    chain: {
      title: 'On-chain status',
      description: 'Query chain-indexed rights independently of the D1 member list.',
      holderLabel: 'Holder address',
      holderPlaceholder: '0x… holder address',
      query: 'Query',
      querying: 'Querying',
      idle: 'Enter a holder to look up its on-chain status.',
      loading: 'Loading on-chain status.',
      unconfigured: 'On-chain status is not configured.',
      errorFallback: 'Chain lookup failed.',
      empty: 'No on-chain rights found.',
      statusHeading: 'On-chain rights',
      active: 'ACTIVE',
      revokedAt: 'REVOKED at',
      holder: 'Holder',
      unresolvedDelegation: 'Unresolved delegation',
      delegation: 'Delegation',
      delegations: 'Issuer delegations',
      enteredAt: 'Entered at',
      inactive: 'INACTIVE',
    },
  },
  ja: {
    chrome: {
      brand: 'fuda ダッシュ',
      subtitle: '運営コンソール',
      navigation: 'ダッシュボードナビゲーション',
      openMenu: 'メニューを開く',
      closeMenu: 'メニューを閉じる',
      language: '言語',
      english: 'English',
      japanese: '日本語',
      theme: { control: 'テーマ', light: 'ライト', dark: 'ダーク', system: 'システム' },
    },
    nav: { overview: '概要', rights: '権利', issue: '発行' },
    auth: {
      title: '運営コンソールを開く',
      description:
        '管理トークンを入力してください。トークンはこのタブのメモリにのみ保持されます。ADMIN_TOKEN を設定していないローカル API でのみ空欄にできます。',
      tokenLabel: '管理トークン',
      tokenPlaceholder: 'ADMIN_TOKEN',
      continue: '続ける',
      unauthorized: '認証できませんでした。管理トークンを確認してください。',
    },
    overview: {
      title: '概要',
      description: '現在の運用中の権利とクライアント設定です。',
      total: '権利の合計',
      active: '有効な権利',
      revoked: '取り消した権利',
      api: 'API',
      graph: 'Graph インデックス',
      checking: '確認中',
      connected: '接続済み',
      unavailable: '利用不可',
      configured: '設定済み',
      notConfigured: '未設定',
      errorPrefix: '権利を読み込めませんでした',
      refreshing: '権利を更新中',
      stale: '最後に読み込んだ値を表示中',
    },
    rights: {
      title: '権利',
      description: '発行した権利の検索、確認、共有、取り消しを行います。',
      searchLabel: '権利を検索',
      searchPlaceholder: 'メンバー、保有者、または UID',
      statusFilter: 'ステータスで絞り込む',
      levelFilter: 'レベルで絞り込む',
      all: 'すべて',
      active: '有効',
      revoked: '取り消し済み',
      bearer: 'Bearer',
      signed: 'Signed',
      private: '+Private',
      member: 'メンバー',
      holder: '保有者',
      level: 'レベル',
      tier: 'ティア',
      status: 'ステータス',
      uid: 'UID',
      passes: 'パス',
      web: 'Web',
      google: 'Google',
      apple: 'Apple',
      qr: 'QR を表示',
      hideQr: 'QR を隠す',
      revoke: '取り消す',
      empty: '発行済みの権利はありません。',
      noMatches: '条件に一致する権利はありません。',
      clearFilters: '絞り込みを解除',
      errorPrefix: '権利を読み込めませんでした',
      refreshing: '権利を更新中',
      stale: '最後に読み込んだ権利を表示中です。ステータスは最新でない可能性があります。',
      qrLabel: '権利識別子の QR',
    },
    revoke: {
      title: 'この権利を取り消しますか？',
      description: 'この権利は検証を通過できなくなります。メンバーと UID を確認してください。',
      memberFallback: 'メンバー ID なし',
      cancel: 'キャンセル',
      confirm: '権利を取り消す',
      revoking: '取り消し中',
      errorPrefix: '取り消しに失敗しました',
    },
    issue: {
      title: '権利を発行',
      description: 'Bearer、Signed、または +Private の権利を作成します。',
      levelLabel: '権利レベル',
      bearerDescription: 'Bearer — アプリ不要のデバイスウォレットパス',
      signedDescription: 'Signed — ゲートでメンバーのウォレットが署名',
      privateDescription: '+Private — メタアドレスからステルスアドレスを生成',
      memberId: 'メンバー ID',
      memberIdOptional: 'メンバー ID（任意の代表 ID）',
      holder: '保有者アドレス',
      stealthMetaAddress: 'ステルスメタアドレス',
      tier: 'ティア',
      usageModel: '利用モデル',
      submit: '権利を発行',
      submitting: '発行中',
      errorPrefix: '発行に失敗しました',
      issued: '発行しました',
      announced: 'アナウンスしました',
      memberDiscovers: 'メンバーがアプリで検出します。',
      transaction: 'トランザクション',
      openPass: 'ブラウザパスを開く',
      qrLabel: '発行した権利の QR',
    },
    chain: {
      title: 'オンチェーンステータス',
      description: 'D1 メンバー一覧とは独立して、チェーンに索引された権利を検索します。',
      holderLabel: '保有者アドレス',
      holderPlaceholder: '0x… 保有者アドレス',
      query: '検索',
      querying: '検索中',
      idle: '保有者を入力してオンチェーンステータスを検索してください。',
      loading: 'オンチェーンステータスを読み込み中です。',
      unconfigured: 'オンチェーンステータスが設定されていません。',
      errorFallback: 'チェーン検索に失敗しました。',
      empty: 'オンチェーン権利が見つかりません。',
      statusHeading: 'オンチェーン権利',
      active: '有効',
      revokedAt: '取り消し日時',
      holder: '保有者',
      unresolvedDelegation: '未解決の委任',
      delegation: '委任',
      delegations: '発行者の委任',
      enteredAt: '入場日時',
      inactive: '無効',
    },
  },
} satisfies Copy<DashCopy>
/* oxlint-enable eslint/sort-keys */
