# Dash UI polish design

**Date:** 2026-09-07
**Status:** Approved for implementation planning

## Purpose

Polish `apps/dash` into a responsive operator console without changing its authority, API contracts, or product behavior. The dashboard remains an admin-token-protected client of the existing issue, member-list, revoke, pass, QR, and Graph query paths. The change adds a three-route information architecture, clearer operation states, English and Japanese copy, and the same light/dark/system preference model across reusable frontend packages.

The sibling `fuda-sh-staff` repository informed only broad interaction categories such as a persistent desktop navigation rail, an overlay drawer on small screens, and reusable appearance controls. This design, its package interfaces, visual system, copy, and implementation are authored independently for this repository.

## Scope

This change includes:

- a responsive authenticated shell with Overview, Rights, and Issue routes;
- a default-English English/Japanese language switcher with a persisted explicit choice;
- a light/dark/system theme switcher with pre-paint application and a persisted explicit mode;
- overview counts derived from the existing `GET /members` response;
- truthful API and Graph configuration indicators derived from existing client state and build configuration;
- search and filters for the existing D1 member rows;
- desktop rows and compact mobile cards for the same rights data;
- an accessible confirm-before-revoke interaction with duplicate-submit protection;
- explicit loading, empty, success, and failure states for list, issue, revoke, and on-chain lookup operations;
- reusable locale mechanics in `packages/i18n`, shared style foundations in `packages/styles`, and reusable non-domain controls in `packages/ui`; and
- tests and canonical documentation updates needed to make the resulting behavior durable.

## Non-goals

This change does not:

- add or alter API endpoints, request payloads, response payloads, authentication rules, D1 schema, chain writes, or Graph queries;
- persist the admin token in a cookie, local storage, session storage, or URL;
- add operator accounts, sign-out endpoints, roles, workspaces, templates, analytics, pagination, server-side search, or background polling;
- change Bearer, Signed, or +Private issuance rules, tier or usage-model semantics, pass generation, QR contents, revocation semantics, or on-chain authority;
- combine D1 member rows with Graph results or write Graph query results to D1;
- give +Private rows a holder, pass link, or scannable Bearer credential;
- adopt the new shared packages in `apps/app` or `apps/gate`, or change those applications;
- change API deployment behavior or introduce health-check requests; or
- copy code, specifications, designs, visual assets, or brand assets from the conceptual reference repository.

## Architecture and package boundaries

The existing pnpm workspace convention remains: each direct child package owns a small public surface and is consumed through a workspace dependency. Dash owns all operator-domain composition; the shared packages remain domain-neutral.

### `packages/styles`

`@fuda/styles` owns the shared CSS foundation: color and spacing tokens, typography defaults, focus treatment, the class-based dark variant, and reusable base/component styles. It also provides the semantic variables that allow light and dark themes to use the same component markup. It does not contain Dash layout selectors, route-specific styles, member status rules, or operator copy.

Dash continues to own a local stylesheet for the sidebar/drawer layout, page grids, rights table/card switch, and other console-specific composition. That stylesheet imports Tailwind and the shared styles entry rather than redefining the foundation.

### `packages/i18n`

`@fuda/i18n` owns the supported locale contract (`en` and `ja`), `en` as the fallback and first-visit default, dictionary selection, validation of persisted values, browser preference reads/writes, and document-language synchronization. The resolution rule is deliberately small and deterministic:

1. use a valid explicitly persisted locale;
2. otherwise use English.

Browser language does not silently select Japanese, so “English-default” has one meaning on every device. Selecting a language updates the active locale immediately, persists it under a namespaced local-storage key, and sets `document.documentElement.lang`. Storage access is guarded; blocked or corrupt storage falls back to English without preventing render.

Dash owns its complete English/Japanese copy dictionary because route names, issuance fields, status descriptions, and errors are operator-domain language. The dictionary must be structurally complete for both locales at type-check time. API error identifiers and blockchain values are data, not translated keys; the UI places them within localized explanatory copy where explanation is needed.

### `packages/ui`

`@fuda/ui` keeps its existing fetch and formatting exports and gains only reusable, non-domain presentation or browser-behavior primitives:

- language selection control;
- light/dark/system theme control;
- a generic icon-button primitive used by those controls; and
- pure theme helpers that resolve and apply an appearance mode.

These controls accept labels and choices from the consumer. They do not import Dash copy, know Dash routes, fetch members, or own authentication. No external reference assets are introduced.

Theme mode is `light | dark | system`. A valid saved mode wins; otherwise the default is `system`. The selected mode is stored under a namespaced local-storage key. Applying a mode records the selection on the root element and toggles the resolved dark class. System mode follows `prefers-color-scheme` changes while the page is open. A small pre-render call in the Dash entry applies the saved/resolved mode before mounting the JSX tree, so the first rendered frame uses the correct palette. As with locale storage, failures fall back safely to system mode.

### `apps/dash`

Dash owns route parsing and navigation, the authenticated shell, the admin token, the members resource, all operator copy, the three pages, issue/revoke/Graph workflows, and Dash-specific responsive styles. Existing API and view-model modules remain the behavioral seams for network calls and right presentation. Components receive state and callbacks instead of reading tokens or build configuration implicitly when a narrow prop can express the dependency.

