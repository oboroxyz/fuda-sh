# Shared Wallet Pass Design

**Status:** Proposed

**Date:** 2026-09-12

**Research:** [Apple Wallet and Google Wallet pass layout and design capabilities](../research/2026-09-12-wallet-pass-layout-design.md)

## Objective

Let an Operator adjust the information design of a Card's Apple Wallet and Google Wallet Passes from Dash without exposing platform-specific JSON or promising pixel-identical output.

The first delivery keeps fuda's current Apple `storeCard`, Google `GenericObject`, and deployment-wide `GOOGLE_CLASS_ID`. It adds a small wallet-neutral design model that both platform renderers compile into their supported layouts.

## Recommended delivery order

1. Add a versioned, card-scoped pass-design model with defaults that reproduce the current Pass output.
2. Let an Operator prioritize fuda-owned front fields and configure supplemental details, links, and barcode fallback text.
3. Compile the same semantic design into Apple and Google output through separate renderers.
4. Add representative Apple and Google previews to the Card settings screen.
5. Treat artwork, localization, and per-Card Google Classes as later projects with their own designs.

This order makes every deployed step backward-compatible and independently testable. It also avoids coupling the initial feature to image processing, Google Class provisioning, or Apple Pass update services.

## Platform constraints

Apple and Google own the final typography, spacing, truncation, and responsive behavior. Dash must not expose font family, font size, weight, line height, arbitrary text color, CSS, coordinates, column widths, or card shape.

Apple's pass style fixes the field groups and image slots. The existing `storeCard` can carry primary, secondary, auxiliary, and back fields, but long values may be omitted and Apple Watch displays less content. Google places custom card rows in `GenericClass.classTemplateInfo`; the current fuda deployment has one shared `GOOGLE_CLASS_ID`, so every Pass must use the same row topology. ([Apple pass metadata](https://developer.apple.com/documentation/walletpasses/defining-the-metadata-of-your-wallet-pass), [Apple store-card guide](https://developer.apple.com/documentation/walletpasses/creating-a-store-card-pass), [Google `ClassTemplateInfo`](https://developers.google.com/wallet/reference/rest/v1/ClassTemplateInfo))

Previews are therefore representative renderings of semantic priority, not Wallet emulators. Their UI must state that device, OS version, locale, accessibility text size, and content length can change the installed result.

## Approaches considered

### 1. Stable semantic slots in one Google Class — recommended

Dash stores only the order of known dynamic fields and a bounded set of detail and link records. The Google Class references stable slot IDs such as `fuda-front-primary` and `fuda-front-supporting-1`; each Google Object fills those slots according to its Card's design. Apple receives the same resolved fields in its native field arrays.

This supports Card-specific information priority while retaining the existing deployment-wide Google Class. It has a bounded operational change: update that Class once with fuda's stable template.

### 2. Provision one Google Class per Card

Each Card could own an arbitrary Google row layout. This would require Class creation, approval, update, retry, deletion, and reconciliation in Card lifecycle operations. Apple would still not offer equivalent arbitrary placement, so the extra infrastructure would not improve the cross-wallet contract proportionally.

This is not part of the first delivery.

### 3. Expose separate Apple and Google editors

This gives maximum platform control but duplicates concepts, lets the two Passes drift, and exposes vendor API details to Operators. It also makes validation and previews significantly harder.

This is rejected for the shared editor. Platform-specific enhancements may later appear in a clearly separate advanced area when there is a demonstrated need.

## Scope

### Included

- Card-scoped priority for `stamps`, `memberNumber`, and `tier`.
- Ordered, static detail sections shared by every Pass issued from that Card.
- Ordered, labeled HTTPS links in Pass details.
- Selection of the human-readable barcode fallback: member number or shortened Right UID.
- Separate representative Apple and Google previews in Dash.
- A one-time stable layout configuration for the existing Google Generic Class.
- Existing issuer-level background color and logo, shown in both previews but not moved into Card settings.

### Excluded

- Arbitrary front-field label/value creation.
- Hiding the barcode, issuer name, Card title, or all identity fields.
- Custom fonts, typography, CSS, absolute positioning, text colors, corner radii, or card shape.
- Artwork uploads and Apple strip/Google hero crops.
- Pass-content localization and localized images.
- Apple Poster Generic, Featured Actions, beacons, or semantic tags.
- Google list/detail/barcode template editors, front app links, messages, rotating barcodes, or screenshot constraints.
- Switching Apple pass style or Google pass vertical.
- Guaranteed refresh of already-installed Passes.

