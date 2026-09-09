# Venue and member experience

Status: detailed design for review. The A/B separation, single authentication
entry, shared modules, and single app deployment were accepted in conversation.
This document specifies the screen flows and session behavior before implementation.

## Intent and constraints

The member app serves two experiences with different navigation and purposes:

- **A — Venue experience:** someone follows a venue link, receives a card,
  saves its Pass, and returns to that venue. No member sign-in is required for
  existing self-serve Bearer issuance.
- **B — Member experience:** someone signs in with Base Account, opens their
  public passes, enters through Signed verification, or uses +Private.

Keep both in `apps/app` on `app.fuda.sh`. Organize their code under `venue/`
and `member/`, with separate layout and state ownership. Keep their browser
storage on the same origin so A's saved public passes remain available to B.
Do not create `apps/member` or another production hostname in this change.

Use the current `ui` checkout; do not create or remove worktrees. Preserve the
pending root dash-development commands and runbook changes as separate work.

The supplied `fuda-sh-staff/packages/mockups/dist/onboarding.html` is a flow
reference. Author implementation and assets in this repository; do not copy
the other repository's code, styles, photos, or mock-only data.

## Routing and navigation

All paths below are on `app.fuda.sh`. Existing apex redirects are unchanged.

| Experience | Path | Access | Destination and behavior |
| --- | --- | --- | --- |
| A | `/@<handle>` | Public | Venue home: venue identity and available cards; an already held card offers Show pass. A single card can retain the current direct-card rendering. |
| A | `/@<handle>/<slug>` | Public | Card details, one-tap issuance, issued Pass and Wallet actions. |
| B | `/` | Public | Member-facing introduction and a single Sign in with Base entry. A live member session offers Open your passes. |
| B | `/signin` | Public | One Base Account connection and signature-verification flow for new and returning members. |
| B | `/rights` | Member session | Public passes from the connected Holder and this browser's saved passes. |
| B | `/rights?uid=<uid>` | Member session | Preserve the query through sign-in, then use the existing public-pass recovery flow. |
| B | `/signed` | Member session | Scan or paste a pass, select the signing wallet if needed, sign, and show the verdict. |
| B | `/private` | Member session | Unlock or create the dedicated PRF passkey, discover private Rights locally, then sign for entry. |
| B | `/settings` | Member session | Connected address, theme, and sign-out. |

Do not add `/signup`. An existing Base Account does not imply that a venue has
been registered or that a particular browser has completed its initial member
visit. Perform fuda-specific branching after authentication.

The four Dock destinations are **Your passes**, **Enter**, **+Private**, and
**Settings**. `/rights?uid=...` selects Your passes. Use real links with
`aria-current="page"`; preserve ordinary browser history and modified-click
behavior. Internal navigation within B should retain its mounted session and
public read cache. Leaving +Private clears its derived keys and discovery
results rather than storing them in the shared read cache.

Only validated B-relative routes may be used as authentication return paths.
Reject external URLs, protocol-relative URLs, and unrecognized destinations;
default to `/rights`. Sign-out always goes to `/`, ignoring a previous return
path. Unavailable/expired sessions must not briefly render protected content.

## A — Venue experience

### Layout

Use one mobile-first column, full width on small devices and approximately
28 rem maximum width on desktop, centered within a neutral page background.
Do not draw a simulated phone frame. Content can grow and scroll on short
screens and with large text. Primary actions have at least 44 px targets and
remain reachable without overlapping content or safe areas.

The store logo, name, brand color, card title, and benefits establish the
hierarchy. Preserve readable contrast and wrap long names and benefits.
An unavailable logo must not break the layout.

### Flow

```text
Venue link /@handle
  -> choose a card (when multiple exist)
  -> card details and benefits
  -> Get this card
  -> issuing state
  -> issued card, member number, QR
  -> Add to Apple Wallet / Google Wallet / open browser pass
  -> Back to venue: /@handle
```

- A valid saved card opens its ready state on revisit without another issue.
- On the ready screen, the Pass and QR are the focus. Preserve the canonical
  formatted random member number; do not use the reference's sequential
  example number or invented stamp counts.
