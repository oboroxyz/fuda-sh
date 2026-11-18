# Claim a card

A member opens a shop's page in the member app and claims its free membership card. The card's QR code and member number appear and stay after a reload. A claim link can carry a source, which the shop later sees. The store display page links customers to the card.

## Sub-features

- `claim-venue-page`: `/@<handle>` lists the venue and its card. `Get your free membership card` claims it.
- `claim-persists`: after a reload, the QR stays and the claim button is gone.
- `claim-source`: `/@<handle>/<slug>?source=<tag>` records `<tag>` on the issued pass.
- `store-display`: `/@<handle>/home` shows `Scan to get your card` with a device link and a print action.
- `unknown-venue`: `/@<unknown>` says `No card here`.

## How to get to it (user POV)

- Scan or open a shop's link `/@<handle>` on a phone.
- Open a flyer link `/@<handle>/<slug>?source=<tag>`.
- Shop staff open `/@<handle>/home` on a counter display.

## Driving it with fuda-verify

Preconditions:

- `fuda-verify up app` is ready and `doctor` reports `"ok": true`.
- `const venue = await seed.venue()` in the journey.
- Use a phone viewport, `{ width: 390, height: 844 }`.

- **Venue page.** `page.goto('/@' + venue.handle)`. `getByText(venue.name)` and `getByText(venue.cardTitle)` are visible.
- **Claim.** `getByRole('button', { name: 'Get your free membership card' }).click()`. `getByRole('img', { name: 'Your membership card QR code for ' + venue.name })` is visible, along with a member number matching `/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{5}$/`.
- **Persists.** `page.reload()`. The QR image is still visible and the claim button is hidden.
- **Claim with source.** `page.goto('/@' + venue.handle + '/' + venue.cardSlug + '?source=verify-flyer')`, then click the button matching `/^Get .*membership card$/`. `apiRequest('/issuers/me/passes', schema, { token: venue.operatorToken })` lists one pass with `source: 'verify-flyer'`.
- **Store display.** `page.goto('/@' + venue.handle + '/home')`. `Scan to get your card`, a link matching `/Get it on this device/` and a `Print this display` button are visible.
- **Unknown venue.** `page.goto('/@nobody-here')`. `No card here` is visible.

## Gotchas

- The claim keeps the pass's secret in browser storage and the vault. A new browser context is a new member, so reload in the same `page` to prove persistence.
- Japanese is the first-visit default. `drive` sets `en-US`, and the names above are the English copy.
- Passkey sign-in (`Sign in with Passkey`) needs an authenticator and is not automated here.
- Apple and Google Wallet saves need real devices and are unverified here.
