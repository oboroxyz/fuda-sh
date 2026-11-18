# Gate scan

Staff at a door scan a member's pass on the gate. A valid pass shows a full-screen green ADMIT. A single-use pass that was already admitted, a pass from another shop, or anything that isn't a fuda pass shows a red REJECT with the reason. A station can be set to one shop and can run with only a desk QR reader and no camera.

## Sub-features

- `scan-admit`: a `fuda:v1:` payload shows `ADMIT`.
- `scan-already-used`: a second admission of a single-use Bearer Right reads `REJECT` with `ALREADY_USED`.
- `scan-unreadable`: input that is not a pass reads `REJECT`, `not a fuda pass`, with no api call.
- `scan-reader`: the gate scans a desk reader's keystrokes and Enter when no field has focus, even while a verdict shows.
- `scan-venue`: `?venue=<handle>` admits that shop's pass and rejects another shop's with `WRONG_VENUE — pass of another shop`.
- `scan-no-venue`: without `?venue`, the header warns `no venue set: any shop's pass is admitted`.

## How to get to it (user POV)

- Open the gate at `/` and paste a pass into the box, then choose `Check`.
- Open `/?camera=off` on a reader-only station and scan with the reader (keystrokes, then Enter).
- Open `/?venue=<handle>` for a station that checks one shop. It can be combined with `camera=off`.
- Tap the verdict (`tap to scan again`) to return to the scanner, or wait 5 seconds (green) or 10 seconds (red).

## Driving it with fuda-verify

Preconditions:

- `fuda-verify up gate` is ready and `fuda-verify doctor` reports `"ok": true`.
- A Bearer Right from `seed.bearer()` for single-use admission, or `seed.pass()` for a venue pass.
- Journey viewport 1024×768, a tablet in landscape.

- **Open scanner.** `page.goto('/')`. The header shows `no venue set: any shop's pass is admitted`, and a textbox named `paste fuda:v1:… or 0x…` with a `Check` button is visible.
- **Admit.** `getByRole('textbox', { name: 'paste fuda:v1:… or 0x…' }).fill(right.qr)`, then `getByRole('button', { name: 'Check' }).click()`. A button whose name matches `/tap to scan again/` contains `ADMIT`.
- **Scan again.** Click that verdict button. The paste box returns.
- **Already used.** Fill the same `qr` and choose `Check`. The verdict contains `REJECT` and `ALREADY_USED`.
- **Side effects.** `d1("select slot from slots where uid = '<uid>'")` returns one row. `d1("select decision, reason, path from entry_log where uid = '<uid>' order by id")` returns `qr ADMIT OK`, then `qr REJECT ALREADY_USED`.
- **Unreadable input.** Fill `hello` and choose `Check`. The verdict contains `REJECT` and `not a fuda pass`, and `entry_log` gets no row.
- **Reader-only station.** `page.goto('/?camera=off')`. The page shows `present your pass` and has no paste box. `page.keyboard.type(right.qr)` and then `page.keyboard.press('Enter')` show a verdict. Typing a second scan while the verdict shows replaces it.
- **Venue station.** `const shop = await seed.pass('Shop A')`, `const other = await seed.venue('Shop B')`. `page.goto('/?venue=' + other.handle)`, so the header shows `checking for @<handle>`. Scanning `shop.qr` shows `WRONG_VENUE`. `page.goto('/?venue=' + shop.handle)` and scanning the same `qr` shows `ADMIT`.
- **Proof.** `packages/e2e/journeys/gate-bearer-once.ts` covers `scan-admit`, `scan-already-used` and `scan-no-venue`, with steps `scanner-ready`, `qr-entered`, `first-scan-admit` and `second-scan-already-used`, plus `slots` and `entryLog` notes.

## Gotchas

- `GET /v1/verify/:uid` is a read-only preview. It never reads or consumes the slot, so it still answers `ADMIT OK` after a single-use admission. Prove consumption from `slots` and `entry_log`, not from the preview.
- A verdict returns to the scanner by itself after 5 seconds (green) or 10 seconds (red). Take the `step` straight after the verdict appears.
- Reader keystrokes go to the page only while no input or textarea has focus. On `/` the paste box takes focus, so test the reader on `/?camera=off`.
- While `checking pass…` shows, a new scan is ignored with `one pass at a time: scan the next pass again after this result`.
- A bare `0x…` uid is a preview, not an admission. Signed passes preview as yellow `VALID — signature required`. Use the `fuda:v1:` payload to prove admission.
- The gate renders in its dark theme whatever the browser's color scheme is. `journey.json` records the theme it found.
- Headless Chromium has no camera. Camera scanning is unverified here.