- Only offer Wallet actions when the existing API says they are available.
  Preserve the browser-pass fallback.
- Back to home, the venue brand link, and error recovery all resolve within
  this venue. They never send someone to `/` or to B's sign-in.
- Empty venue, missing card, closed claim window, pending issuance, and failed
  requests have explicit states. A failure offers the existing safe retry or
  a link back to this venue.
- Render no member Dock or sign-out control on A pages.

The mock also illustrates OS Wallet usage, notifications, redemption,
community links, and transfer/recovery. This UI change must not invent
working controls for absent backend capabilities. Existing Wallet behavior
continues; new redemption, push, transfer, or Activation functionality needs
its own functional specification before it is exposed as an action.

## B — Member experience

### Layout

The public top page can use a wider responsive marketing layout. The sign-in
screen and signed-in screens use a centered mobile-first column, approximately
30 rem maximum width, with full-width cards and actions on small devices.

Use daisyUI Dock for the four signed-in destinations. On desktop it remains
aligned with the centered content rather than spanning an unrelated full
monitor width. Reserve bottom space for its height and the device safe area;
configure `viewport-fit=cover`. The Dock is absent from `/`, `/signin`, and
all A routes. It must not obscure validation messages, final actions, or QR.

Use a compact page header and one clear primary action. Place chain IDs,
full UIDs, Holder addresses, and lookup tools in labeled secondary details
unless the current task requires them. Do not relabel a Right as a card when
no venue/card metadata is available.

### Public top and authentication

The public top explains what members can do: keep passes, show them, and use
their own key when entry requires it. Its primary entry is Sign in with Base;
no separate new/returning choice is needed before opening Base Account.

Connecting a wallet is followed by a server-issued, single-use challenge,
wallet signature, and server verification, as in the existing dash flow.
Do not claim that an account address returned by the wallet alone is a
verified fuda session. Cancellations return to an actionable entry screen.

After sign-in, route to the validated requested B page or `/rights`. An empty
list explains that a member receives cards from a venue's link or QR; it
does not present a global venue catalog that the product does not have.

### Your passes

Use the authenticated Holder as the default public lookup address. Include
public passes remembered on this browser, preserving their existing local
recovery rules. Keep manual public-address lookup as a secondary disclosure.

Each row emphasizes live status and available pass actions. Display known
venue/card metadata when actually available from existing data. For rows
without it, use a clear generic label and a secondary shortened UID, rather
than fabricating a venue name. Retain index-unavailable and per-pass status
failure states without presenting uncertain data as valid for entry.

Base Account creation does not automatically activate or transfer a Bearer
Right, move its Holder, or make device-only data recoverable on another device.
The UI must not promise those effects.

### Enter and +Private

Enter retains the existing challenge/verification protocol and reports a
verdict for the current attempt. The authentication signature and an entry
signature are distinct actions. A member login never admits someone itself.
Passkey wallet is the main Signed action; a supported browser wallet remains
available as an explicit alternative.

+Private keeps the existing fuda PRF credential flow separate from Base
Account authentication. Explain the difference at first setup. For returning
members, emphasize Use existing passkey; Create passkey is a deliberate
alternative with the existing duplicate-key guidance. Keep meta-address
sharing and discovery as distinct tasks. No private signing keys, PRF output,
or discovered stealth account associations enter generic browser persistence,
public-holder queries, telemetry, or shared Query Core results.

### Settings and sign-out

Settings shows the connected address, existing light/dark/system theme
control, and sign-out. Do not add profile fields or a member database.

Sign-out opens the shared confirmation dialog. Cancel, Escape, and backdrop
dismissal retain the session. Confirmation clears B's active session, saved
member token, session read cache, transient wallet state, and any in-memory
+Private keys/results, then goes to `/`. Attempt server-side session deletion;
network failure must not restore the local signed-in state.

Preserve saved public Pass/Card records, OS Wallet passes, passkey credentials,
and appearance preferences. This keeps A usable after B signs out. A separate
device-data removal feature, if needed, must explain its effects explicitly.

## Shared modules and role isolation