## Routes and components

Dash remains an assets-only single-page application. Wrangler's existing SPA fallback serves `index.html` for direct route visits. A small local router parses `location.pathname`, uses `history.pushState` for in-app navigation, and reacts to `popstate`. Trailing slashes normalize to the canonical path; unknown paths replace to Overview rather than rendering an unlabelled state.

| Path | Navigation label | Responsibility |
| --- | --- | --- |
| `/` | Overview | Summary counts and configuration status |
| `/rights` | Rights | D1 member search/filter, responsive right records, pass/QR actions, revoke, and the separate on-chain lookup |
| `/issue` | Issue | Existing Bearer, Signed, and +Private issue workflow and result |

The admin-token gate wraps the authenticated application, not an individual route. A direct visit to any valid route keeps that route selected while the operator enters the token. The token remains React state for the current page lifetime only. A `401` from list, issue, or revoke clears the token and member data and returns to the gate with a localized unauthorized message. The appearance and locale controls remain available at the gate so preferences do not depend on authentication.

`DashboardShell` renders the current page and shared chrome. On large screens it exposes a persistent sidebar with the three navigation links and marks the current page with `aria-current="page"`. On smaller screens it renders a compact header and an overlay drawer containing the same links and controls. Navigation closes the mobile drawer.

### Overview page

Overview derives its metrics only from the current successful members resource:

- total rights: every returned member row;
- active rights: rows whose status is `active`; and
- revoked rights: rows whose status is `revoked`.

Counts are not rendered as zero while the first members request is unresolved or failed. Loading placeholders represent an unresolved request; an empty successful response produces three zero counts. If a refresh fails after a successful load, the last successful counts remain visible with an explicit stale/error marker. If no successful load exists, the error replaces the count values.

The API status card shows the configured API base URL and the state of the existing members request: checking, connected, or unavailable. “Connected” means only that `GET /members` succeeded; it does not claim general API health. The Graph status card shows the configured endpoint and “configured,” or “not configured” when `VITE_GRAPH_RIGHTS_ENDPOINT` is empty. It does not issue a probe or claim that a configured endpoint is reachable. A failed on-chain lookup is reported within that lookup and does not rewrite the build-configuration indicator.

### Rights page

Rights presents the existing D1 member rows. Search is client-side, case-insensitive, and matches member ID, full holder address when present, and full UID. Filters independently select status (`all`, `active`, or `revoked`) and level (`all`, `bearer`, `signed`, or `private`); search and both filters combine with AND semantics. Filters never mutate or refetch the source rows. “No rights issued” is distinct from “no rights match these controls,” and the latter offers a clear-filters action.

At desktop widths the results use a table. At mobile widths the same view models render as cards with the same member, holder, level, tier, status, UID, pass, QR, and revoke capabilities; the mobile layout does not depend on horizontal scrolling. Bearer and Signed rows retain web, Google, and Apple pass links. +Private rows retain their member ID, UID, and QR identifier but show no holder or pass links. Existing QR generation and full QR payload text remain unchanged.

The on-chain status lookup remains visually and operationally separate beneath the D1 rights collection. It queries by a manually entered holder, then loads the same rights, Attendance records, and issuer delegations through the existing Graph helpers. It does not inherit the D1 search filters, require a matching member row, or modify Overview counts.

### Issue page

Issue retains the existing level-dependent form and request derivation:

- Bearer requires `memberId`;
- Signed requires a valid holder address; and
- +Private requires a valid stealth meta-address and allows an optional representative `memberId`.

Tier and usage-model selection, API error identifiers, successful +Private announcement feedback, Bearer/Signed QR output, and browser pass link behavior remain intact. While one issue request is active, its submit control is disabled to avoid an accidental duplicate issuance. Success reloads the shared members resource so Overview and Rights reflect the new row without a second page-local store.

## State and data flow

`App` is the single owner of cross-route state:

- current route;
- in-memory admin token;
- active locale;
- members resource; and
- global authentication failure message.

The members resource is an explicit discriminated state: `idle`, `loading`, `ready(rows)`, or `error(message, previousRows?)`. It loads after a token is accepted and reloads after successful issue or revoke. A refresh may retain the last successful rows for continuity, but the UI marks them as refreshing and never presents stale counts as a newly successful result. Route changes do not cause redundant requests.

Page-local state stays local: issue form values and outcome belong to Issue; search, filters, expanded QR UID, selected revoke target, and revoke operation state belong to Rights; holder input and Graph lookup state belong to the on-chain section. The shared member rows are immutable inputs to filtering and rendering helpers.

The write flows are:

```text
Issue submit -> existing POST /issue -> render existing result -> reload GET /members
Revoke confirm -> existing POST /revoke -> close on success -> reload GET /members
Holder query -> existing Graph helpers -> render chain-only result
```

All three admin API helpers continue to send the in-memory token as the Bearer credential. No theme or locale preference is sent to the API.

## Loading, errors, and revoke confirmation

