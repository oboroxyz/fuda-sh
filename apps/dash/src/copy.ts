import { AUTH_COPY } from '@fuda/i18n'
import type { Copy } from '@fuda/i18n'

import type { BrandColorName } from './brand-colors.ts'
import { MANAGEMENT_COPY } from './management-copy.ts'
import type { ManagementCopy } from './management-copy.ts'

export interface DashCopy {
  management: ManagementCopy
  chrome: {
    brand: string
    switchProfile: string
    navigation: string
    openMenu: string
    closeMenu: string
    language: string
    english: string
    japanese: string
    theme: { control: string; light: string; dark: string; system: string }
  }
  nav: {
    overview: string
    rights: string
    issue: string
    venue: string
    reception: string
    newCard: string
    card: string
    passes: string
  }
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
    restoring: string
    restoreFailed: string
    retry: string
    signOut: string
    signOutTitle: string
    signOutDescription: string
    cancelSignOut: string
    failures: { network: string; rejected: string; unavailable: string; wallet: string }
  }
  logo: {
    label: string
    change: string
    choose: string
    hint: string
    remove: string
    previewAlt: string
    upload: string
    updating: string
    updateFailed: string
    rejections: {
      decode: string
      encode: string
      tooHeavy: string
      tooLarge: string
      tooSmall: string
      type: string
    }
  }
  venue: {
    profileTitle: string
    profileDescription: string
    ensUnavailable: string
    handleLabel: string
    handleHint: string
    registerTitle: string
    registerDescription: string
    register: string
    registering: string
    optional: string
    save: string
    saving: string
    saved: string
    saveFailed: string
  }
  stamps: {
    back: string
    cardNotFound: string
    title: string
    description: string
    enabled: string
    dailyLimit: string
    goal: string
    loading: string
    save: string
    saving: string
    retry: string
    saved: string
    failures: { load: string; save: string; validation: string }
  }
  reception: {
    title: string
    description: string
    scannerLabel: string
    scannerPlaceholder: string
    checking: string
    retry: string
    failures: { network: string; rejected: string; notFound: string; badQr: string; badInput: string }
    stamp: { awarded: string; daily_limit: string; disabled: string; not_admitted: string }
  }
  designer: {
    title: string
    description: string
    preview: string
    profileHint: string
    editProfile: string
    optional: string
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
    customColorLabel: string
    colorNames: Record<BrandColorName, string>
    categoryLabel: string
    membership: string
    ticket: string
    cardDescriptionLabel: string
    cardDescriptionPlaceholder: string
    cardDescriptionHint: string
    expiryDays: string
    claimLabel: string
    claimHint: string
    claimFromLabel: string
    claimUntilLabel: string
    validityLabel: string
    validityHint: string
    validityModeLabel: string
    validityNone: string
    validityDaysMode: string
    validityFixed: string
    validityDaysLabel: string
    validFromLabel: string
    validUntilLabel: string
    windowProblems: {
      bothRules: string
      claimOrder: string
      validOrder: string
    }
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
      ensRequired: string
      ensUnavailable: string
      input: string
      logo: string
      network: string
      session: string
      slugInvalid: string
      slugTaken: string
      taken: string
    }
  }
  ens: {
    requiredTitle: string
    requiredDescription: string
    title: string
    description: string
    claim: string
    retry: string
    signing: string
    submitting: string
    confirming: string
    claimedLabel: string
    explorer: string
    failures: {
      network: string
      rejected: string
      unconfigured: string
      unsponsored: string
      unconfirmed: string
    }
  }
  published: {
    settings: string
    createFirst: string
    manageVenue: string
    title: string
    description: string
    venueLabel: string
    addCard: string
    qrLabel: string
    print: string
    share: string
    copy: string
    copied: string
    storeDisplay: string
    defaultBadge: string
    setDefault: string
    clearDefault: string
    defaultSaving: string
    defaultSaved: string
    defaultSaveFailed: string
    hint: string
    claimStates: {
      closed: string
      closedSince: string
      notYet: string
      open: string
      openUntil: string
    }
    validityStates: {
      days: string
      fixed: string
      from: string
      never: string
      until: string
    }
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
    management: MANAGEMENT_COPY.en,
    chrome: {
      brand: 'fuda.',
      switchProfile: 'Switch profile',
      navigation: 'Dashboard navigation',
      openMenu: 'Open menu',
      closeMenu: 'Close menu',
      language: 'Language',
      english: 'English',
      japanese: '日本語',
      theme: { control: 'Theme', light: 'Light', dark: 'Dark', system: 'System' },
    },
    nav: {
      overview: 'Overview',
      rights: 'Rights',
      issue: 'Issue',
      venue: 'Profile',
      reception: 'Reception',
      newCard: 'New card',
      card: 'Your cards',
      passes: 'Passes',
    },
    auth: {
      title: 'fuda. dashboard',
      description:
        "Enter the admin token. It stays in this tab's memory only. Leave it empty only for a local API without ADMIN_TOKEN.",
      tokenLabel: 'Admin token',
      tokenPlaceholder: 'ADMIN_TOKEN',
      continue: 'Continue',
      unauthorized: 'Unauthorized. Check the admin token.',
      passkey: AUTH_COPY.en.signInWithPasskey,
      passkeyHint: 'Sign in with a passkey. Coinbase may ask for an email to recover your account.',
      adminSection: 'Sign in with an admin token instead',
      signingIn: 'Waiting for your passkey…',
      restoring: 'Restoring your session…',
      restoreFailed: 'Could not restore your session. Please try again.',
      retry: 'Try again',
      signOut: 'Sign out',
      signOutTitle: 'Sign out of fuda?',
      signOutDescription: 'You will need to sign in again to use the dashboard.',
      cancelSignOut: 'Cancel',
      failures: {
        network: 'Could not reach fuda. Check your connection and try again.',
        rejected: 'That signature was not accepted. Please try again.',
        unavailable: 'Sign-in is unavailable right now. Please try again later.',
        wallet: 'The passkey step was cancelled.',
      },
    },
    logo: {
      label: 'Logo',
      change: 'Change logo',
      choose: 'Choose image',
      hint: 'PNG, JPEG or WebP, at least 660×660. A square image works best.',
      remove: 'Remove',
      previewAlt: 'Logo preview',
      upload: 'Upload logo',
      updating: 'Updating…',
      updateFailed: 'Could not update the logo. Try again.',
      rejections: {
        decode: 'That image could not be read. Try another file.',
        encode: 'Your browser could not prepare that image. Try another file.',
        tooHeavy: 'That image is too detailed for a logo. Try a simpler one.',
        tooLarge: 'That file is over 10 MB. Try a smaller one.',
        tooSmall: 'That image is too small. Use one at least 660×660.',
        type: 'Use a PNG, JPEG or WebP image.',
      },
    },
    venue: {
      profileTitle: 'Profile',
      profileDescription: 'Manage your name, logo and ENS name.',
      ensUnavailable:
        'ENS is not configured for this deployment. Card creation is unavailable until it is enabled.',
      handleLabel: 'Handle',
      handleHint: 'This cannot be changed after registration.',
      registerTitle: 'Create your profile',
      registerDescription: 'Choose the name and appearance members will see. Next, claim your ENS name.',
      register: 'Create profile',
      registering: 'Creating…',
      optional: '(optional)',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved.',
      saveFailed: 'Could not save your changes. Try again.',
    },
    stamps: {
      back: 'Back to cards',
      cardNotFound: 'Card not found',
      title: 'Stamp settings',
      description:
        'Settings apply only to this card. Each issued pass earns stamps separately, with daily limits based on Japan time.',
      enabled: 'Award stamps at reception',
      dailyLimit: 'Daily limit (1–100)',
      goal: 'Stamp goal (1–1000)',
      loading: 'Loading stamp settings…',
      save: 'Save settings',
      saving: 'Saving…',
      retry: 'Retry',
      saved: 'Saved',
      failures: {
        load: 'Could not load stamp settings. Refresh the page to try again.',
        save: 'Could not save stamp settings. Try again.',
        validation: 'Daily limit must be 1–100 and stamp goal must be 1–1000.',
      },
    },
    reception: {
      title: 'Scan member cards',
      description: 'Scan a fuda QR code. The scanner input stays ready for the next guest.',
      scannerLabel: 'QR scanner input',
      scannerPlaceholder: 'Scan fuda:v1:… and press Enter',
      checking: 'Checking admission…',
      retry: 'Try again',
      failures: {
        network: 'The result is uncertain because fuda could not be reached. Retry this scan safely.',
        rejected: 'The scan could not be processed. Check the QR code and try again.',
        notFound: 'This QR code is not recognised or belongs to another profile.',
        badQr: 'This is not a valid fuda QR code.',
        badInput: 'This scan could not be accepted. Scan the QR code again.',
      },
      stamp: {
        awarded: 'Stamp awarded · total',
        daily_limit: 'Admitted · daily stamp limit already reached',
        disabled: 'Admitted · stamps are disabled',
        not_admitted: 'No stamp · admission was declined',
      },
    },
    designer: {
      title: 'Design the card',
      description: 'Your members see this card. You can run the whole programme from one link.',
      preview: 'Live preview',
      profileHint: 'Name, description and logo are shared across your cards.',
      editProfile: 'Edit profile',
      optional: '(optional)',
      handleLabel: 'Link',
      handlePrefix: 'fuda.sh/@',
      handlePlaceholder: 'example-club',
      slugLabel: 'Card link',
      slugPlaceholder: 'membership',
      nameLabel: 'Name',
      namePlaceholder: 'Example Club',
      titleLabel: 'Card title',
      taglineLabel: 'Tagline',
      taglinePlaceholder: 'A place to connect',
      colorLabel: 'Brand colour',
      customColorLabel: 'Custom colour',
      colorNames: {
        mint: 'Mint',
        steel: 'Steel',
        apricot: 'Apricot',
        rose: 'Rose',
        lilac: 'Lilac',
        lemon: 'Lemon',
        cyan: 'Cyan',
        teal: 'Teal',
        coral: 'Coral',
        navy: 'Navy',
        plum: 'Plum',
        charcoal: 'Charcoal',
      },
      categoryLabel: 'Card type',
      membership: 'Membership',
      ticket: 'Ticket',
      cardDescriptionLabel: 'Description',
      cardDescriptionPlaceholder: 'Tell people what this card is for and how to use it.',
      cardDescriptionHint: 'Shown on the card’s welcome page.',
      expiryDays: '{days} days',
      claimLabel: 'Claim window',
      claimHint: 'When the card is handed out. Leave both empty to keep it open.',
      claimFromLabel: 'Opens',
      claimUntilLabel: 'Closes',
      validityLabel: 'Validity',
      validityHint: 'How long the card stays valid once someone has it.',
      validityModeLabel: 'Expires',
      validityNone: 'Never',
      validityDaysMode: 'Days after claiming',
      validityFixed: 'On set dates',
      validityDaysLabel: 'Valid for',
      validFromLabel: 'Valid from',
      validUntilLabel: 'Valid until',
      windowProblems: {
        bothRules: 'Pick one: days after claiming, or set dates. Not both.',
        claimOrder: 'The claim window cannot close before it opens.',
        validOrder: 'The validity cannot end before it starts.',
      },
      lockScreenLabel: 'Lock screen',
      lockScreenHint: 'Show the card near this location.',
      locationUnavailable: 'Location unavailable.',
      submit: 'Create card',
      submitting: 'Creating…',
      handleStatus: {
        available: 'Available',
        checking: 'Checking…',
        format:
          'Use 1–63 lowercase letters, digits or hyphens. No leading or trailing hyphens, or “--” at positions 3–4.',
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
        ensRequired: 'Claim your ENS name before creating a card.',
        ensUnavailable: 'Card creation is unavailable because ENS is not configured.',
        input: 'Some fields need a change before this card can be created.',
        logo: 'Could not upload the logo. Your card is still here — try again.',
        network: 'Could not reach fuda. Check your connection and try again.',
        session: 'Your sign-in expired. Please sign in again.',
        slugInvalid: 'That card link cannot be used. Pick another one.',
        slugTaken: 'That card link is already used. Pick another one.',
        taken: 'That link is already taken. Pick another one.',
      },
    },
    ens: {
      requiredTitle: 'Claim your ENS name first',
      requiredDescription: 'Claim your ENS name to start creating cards.',
      title: 'ENS name',
      description:
        'Claim {name} and the name is yours onchain. fuda covers the transaction fee — you never need a second wallet or any ETH.',
      claim: 'Claim this name',
      retry: 'Try again',
      signing: 'Preparing the claim…',
      submitting: 'Confirm in your wallet…',
      confirming: 'Waiting for the chain…',
      claimedLabel: 'Claimed',
      explorer: 'View on Sepolia Etherscan',
      failures: {
        network: 'Could not reach fuda. Check your connection and try again.',
        rejected: 'The claim was not signed. Press the button to try again.',
        unconfigured: 'ENS names are not switched on for this deployment yet.',
        unsponsored: 'The transaction fee could not be covered. Please try again shortly.',
        unconfirmed: 'The claim has not appeared on chain yet. Wait a moment and press the button again.',
      },
    },
    published: {
      settings: 'Card settings',
      createFirst: 'Create your first card',
      manageVenue: 'Go to profile',
      title: 'Your Cards',
      description: 'Manage your cards, track issuance, and share their links.',
      venueLabel: 'Public page',
      addCard: '+ Add card',
      qrLabel: 'QR code for your card link',
      print: 'Print QR poster',
      share: 'Share link',
      copy: 'Copy link',
      copied: 'Copied',
      storeDisplay: 'Open store display',
      defaultBadge: 'Default',
      setDefault: 'Set as default',
      clearDefault: 'Clear default',
      defaultSaving: 'Saving…',
      defaultSaved: 'Default card updated.',
      defaultSaveFailed: 'Could not update the default card. Try again.',
      hint: 'Anyone who scans gets a card — no app on their side either.',
      claimStates: {
        closed: 'Closed',
        closedSince: 'Closed since {until}',
        notYet: 'Opens {from}',
        open: 'Open',
        openUntil: 'Open until {until}',
      },
      validityStates: {
        days: 'Valid {days} days after claiming',
        fixed: 'Valid {from} – {until}',
        from: 'Valid from {from}',
        never: 'Does not expire',
        until: 'Valid until {until}',
      },
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
    management: MANAGEMENT_COPY.ja,
    chrome: {
      brand: 'fuda.',
      switchProfile: 'プロフィールを切り替え',
      navigation: 'ダッシュボードナビゲーション',
      openMenu: 'メニューを開く',
      closeMenu: 'メニューを閉じる',
      language: '言語',
      english: 'English',
      japanese: '日本語',
      theme: { control: 'テーマ', light: 'ライト', dark: 'ダーク', system: 'システム' },
    },
    nav: {
      overview: '概要',
      rights: '権利',
      issue: '発行',
      venue: 'プロフィール',
      reception: '受付',
      newCard: 'カードを作る',
      card: 'カード',
      passes: 'パス一覧',
    },
    auth: {
      title: 'fuda. dashboard',
      description:
        '管理トークンを入力してください。トークンはこのタブのメモリにのみ保持されます。ADMIN_TOKEN を設定していないローカル API でのみ空欄にできます。',
      tokenLabel: '管理トークン',
      tokenPlaceholder: 'ADMIN_TOKEN',
      continue: '続ける',
      unauthorized: '認証できませんでした。管理トークンを確認してください。',
      passkey: AUTH_COPY.ja.signInWithPasskey,
      passkeyHint:
        'パスキーでサインインします。アカウント復旧のため、Coinbaseからメールアドレスを求められることがあります。',
      adminSection: '管理トークンでサインインする',
      signingIn: 'パスキーの操作を待っています…',
      restoring: 'ログイン状態を確認しています…',
      restoreFailed: 'ログイン状態を確認できませんでした。もう一度お試しください。',
      retry: '再試行',
      signOut: 'サインアウト',
      signOutTitle: 'サインアウトしますか？',
      signOutDescription: 'ダッシュボードを使うには、もう一度サインインしてください。',
      cancelSignOut: 'キャンセル',
      failures: {
        network: 'fuda に接続できませんでした。通信環境を確認して、もう一度お試しください。',
        rejected: '署名が受け付けられませんでした。もう一度お試しください。',
        unavailable: '現在サインインできません。しばらくしてからお試しください。',
        wallet: 'パスキーの操作が取り消されました。',
      },
    },
    logo: {
      label: 'ロゴ',
      change: 'ロゴを変更',
      choose: '画像を選ぶ',
      hint: 'PNG・JPEG・WebP に対応しています。660px 以上の正方形に近い画像がきれいに表示されます。',
      remove: '削除',
      previewAlt: 'ロゴのプレビュー',
      upload: 'ロゴをアップロード',
      updating: '更新中…',
      updateFailed: 'ロゴを更新できませんでした。もう一度お試しください。',
      rejections: {
        decode: 'この画像を読み込めませんでした。別の画像を選んでください。',
        encode: 'ブラウザで画像を変換できませんでした。別の画像を選んでください。',
        tooHeavy: '画像が複雑すぎてロゴに使えません。もっとシンプルな画像を選んでください。',
        tooLarge: 'ファイルが 10MB を超えています。もっと小さい画像を選んでください。',
        tooSmall: '画像が小さすぎます。660px 以上の画像を選んでください。',
        type: 'PNG・JPEG・WebP の画像を選んでください。',
      },
    },
    venue: {
      profileTitle: 'プロフィール',
      profileDescription: '名前、ロゴ、ENS名を管理します。',
      ensUnavailable: 'この環境では ENS が設定されていません。有効になるまでカードを作成できません。',
      handleLabel: 'ハンドル',
      handleHint: '登録後は変更できません。',
      registerTitle: 'プロフィールを作成',
      registerDescription: 'メンバーに表示する名前やデザインを設定します。次にENS名を取得します。',
      register: 'プロフィールを作成',
      registering: '作成中…',
      optional: '（任意）',
      save: '保存',
      saving: '保存中…',
      saved: '保存しました。',
      saveFailed: '保存できませんでした。もう一度お試しください。',
    },
    stamps: {
      back: 'カード一覧に戻る',
      cardNotFound: 'カードが見つかりません',
      title: 'スタンプ設定',
      description:
        'このカードのスタンプを設定します。獲得数は発行済みパスごとに集計し、1日の上限は日本時間で判定します。',
      enabled: '受付でスタンプを付与',
      dailyLimit: '1日の上限（1〜100）',
      goal: 'ゴール（1〜1000）',
      loading: 'スタンプ設定を読み込み中…',
      save: '設定を保存',
      saving: '保存中…',
      retry: '再試行',
      saved: '保存しました',
      failures: {
        load: 'スタンプ設定を読み込めませんでした。ページを再読み込みしてください。',
        save: 'スタンプ設定を保存できませんでした。もう一度お試しください。',
        validation: '1日の上限は1〜100、ゴールは1〜1000で入力してください。',
      },
    },
    reception: {
      title: 'メンバーカードをスキャン',
      description: 'fuda の QR コードを読み取ります。読み取り後も次のお客さまの入力をすぐ受け付けます。',
      scannerLabel: 'QR スキャナー入力',
      scannerPlaceholder: 'fuda:v1:… を読み取って Enter',
      checking: '入場可否を確認中…',
      retry: '再試行',
      failures: {
        network: 'fuda に接続できず、結果を確定できません。同じ読み取りを安全に再試行できます。',
        rejected: '読み取りを処理できませんでした。QR コードを確認してもう一度お試しください。',
        notFound: 'このQRコードは登録されていないか、別のプロフィールに属しています。',
        badQr: 'fuda の正しい QR コードではありません。',
        badInput: 'この読み取りは受け付けられませんでした。QR コードをもう一度読み取ってください。',
      },
      stamp: {
        awarded: 'スタンプを付与・合計',
        daily_limit: '入場可・本日のスタンプ上限に達しています',
        disabled: '入場可・スタンプは無効です',
        not_admitted: 'スタンプなし・入場できません',
      },
    },
    designer: {
      title: 'カードをデザイン',
      description: 'メンバーにはこのカードが表示されます。リンク 1 本で運用できます。',
      preview: 'プレビュー',
      profileHint: '店舗名・説明・ロゴは',
      editProfile: 'プロフィールで編集',
      optional: '（任意）',
      handleLabel: 'リンク',
      handlePrefix: 'fuda.sh/@',
      handlePlaceholder: 'example-club',
      slugLabel: 'カードのリンク',
      slugPlaceholder: 'membership',
      nameLabel: '名前',
      namePlaceholder: 'Example Club',
      titleLabel: 'カード名',
      taglineLabel: '説明',
      taglinePlaceholder: 'つながりが生まれる場所',
      colorLabel: 'ブランドカラー',
      customColorLabel: 'カスタムカラー',
      colorNames: {
        mint: 'ミント',
        steel: 'スチール',
        apricot: 'アプリコット',
        rose: 'ローズ',
        lilac: 'ライラック',
        lemon: 'レモン',
        cyan: 'シアン',
        teal: 'ティール',
        coral: 'コーラル',
        navy: 'ネイビー',
        plum: 'プラム',
        charcoal: 'チャコール',
      },
      categoryLabel: 'カードの種類',
      membership: '会員カード',
      ticket: 'チケット',
      cardDescriptionLabel: '説明',
      cardDescriptionPlaceholder: 'カードの内容や利用方法を入力してください。',
      cardDescriptionHint: 'カードの受け取りページに表示されます。',
      expiryDays: '{days} 日',
      claimLabel: '受付期間',
      claimHint: 'カードを受け取れる期間です。両方とも空欄なら、いつでも受け取れます。',
      claimFromLabel: '受付開始',
      claimUntilLabel: '受付締切',
      validityLabel: '有効期間',
      validityHint: '受け取ったカードが使える期間です。',
      validityModeLabel: '期限の決め方',
      validityNone: '期限なし',
      validityDaysMode: '受け取ってから◯日',
      validityFixed: '日時を指定',
      validityDaysLabel: '有効な日数',
      validFromLabel: '開始日時',
      validUntilLabel: '終了日時',
      windowProblems: {
        bothRules: '日数か日時のどちらか一方で決めてください。',
        claimOrder: '受付締切は受付開始より後にしてください。',
        validOrder: '終了日時は開始日時より後にしてください。',
      },
      lockScreenLabel: 'ロック画面',
      lockScreenHint: 'この場所の近くでカードを表示します。',
      locationUnavailable: '位置情報を取得できませんでした。',
      submit: 'カードを作成',
      submitting: '作成中…',
      handleStatus: {
        available: '使えます',
        checking: '確認中…',
        format:
          '小文字の英字・数字・ハイフンで1〜63文字にしてください。先頭・末尾のハイフンと、3・4文字目の連続ハイフンは使えません。',
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
        ensRequired: 'カードを作成する前にENS名を取得してください。',
        ensUnavailable: 'ENS が設定されていないため、カードを作成できません。',
        input: '入力内容を確認してください。このままではカードを作成できません。',
        logo: 'ロゴをアップロードできませんでした。入力内容はそのままです。もう一度お試しください。',
        network: 'fuda に接続できませんでした。通信環境を確認して、もう一度お試しください。',
        session: 'サインインの有効期限が切れました。もう一度サインインしてください。',
        slugInvalid: 'このカードのリンクは使えません。別の名前を選んでください。',
        slugTaken: 'このカードのリンクはすでに使われています。別の名前を選んでください。',
        taken: 'このリンクはすでに使われています。別の名前を選んでください。',
      },
    },
    ens: {
      requiredTitle: '先にENS名を取得してください',
      requiredDescription: 'ENS名を取得すると、カードを作成できます。',
      title: 'ENS名',
      description:
        '{name} を取得すると、この名前がオンチェーンであなたのものになります。手数料は fuda が負担するので、別のウォレットも ETH も要りません。',
      claim: 'この名前を取得する',
      retry: 'もう一度試す',
      signing: '取得の準備をしています…',
      submitting: 'ウォレットで承認してください…',
      confirming: 'チェーンの確認を待っています…',
      claimedLabel: '取得済み',
      explorer: 'Sepolia Etherscanで確認',
      failures: {
        network: 'fuda に接続できませんでした。通信環境を確認してもう一度試してください。',
        rejected: '署名されませんでした。ボタンを押すとやり直せます。',
        unconfigured: 'この環境では ENS 名がまだ有効になっていません。',
        unsponsored: '手数料を負担できませんでした。少し待ってからもう一度試してください。',
        unconfirmed: 'チェーン上にまだ現れていません。少し待ってからボタンを押してください。',
      },
    },
    published: {
      settings: 'カード設定',
      createFirst: '最初のカードを作成',
      manageVenue: 'プロフィールへ',
      title: 'カード一覧',
      description: 'カードの設定や発行状況を確認し、公開リンクを共有できます。',
      venueLabel: '公開ページ',
      addCard: '+ カードを追加',
      qrLabel: 'カードのリンクの QR コード',
      print: 'QR ポスターを印刷',
      share: 'リンクを共有',
      copy: 'リンクをコピー',
      copied: 'コピーしました',
      storeDisplay: 'ストア表示を開く',
      defaultBadge: 'デフォルト',
      setDefault: 'デフォルトに設定',
      clearDefault: 'デフォルトを解除',
      defaultSaving: '保存中…',
      defaultSaved: 'デフォルトカードを更新しました。',
      defaultSaveFailed: 'デフォルトカードを更新できませんでした。もう一度お試しください。',
      hint: 'スキャンした人は誰でもカードを受け取れます。相手にもアプリは要りません。',
      claimStates: {
        closed: '受付終了',
        closedSince: '{until} に受付終了',
        notYet: '{from} から受付',
        open: '受付中',
        openUntil: '{until} まで受付',
      },
      validityStates: {
        days: '受け取ってから {days} 日間有効',
        fixed: '{from} 〜 {until} に有効',
        from: '{from} から有効',
        never: '期限なし',
        until: '{until} まで有効',
      },
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
