import { AUTH_COPY } from '@fuda/i18n'
import type { Copy } from '@fuda/i18n'
import type { PasskeySectionCopy } from '@fuda/ui'

import { APPS_COPY } from './apps-copy.ts'
import type { AppsCopy } from './apps-copy.ts'
import type { BrandColorName } from './brand-colors.ts'
import { dashMessage } from './error-copy.ts'
import { MANAGEMENT_COPY } from './management-copy.ts'
import type { ManagementCopy } from './management-copy.ts'
import { REQUIREMENTS_COPY } from './requirements-copy.ts'

export interface DashCopy {
  requirements: typeof REQUIREMENTS_COPY.en
  requirementsError: (code: string) => string
  apps: AppsCopy
  management: ManagementCopy
  chrome: {
    brand: string
    addProfile: string
    switchFailed: string
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
    card: string
    passes: string
    apps: string
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
    createPasskey: string
    creating: string
    cancel: string
    wallet: string
    walletHint: string
    signingInWallet: string
    adminSection: string
    signingIn: string
    restoreFailed: string
    retry: string
    signOut: string
    signOutTitle: string
    signOutDescription: string
    cancelSignOut: string
    failures: { cancelled: string; network: string; rejected: string; unavailable: string; wallet: string }
  }
  passkeys: PasskeySectionCopy
  logo: {
    label: string
    choose: string
    hint: string
    remove: string
    previewAlt: string
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
  integrations: {
    worldId: string
    worldIdHint: string
    loading: string
    save: string
    saving: string
    retry: string
    saved: string
    failures: { load: string; save: string }
  }
  reception: {
    title: string
    description: string
    scannerLabel: string
    scannerPlaceholder: string
    checking: string
    requirementInactive: string
    registryNotAllowed: string
    retry: string
    failures: { network: string; rejected: string; notFound: string; badQr: string; badInput: string }
    stamp: { awarded: string; daily_limit: string; disabled: string; not_admitted: string }
    card: {
      balance: string
      full: string
      giveReward: string
      confirmReward: string
      confirmRewardHint: (goal: number) => string
      cancel: string
      adjust: string
      adjustHint: string
      amountLabel: string
      amountPlaceholder: string
      reasonLabel: string
      reasonPlaceholder: string
      save: string
      working: string
      retry: string
      historyTitle: string
      historyEmpty: string
      historyReward: string
      historyAdjust: string
      done: { reward: string; adjust: string }
      failures: {
        network: string
        notFull: string
        belowZero: string
        revoked: string
        disabled: string
        badAmount: string
        generic: string
      }
    }
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
    recordLabel: string
    recordOffchain: string
    recordOnchain: string
    recordHint: string
    identityLabel: string
    identityNone: string
    identityPasskey: string
    identityHint: string
    requirementLabel: string
    identityWallet: string
    identityWalletHint: string
    identityAddress: string
    identityAddressHint: string
    requirementRegistry: string
    requirementAsset: string
    requirementTerms: string
    requirementHexError: string
    requirementRegistryError: string
    requirementFixed: string
    identitySensitive: string
    identitySensitiveHint: string
    attendanceLabel: string
    attendanceHint: string
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
      input: string
      issuerLimit: string
      network: string
      session: string
      slugInvalid: string
      slugTaken: string
      taken: string
    }
  }
  ens: {
    title: string
    claim: string
    walletRequired: string
    retry: string
    signing: string
    submitting: string
    pending: string
    recheck: string
    confirming: string
    claimedLabel: string
    explorer: string
    failures: {
      network: string
      rejected: string
      undelegated: string
      unconfigured: string
      unsponsored: string
      unconfirmed: string
    }
  }
  published: {
    createFirst: string
    title: string
    description: string
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
    connected: string
    unavailable: string
    configured: string
    notConfigured: string
    errorMessage: (code: string) => string
    errorPrefix: string
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
    member: string
    holder: string
    level: string
    tier: string
    status: string
    verifiedHuman: string
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
    errorMessage: (code: string) => string
    errorPrefix: string
    qrLabel: string
  }
  revoke: {
    title: string
    description: string
    memberFallback: string
    cancel: string
    confirm: string
    revoking: string
    errorMessage: (code: string) => string
    errorPrefix: string
  }
  issue: {
    title: string
    description: string
    levelLabel: string
    bearerDescription: string
    signedDescription: string
    memberId: string
    holder: string
    tier: string
    usageModel: string
    submit: string
    submitting: string
    errorMessage: (code: string) => string
    errorPrefix: string
    issued: string
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
    apps: APPS_COPY.en,
    management: MANAGEMENT_COPY.en,
    chrome: {
      brand: 'fuda.',
      addProfile: 'Add a profile',
      switchFailed: 'Could not switch profiles. Please try again.',
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
      card: 'Your cards',
      passes: 'Passes',
      apps: 'Apps',
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
      passkeyHint: 'Use the passkey on this device, or create one. You do not need an email or a wallet.',
      createPasskey: 'Create a passkey',
      creating: 'Creating…',
      cancel: 'Cancel',
      wallet: 'Sign in with a wallet',
      walletHint:
        'For a profile made with a wallet, and to claim an ENS name. Coinbase may ask for an email to recover your account.',
      signingInWallet: 'Waiting for your wallet…',
      adminSection: 'Sign in with an admin token instead',
      signingIn: 'Waiting for your passkey…',
      restoreFailed: 'Could not restore your session. Please try again.',
      retry: 'Try again',
      signOut: 'Sign out',
      signOutTitle: 'Sign out of fuda?',
      signOutDescription: 'You will need to sign in again to use the dashboard.',
      cancelSignOut: 'Cancel',
      failures: {
        cancelled: 'No passkey was used. You can try again, or create one if you have none.',
        network: 'Could not reach fuda. Check your connection and try again.',
        rejected: 'That sign-in was not accepted. Please try again.',
        unavailable: 'Sign-in is unavailable right now. Please try again later.',
        wallet: 'The wallet step was cancelled.',
      },
    },
    passkeys: {
      add: 'Add a passkey',
      adding: 'Adding…',
      cancel: 'Keep it',
      created: 'Added {date}',
      failures: {
        cancelled: 'No passkey was added. You can try again.',
        limit: 'This account already has the most passkeys it can hold. Remove one first.',
        network: 'The service could not be reached. Try again.',
        rejected: 'That passkey was not accepted. Try again.',
        remove: 'That passkey could not be removed. An account must keep at least one.',
        unavailable: 'This is not available right now. Try again later.',
      },
      hint: 'Confirm with an existing passkey, then save the new one. A passkey in a second place, such as another password manager or a security key, keeps you able to sign in if you lose this device. The same passkeys sign you in to your passes in fuda.',
      loadFailed: 'Could not load your passkeys.',
      name: 'Passkey {number}',
      remove: 'Remove',
      removeTitle: 'Remove this passkey?',
      removeWarning:
        'You will no longer be able to sign in with it. Remove it if the device is lost or no longer yours.',
      synced: 'synced',
      title: 'Passkeys',
    },
    logo: {
      label: 'Logo',
      choose: 'Choose image',
      hint: 'PNG, JPEG or WebP, at least 660×660. A square image works best.',
      remove: 'Remove',
      previewAlt: 'Logo preview',
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
      ensUnavailable: 'ENS names are not available on this deployment.',
      handleLabel: 'Handle',
      handleHint: 'This cannot be changed after registration.',
      registerTitle: 'Create your profile',
      registerDescription: 'Choose the name and appearance members will see.',
      register: 'Create profile',
      registering: 'Creating…',
      optional: '(optional)',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved.',
      saveFailed: 'Could not save your changes. Try again.',
    },
    stamps: {
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
    integrations: {
      worldId: 'World ID',
      worldIdHint:
        'Let members attach a Verified Human badge to a pass from this card. Off by default; the badge never changes admission.',
      loading: 'Loading integrations…',
      save: 'Save integrations',
      saving: 'Saving…',
      retry: 'Retry',
      saved: 'Saved',
      failures: {
        load: 'Could not load integrations. Refresh the page to try again.',
        save: 'Could not save integrations. Try again.',
      },
    },
    reception: {
      title: 'Scan member cards',
      description: 'Scan a fuda QR code. The scanner input stays ready for the next guest.',
      scannerLabel: 'QR scanner input',
      scannerPlaceholder: 'Scan fuda:v1:… and press Enter',
      checking: 'Checking admission…',
      requirementInactive: 'This pass’s licence agreement is not active.',
      registryNotAllowed:
        'This pass’s licence agreement is not active because this deployment no longer accepts its registry.',
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
      card: {
        balance: 'Stamps on this card',
        full: 'The card is full',
        giveReward: 'Give the reward',
        confirmReward: 'Yes, give the reward',
        confirmRewardHint: (goal) => `The reward is handed over and ${goal} stamps come off this card.`,
        cancel: 'Cancel',
        adjust: 'Adjust',
        adjustHint: 'Fix a mistake. Use a minus number to take stamps off.',
        amountLabel: 'Change',
        amountPlaceholder: 'For example 2 or -1',
        reasonLabel: 'Reason',
        reasonPlaceholder: 'For example forgot to stamp yesterday',
        save: 'Save change',
        working: 'Saving…',
        retry: 'Try again',
        historyTitle: 'Recent changes',
        historyEmpty: 'No rewards or changes yet.',
        historyReward: 'Reward given',
        historyAdjust: 'Count changed',
        done: { reward: 'Reward recorded. Hand it over.', adjust: 'Change saved.' },
        failures: {
          network: 'fuda could not be reached, so this may not have been saved. Try again safely.',
          notFull: 'The card is not full yet.',
          belowZero: 'That would take the count below zero.',
          revoked: 'This pass has been revoked.',
          disabled: 'Stamps are turned off for this card.',
          badAmount: 'Enter a whole number other than 0, up to 50, and a reason.',
          generic: 'This could not be saved. Scan the card again and retry.',
        },
      },
    },
    requirements: REQUIREMENTS_COPY.en,
    requirementsError: (code: string) => dashMessage(code, 'en'),
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
      recordLabel: 'Where passes are recorded',
      recordOffchain: 'Private (recommended)',
      recordOnchain: 'Public on the blockchain',
      recordHint:
        'Private passes are issued at once and leave no public record of each pass. Public passes can be checked by anyone, take a little longer to issue, and cannot be erased. This cannot be changed later.',
      requirementLabel: 'Require an ERC-8432 licence agreement',
      identityWallet: 'Anyone who shows the pass (recommended)',
      identityWalletHint:
        'The pass goes into Apple Wallet and Google Wallet and is read as a QR at the gate. The licence agreement is checked at every scan. A copied QR also works while the agreement is active.',
      identityAddress: 'Only the member’s licence key, by signature in the app',
      identityAddressHint:
        'The member signs in the app with their licence key. This pass has no Wallet pass and no QR, and earns no Stamps.',
      requirementRegistry: 'Registry',
      requirementAsset: 'Asset id',
      requirementTerms: 'Terms id (optional)',
      requirementHexError: 'Enter 0x followed by 64 hexadecimal characters.',
      requirementRegistryError: 'Choose a registry.',
      requirementFixed: 'This requirement cannot be changed after the card is created.',
      identitySensitive: 'Sensitive use: employee badges and private memberships',
      identitySensitiveHint:
        'Each pass gets its own key on the member’s device, so fuda’s records do not connect one person’s passes at different places. You still see how many passes you issued and when they were used, but not who holds them. Members need a fuda account and a passkey saved in iCloud Keychain, Google Password Manager or another app with this feature; anyone else is told how to save one. There are no stamps, Wallet passes, codes, backup files, member names or integrations, and entry is refused while the chain cannot be read. If a member loses every passkey, you revoke the pass and they get a new one. This cannot be changed later.',
      identityLabel: 'Who can use a pass',
      identityNone: 'Anyone showing its code (recommended)',
      identityPasskey: 'Only the person who got it, with their passkey',
      identityHint:
        'With a passkey, a photo of the pass does not get anyone in. People need a fuda account to get one, they enter by confirming on their own phone instead of showing a code, and it does not go in a Wallet app or earn stamps at reception. Private passes only. This cannot be changed later.',
      attendanceLabel: 'Record each visit',
      attendanceHint:
        'Writes a public record on the blockchain every time this card is scanned. Anyone can see it and it cannot be erased. Tickets start with this on, memberships with it off.',
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
        input: 'Some fields need a change before this card can be created.',
        issuerLimit: 'This account already has the most profiles it can create.',
        network: 'Could not reach fuda. Check your connection and try again.',
        session: 'Your sign-in expired. Please sign in again.',
        slugInvalid: 'That card link cannot be used. Pick another one.',
        slugTaken: 'That card link is already used. Pick another one.',
        taken: 'That link is already taken. Pick another one.',
      },
    },
    ens: {
      title: 'ENS name',
      claim: 'Claim this name',
      walletRequired:
        'An ENS name is held by a wallet, and this profile was made with a passkey, so it has none. To claim a name, sign in with a wallet and make the profile there.',
      retry: 'Try again',
      signing: 'Preparing the claim…',
      submitting: 'Confirm in your wallet…',
      pending: 'Your claim is pending. You can check again later.',
      recheck: 'Check claim',
      confirming: 'Waiting for the chain…',
      claimedLabel: 'Claimed',
      explorer: 'View on Sepolia Etherscan',
      failures: {
        network: 'Could not reach fuda. Check your connection and try again.',
        rejected: 'The claim was not signed. Press the button to try again.',
        undelegated: 'Names cannot be claimed right now. Please try again later.',
        unconfigured: 'ENS names are not switched on for this deployment yet.',
        unsponsored: 'The transaction fee could not be covered. Please try again shortly.',
        unconfirmed: 'The claim failed. Please try again.',
      },
    },
    published: {
      createFirst: 'Create your first card',
      title: 'Your Cards',
      description: 'Manage your cards, track issuance, and share their links.',
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
      connected: 'Connected',
      unavailable: 'Unavailable',
      configured: 'Configured',
      notConfigured: 'Not configured',
      errorMessage: (code: string) => dashMessage(code, 'en'),
      errorPrefix: 'Could not load rights',
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
      member: 'Member',
      holder: 'Holder',
      level: 'Level',
      tier: 'Tier',
      status: 'Status',
      // The claim, never the vendor behind it: this says a unique person holds
      // the pass, not that anyone checked who they are.
      verifiedHuman: 'Verified human',
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
      errorMessage: (code: string) => dashMessage(code, 'en'),
      errorPrefix: 'Could not load rights',
      qrLabel: 'Right identifier QR',
    },
    revoke: {
      title: 'Revoke this right?',
      description: 'The right will stop passing verification. Confirm the exact member and UID.',
      memberFallback: 'No member ID',
      cancel: 'Cancel',
      confirm: 'Revoke right',
      revoking: 'Revoking',
      errorMessage: (code: string) => dashMessage(code, 'en'),
      errorPrefix: 'Revoke failed',
    },
    issue: {
      title: 'Issue a right',
      description: 'Create a Bearer or Signed right.',
      levelLabel: 'Right level',
      bearerDescription: 'Bearer — device wallet pass, no app',
      signedDescription: "Signed — the member's wallet signs at the gate",
      memberId: 'Member ID',
      holder: 'Holder address',
      tier: 'Tier',
      usageModel: 'Usage model',
      submit: 'Issue right',
      submitting: 'Issuing',
      errorMessage: (code: string) => dashMessage(code, 'en'),
      errorPrefix: 'Issue failed',
      issued: 'Issued',
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
    apps: APPS_COPY.ja,
    management: MANAGEMENT_COPY.ja,
    chrome: {
      brand: 'fuda.',
      addProfile: 'プロフィールを追加',
      switchFailed: 'プロフィールを切り替えられませんでした。もう一度お試しください。',
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
      card: 'カード',
      passes: 'パス一覧',
      apps: 'アプリ連携',
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
        'この端末のパスキーを使うか、新しく作成してください。メールアドレスもウォレットも要りません。',
      createPasskey: 'パスキーを作成',
      creating: '作成中…',
      cancel: 'キャンセル',
      wallet: 'ウォレットでサインイン',
      walletHint:
        'ウォレットで作成したプロフィールと、ENS名の取得に使います。アカウント復旧のため、Coinbaseからメールアドレスを求められることがあります。',
      signingInWallet: 'ウォレットの操作を待っています…',
      adminSection: '管理トークンでサインインする',
      signingIn: 'パスキーの操作を待っています…',
      restoreFailed: 'ログイン状態を確認できませんでした。もう一度お試しください。',
      retry: '再試行',
      signOut: 'サインアウト',
      signOutTitle: 'サインアウトしますか？',
      signOutDescription: 'ダッシュボードを使うには、もう一度サインインしてください。',
      cancelSignOut: 'キャンセル',
      failures: {
        cancelled:
          'パスキーは使われませんでした。もう一度お試しいただくか、お持ちでなければ作成してください。',
        network: 'fuda に接続できませんでした。通信環境を確認して、もう一度お試しください。',
        rejected: 'サインインが受け付けられませんでした。もう一度お試しください。',
        unavailable: '現在サインインできません。しばらくしてからお試しください。',
        wallet: 'ウォレットの操作が取り消されました。',
      },
    },
    passkeys: {
      add: 'パスキーを追加',
      adding: '追加中…',
      cancel: '残す',
      created: '{date} に追加',
      failures: {
        cancelled: 'パスキーは追加されませんでした。もう一度お試しください。',
        limit: 'このアカウントのパスキーは上限に達しています。先に1つ削除してください。',
        network: 'サービスに接続できませんでした。もう一度お試しください。',
        rejected: 'このパスキーは受け付けられませんでした。もう一度お試しください。',
        remove:
          'このパスキーは削除できませんでした。パスキーと Sensitive の復元データは、それぞれ最低1つ必要です。',
        unavailable: '現在ご利用いただけません。しばらくしてからお試しください。',
      },
      hint: '現在のパスキーで確認してから、新しいパスキーを保存します。別のパスワード管理アプリやセキュリティキーにも追加しておくと、この端末をなくしてもサインインできます。同じパスキーで fuda のパスにもサインインできます。',
      loadFailed: 'パスキーを読み込めませんでした。',
      name: 'パスキー {number}',
      remove: '削除',
      removeTitle: 'このパスキーを削除しますか？',
      removeWarning:
        '削除すると、このパスキーではサインインできなくなります。端末をなくしたときや手放すときに削除してください。',
      synced: '同期あり',
      title: 'パスキー',
    },
    logo: {
      label: 'ロゴ',
      choose: '画像を選ぶ',
      hint: 'PNG・JPEG・WebP に対応しています。660px 以上の正方形に近い画像がきれいに表示されます。',
      remove: '削除',
      previewAlt: 'ロゴのプレビュー',
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
      ensUnavailable: 'この環境では ENS 名を利用できません。',
      handleLabel: 'ハンドル',
      handleHint: '登録後は変更できません。',
      registerTitle: 'プロフィールを作成',
      registerDescription: 'メンバーに表示する名前やデザインを設定します。',
      register: 'プロフィールを作成',
      registering: '作成中…',
      optional: '（任意）',
      save: '保存',
      saving: '保存中…',
      saved: '保存しました。',
      saveFailed: '保存できませんでした。もう一度お試しください。',
    },
    stamps: {
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
    integrations: {
      worldId: 'World ID',
      worldIdHint:
        'このカードのパスに、メンバーが「人間であることを確認済み」バッジを付けられるようにします。初期状態はオフで、バッジは入場判定を変えません。',
      loading: '連携設定を読み込み中…',
      save: '連携を保存',
      saving: '保存中…',
      retry: '再試行',
      saved: '保存しました',
      failures: {
        load: '連携設定を読み込めませんでした。ページを再読み込みしてください。',
        save: '連携設定を保存できませんでした。もう一度お試しください。',
      },
    },
    reception: {
      title: 'メンバーカードをスキャン',
      description: 'fuda の QR コードを読み取ります。読み取り後も次のお客さまの入力をすぐ受け付けます。',
      scannerLabel: 'QR スキャナー入力',
      scannerPlaceholder: 'fuda:v1:… を読み取って Enter',
      checking: '入場可否を確認中…',
      requirementInactive: 'このパスのライセンス契約は有効ではありません。',
      registryNotAllowed:
        'この環境では契約のレジストリを受け付けなくなったため、このパスのライセンス契約は有効ではありません。',
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
      card: {
        balance: 'このカードのスタンプ',
        full: 'カードがいっぱいです',
        giveReward: '特典を渡す',
        confirmReward: '特典を渡す',
        confirmRewardHint: (goal) => `特典をお渡ししたあと、カードから ${goal} 個のスタンプを引きます。`,
        cancel: 'やめる',
        adjust: '数を直す',
        adjustHint: '押し間違いなどを直します。減らすときはマイナスの数を入れます。',
        amountLabel: '増減',
        amountPlaceholder: '例 2 または -1',
        reasonLabel: '理由',
        reasonPlaceholder: '例 昨日の押し忘れ',
        save: '保存する',
        working: '保存中…',
        retry: 'もう一度',
        historyTitle: '最近の変更',
        historyEmpty: '特典や変更はまだありません。',
        historyReward: '特典を渡した',
        historyAdjust: '数を直した',
        done: { reward: '特典を記録しました。お渡しください。', adjust: '保存しました。' },
        failures: {
          network: 'fuda に接続できず、保存できていない可能性があります。そのままもう一度お試しください。',
          notFull: 'カードはまだいっぱいではありません。',
          belowZero: '0 より少なくなるため直せません。',
          revoked: 'このパスは取り消されています。',
          disabled: 'このカードではスタンプが無効です。',
          badAmount: '0 以外の整数（50 まで）と理由を入れてください。',
          generic: '保存できませんでした。カードを読み取り直してもう一度お試しください。',
        },
      },
    },
    requirements: REQUIREMENTS_COPY.ja,
    requirementsError: (code: string) => dashMessage(code, 'ja'),
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
      recordLabel: 'パスの記録先',
      recordOffchain: '非公開(おすすめ)',
      recordOnchain: 'ブロックチェーンで公開',
      recordHint:
        '非公開のパスはすぐに発行でき、1枚ごとの公開記録が残りません。公開のパスは誰でも確認できますが、発行に少し時間がかかり、記録は消せません。あとから変更できません。',
      requirementLabel: 'ERC-8432のライセンス契約を必須にする',
      identityWallet: 'パスを見せた人（おすすめ）',
      identityWalletHint:
        'Apple Wallet と Google Wallet に追加でき、ゲートでQRを読み取って使えます。読み取るたびにライセンス契約を確認します。契約が有効な間は、コピーしたQRでも使えます。',
      identityAddress: 'メンバーのライセンスキーのみ（アプリで署名）',
      identityAddressHint:
        'メンバーがアプリでライセンスキーを使って署名します。Wallet パスとQRはなく、スタンプも付きません。',
      requirementRegistry: 'レジストリ',
      requirementAsset: 'アセットID',
      requirementTerms: '利用条件ID（任意）',
      requirementHexError: '0xに続けて64文字の16進数を入力してください。',
      requirementRegistryError: 'レジストリを選んでください。',
      requirementFixed: 'この必要条件はカード作成後に変更できません。',
      identitySensitive: '機密利用: 社員証やプライバシーを守りたい会員証',
      identitySensitiveHint:
        'パスごとに会員の端末内で専用の鍵を作るため、同じ人の別の場所のパスが fuda の記録上で結び付きません。発行数と利用日時は確認できますが、誰が持っているかはわかりません。会員には fuda のアカウントと、iCloud キーチェーン、Google パスワード マネージャーなど、この機能に対応したアプリに保存したパスキーが必要です。対応していない場合は保存方法を案内します。スタンプ、Wallet パス、コード、控えのファイル、メンバー名、連携機能はなく、チェーンを読めない間は入場できません。パスキーをすべてなくした場合は、パスを取り消して新しいものを受け取ってもらいます。あとから変更できません。',
      identityLabel: 'パスを使える人',
      identityNone: 'コードを見せた人(おすすめ)',
      identityPasskey: '受け取った本人のみ(パスキーで確認)',
      identityHint:
        'パスキーを使うと、パスの写真では入場できません。受け取るには fuda のアカウントが必要です。入場時はコードを見せる代わりに本人のスマートフォンで確認します。Wallet アプリには追加できず、受付でのスタンプも付きません。非公開のパスでのみ選べます。あとから変更できません。',
      attendanceLabel: '来場を記録する',
      attendanceHint:
        'このカードを読み取るたびに、ブロックチェーンへ公開の記録を書き込みます。誰でも見られ、消せません。チケットは初期設定でオン、会員カードはオフです。',
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
        input: '入力内容を確認してください。このままではカードを作成できません。',
        issuerLimit: 'このアカウントで作成できるプロフィールの上限に達しています。',
        network: 'fuda に接続できませんでした。通信環境を確認して、もう一度お試しください。',
        session: 'サインインの有効期限が切れました。もう一度サインインしてください。',
        slugInvalid: 'このカードのリンクは使えません。別の名前を選んでください。',
        slugTaken: 'このカードのリンクはすでに使われています。別の名前を選んでください。',
        taken: 'このリンクはすでに使われています。別の名前を選んでください。',
      },
    },
    ens: {
      title: 'ENS名',
      claim: 'この名前を取得する',
      walletRequired:
        'ENS名はウォレットで保持します。このプロフィールはパスキーで作成したのでウォレットがありません。名前を取得するには、ウォレットでサインインしてプロフィールを作成してください。',
      retry: 'もう一度試す',
      signing: '取得の準備をしています…',
      submitting: 'ウォレットで承認してください…',
      pending: '名前の取得を確認中です。しばらくしてから再確認できます。',
      recheck: '取得状況を確認',
      confirming: 'チェーンの確認を待っています…',
      claimedLabel: '取得済み',
      explorer: 'Sepolia Etherscanで確認',
      failures: {
        network: 'fuda に接続できませんでした。通信環境を確認してもう一度試してください。',
        rejected: '署名されませんでした。ボタンを押すとやり直せます。',
        undelegated: '現在は名前を取得できません。しばらくしてからもう一度試してください。',
        unconfigured: 'この環境では ENS 名がまだ有効になっていません。',
        unsponsored: '手数料を負担できませんでした。少し待ってからもう一度試してください。',
        unconfirmed: '名前を取得できませんでした。もう一度試してください。',
      },
    },
    published: {
      createFirst: '最初のカードを作成',
      title: 'カード一覧',
      description: 'カードの設定や発行状況を確認し、公開リンクを共有できます。',
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
      connected: '接続済み',
      unavailable: '利用不可',
      configured: '設定済み',
      notConfigured: '未設定',
      errorMessage: (code: string) => dashMessage(code, 'ja'),
      errorPrefix: '権利を読み込めませんでした',
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
      member: 'メンバー',
      holder: '保有者',
      level: 'レベル',
      tier: 'ティア',
      status: 'ステータス',
      // Not 本人確認: that is the KYC / identity-document phrase and would
      // promise an identity check this badge deliberately does not make.
      verifiedHuman: '人間であることを確認済み',
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
      errorMessage: (code: string) => dashMessage(code, 'ja'),
      errorPrefix: '権利を読み込めませんでした',
      qrLabel: '権利識別子の QR',
    },
    revoke: {
      title: 'この権利を取り消しますか？',
      description: 'この権利は検証を通過できなくなります。メンバーと UID を確認してください。',
      memberFallback: 'メンバー ID なし',
      cancel: 'キャンセル',
      confirm: '権利を取り消す',
      revoking: '取り消し中',
      errorMessage: (code: string) => dashMessage(code, 'ja'),
      errorPrefix: '取り消しに失敗しました',
    },
    issue: {
      title: '権利を発行',
      description: 'BearerまたはSignedの権利を作成します。',
      levelLabel: '権利レベル',
      bearerDescription: 'Bearer — アプリ不要のデバイスウォレットパス',
      signedDescription: 'Signed — ゲートでメンバーのウォレットが署名',
      memberId: 'メンバー ID',
      holder: '保有者アドレス',
      tier: 'ティア',
      usageModel: '利用モデル',
      submit: '権利を発行',
      submitting: '発行中',
      errorMessage: (code: string) => dashMessage(code, 'ja'),
      errorPrefix: '発行に失敗しました',
      issued: '発行しました',
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
