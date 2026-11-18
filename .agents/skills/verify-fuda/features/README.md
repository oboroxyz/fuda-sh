# fuda verification map

This directory is the maintained source for verifying fuda's user-facing behavior on the local stack. Read this index before driving, then use the matching feature file as the recipe. Behavior is specified in `docs/specs/`; when a recipe and a spec disagree, the spec and the code win, and the recipe gets fixed.

## Baseline preconditions

- Start the stack for the feature's surface with `.agents/skills/verify-fuda/scripts/fuda-verify up <surface>`. Every `up` starts from an empty, freshly migrated D1.
- Run `fuda-verify doctor` and require `"ok": true`.
- Surfaces: gate `http://127.0.0.1:6174`, app `http://127.0.0.1:6173`, dash `http://127.0.0.1:6175`. The api is `http://127.0.0.1:8797`, with routes under `/v1`.
- The api runs with no `ADMIN_TOKEN`, a fake chain and throwaway operator keys. All data is fictional.
- Never drive a stack this helper did not start. `pnpm e2e` uses the same ports.

## Driving conventions

- Seed through `ctx.seed.*` or `fuda-verify seed`, which use public api routes only. Use unique names, never fixed ones: one stack keeps its D1 for the whole session.
- Drive with Playwright roles and accessible names. The names in these files are the English copy. `drive` sets locale `en-US`, because Japanese is the first-visit default.
- Each journey is a module run by `fuda-verify drive <file>`. Keep the steps in the order a user takes them.
- Prove persistence and side effects with `ctx.d1()` or an api read that did not make the change.

## Proof and skip reporting

- Save a `step` before and after each action whose result is the claim.
- Record the feature ID, the entry point, and the evidence path from `drive`'s output.
- An entry point you could not reach is reported with the attempted command and the unmet precondition. Do not report it as verified through a different entry point.
- Passkey, wallet sign-in, a real camera, a real QR reader, Apple and Google Wallet, and NFC are out of reach of this harness. Say so instead of claiming them.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with fuda-verify`, `Gotchas`. The driving section starts with `Preconditions:` and pairs each user action with its Playwright call and the observable result.

## Features

- [Gate scan](./gate-scan.md) covers paste and reader admission, single use, unreadable input, and venue-scoped stations. Journey: `packages/e2e/journeys/gate-bearer-once.ts`.
- [Claim a card](./app-claim.md) covers the member app's venue page, claim links with a source, the store display, and unknown venues.
- [Bearer rights](./dash-rights.md) covers admin sign-in on dash, issuing a Bearer Right, and revoking it.
- [Connected apps](./dash-connected-apps.md) covers registering an app, the OAuth consent page, and revoking access.
- [Profile switching](./dash-profiles.md) covers switching between an operator's venues without leaking drafts or counts.
