# Venue first onboarding and visual refinement

## Intent

The operator registers the venue and acquires its ENS name before creating cards. A venue owns zero or more cards. Separate venue identity from each card's content and distribution. The user requested autonomous completion and commits, followed by visual improvements to dash and app for morning review.

## Contract

- `POST /issuers` accepts venue fields only (brandColor, handle, name, tagline, logoUploadId), creates the issuer and attaches its session atomically, and creates no card.
- Its `IssuerCreateResponse` contains a non-null issuer, `cards: []`, publicUrl, and the current ENS view, matching the registered branch of `IssuerMeResponse`.
- Introduce `CardCreateResponse` for `POST /issuers/cards`: `{ issuer, card, publicUrl }`.
- `POST /issuers/cards` requires a recorded chain-confirmed ENS claim for the issuer's configured name. Return `ens_required` (409) before inserting any card if unclaimed, and `ens_not_configured` (503) if no ENS name can be configured. Existing card reads and member issuance are preserved.
- ENS acquisition is a prerequisite, not a new perpetual expiry policy. Existing chain receipt verification remains the authority. No fake claims or client-only gate.
- Registered issuers with zero cards survive sign-in, reload and query refresh. Existing issuers and cards need no migration.

## Screens

- `/venue`: before registration, a dedicated venue form with name, permanent handle, brand and optional logo; no card title, slug, reward or validity fields. After registration, show venue identity and ENS claim/retry state.
- `/published`: card list, meaningful empty state, add-card action only when ENS claimed. Venue/ENS management is a separate navigation destination.
- `/new`: only a card form for a registered venue with claimed ENS. Redirect other operators to `/venue`. Existing cards remain readable if ENS is unclaimed or unavailable.
- After venue registration stay on `/venue` to claim ENS. After confirmed claim offer creating the first card or returning to cards. After card creation go to `/published` with all cards preserved.
- Keep localized English/Japanese copy, session-generation guards, scoped query cache, confirmation modal and responsive Drawer.

## Visual refinement

Use existing daisyUI and shared styles. Inspect dash and app for overly wide text, weak hierarchy, crowded mobile actions, unclear loading/error/empty states and inconsistent spacing. Make concrete improvements in each app with existing product semantics. Do not add marketing claims, unrequested features, external assets or copy from other repositories.

## Verification

Behavioral tests cover zero-card registration, ENS gate and subsequent multiple-card creation, reload/routing, late responses after sign-out, and the separated form boundaries. Inspect rendered desktop/mobile views where tooling allows. Run final `pnpm check`, `pnpm test`, and both production builds. Update canonical contracts and screen descriptions, delete these temporary artifacts, commit all completed changes. No push or deployment is requested.
