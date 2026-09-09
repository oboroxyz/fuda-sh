# Dashboard card and pass management

User delegated design decisions, implementation, local commits, screenshots, and a verification checklist while away. Work stays in the existing `ui` worktree. Preserve all pre-existing changes and report commit scope.

## Product design

Keep current fuda typography, palette, brand and responsive drawer. Use the reference https://nexus.daisyui.com/dashboards for placement only: page title/action, compact metric panels, filter toolbar, table. Author all implementation here.

`/cards` becomes a full-width searchable list with no visual card previews. Columns: title/slug, issued and active counts, type, claim/validity settings, public URL, Edit. Upper-right action is `+ Add card`. Empty state retains a clear create/ENS prerequisite action. Add type filter and no-results state. Public URL opens safely in another tab and can be copied. No hidden promotional features.

`/cards/:slug/edit` loads a managed Card, preserving all values, and shares the actual form component with `/cards/new`. Slug is read-only in edit because published links must remain stable. Category/title/description/claim and validity windows/lock-screen venue can change. Explain that validity changes affect future claims. Card save and optional Stamp settings are separate, explicit saves. Show Stamp settings only for saved Membership cards, as an optional section. `/cards/:slug` retains a useful card detail screen and a text `< Back to card` link to `/cards`; add an Edit link. Legacy ID/stamps routes remain valid, including old slug `new`. Do not show Stamp settings for Ticket.

`/passes` is an operator navigation item listing this Issuer's issued non-private Passes. Header metrics: total passes, active, total stamps, and recent claims (last 30 days). Explain that pass count counts issued member numbers, not unique people. Filter by card, lifecycle status and search (member number/UID/address/card name); page through results. Rows include member number or UID, Card, claim time, Stamp count, address where stored, status, and expiry. Show unknown values as unknown, never zero or a fabricated address. No raw pass-QR/bearer secrets or deep links to bearer-secret endpoints.

## Domain and backend decisions

A Card is an issuance template; a Pass is one non-private issued Right. `members.createdAt` is claim/issuance time. There is no distinct-human identity or separate points model. Use the existing Stamp ledger rather than creating points or user tracking.

Add immutable issuance metadata `members.validFrom`, `validUntil`, `usageModel`, nullable for historical unknown. New issuance writes exact validated request values. Zero validity boundary means unbounded. Existing records are not backfilled from mutable Card settings. Local lifecycle: revoked, unknown metadata, not yet valid, expired, consumed (single-use with default slot), active. These are operational database snapshots, not fresh chain verification. Exclude private rows from this Pass screen/aggregates; those have no Pass and rotating stealth holders must not be reinterpreted as users.

## API contract

All new endpoints use operatorAuth, cache-control no-store, owner scoping and no tenant ID from request body.

- `PUT /v1/issuers/me/cards/:cardId` receives strict `CardUpdateBody` = Card editable fields excluding slug, and returns `{ card: OperatorCardView }`. Foreign/missing ID is 404, malformed/unknown fields 400. Preserve id/issuer/slug/createdAt; update mutable fields only. Claim/validity schema checks match create. No ENS gating on editing an existing Card. A saved Ticket disables its card-specific Stamp setting in the same batch so switching back does not silently reactivate a prior option.
- `GET /v1/issuers/me/cards/:cardId` returns `{ card: OperatorCardView }` for hydration with `lockScreen: boolean` and `venue: {lat,lng}|null`, keeping public CardView unchanged. Extend `OperatorCardView` from CardView. No new required fields on existing issuerMe contract.
- `GET /v1/issuers/me/passes?page=1&pageSize=25&q=&cardId=&status=` returns `IssuerPassesResponse`. Validate page positive integer, pageSize 1..100, q <= 120 chars, known status and owned card filters. Unknown foreign cards return empty results (no leak). Stable order claimedAt DESC then uid ASC. Page totals are filtered; summary and cardStats are unfiltered across the Issuer. Use SQL aggregate/count pagination without loading entire venue rows into Worker memory. Clamp no page silently; empty page is valid.

```ts
type IssuerPassStatus = 'active' | 'revoked' | 'expired' | 'not_yet_valid' | 'consumed' | 'unknown'
interface IssuerPassView {
  uid: string
  memberNumber: string
  card: { id: string; slug: string; title: string; category: 'membership' | 'ticket' } | null
  holder: string | null
  claimedAt: number
  stamps: number
  status: IssuerPassStatus
  validFrom: number | null
  validUntil: number | null
}
interface IssuerPassesResponse {
  passes: IssuerPassView[]
  page: { number: number; size: number; total: number }
  summary: { total: number; active: number; stamps: number; claimedLast30Days: number; unknown: number }
  cardStats: { cardId: string; issued: number; active: number; unknown: number }[]
}
```

Explicit SQL projections: never return secrets or private recovery data. Stamp and slot joins must not multiply rows/counts; preaggregate them. Joins on Cards and stamps retain issuer scope. SQLite/D1 bound parameters stay under 100. Existing privacy and verifier protocols stay authoritative.

## State, validation, and evidence

Retain current session generation checks. Late card loads/saves/pass queries cannot replace a different route or session. Successful card saves update operator state without clearing unrelated draft data. Loading/error/retry/empty states are visible, 401 follows current sign-out invalidation. Dates are in local browser time with a label. Search debounce and page reset when filters change; screen reader labels and real anchors preserve modified clicks.

Tests cover ownership, immutable validity and historical unknown, consumed/expired boundaries, aggregate pagination over 200, no join count inflation, edit preservation and validation, route reload/navigation, draft hydration and save failure/retry, type-gated stamps, stale requests, empty and filtered tables. Run final `pnpm check` and `pnpm test` plus dash build; record environment failures accurately. Capture desktop/mobile/light/dark images with explicitly labeled test fixtures if live auth/data unavailable. Save review checklist and screenshots in a review artifact directory, then remove completed temporary spec/plan after canonical docs updated.
