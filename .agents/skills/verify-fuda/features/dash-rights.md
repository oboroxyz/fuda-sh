# Bearer rights

An admin signs in to the dashboard, issues a Bearer Right for a member ID, sees it listed as Active, and revokes it after a confirmation dialog.

## Sub-features

- `admin-sign-in`: the sign-in screen offers `Sign in with Passkey` and an admin token path. An empty token signs in when the api has no `ADMIN_TOKEN`.
- `rights-issue`: the `Issue` page issues a Bearer Right and shows its `fuda:v1:0x…` payload.
- `rights-list`: the `Rights` page lists the right as `Active`.
- `rights-revoke`: `Revoke`, confirmed in the `Revoke this right?` dialog, marks it `Revoked`.

## How to get to it (user POV)

- Open dash at `/`, choose `Sign in with an admin token instead`, leave the token empty and choose `Continue`.
- Use the `Issue` and `Rights` links in the sidebar.

## Driving it with fuda-verify

Preconditions:

- `fuda-verify up dash` is ready and `doctor` reports `"ok": true`.
- A unique member ID, such as `verify-member-<Date.now()>`.

- **Sign in.** `page.goto('/')`. Heading `fuda. dashboard` is visible. `getByText('Sign in with an admin token instead').click()`, then `getByRole('button', { name: 'Continue' }).click()`. Heading `Overview` is visible.
- **Issue.** `getByRole('link', { name: 'Issue' }).first().click()`, `getByLabel('Member ID').fill(memberId)`, then `getByRole('button', { name: 'Issue right' }).click()`. Text matching `/^Issued bearer/` and text matching `/^fuda:v1:0x[0-9a-f]{64}$/` are visible.
- **List.** `getByRole('link', { name: 'Rights' }).first().click()`. The `row` filtered by `memberId` contains `Active`.
- **Revoke.** In that row, `getByRole('button', { name: 'Revoke' }).click()`. In `getByRole('dialog', { name: 'Revoke this right?' })`, choose `Revoke right`. The row contains `Revoked`.
- **Side effect.** Scan the issued payload on a gate stack, or read the right's state with `d1()`. The admission recipe is in `gate-scan.md`.

## Gotchas

- The admin cookie ends with the browser session. Each `drive` run starts signed out.
- Below 64rem the rights list renders as cards, not a table. Use the default 1280×800 viewport for the `row` locators.
- Revocation suppresses a duplicate submit while the request is in flight. A double click does not prove idempotence.