Each asynchronous action exposes its own state and disables only controls that would duplicate or invalidate that action:

- initial and refresh member loads show progress without disguising failure as an empty list;
- issue submission disables the form submit and uses a localized busy label;
- a Graph query disables its query submit until the current request settles; and
- revoke disables both the confirmation action and the matching row/card action for the target UID.

Network and API failures appear in the page section that initiated them. A member-list failure is also visible on Overview because its counts cannot be trusted. Existing machine-readable API errors remain visible verbatim, with localized surrounding labels. A `401` is the one cross-cutting failure and returns to the token gate. Failed refreshes do not erase the last successful rows; the error and staleness are explicit.

Selecting Revoke opens an accessible confirmation dialog containing enough immutable identity to catch a mistake: member ID or its empty fallback, shortened holder when present, level, and shortened UID. The destructive button is visually distinct and the cancel action is the initial safe action. Escape and the cancel control close the dialog when no request is running, and focus returns to the invoking control.

Confirmation sets the selected UID as in flight before starting the request. Repeated clicks and repeated submit events for that UID are ignored until the promise settles. The dialog cannot be dismissed during the request. On success it closes and the shared member list reloads. On a non-401 failure it remains open, displays the error, and enables an intentional retry after the in-flight state clears. Already revoked rows never offer an enabled destructive action.

## Responsive and accessibility behavior

The layout has two intentional modes rather than a scaled desktop table, separated at the existing Tailwind `lg` breakpoint of 64 rem (1024 CSS pixels):

- at the large breakpoint and above, the sidebar stays visible and content uses the remaining width;
- below it, the sidebar becomes a modal drawer over the page, and Rights switches to cards.

The drawer has a named open button, a labelled navigation landmark, an overlay/close control, Escape dismissal, and focus restoration. When open, focus stays within the drawer; background content is not keyboard-interactive. Route changes close it. Content remains usable at 320 CSS pixels without page-level horizontal overflow.

All interactive elements are native buttons, links, inputs, selects, or dialog controls. Inputs have persistent programmatic labels rather than placeholder-only names. Icon-only appearance controls expose localized accessible names and their current value. Status is communicated by text as well as color. Busy changes that matter are announced through an appropriate live region, while decorative loading shapes are hidden from assistive technology. Visible focus styles meet both themes. Icon controls, primary actions, and mobile navigation targets are at least 44 by 44 CSS pixels. Nonessential motion respects `prefers-reduced-motion`. QR payload text remains available alongside the image.

Language changes update visible copy, control labels, empty/error states, and the root `lang` attribute without changing the route, token, form data, filters, or loaded member data. Theme changes likewise preserve all application state.

## Testing strategy

Tests follow package ownership and favor pure seams that run in the repository's existing Vitest setup.

### Shared packages

- `packages/i18n`: supported locale typing, English fallback, valid/invalid persisted values, storage failure fallback, preference writes, and root-language application.
- `packages/ui`: theme default and cycle order, saved-mode validation, light/dark/system resolution, system preference changes, and semantic language/theme control markup.
- `packages/styles`: verified indirectly by both theme build output and the Dash build; no screenshot assertions are required for token declarations.

### Dash units and views

- router recognition, trailing-slash normalization, unknown-path fallback, navigation, and browser back/forward handling;
- Overview totals for mixed, empty, loading, and failed member resources, plus truthful API/Graph status labels;
- case-insensitive search and combined status/level filtering, including empty-result distinctions;
- desktop and mobile view semantics, pass availability, +Private exclusion rules, QR expansion, and revoked-action disabling;
- revoke confirmation cancel, confirm, in-flight duplicate suppression, success refresh, non-401 retry, and `401` token clearing;
- issue validation and payload tests for all three levels, in-flight suppression, existing result behavior, and success refresh;
- on-chain idle, loading, empty, error, unresolved-delegation, rights, Attendance, and delegation states; and
- language changes preserving route and application data while changing copy and the document language.

Existing API-client, issue-body, member-view, and Graph-loader tests remain and must continue to pass. New component tests may use small injectable browser/storage/network seams instead of introducing a second application framework.

### Completion verification

Implementation is complete when:

1. `pnpm test`, `pnpm check`, `pnpm format:check`, `pnpm --filter dash build`, and `git diff --check` pass;
2. direct loads and back/forward navigation work for `/`, `/rights`, and `/issue` under the existing SPA fallback;
3. manual keyboard checks cover the token gate, both appearance controls, route navigation, mobile drawer, search/filters, QR disclosure, issue form, Graph query, and revoke dialog;
4. manual responsive checks at 320 px, 768 px, and at least 1024 px show no lost actions or page-level horizontal overflow;
5. light, dark, and system modes render legibly, system mode reacts to an OS preference change, and both theme and language choices survive reload;
6. English is the first-visit locale, Japanese is complete, and switching either preference does not clear operational state;
7. the existing issue/list/revoke/pass/QR/on-chain behavior and in-memory-only token policy are unchanged; and
8. canonical docs are updated to describe the new Dash routes and durable operator-visible behavior, without treating this temporary design artifact as the source of truth.