### `@fuda/libs/wallet`

Own Base Account initialization, validated EIP-1193 account retrieval,
personal signing, and connection errors. Accept caller configuration for the
required chains and paymaster endpoints; do not impose dash's ENS sponsorship
configuration on member screens. Keep Base SDK loading lazy.

### `@fuda/libs/auth`

Own the repeated browser authentication sequence and browser token lifecycle:
connect, obtain challenge, sign, verify, restore, and clear. Session storage
is explicitly scoped by API deployment and audience. Stale async results may
not restore an old session after sign-out or replacement. Storage failure
still allows the active in-memory session to work.

Member and operator authenticated data are caller-owned. Loading an issuer,
creating a venue, and selecting the post-login destination remain in dash.
Member initialization loads the verified member address without issuer data.
Do not build a generic module that requires every caller to understand both
sets of product states.

### API session scope

The existing `/auth/challenge`, `/auth/verify`, and `/auth/logout` remain the
operator contract. Add `/auth/member/challenge`, `/auth/member/verify`,
`GET /auth/member/me`, and `/auth/member/logout` for member sessions.

Reuse challenge/signature/session machinery with an explicit audience:

- Add a session audience with existing rows defaulting to `operator`.
- Member session creation has audience `member` and no issuer binding.
- Use distinct `operator:<address>` and `member:<address>` challenge subjects
  and distinct signature messages. An entry nonce is valid for neither.
- Preserve the existing one-time nonce, expiry, hashed token storage, and
  EOA/ERC-1271/ERC-6492 verification behavior.
- Every operator credential resolver, including operator-or-admin routes,
  accepts only operator sessions. Member sessions cannot list/revoke a
  venue's members, register an issuer, or mutate its cards or ENS state.
- Member session endpoints accept only member sessions. Signing out of one
  audience does not delete the other's token.
- No member profile registration, membership synchronization, or persistent
  private discovery table is introduced by this login feature.

### `@fuda/ui` and `@fuda/styles`

Share the confirmation dialog and existing theme/icon controls where used by
both apps. Keep product copy and success actions with the caller. Reuse
daisyUI patterns for Dock, cards, alerts, and loading states; do not create a
wrapper module for every CSS class. Shared `.fuda-*` component styles belong
in `packages/styles`, while A branding and B/Dash layout remain app-owned.

`@fuda/libs/query` remains the public read integration. Session/credential
state and +Private keys are not query result data. No dashboard Drawer is
added to the member app.

## Dash behavior

Keep one authentication entry for new and returning operators. Base Account
connection and verified sign-in are shared; whether an operator has an issuer
determines the next venue screen. Do not introduce a `/signup` route or a new
signup form. Existing protected-route restoration, admin-token access,
responsive Drawer, confirmation modal, and ENS-before-new-card rules remain.

## Verification and acceptance

- Exercise member authentication success, cancellation, verification failure,
  expiry, reload, unavailable storage, sign-out, and late-response isolation.
- Prove cross-audience challenges/tokens are rejected, including operator
  routes with an admin fallback. Existing operator sessions keep working.
- Verify A navigation never exits to `/`, with zero/one/multiple cards and
  already-held cards. Preserve issuance idempotence guards and Wallet fallback.
- Verify B Dock selection, browser history, return-path validation, sign-out
  destination, and that A does not render the Dock or member gate.
- Check small mobile widths, short viewports, desktop centering, dark mode,
  keyboard focus, modal Escape behavior, and Dock safe-area clearance.
- Verify no pass transfer, Activation, balance, or recovery capability is
  implied by sign-in alone.
- Run targeted tests as content changes; run root `pnpm check` and `pnpm test`
  against final content and app/dash production builds. Reuse fresh results
  under the repository's verification cadence.
- Update canonical specs/runbook with shipped behavior, then remove this
  temporary design and any completed implementation plan.

## References

- `docs/CONTEXT.md`
- `docs/specs/pass-types-and-flows.md`
- [daisyUI Dock](https://daisyui.com/components/dock/)
- [Base Account authentication](https://docs.base.org/sdks/base-account/guides/authenticate-users)
