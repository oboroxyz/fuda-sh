# Apple Wallet and Google Wallet pass layout and design capabilities

Research date: 2026-09-12

## Scope and source policy

This note compares the current Apple Wallet pass format and Google Wallet Generic pass API for layout and visual customization. It uses only first-party Apple Developer and Google for Developers documentation. The comparison is intentionally based on the pass types fuda currently emits: an Apple `storeCard` and a Google `GenericObject`.

Apple's current documentation includes features announced for iOS 27, such as Poster Generic passes and Featured Actions. Those features are recorded separately and are not treated as capabilities of fuda's existing `storeCard` output.

## Executive summary

Neither wallet is an arbitrary design canvas. The issuer selects a platform pass style and supplies data and supported image assets; Wallet owns the final typography, spacing, truncation, and much of the responsive layout. Apple states that the pass style controls field layout and supported images, while Google exposes template rows that reference fields but limits the card face to at most three configured rows. ([Apple pass metadata](https://developer.apple.com/documentation/walletpasses/defining-the-metadata-of-your-wallet-pass), [Google `ClassTemplateInfo`](https://developers.google.com/wallet/reference/rest/v1/ClassTemplateInfo))

The safe shared model for Dash is therefore semantic rather than pixel-based:

1. a brand background color;
2. issuer logo;
3. a small ordered set of label/value fields with an importance level;
4. supplemental detail text;
5. labeled links;
6. human-readable barcode fallback text;
7. localized strings;
8. optionally, a shared artwork source that is cropped and exported separately for Apple and Google.

Font family, font size, font weight, arbitrary text color shared by both wallets, CSS, and absolute positioning are not part of the common API surface. The Apple `Pass`/`PassFieldContent` schemas and Google's `GenericObject`/`ClassTemplateInfo` schemas contain no custom-font property. Apple exposes foreground and label colors, but Google does not expose their equivalents and renders its own foreground against `hexBackgroundColor`. ([Apple `Pass`](https://developer.apple.com/documentation/walletpasses/pass), [Apple `PassFieldContent`](https://developer.apple.com/documentation/walletpasses/passfieldcontent), [Google `GenericObject`](https://developers.google.com/wallet/reference/rest/v1/genericobject), [Google `ClassTemplateInfo`](https://developers.google.com/wallet/reference/rest/v1/ClassTemplateInfo))

## Current fuda pass types

The current checkout emits:

- Apple Wallet: `storeCard`, with `primaryFields`, `secondaryFields`, and `backFields` in `packages/pass/src/apple/pass-json.ts`.
- Google Wallet: `GenericObject`, with `cardTitle`, `subheader`, `header`, `hexBackgroundColor`, `logo`, and `barcode` in `packages/pass/src/google.ts`.

This matters because supported assets and field layouts are pass-type-specific on both platforms. Apple explicitly says the chosen style determines appearance, field placement, supported images, time window, and relevance behavior. Google likewise defines different Class/Object schemas for each pass vertical. ([Apple Wallet: Get started](https://developer.apple.com/wallet/get-started/), [Google Classes and Objects overview](https://developers.google.com/wallet/generic/overview/how-classes-objects-work))

## Capability matrix

| Capability | Apple Wallet `storeCard` | Google Wallet `GenericObject` | Common Dash abstraction |
| --- | --- | --- | --- |
| Background color | `backgroundColor` uses a CSS-style RGB triple. | `hexBackgroundColor`; when omitted, Google derives a color from hero image, logo, or its own choice. | One `#RRGGBB` brand color, converted for Apple. |
| Foreground and label colors | `foregroundColor` and `labelColor` are supported. | No corresponding fields in the Generic Object or template schema. | Do not expose as a cross-wallet setting; derive safe Apple colors and let Google render its foreground. |
| Logo | Embedded PNG assets such as `logo.png`; logo is shown in the top leading area. | `logo` is a remote `Image`; it appears on the card and list views, with the first letter of `cardTitle` as fallback. `wideLogo` can replace it on the card. | Existing issuer logo setting. Export/embed Apple variants and publish the Google image URL. |
| Prominent artwork | A store card supports `strip.png` at 375 × 144 pt; primary text can overlay it. Apple warns that pass appearance differs by OS/device, and Apple Watch omits strip images. | `heroImage` is a 100%-width front image. Current guidance recommends PNG at 1032 × 812 px (about 5:4) and supplies a category fallback if absent. | Optional artwork source with separate crop previews and platform-specific outputs; never promise identical composition. |
| Additional imagery | The store-card face has the pass-style-specific logo, icon, and strip slots; no arbitrary image module exists. | `imageModulesData` supplies a 100%-width image in the details area; one class-level and one object-level image can render. | Not a true common feature beyond the main artwork slot. |
| Front label/value fields | Fields are grouped by semantic importance (`headerFields`, `primaryFields`, `secondaryFields`, `auxiliaryFields`). A store card allows up to four secondary and auxiliary fields combined on one row; text length may cause fields not to display. | Developer-defined `textModulesData` can be referenced by `cardTemplateOverride`. The card override allows at most three rows, with one, two, or three items per row. | Ordered fields plus `primary`/`supporting` importance; compile into platform layouts and enforce the stricter preview/content limits. |
| Detail text | `backFields` can hold additional, noncritical information; the store-card guide says the back can have as many fields as needed and longer content. | `textModulesData` renders up to 10 class-level and 10 object-level items; `detailsTemplateOverride` controls their order. Recommended module lengths are 35 characters for a header and 500 for a body. | Ordered detail sections with conservative validation and platform-specific hard limits. |
| Links and calls to action | A back-field `attributedValue` supports only an HTML `<a href>` link; back fields also support URL/phone/address/calendar data detection. | `linksModuleData` supplies labeled URIs; up to 10 class-level and 10 object-level link fields render. `appLinkData` can add a front button with localized text limited to 30 characters. | Labeled web links in pass details. Treat front CTAs as a later enhancement because the Apple equivalent is version/style-specific. |
| Text alignment | `textAlignment` supports left, center, right, and natural, but is invalid for primary and back fields. | Alignment follows the row position: a one-item row is centered; two/three-item rows align start/middle/end. There is no arbitrary per-field alignment. | Infer alignment from field count and order; do not expose a universal alignment control. |
| Date/number presentation | A field may specify date/time styles, relative-date behavior, time-zone handling, number style, and currency code. | A template field reference may select one of the documented date formats. | Store typed values when product semantics require them, but compile formatting separately; do not offer free-form format strings. |
| Barcode | Supports multiple barcode entries and QR, PDF417, Aztec, Code 128, Code 39, Codabar, EAN-13, and ITF. Barcode metadata includes alternate text. | `barcode` selects type/value/encoding and `alternateText`; `cardBarcodeSectionDetails` can place referenced fields above and below it. | Barcode type/value plus a human-readable fallback label. Keep Google-only barcode-section layout out of the shared MVP. |
| Localization | A pass bundle can contain locale-specific `pass.strings` and localized image files. | `LocalizedString` contains a default and BCP 47-tagged translations; text modules also have localized header/body properties. | Localized text values by BCP 47 locale, with one required default locale. Image localization should be a later, explicit feature. |
| Expiration/state appearance | `expirationDate` and `voided` influence pass state; relevance dates affect when a pass is surfaced. | `validTimeInterval` affects expired rendering and `state` moves inactive objects to Expired passes. | Product validity/state should remain canonical and feed both outputs; it is not merely a design setting. |

Sources for the matrix: [Apple `Pass`](https://developer.apple.com/documentation/walletpasses/pass), [Apple `PassFieldContent`](https://developer.apple.com/documentation/walletpasses/passfieldcontent), [Apple store-card guide](https://developer.apple.com/documentation/walletpasses/creating-a-store-card-pass), [Apple Wallet HIG](https://developer.apple.com/design/human-interface-guidelines/wallet), [Apple source/localization guide](https://developer.apple.com/documentation/walletpasses/creating-the-source-for-a-pass), [Apple barcodes](https://developer.apple.com/documentation/walletpasses/pass/barcodes-data.dictionary), [Google `GenericObject`](https://developers.google.com/wallet/reference/rest/v1/genericobject), [Google `ClassTemplateInfo`](https://developers.google.com/wallet/reference/rest/v1/ClassTemplateInfo), [Google pass customization](https://developers.google.com/wallet/retail/offers/use-cases/pass-customization), [Google brand guidelines](https://developers.google.com/wallet/generic/resources/brand-guidelines), [Google `TextModuleData`](https://developers.google.com/wallet/reference/rest/v1/TextModuleData), [Google `ImageModuleData`](https://developers.google.com/wallet/reference/rest/v1/ImageModuleData), [Google `Barcode`](https://developers.google.com/wallet/reference/rest/v1/Barcode), [Google `LocalizedString`](https://developers.google.com/wallet/reference/rest/v1/LocalizedString), [Google `AppLinkData`](https://developers.google.com/wallet/reference/rest/v1/AppLinkData).

## Apple Wallet details and constraints

### Layout is pass-style-owned

Apple supports boarding pass, coupon, event ticket, store card, and generic styles. A style determines the visual template and supported image slots; developers cannot add a new pass style or freely reposition fields. In the current store-card style, secondary and auxiliary fields share a single row and only four can appear in total. Long values can make Wallet omit fields, so a Dash preview must present possible truncation/omission rather than claim pixel fidelity. ([Apple Wallet: Get started](https://developer.apple.com/wallet/get-started/), [Apple store-card guide](https://developer.apple.com/documentation/walletpasses/creating-a-store-card-pass))

Apple's fields carry a unique key, optional label, and a string/date/number value. The API adds platform formatting for dates, times, relative dates, time zones, numbers, and currencies. Alignment is available only for eligible front fields. Update notifications can interpolate a changed field value through `changeMessage`, but that property is not used on watchOS. ([Apple `PassFieldContent`](https://developer.apple.com/documentation/walletpasses/passfieldcontent))

### Colors and images

The pass schema exposes `backgroundColor`, `foregroundColor`, and `labelColor`; there is no font-family or font-size key. Store cards support logo, icon, and strip artwork. Apple's current HIG specifies a 375 × 144 pt strip and advises keeping the text area uncluttered and maintaining contrast because primary text may overlay it. Text and barcodes should not be baked into images because embedded text is inaccessible and images may not appear on every device. ([Apple `Pass`](https://developer.apple.com/documentation/walletpasses/pass), [Apple Wallet HIG](https://developer.apple.com/design/human-interface-guidelines/wallet))

Apple explicitly warns that passes can differ by device, with fewer fields and images on Apple Watch. The store-card guide states that Apple Watch omits the strip image and back-of-pass information. Essential information must therefore remain in platform text fields and the barcode, not only in artwork or detail fields. ([Apple Wallet HIG](https://developer.apple.com/design/human-interface-guidelines/wallet), [Apple store-card guide](https://developer.apple.com/documentation/walletpasses/creating-a-store-card-pass))

### Details, links, localization, and updates

Back fields are available to every pass type for noncritical information in Pass Details. `attributedValue` supports a link using only the `<a>` tag and `href`; it overrides plain `value` and is not used on watchOS. Data detectors can recognize phone numbers, links, addresses, and calendar events in back fields. ([Apple pass metadata](https://developer.apple.com/documentation/walletpasses/defining-the-metadata-of-your-wallet-pass), [Apple `PassFieldContent`](https://developer.apple.com/documentation/walletpasses/passfieldcontent))

Text and images can be localized through language/region `.lproj` directories and `pass.strings`. The pass update service can update installed pass content and use push notifications to prompt retrieval of the latest pass. ([Apple source/localization guide](https://developer.apple.com/documentation/walletpasses/creating-the-source-for-a-pass), [Apple Wallet: Get started](https://developer.apple.com/wallet/get-started/))

### Apple-only or future-style capabilities

- Apple can surface passes using up to 10 geographic locations, BLE beacons, and relevant date intervals. ([Apple `Pass`](https://developer.apple.com/documentation/walletpasses/pass), [Apple Lock Screen relevance](https://developer.apple.com/documentation/walletpasses/showing-a-pass-on-the-lock-screen))
- Semantic tags let the system understand pass content and suggest related actions; they are not arbitrary visual controls. ([Apple semantic tags](https://developer.apple.com/documentation/walletpasses/supporting-semantic-tags-in-wallet-passes))
- iOS/watchOS 27 introduces Poster Generic, a full-art generic style with a header, up to four primary fields, up to two footer fields, additional information, and up to two Featured Actions. It requires a legacy pass style in the package for older OS fallback. Migrating fuda's existing store card to this style is therefore a separate compatibility/product decision, not a small design-field addition. ([Apple poster-generic guide](https://developer.apple.com/documentation/walletpasses/creating-a-poster-generic-pass), [Apple What's new in Wallet](https://developer.apple.com/wallet/whats-new/), [WWDC26: What's new in Wallet](https://developer.apple.com/videos/play/wwdc2026/209/))
- Apple supports `sharingProhibited`, but its own schema notes that it only removes Wallet's Share button and cannot prevent all other sharing. ([Apple `Pass`](https://developer.apple.com/documentation/walletpasses/pass))

## Google Wallet details and constraints

### Class/Object split and layout overrides

Google separates shared template data in a Passes Class from per-holder data in a Passes Object. Changes to class data propagate to objects that reference that class. For Generic passes, `GenericClass.classTemplateInfo` owns the layout overrides, while content can live at class or object level. If no class template is set, Google uses its default fields. ([Google Classes and Objects overview](https://developers.google.com/wallet/generic/overview/how-classes-objects-work), [Google `GenericClass`](https://developers.google.com/wallet/reference/rest/v1/genericclass))

`cardTemplateOverride` can define at most three rows. Each row has exactly one of the one-, two-, or three-item shapes. Each item references a predefined field or a custom field such as `object.textModulesData['id']`; multiple fallback references may be supplied, of which Google displays the first nonempty field. `detailsTemplateOverride` controls Pass Details ordering, `listTemplateOverride` controls list-view rows, and `cardBarcodeSectionDetails` adds referenced information around the barcode. ([Google `ClassTemplateInfo`](https://developers.google.com/wallet/reference/rest/v1/ClassTemplateInfo), [Google pass customization](https://developers.google.com/wallet/retail/offers/use-cases/pass-customization))

The Generic Object always requires `cardTitle` and `header`, which occupy the top/header and title regions. Its schema has no custom typography or foreground-color controls. Dash should offer content priority and row grouping, not an HTML/CSS designer. ([Google `GenericObject`](https://developers.google.com/wallet/reference/rest/v1/genericobject))

### Content modules and images

Custom text is supplied through `textModulesData`; Google displays at most 10 entries from the class and 10 from the object. Google recommends headers of at most 35 characters and bodies of at most 500 characters for smaller screens. Its newer pass-creation guidance recommends keeping card-face labels and values substantially shorter and using no more than two fields per row and three rows when possible. ([Google `GenericObject`](https://developers.google.com/wallet/reference/rest/v1/genericobject), [Google `TextModuleData`](https://developers.google.com/wallet/reference/rest/v1/TextModuleData), [Google brand guidelines](https://developers.google.com/wallet/generic/resources/brand-guidelines))

`heroImage` renders at full width on the front. Current guidance recommends a 1032 × 812 px PNG with about a 5:4 ratio and warns against embedding text because it will not localize. `imageModulesData.mainImage` is another 100%-width image below the hero in Pass Details; when both class and object images are supplied, only one from each level renders. ([Google `GenericObject`](https://developers.google.com/wallet/reference/rest/v1/genericobject), [Google `ImageModuleData`](https://developers.google.com/wallet/reference/rest/v1/ImageModuleData), [Google brand guidelines](https://developers.google.com/wallet/generic/resources/brand-guidelines))

Google logo images are URI-based and may include a localized accessibility description. The standard logo is masked into a circle and Google recommends at least 660 × 660 px with a 15% safe margin. A transparent 16:5 `wideLogo`, recommended at 1280 × 400 px, is also supported and replaces the ordinary logo on the card. ([Google `Image`](https://developers.google.com/wallet/reference/rest/v1/Image), [Google brand guidelines](https://developers.google.com/wallet/generic/resources/brand-guidelines), [Google `GenericObject`](https://developers.google.com/wallet/reference/rest/v1/genericobject))

### Google-only capabilities

- Google can independently override card, pass-list, details, and barcode-section layouts. Apple has no equivalent issuer-controlled list-view template. ([Google `ClassTemplateInfo`](https://developers.google.com/wallet/reference/rest/v1/ClassTemplateInfo))
- `appLinkData` can put a localized web/app button on the pass face; `linksModuleData` provides additional labeled links. ([Google `GenericObject`](https://developers.google.com/wallet/reference/rest/v1/genericobject), [Google `AppLinkData`](https://developers.google.com/wallet/reference/rest/v1/AppLinkData), [Google `LinksModuleData`](https://developers.google.com/wallet/reference/rest/v1/LinksModuleData))
- `rotatingBarcode`, `messages`, and validity/upcoming notifications are available on the Generic Object. Expiry notification is two days before expiry; upcoming notification is one day before validity and expiry takes precedence if both are set. ([Google `GenericObject`](https://developers.google.com/wallet/reference/rest/v1/genericobject))
- `passConstraints.screenshotEligibility` can request that Android disallow screenshots, with the explicit caveat that older Wallet versions may still allow them. ([Google `PassConstraints`](https://developers.google.com/wallet/reference/rest/v1/PassConstraints))
- Merchant locations can trigger a notification within a Google-controlled radius, with up to 10 locations on the object. ([Google `GenericObject`](https://developers.google.com/wallet/reference/rest/v1/genericobject))

## Recommended shared feature boundary for a Dash plan

### Phase 1: low-risk common capabilities

1. **Front-field editor** — a small ordered set of label/value rows with `primary` or `supporting` importance. Compile primary/supporting into Apple store-card fields and Google text modules/template rows. Preserve system-owned fields such as member number and verification payload; do not let issuer configuration hide security-critical or redemption-critical values.
2. **Details editor** — ordered label/body entries compiled into Apple `backFields` and Google `textModulesData`, with conservative shared length/count validation and platform warnings.
3. **Links editor** — labeled HTTPS links compiled into Apple linked back fields and Google `linksModuleData`. Start in the details view on both platforms instead of exposing Google-only front buttons.
4. **Barcode fallback text** — one human-readable value shown when scanning fails, mapped to each platform's alternate-text field.
5. **Preview constraints** — show Apple and Google previews side by side and label them as representative. Warn that device, OS, text length, locale, and accessibility text size can change the final layout.

Background color and issuer logo already fit this common boundary and should remain shared issuer-level branding unless product requirements deliberately make them card-specific.

### Phase 2: common intent, platform-specific rendering

6. **Card artwork** — accept one source image, then require/offer separate Apple strip and Google hero crops. Generate Apple embedded PNG variants and a remotely served Google asset with localized accessibility text. Essential text must stay outside the image.
7. **Localization** — add default-locale plus translated strings to the shared content model and emit Apple localization bundles and Google `LocalizedString` values.
8. **Typed date/number fields** — add only when there is a product-level semantic requirement; map to each platform's native formatter instead of saving display-ready text alone.

### Keep outside the common editor

- font family, font size, weight, line height, letter spacing, CSS, and absolute positioning;
- user-selected foreground/label text colors (Apple-only);
- Google-only list/details/barcode template controls, wide logo, front app-link button, messages, rotating barcode, and screenshot constraints;
- Apple-only beacons, semantic tags, Featured Actions, and Poster Generic artwork;
- switching Apple pass style or Google pass vertical, which changes protocol and compatibility semantics rather than only appearance.

## Design implications for implementation planning

- Use a wallet-neutral content model and two renderers. Do not persist raw Apple field arrays or Google `ClassTemplateInfo` as the Dash domain model.
- Validate to the common safe subset, then apply platform-specific limits again in each renderer.
- Treat previews as two platform previews, not a single supposedly identical card.
- Store artwork source/crop metadata separately from generated assets. Apple packages images into each signed `.pkpass`; Google consumes an HTTPS image URI.
- Decide explicitly whether card-design changes apply only to future issuance or also update already-saved passes. Apple requires its pass update web service for installed-pass refreshes; Google class changes can propagate, while object changes require API updates. ([Apple Wallet: Get started](https://developer.apple.com/wallet/get-started/), [Google Classes and Objects overview](https://developers.google.com/wallet/generic/overview/how-classes-objects-work), [Google Generic Object update methods](https://developers.google.com/wallet/reference/rest/v1/genericobject))

The present repository configuration has one deployment-wide `GOOGLE_CLASS_ID`, and generated save JWTs contain a `GenericObject` that only references that existing class. Because Google puts `classTemplateInfo` on `GenericClass`, not `GenericObject`, per-card free-form row layouts cannot be added only by extending the current object payload. The implementation plan must choose between:

1. keeping one shared Generic Class with stable, predefined slot IDs that every object may fill; or
2. provisioning and maintaining a Generic Class per fuda card so each card can own its layout.

The first option is materially smaller and fits a constrained common editor. The second permits truly card-specific Google layouts but adds class lifecycle, approval, update, and failure handling to card creation and editing. This is an inference from the current repository's `packages/pass/src/google.ts` and `docs/runbook.md`, combined with Google's documented Class/Object split and placement of `classTemplateInfo`. ([Google `GenericClass`](https://developers.google.com/wallet/reference/rest/v1/genericclass), [Google `GenericObject`](https://developers.google.com/wallet/reference/rest/v1/genericobject))

## Primary-source index

### Apple

- [Wallet: Get started](https://developer.apple.com/wallet/get-started/)
- [Wallet Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/wallet)
- [Wallet Passes overview](https://developer.apple.com/documentation/walletpasses)
- [`Pass` dictionary](https://developer.apple.com/documentation/walletpasses/pass)
- [`PassFields`](https://developer.apple.com/documentation/walletpasses/passfields)
- [`PassFieldContent`](https://developer.apple.com/documentation/walletpasses/passfieldcontent)
- [Defining pass metadata](https://developer.apple.com/documentation/walletpasses/defining-the-metadata-of-your-wallet-pass)
- [Creating a store card pass](https://developer.apple.com/documentation/walletpasses/creating-a-store-card-pass)
- [Creating a generic pass](https://developer.apple.com/documentation/walletpasses/creating-a-generic-pass)
- [Creating a poster generic pass](https://developer.apple.com/documentation/walletpasses/creating-a-poster-generic-pass)
- [Creating pass source and localization](https://developer.apple.com/documentation/walletpasses/creating-the-source-for-a-pass)
- [Supporting semantic tags](https://developer.apple.com/documentation/walletpasses/supporting-semantic-tags-in-wallet-passes)
- [Showing a pass on the Lock Screen](https://developer.apple.com/documentation/walletpasses/showing-a-pass-on-the-lock-screen)
- [What's new in Apple Wallet](https://developer.apple.com/wallet/whats-new/)
- [WWDC26: What's new in Wallet](https://developer.apple.com/videos/play/wwdc2026/209/)

### Google

- [Passes Classes and Objects overview](https://developers.google.com/wallet/generic/overview/how-classes-objects-work)
- [`GenericClass`](https://developers.google.com/wallet/reference/rest/v1/genericclass)
- [`GenericObject`](https://developers.google.com/wallet/reference/rest/v1/genericobject)
- [`ClassTemplateInfo`](https://developers.google.com/wallet/reference/rest/v1/ClassTemplateInfo)
- [Customize Google Wallet passes](https://developers.google.com/wallet/retail/offers/use-cases/pass-customization)
- [Generic pass brand guidelines](https://developers.google.com/wallet/generic/resources/brand-guidelines)
- [`TextModuleData`](https://developers.google.com/wallet/reference/rest/v1/TextModuleData)
- [`ImageModuleData`](https://developers.google.com/wallet/reference/rest/v1/ImageModuleData)
- [`Image`](https://developers.google.com/wallet/reference/rest/v1/Image)
- [`LinksModuleData`](https://developers.google.com/wallet/reference/rest/v1/LinksModuleData)
- [`AppLinkData`](https://developers.google.com/wallet/reference/rest/v1/AppLinkData)
- [`Barcode`](https://developers.google.com/wallet/reference/rest/v1/Barcode)
- [`LocalizedString`](https://developers.google.com/wallet/reference/rest/v1/LocalizedString)
- [`PassConstraints`](https://developers.google.com/wallet/reference/rest/v1/PassConstraints)
