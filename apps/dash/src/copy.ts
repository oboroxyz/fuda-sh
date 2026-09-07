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
  nav: { overview: string; rights: string; issue: string; newCard: string; card: string }
  auth: {
    title: string
    description: string
    tokenLabel: string
    tokenPlaceholder: string
    continue: string
    unauthorized: string
    passkey: string
    passkeyHint: string
    adminSection: string
    signingIn: string
    signOut: string
    failures: { network: string; rejected: string; unavailable: string; wallet: string }
  }
  designer: {
    title: string
    description: string
    preview: string
    handleLabel: string
    handlePrefix: string
    handlePlaceholder: string
    slugLabel: string
    slugPlaceholder: string
    nameLabel: string
    namePlaceholder: string
    titleLabel: string
    taglineLabel: string
    taglinePlaceholder: string
    colorLabel: string
    colorHexLabel: string
    categoryLabel: string
    membership: string
    ticket: string
    perkLabel: string
    perkPlaceholder: string
    rewardLabel: string
    rewardPlaceholder: string
    expiryLabel: string
    expiryNone: string
    expiryDays: string
    lockScreenLabel: string
    lockScreenHint: string
    locationUnavailable: string
    submit: string
    submitting: string
    handleStatus: {
      available: string
      checking: string
      format: string
      reserved: string
      taken: string
      unknown: string
    }
    slugStatus: {
      available: string
      checking: string
      format: string
      reserved: string
      taken: string
      unknown: string
    }
    failures: {
      input: string
      network: string
      session: string
      slugInvalid: string
      slugTaken: string
      taken: string
    }
  }
  published: {
    title: string
    titleMany: string
    description: string
    descriptionMany: string
    venueLabel: string
    addCard: string
    qrLabel: string
    print: string
    share: string
    copy: string
    copied: string
    hint: string
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
    nav: { overview: 'Overview', rights: 'Rights', issue: 'Issue', newCard: 'New card', card: 'Your cards' },
    auth: {
      title: 'fuda. dashboard',
      description:
        "Enter the admin token. It stays in this tab's memory only. Leave it empty only for a local API without ADMIN_TOKEN.",
      tokenLabel: 'Admin token',
      tokenPlaceholder: 'ADMIN_TOKEN',
      continue: 'Continue',
      unauthorized: 'Unauthorized. Check the admin token.',
      passkey: 'Continue with a passkey',
      passkeyHint: 'No email, no password. Your passkey is the whole account.',
      adminSection: 'Sign in with an admin token instead',
      signingIn: 'Waiting for your passkey…',
      signOut: 'Sign out',
      failures: {
        network: 'Could not reach fuda. Check your connection and try again.',
        rejected: 'That signature was not accepted. Please try again.',
        unavailable: 'Sign-in is unavailable right now. Please try again later.',
        wallet: 'The passkey step was cancelled.',
      },
    },
    designer: {
      title: 'Design the card',
      description: 'Your members see this card. You can run the whole programme from one link.',
      preview: 'Live preview',
      handleLabel: 'Link',
      handlePrefix: 'fuda.sh/@',
      handlePlaceholder: 'wassie-coffee',
      slugLabel: 'Card link',
      slugPlaceholder: 'membership-card',
      nameLabel: 'Venue name',
      namePlaceholder: 'Wassie Coffee',
      titleLabel: 'Card title',
      taglineLabel: 'Tagline',
      taglinePlaceholder: 'Omotesando · Coffee shop',
      colorLabel: 'Brand colour',
      colorHexLabel: 'Brand colour hex',
      categoryLabel: 'Card type',
      membership: 'Membership',
      ticket: 'Ticket',
      perkLabel: 'Perk',
      perkPlaceholder: 'Stamp card · 10 stamps',
      rewardLabel: 'Reward',
      rewardPlaceholder: 'Free drink of your choice',
      expiryLabel: 'Expiry',
      expiryNone: 'None',
      expiryDays: '{days} days',
      lockScreenLabel: 'Lock screen',
      lockScreenHint: 'Show the card near the venue.',
      locationUnavailable: 'Location unavailable.',
      submit: 'Create card',
      submitting: 'Creating…',
      handleStatus: {
        available: 'Available',
        checking: 'Checking…',
        format: 'Use lowercase letters, digits and hyphens.',
        reserved: 'This name is reserved.',
        taken: 'Already taken',
        unknown: 'Could not check this link.',
      },
      slugStatus: {
        available: 'Available',
        checking: 'Checking…',
        format: 'Use lowercase letters, digits and hyphens.',
        reserved: 'This name is reserved.',
        taken: 'Already used',
        unknown: 'Could not check this link.',
      },
      failures: {
        input: 'Some fields need a change before this card can be created.',
        network: 'Could not reach fuda. Check your connection and try again.',
        session: 'Your sign-in expired. Please sign in again.',
        slugInvalid: 'That card link cannot be used. Pick another one.',
        slugTaken: 'That card link is already used. Pick another one.',
        taken: 'That link is already taken. Pick another one.',
      },
    },
    published: {
      title: 'Your card is live',
      titleMany: 'Your cards are live',
      description: 'One link is the whole sign-up. Print it, mail it, or post it.',
      descriptionMany: 'Every card has its own link. Print it, mail it, or post it.',
      venueLabel: 'Venue page',
      addCard: 'Add another card',
      qrLabel: 'QR code for your card link',
      print: 'Print QR poster',
      share: 'Share link',
      copy: 'Copy link',
      copied: 'Copied',
      hint: 'Anyone who scans gets a card — no app on their side either.',
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
    nav: { overview: '概要', rights: '権利', issue: '発行', newCard: 'カードを作る', card: 'カード' },
    auth: {
      title: 'fuda. dashboard',
      description:
        '管理トークンを入力してください。トークンはこのタブのメモリにのみ保持されます。ADMIN_TOKEN を設定していないローカル API でのみ空欄にできます。',
      tokenLabel: '管理トークン',
      tokenPlaceholder: 'ADMIN_TOKEN',
      continue: '続ける',
      unauthorized: '認証できませんでした。管理トークンを確認してください。',
      passkey: 'パスキーで続ける',
      passkeyHint: 'メールアドレスもパスワードも不要です。パスキーがそのままアカウントになります。',
      adminSection: '管理トークンでサインインする',
      signingIn: 'パスキーの操作を待っています…',
      signOut: 'サインアウト',
      failures: {
        network: 'fuda に接続できませんでした。通信環境を確認して、もう一度お試しください。',
        rejected: '署名が受け付けられませんでした。もう一度お試しください。',
        unavailable: '現在サインインできません。しばらくしてからお試しください。',
        wallet: 'パスキーの操作が取り消されました。',
      },
    },
    designer: {
      title: 'カードをデザイン',
      description: 'メンバーにはこのカードが表示されます。リンク 1 本で運用できます。',
      preview: 'プレビュー',
      handleLabel: 'リンク',
      handlePrefix: 'fuda.sh/@',
      handlePlaceholder: 'wassie-coffee',
      slugLabel: 'カードのリンク',
      slugPlaceholder: 'membership-card',
      nameLabel: '店舗名',
      namePlaceholder: 'Wassie Coffee',
      titleLabel: 'カード名',
      taglineLabel: '説明',
      taglinePlaceholder: '表参道 · コーヒーショップ',
      colorLabel: 'ブランドカラー',
      colorHexLabel: 'ブランドカラーの16進数',
      categoryLabel: 'カードの種類',
      membership: '会員カード',
      ticket: 'チケット',
      perkLabel: '特典',
      perkPlaceholder: 'スタンプカード · 10 個',
      rewardLabel: 'リワード',
      rewardPlaceholder: 'お好きなドリンク 1 杯無料',
      expiryLabel: '有効期限',
      expiryNone: 'なし',
      expiryDays: '{days} 日',
      lockScreenLabel: 'ロック画面',
      lockScreenHint: '店舗の近くでカードを表示します。',
      locationUnavailable: '位置情報を取得できませんでした。',
      submit: 'カードを作成',
      submitting: '作成中…',
      handleStatus: {
        available: '使えます',
        checking: '確認中…',
        format: '小文字の英字、数字、ハイフンが使えます。',
        reserved: 'この名前は予約されています。',
        taken: 'すでに使われています',
        unknown: 'リンクを確認できませんでした。',
      },
      slugStatus: {
        available: '使えます',
        checking: '確認中…',
        format: '小文字の英字、数字、ハイフンが使えます。',
        reserved: 'この名前は予約されています。',
        taken: 'すでに使われています',
        unknown: 'リンクを確認できませんでした。',
      },
      failures: {
        input: '入力内容を確認してください。このままではカードを作成できません。',
        network: 'fuda に接続できませんでした。通信環境を確認して、もう一度お試しください。',
        session: 'サインインの有効期限が切れました。もう一度サインインしてください。',
        slugInvalid: 'このカードのリンクは使えません。別の名前を選んでください。',
        slugTaken: 'このカードのリンクはすでに使われています。別の名前を選んでください。',
        taken: 'このリンクはすでに使われています。別の名前を選んでください。',
      },
    },
    published: {
      title: 'カードを公開しました',
      titleMany: '公開中のカード',
      description: 'このリンク 1 本が入会導線になります。印刷しても、送っても、投稿してもかまいません。',
      descriptionMany: 'カードごとにリンクがあります。印刷しても、送っても、投稿してもかまいません。',
      venueLabel: '店舗ページ',
      addCard: 'カードを追加',
      qrLabel: 'カードのリンクの QR コード',
      print: 'QR ポスターを印刷',
      share: 'リンクを共有',
      copy: 'リンクをコピー',
      copied: 'コピーしました',
      hint: 'スキャンした人は誰でもカードを受け取れます。相手にもアプリは要りません。',
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