## Domain model

The wallet-neutral persisted model is `PassDesignV1`:

```ts
export const PASS_FRONT_FIELDS = ['stamps', 'memberNumber', 'tier'] as const
export type PassFrontField = (typeof PASS_FRONT_FIELDS)[number]

export interface PassDesignDetail {
  id: string
  label: string
  body: string
}

export interface PassDesignLink {
  id: string
  label: string
  url: string
}

export interface PassDesignV1 {
  version: 1
  frontFieldOrder: PassFrontField[]
  details: PassDesignDetail[]
  links: PassDesignLink[]
  barcodeAltText: 'memberNumber' | 'shortUid'
}
```

`frontFieldOrder` must contain each of the three keys exactly once. It expresses priority, not coordinates. The renderer removes unavailable fields and promotes the first available value to the primary slot. The default order is `stamps`, `memberNumber`, `tier`, preserving today's behavior: enabled Stamp progress is primary; otherwise the member number is primary; Tier remains supporting information.

`stamps` is unavailable when the Card does not have enabled Stamp settings. `memberNumber` is available for self-serve branded Passes. `tier` is always available. The barcode and its verification payload remain system-owned and cannot be removed or edited.

Details and links are static Card content. They never contain per-Member data and never affect validity, Entry, Stamps, or the on-chain Right.

### Shared limits

- At most 4 details.
- Detail label: 1–35 Unicode characters after trimming.
- Detail body: 1–500 Unicode characters after trimming; internal newlines are preserved.
- At most 4 links.
- Link label: 1–30 Unicode characters after trimming.
- Link URL: an absolute `https:` URL with a maximum serialized length of 2,048 characters.
- Detail and link IDs are opaque UUIDs generated in Dash and preserved across edits.
- Duplicate IDs are invalid; duplicate labels or URLs are allowed.

These limits are intentionally stricter than either platform's maximum where necessary. The shared editor must remain safe on smaller devices; essential information must not exist only in Pass details because Apple Watch omits back fields.

## Storage and API

Add a nullable `pass_design_json` text column to `cards`. `NULL` means the exact `PassDesignV1` default. The API serializes only validated V1 objects. When reading malformed or unsupported stored JSON, it fails closed to the default design and logs the Card ID; a bad design must never make a Pass unavailable.

Use a separate operator endpoint instead of enlarging the existing full-replacement Card update body:

```text
GET /v1/issuers/me/cards/:cardId/pass-design
PUT /v1/issuers/me/cards/:cardId/pass-design
```

Both routes require the owning Operator session and return `Cache-Control: no-store`.

`GET` returns:

```json
{ "design": { "version": 1, "frontFieldOrder": ["stamps", "memberNumber", "tier"], "details": [], "links": [], "barcodeAltText": "shortUid" } }
```

`PUT` accepts and returns the same complete `design` object. It normalizes trimmed strings and stores the canonical JSON in one Card update. Unknown properties, unsupported versions, invalid URLs, duplicate IDs, missing field-order keys, foreign Cards, and limit violations are rejected. Validation errors answer `400 bad_input`; an unknown or foreign Card answers `404 not_found`; an invalid or missing session follows the existing operator-auth behavior.

Separating the endpoint prevents an ordinary Card metadata save from overwriting a concurrently edited Pass design and avoids changing `CardBody` or `CardUpdateBody`. New Cards need no extra write because `NULL` has a complete default meaning.

## Semantic compilation

A pure shared compiler resolves one persisted design plus current Pass data into this internal shape:

```ts
export interface ResolvedPassDesign {
  primary: { key: PassFrontField; label: string; value: string }
  supporting: { key: PassFrontField; label: string; value: string }[]
  details: PassDesignDetail[]
  links: PassDesignLink[]
  barcodeAltText: string
}
```

The compiler owns availability, ordering, default fallback, built-in English labels, and barcode fallback resolution. It produces at most one primary and two supporting fields. The barcode alternate text falls back to shortened UID when a branded member number is unavailable.

The compiler must not accept platform types. Apple and Google renderers consume `ResolvedPassDesign`, keeping vendor constraints outside the domain model.

### Apple mapping

