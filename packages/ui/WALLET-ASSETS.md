# Wallet artwork

`src/wallet-assets.ts` contains the original SVG bytes encoded as base64 data URLs, so the standalone Pass remains self-contained. Do not redraw, recolor, crop, or apply effects to either provider’s badges.

- Apple English: https://developer.apple.com/assets/elements/badges/add-to-apple-wallet/add-to-apple-wallet.svg
- Apple Japanese: https://developer.apple.com/assets/elements/badges/add-to-apple-wallet/add-to-apple-wallet-jp.svg
- Apple usage guidelines and artwork terms: https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/
- Google official SVG archive: https://developers.google.com/static/wallet/download-assets/add-to-wallet-svg.zip
  - English: `svg/enUS_add_to_google_wallet_wallet-button.svg` (primary).
  - Japanese: `svg/jp_add_to_google_wallet_add-wallet-badge.svg` (condensed to fit narrow screens).
- Google usage guidelines: https://developers.google.com/wallet/generic/resources/brand-guidelines

Both providers render at 48 px high with the original aspect ratio and 8 px clear space on every side. The app centers the badge in the action row. The former standalone Google icon and custom text button are no longer used.

Retrieved 2026-09-11. Apple and Apple Wallet are trademarks of Apple Inc., registered in the U.S. and other countries. Google Wallet is a trademark of Google LLC. These assets are not covered by this repository's MIT license.

The DOM button uses `packages/styles/wallet-button.css`. The standalone API Pass mirrors these few rules in its inline stylesheet because it does not load app CSS.
