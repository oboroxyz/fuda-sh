import type { ReceptionResponse } from '@fuda/sdk'
import { isNotNull } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const members = sqliteTable(
  'members',
  {
    attestationUid: text('attestation_uid').primaryKey(),
    cardId: text('card_id'),
    createdAt: integer('created_at').notNull(),
    holder: text('holder'),
    issuerId: text('issuer_id'),
    level: text('level', { enum: ['bearer', 'signed'] }).notNull(),
    memberId: text('member_id').notNull().default(''),
    source: text('source'),
    status: text('status', { enum: ['active', 'revoked'] })
      .notNull()
      .default('active'),
    tier: integer('tier').notNull().default(0),
    usageModel: integer('usage_model'),
    validFrom: integer('valid_from'),
    validUntil: integer('valid_until'),
  },
  (t) => [
    index('members_holder').on(t.holder),
    index('members_member_id').on(t.memberId),
    index('members_card_id').on(t.cardId),
    index('members_issuer_created').on(t.issuerId, t.createdAt),
    index('members_issuer_card_status').on(t.issuerId, t.cardId, t.status),
    // Per issuer, not per card: the member number is an ENS label under the
    // issuer (docs/specs/ens-naming.md#member-number).
    uniqueIndex('members_issuer_member').on(t.issuerId, t.memberId).where(isNotNull(t.issuerId)),
  ],
)

// An account: its passkeys are its only identity, for the person holding passes and
// for the operator alike (docs/specs/pass-types-and-flows.md#member-sign-in).
export const accounts = sqliteTable('accounts', {
  createdAt: integer('created_at').notNull(),
  id: text('id').primaryKey(),
  secretWriteHash: text('secret_write_hash'),
  userHandle: text('user_handle').notNull().unique(),
})

// One owner may hold several issuers; each keeps its own handle, cards and data
// (../../../../docs/specs/pass-types-and-flows.md#issuer-onboarding-and-the-handle-route). The owner is an account or an
// address, exactly one of them, which the table's CHECK holds.
export const issuers = sqliteTable(
  'issuers',
  {
    brandColor: text('brand_color').notNull(),
    createdAt: integer('created_at').notNull(),
    defaultCardSlug: text('default_card_slug'),
    handle: text('handle').notNull().unique(),
    id: text('id').primaryKey(),
    logoPrefix: text('logo_prefix'),
    name: text('name').notNull(),
    operatorAddress: text('operator_address'),
    ownerAccountId: text('owner_account_id').references(() => accounts.id),
    tagline: text('tagline').notNull().default(''),
  },
  (t) => [
    index('issuers_operator_address').on(t.operatorAddress, t.createdAt),
    index('issuers_owner_account').on(t.ownerAccountId, t.createdAt),
  ],
)

export const cards = sqliteTable(
  'cards',
  {
    // docs/specs/attestation-model.md#entitlement-lifecycle: 1 when a scan writes a public
    // Attendance. Only an on-chain card can have it on.
    attendance: integer('attendance').notNull().default(0),
    capacity: integer('capacity'),
    category: text('category', { enum: ['membership', 'ticket'] }).notNull(),
    claimFrom: integer('claim_from'),
    claimUntil: integer('claim_until'),
    createdAt: integer('created_at').notNull(),
    description: text('description').notNull().default(''),
    hasRequirements: integer('has_requirements', { mode: 'boolean' }).notNull().default(false),
    id: text('id').primaryKey(),
    identity: text('identity', { enum: ['none', 'passkey', 'sensitive', 'address'] })
      .notNull()
      .default('none'),
    issuerId: text('issuer_id')
      .notNull()
      .references(() => issuers.id),
    lockScreen: integer('lock_screen').notNull().default(0),
    record: text('record', { enum: ['offchain', 'onchain'] })
      .notNull()
      .default('onchain'),
    reserved: integer('reserved').notNull().default(0),
    slug: text('slug').notNull().default(''),
    title: text('title').notNull(),
    validFrom: integer('valid_from'),
    validUntil: integer('valid_until'),
    validityDays: integer('validity_days'),
    venueLat: real('venue_lat'),
    venueLng: real('venue_lng'),
  },
  (t) => [index('cards_issuer_id').on(t.issuerId), uniqueIndex('cards_issuer_slug').on(t.issuerId, t.slug)],
)