- `primary` becomes the first `storeCard.primaryFields` entry.
- `supporting` becomes `storeCard.secondaryFields` in order.
- `details` follow the existing Holder and Attestation fields in `backFields`.
- Links become additional `backFields` with a plain URL `value` and an escaped `<a href>` `attributedValue`. The plain value remains useful where attributed values are unsupported.
- The resolved barcode fallback becomes `altText` on the barcode entry.
- Existing `backgroundColor`, derived foreground/label colors, embedded logo files, locations, and QR payload remain unchanged.

Apple's primary and system fields remain short. Long custom content is confined to back fields, which keeps the Store Card face within its conservative field limits.

### Google mapping

- `cardTitle` remains the Issuer name and `header` remains the Card title.
- The resolved primary and supporting fields become `textModulesData` with stable IDs `fuda-front-primary`, `fuda-front-supporting-1`, and `fuda-front-supporting-2`.
- Details are assigned by saved order to the fixed module IDs `fuda-detail-1` through `fuda-detail-4`; their opaque persisted UUIDs remain Dash identities and never become Google template paths.
- Links are assigned by saved order to `linksModuleData.uris` entries with fixed IDs `fuda-link-1` through `fuda-link-4`.
- The resolved barcode fallback becomes `barcode.alternateText`.
- Existing background color, logo, QR payload, and Smart Tap redemption value remain unchanged.

The deployment-wide Generic Class receives one `cardTemplateOverride` whose rows reference only the stable front slot IDs. It also receives a `detailsTemplateOverride` that references only the four fixed detail slots and the links module. The template must include fallback field paths for legacy objects that still carry the existing `member`, `tier`, and `fuda-stamps` module IDs.

The rollout must verify the Generic Class in a test issuer before production because Google owns final omission and wrapping behavior. The runbook must contain the exact Class patch and rollback payload; Operators do not edit the Class from Dash.

### Stamp synchronization

The current Google Stamp update reads and merges only Stamp modules. Once a front slot may contain Stamp progress, a partial module merge is unsafe. Stamp synchronization must load the Card's `PassDesignV1`, resolve all front fields and details from current data, and replace the complete set of fuda-owned modules in one Google Object patch. It must preserve fields not owned by fuda and retain the current best-effort, post-commit failure semantics.

This change must be based on the current working tree and preserve the in-progress `smartTapRedemptionValue` behavior in `packages/pass/src/google.ts` and its tests.

## Dash interaction design

Add a collapsed `Pass design` section to the existing Card edit screen, beside the independently saved Stamp settings. Opening it loads the design endpoint. The Card metadata form and Pass design form save independently.

The section is ordered as follows:

1. **Preview** — an Apple/Google segmented control above a representative Pass. The preview uses clearly fictional Member data and carries a visible note that installed layout varies by device and OS.
2. **Front information** — three rows for Stamps, Member number, and Tier. Operators move rows with explicit up/down buttons; drag and drop is not required. Unavailable Stamp data remains visible in the editor with an explanation and is omitted from the preview.
3. **Barcode fallback** — a select with Member number and shortened Right UID. The preview updates immediately.
4. **Details** — add, remove, edit, and reorder up to four label/body records.
5. **Links** — add, remove, edit, and reorder up to four label/URL records.
6. **Save** — one explicit save button with saving, saved, validation, session, and network states.

The reorder controls must have accessible names that include the field or record label, and keyboard operation must cover every action. Removing an unsaved detail or link needs no confirmation because Save is explicit. Navigating away discards unsaved Pass-design edits; the existing Card metadata remains unaffected.

The preview reuses Issuer name, Card title, brand color, and logo from the loaded Dash session. It uses fixed fictional values for dynamic data:

- Member number: `ABCD-E123-F5679`
- Tier: `VIP`
- Stamps: `4 / 10`
- Short UID: `0x12345678`

The preview must never render a real Member's Right or imply that it is an installable Pass.

## Existing and installed Passes

Cards with `pass_design_json = NULL` render exactly as they do before this feature. Saving a design changes newly generated Google save links and newly downloaded Apple `.pkpass` files immediately.

The first delivery does not promise refresh of already-installed Passes:

- fuda has no Apple Pass update web service, so an installed Apple Pass cannot receive the new design automatically.
- Google Object updates are currently triggered by Stamp reception, not by Card design saves. A later sync can adopt the latest design, but design save does not fan out across every issued Right.

Dash must state: “Changes apply when a Pass is next added or downloaded. Previously saved Passes may keep their current appearance.” The canonical product specification must preserve this platform-neutral guarantee.

## Error and degradation behavior

