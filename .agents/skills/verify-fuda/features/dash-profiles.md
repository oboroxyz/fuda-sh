# Profile switching

An operator with two venues switches between them from the venue-name button above the dashboard navigation. Each venue's card list, counts and forms belong to that venue only. An unsaved card draft from one venue is not carried into the other. A form left open in an old tab cannot save into the venue the operator switched to in another tab.

## Sub-features

- `profile-switch`: the venue-name button opens a list of profiles. Choosing `@<handle>` switches the venue.
- `profile-counts`: `/cards` shows each venue's own issued and active counts and `Total stamps`.
- `profile-draft-reset`: an unsaved `/cards/new` draft does not survive a switch.
- `profile-stale-tab`: saving a stale form after a switch in another tab does not overwrite either venue.

## How to get to it (user POV)

- Choose the current venue's name above the navigation, then a profile marked `@<handle>`.
- Open `/profile` or `/cards` in two tabs.

## Driving it with fuda-verify

Preconditions:

- `fuda-verify up dash` is ready and `doctor` reports `"ok": true`.
- Two venues owned by one operator. Reuse `operatorWithTwoProfiles()` and `claimCard()` from `packages/e2e/tests/support/operator.ts` by importing them into the journey. Then call `signInOperator(first.token)`.

- **Counts.** `page.goto('/cards')`. The `row` for the first venue's card shows `1` and `1` after `claimCard(first)`, and `Total stamps` reads `1`.
- **Draft.** Choose `+ Add card`, then `getByLabel('Card title', { exact: true }).fill('Unsent draft')`. Choose `Profile` in the sidebar.
- **Switch.** `getByRole('button', { name: first.issuer.name, exact: true }).click()`, then click the button matching `@<second handle>`. The venue button now reads the second venue's name, its card row shows `0` and `0`, and `Total stamps` reads `0`.
- **Draft reset.** `page.goto('/cards/new')`. `Card title` holds the default `Membership`, not the draft.
- **Stale tab.** Run the second test in `packages/e2e/tests/dash/profiles.e2e.ts` as the recipe. After saving, `apiRequest('/issuers/me', ..., { token })` for both venues returns their original names.

## Gotchas

- A switch changes the session's venue on the server. Read both venues back through the api, not through the page that just saved.
- Leaving for `Profile` keeps a draft within one venue. Only a switch, a new session or a reload clears it.
- The stale-tab case needs a second named window (`window.open('', 'fuda-profile-switch')`). Close it before the journey ends.