// The signed attestation behind an offchain right (docs/specs/attestation-model.md#offchain-rights).
export const offchainAttestations = sqliteTable('offchain_attestations', {
  createdAt: integer('created_at').notNull(),
  revokeTx: text('revoke_tx'),
  root: text('root'),
  signed: text('signed').notNull(),
  uid: text('uid').primaryKey(),
})

// A timestamped batch of offchain rights. The tree is rebuilt from the uids that name
// this root, and never stored: its leaves' preimages are bearer secrets.
export const offchainRoots = sqliteTable('offchain_roots', {
  anchoredAt: integer('anchored_at'),
  createdAt: integer('created_at').notNull(),
  passCount: integer('pass_count').notNull(),
  root: text('root').primaryKey(),
  txHash: text('tx_hash'),
})

// A member account: its passkeys are its only identity (docs/specs/pass-types-and-flows.md#member-sign-in).

export const passkeys = sqliteTable(
  'passkeys',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    backedUp: integer('backed_up').notNull(),
    counter: integer('counter').notNull(),
    createdAt: integer('created_at').notNull(),
    credentialId: text('credential_id').primaryKey(),
    lastUsedAt: integer('last_used_at'),
    publicKey: text('public_key').notNull(),
    transports: text('transports').notNull(),
  },
  (t) => [index('passkeys_account').on(t.accountId)],
)

export const passkeyChallenges = sqliteTable(
  'passkey_challenges',
  {
    accountId: text('account_id'),
    challenge: text('challenge').primaryKey(),
    createdAt: integer('created_at').notNull(),
    purpose: text('purpose', {
      enum: ['register', 'login', 'add', 'claim', 'reset', 'authorize-add'],
    }).notNull(),
    userHandle: text('user_handle'),
  },
  (t) => [index('passkey_challenges_created_at').on(t.createdAt)],
)

// docs/specs/pass-types-and-flows.md#sensitive-use
export const memberSecretCopies = sqliteTable(
  'member_secret_copies',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    ciphertext: text('ciphertext').notNull(),
    createdAt: integer('created_at').notNull(),
    credentialId: text('credential_id')
      .notNull()
      .references(() => passkeys.credentialId, { onDelete: 'cascade' }),
    iv: text('iv').notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.credentialId] })],
)

export const memberVaults = sqliteTable('member_vaults', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  updatedAt: integer('updated_at').notNull(),
  version: integer('version').notNull(),
})

export const memberSecretOutcomes = sqliteTable('member_secret_outcomes', {
  outcome: text('outcome', { enum: ['prf', 'no_prf'] }).primaryKey(),
  total: integer('total').notNull(),
})

export const memberPasses = sqliteTable(
  'member_passes',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    addedAt: integer('added_at').notNull(),
    uid: text('uid').notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.uid] })],
)

export const sessions = sqliteTable(
  'sessions',
  {
    accountId: text('account_id'),
    address: text('address').notNull(),
    audience: text('audience', { enum: ['member', 'operator'] })
      .notNull()
      .default('operator'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    issuerId: text('issuer_id'),
    tokenHash: text('token_hash').primaryKey(),
  },
  (t) => [index('sessions_expires_at').on(t.expiresAt)],
)

export const rateLimits = sqliteTable(
  'rate_limits',
  {
    count: integer('count').notNull(),
    ip: text('ip').notNull(),
    windowStart: integer('window_start').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ip, t.windowStart] }),
    index('rate_limits_window_start').on(t.windowStart),
  ],
)

export const challenges = sqliteTable('challenges', {
  createdAt: integer('created_at').notNull(),
  nonce: text('nonce').primaryKey(),
  uid: text('uid').notNull(),
  usedAt: integer('used_at'),
  venue: text('venue'),
})

export const slots = sqliteTable(
  'slots',
  {
    consumedAt: integer('consumed_at').notNull(),
    slot: text('slot').notNull(),
    uid: text('uid').notNull(),
  },
  (t) => [primaryKey({ columns: [t.uid, t.slot] })],
)

export const entryLog = sqliteTable(
  'entry_log',
  {
    at: integer('at').notNull(),
    attendanceUid: text('attendance_uid'),
    decision: text('decision', { enum: ['ADMIT', 'REJECT'] }),
    id: integer('id').primaryKey({ autoIncrement: true }),
    path: text('path', { enum: ['qr', 'signature'] }),
    reason: text('reason'),
    receptionId: text('reception_id').unique(),
    uid: text('uid').notNull(),
  },
  (t) => [index('entry_log_uid_at').on(t.uid, t.at)],
)