- A `NULL` design value uses the default.
- Malformed persisted JSON uses the default and logs the Card ID without logging custom content or session data.
- A missing detail or link on one platform never prevents barcode generation.
- An invalid design write is rejected without changing the stored design.
- Google Class mismatch or missing fixed slots is a deployment fault. Pass creation still returns the existing platform error contract; the runbook provides diagnosis and rollback.
- Preview rendering errors remain inside the Pass-design section and never block the Card metadata editor.
- Google synchronization failures remain asynchronous and never reverse an Entry or Stamp award.

## Verification strategy

### Shared contract

- Schema tests cover canonical defaults, every boundary, trimming, field-order permutations, duplicate/missing keys, UUID uniqueness, URL protocol, unknown properties, and version rejection.
- Compiler tests cover Stamps enabled/disabled, branded/admin Passes, every field-order permutation, and both barcode fallback choices.

### API and storage

- Migration tests prove existing Cards read the default design.
- Route tests cover owner access, foreign/unknown Cards, full replacement, normalization, invalid JSON input, and `no-store` responses.
- Pass-route tests prove malformed stored data falls back without losing the QR Pass.

### Wallet renderers

- Apple tests assert field order, details, escaped attributed links, barcode `altText`, field limits, and unchanged colors/logo/location/QR behavior.
- Google tests assert stable slot IDs, detail/link modules, barcode `alternateText`, legacy template compatibility, Stamp re-resolution, and preservation of `smartTapRedemptionValue`.
- Package tests confirm both renderers consume the same `ResolvedPassDesign` fixtures.

### Dash

- Pure state tests cover reorder, add/remove, limits, dirty state, and discard-on-navigation.
- Component tests cover loading, accessible controls, both previews, fictional data, local validation, independent saves, and every API failure state.
- Browser verification covers narrow mobile and desktop layouts in English and Japanese, light and dark themes, keyboard-only operation, and representative long content.
- Local screenshots and review evidence go under `artifacts/<YYYY-MM-DD>-wallet-pass-design/` and remain untracked.

### Final repository verification

During implementation, run the narrowest affected package tests after each task. Before completion, run `pnpm check` and `pnpm test` once against the final tree. Update `docs/specs/pass-types-and-flows.md` with the resulting behavior and `docs/runbook.md` with the Google Class configuration and rollout procedure.

## Later projects, in recommended order

### 1. Shared artwork with platform crops

Accept one source image but require separate Apple strip and Google hero crop previews. Export embedded Apple `strip.png`, `strip@2x.png`, and `strip@3x.png`; publish a separately sized Google hero image with accessibility text. Essential text remains outside artwork, and the preview explains that Apple Watch omits the strip image.

This requires a card-scoped R2 asset lifecycle, image validation, immutable versioned URLs, and replacement semantics. It should reuse principles from the existing issuer-logo pipeline without conflating issuer logos and Card artwork.

### 2. Pass-content localization

Add one required default locale and selected BCP 47 translations for built-in labels, details, links, and image descriptions. Emit Apple `.lproj/pass.strings` resources and Google `LocalizedString` translations. This should follow the shared content model rather than localizing platform JSON independently.

### 3. Typed date and number fields

Add semantic dates, times, numbers, and currencies only when a Card feature needs them. Store typed values and map to native formatters instead of persisting display-ready format strings.

### 4. Installed-Pass refresh

Design Apple web-service registration, push updates, Google Object synchronization after Card changes, retry policy, and operational observability as one explicit lifecycle project. Do not imply cross-platform refresh until both paths exist.

### 5. New platform styles

Evaluate Apple Poster Generic/Featured Actions and per-Card Google Classes only after the shared editor has real usage data. These change compatibility and provisioning contracts and should not be folded into an appearance-editor increment.

## Acceptance criteria

- Existing Cards and Pass endpoints produce their current output when no design is saved.
- An owning Operator can load and replace one Card's Pass design independently of Card metadata and Stamp settings.
- The same saved field priority, details, links, and barcode fallback compile into valid Apple and Google payloads.
- The barcode payload, Right validity, issuer identity, Card identity, and Entry behavior cannot be changed from the Pass-design editor.
- The Google implementation uses one deployment-wide Class with stable slots and does not create Classes from Dash.
- Dash provides distinct, explicitly representative Apple and Google previews using fictional Member data.
- Design saves affect future adds/downloads; the UI does not promise refresh of already-installed Passes.
- Canonical specs and the runbook describe the shipped behavior and Google Class rollout.