export const stampSettings = sqliteTable('stamp_settings', {
  dailyLimit: integer('daily_limit').notNull().default(1),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  goal: integer('goal').notNull().default(10),
  issuerId: text('issuer_id')
    .primaryKey()
    .references(() => issuers.id),
})

// docs/specs/pass-types-and-flows.md#card-integrations — one boolean column per
// Badge kind rather than a kind list, so the CHECK constraint keeps the row
// honest and a second kind is a second column.
export const cardIntegrations = sqliteTable('card_integrations', {
  cardId: text('card_id')
    .primaryKey()
    .references(() => cards.id),
  humanBadge: integer('human_badge', { mode: 'boolean' }).notNull().default(false),
})

// docs/specs/card-requirements.md. `config` is the JSON of the parsed requirement, read back
// through its kind's schema.
export const cardRequirements = sqliteTable(
  'card_requirements',
  {
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id),
    config: text('config').notNull(),
    kind: text('kind').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.position] })],
)

export const cardStampSettings = sqliteTable('card_stamp_settings', {
  cardId: text('card_id')
    .primaryKey()
    .references(() => cards.id),
  dailyLimit: integer('daily_limit').notNull().default(1),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  goal: integer('goal').notNull().default(10),
})

export const stampCredits = sqliteTable(
  'stamp_credits',
  {
    at: integer('at').notNull(),
    day: text('day').notNull(),
    entryLogId: integer('entry_log_id')
      .notNull()
      .unique()
      .references(() => entryLog.id),
    issuerId: text('issuer_id')
      .notNull()
      .references(() => issuers.id),
    // principalKey of the operator who scanned, not always an address
    operatorAddress: text('operator_address').notNull(),
    ordinal: integer('ordinal').notNull(),
    uid: text('uid').notNull(),
  },
  (t) => [primaryKey({ columns: [t.issuerId, t.uid, t.day, t.ordinal] })],
)

export const stampAdjustments = sqliteTable(
  'stamp_adjustments',
  {
    at: integer('at').notNull(),
    delta: integer('delta').notNull(),
    id: integer('id').primaryKey({ autoIncrement: true }),
    issuerId: text('issuer_id')
      .notNull()
      .references(() => issuers.id),
    kind: text('kind', { enum: ['adjust', 'redeem'] }).notNull(),
    note: text('note').notNull(),
    operatorAddress: text('operator_address').notNull(),
    requestId: text('request_id').notNull().unique(),
    uid: text('uid').notNull(),
  },
  (t) => [index('stamp_adjustments_pass').on(t.issuerId, t.uid, t.id)],
)

export const receptionRequests = sqliteTable('reception_requests', {
  entryLogId: integer('entry_log_id')
    .notNull()
    .references(() => entryLog.id),
  id: text('id').primaryKey(),
  issuerId: text('issuer_id')
    .notNull()
    .references(() => issuers.id),
  response: text('response', { mode: 'json' }).$type<ReceptionResponse>().notNull(),
  uid: text('uid').notNull(),
})

export const logoUploads = sqliteTable(
  'logo_uploads',
  {
    assetPrefix: text('asset_prefix').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    id: text('id').primaryKey(),
    sessionTokenHash: text('session_token_hash').notNull(),
    status: text('status', { enum: ['pending', 'committed'] })
      .notNull()
      .default('pending'),
  },
  (t) => [index('logo_uploads_expires_at').on(t.expiresAt)],
)

// One Badge per (Right, kind); one subject per (verifier, scope). The two
// constraints are different rules: the first leaves room for other kinds on
// the same Right, the second is the one-per-human guarantee.
export const badges = sqliteTable(
  'badges',
  {
    credential: text('credential').notNull(),
    expiresAt: integer('expires_at'),
    kind: text('kind').notNull(),
    scope: text('scope').notNull(),
    subjectKey: text('subject_key').notNull(),
    uid: text('uid').notNull(),
    verifiedAt: integer('verified_at').notNull(),
    verifier: text('verifier').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.uid, t.kind] }),
    uniqueIndex('badges_subject').on(t.verifier, t.scope, t.subjectKey),
  ],
)

// docs/specs/connected-apps.md — a browser-only app registered by an operator. Only
// that operator may approve it (no third-party consent yet). `ownerAddress` here, and
// `address` on the approval tables below, hold principalKey: an address, or
// `account:<id>` for an operator signed in with a passkey.
export const connectedApps = sqliteTable(
  'connected_apps',
  {
    clientId: text('client_id').primaryKey(),
    createdAt: integer('created_at').notNull(),
    name: text('name').notNull(),
    ownerAddress: text('owner_address').notNull(),
  },
  (t) => [index('connected_apps_owner').on(t.ownerAddress)],
)

export const connectedAppRedirects = sqliteTable(
  'connected_app_redirects',
  {
    clientId: text('client_id')
      .notNull()
      .references(() => connectedApps.clientId),
    origin: text('origin').notNull(),
    redirectUri: text('redirect_uri').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.clientId, t.redirectUri] }),
    index('connected_app_redirects_origin').on(t.origin),
  ],
)

export const oauthCodes = sqliteTable(
  'oauth_codes',
  {
    address: text('address').notNull(),
    clientId: text('client_id')
      .notNull()
      .references(() => connectedApps.clientId),
    codeChallenge: text('code_challenge').notNull(),
    codeHash: text('code_hash').primaryKey(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    issuerId: text('issuer_id')
      .notNull()
      .references(() => issuers.id),
    redirectUri: text('redirect_uri').notNull(),
    resource: text('resource'),
    scope: text('scope').notNull(),
    usedAt: integer('used_at'),
  },
  (t) => [index('oauth_codes_expires_at').on(t.expiresAt)],
)

export const oauthTokens = sqliteTable(
  'oauth_tokens',
  {
    address: text('address').notNull(),
    clientId: text('client_id')
      .notNull()
      .references(() => connectedApps.clientId),
    codeHash: text('code_hash'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    id: text('id').primaryKey(),
    issuerId: text('issuer_id')
      .notNull()
      .references(() => issuers.id),
    lastUsedAt: integer('last_used_at'),
    resource: text('resource'),
    revokedAt: integer('revoked_at'),
    scope: text('scope').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
  },
  (t) => [
    index('oauth_tokens_address').on(t.address),
    index('oauth_tokens_client').on(t.clientId),
    index('oauth_tokens_code_hash').on(t.codeHash),
    index('oauth_tokens_expires_at').on(t.expiresAt),
    index('oauth_tokens_revoked_at').on(t.revokedAt),
  ],
)

// No foreign keys, and the app's name is copied: the record outlives the app.
export const connectedAppEvents = sqliteTable(
  'connected_app_events',
  {
    action: text('action').notNull(),
    address: text('address').notNull(),
    appName: text('app_name').notNull(),
    clientId: text('client_id').notNull(),
    createdAt: integer('created_at').notNull(),
    error: text('error'),
    id: text('id').primaryKey(),
    issuerId: text('issuer_id').notNull(),
    subject: text('subject'),
    tokenId: text('token_id').notNull(),
  },
  (t) => [index('connected_app_events_address').on(t.address, t.createdAt)],
)

// docs/specs/pass-types-and-flows.md#apple-wallet-updates
export const applePassDevices = sqliteTable('apple_pass_devices', {
  deviceId: text('device_id').primaryKey(),
  pushToken: text('push_token').notNull(),
})

export const applePassUpdates = sqliteTable('apple_pass_updates', {
  tag: integer('tag').primaryKey({ autoIncrement: true }),
  uid: text('uid').notNull().unique(),
  updatedAt: integer('updated_at').notNull(),
})

export const applePassRegistrations = sqliteTable(
  'apple_pass_registrations',
  {
    deviceId: text('device_id')
      .notNull()
      .references(() => applePassDevices.deviceId),
    serial: text('serial').notNull(),
    uid: text('uid').notNull(),
    updatedTag: integer('updated_tag').notNull(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.uid] }), index('apple_pass_registrations_uid').on(t.uid)],
)

export const cardApplicants = sqliteTable(
  'card_applicants',
  {
    address: text('address').notNull(),
    appliedAt: integer('applied_at').notNull(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.address] }),
    index('card_applicants_applied').on(t.cardId, t.appliedAt, t.address),
  ],
)

export const cardAddressPasses = sqliteTable(
  'card_address_passes',
  {
    address: text('address').notNull(),
    attestationUid: text('attestation_uid')
      .notNull()
      .references(() => members.attestationUid),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.address] }),
    index('card_address_passes_uid').on(t.attestationUid),
  ],
)

export const passEvidence = sqliteTable(
  'pass_evidence',
  {
    attestationUid: text('attestation_uid')
      .notNull()
      .references(() => members.attestationUid),
    evidence: text('evidence').notNull(),
    kind: text('kind', { enum: ['erc8432-agreement'] }).notNull(),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.attestationUid, t.position] })],
)
