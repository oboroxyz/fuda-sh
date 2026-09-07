# Venue logo on R2 — design

Status: active temporary artifact (`.agents/rules/superpowers-policy.md`).
Decisions below were made by the agent and are flagged to the user in the
hand-off. Written from scratch in this repository.

## Problem

A venue's card carries its name, title and brand colour but no mark. Three
surfaces want one, and they want it in two different forms:

| Surface | Needs | Form |
| --- | --- | --- |
| Google Wallet object | `logo` | a public HTTPS URL |
| Apple `.pkpass` | `logo.png`, `logo@2x.png`, `logo@3x.png` | raw PNG bytes inside the archive |
| Web pass, venue page, dashboard preview | the mark | a public HTTPS URL |

So the api must both serve a URL and read the bytes back server-side. R2 is
the store; D1 keeps only a reference.

## Decisions

1. **The logo belongs to the issuer, not the card.** It is the venue's mark,
   and Apple renders it in the pass header where the organisation belongs. Per
   event artwork is a different asset (Apple `strip`, Google `heroImage`) and
   is out of scope; the schema leaves room for it by keying the asset prefix on
   the issuer row rather than inventing a shared table.
2. **The browser produces the variants; the api validates and stores them.**
   Workers have no image decoder, and adding Cloudflare Images would introduce
   a paid product and a second binding for one feature. The dashboard draws the
   source image onto a canvas and exports a fixed set of square PNGs. Because
   the client then controls the pixels, the api re-checks every object rather
   than trusting it: PNG signature and IHDR are parsed directly (no decoder
   needed) for the exact expected dimensions, plus per-object and per-set byte
   caps.
3. **Four variants.** `master` 1024×1024 serves Google and every web surface
   (Google wants at least 660 square). `logo1x` 50×50, `logo2x` 100×100 and
   `logo3x` 150×150 go into the `.pkpass`, sized for Apple's 160×50 pt logo
   area at a square aspect. Embedding the master in the archive instead would
   add roughly a megabyte to every pass, which is why the small ones exist.
   The Apple `icon.png` keeps today's synthetic mark; making the venue logo the
   icon is a later, additive change.
4. **Objects are immutable and content-addressed by a per-upload prefix**
   (`logos/<uuid>/<variant>.png`). Replacing a logo writes a new prefix and
   repoints the issuer; no object is ever overwritten in place.

   The public route is keyed by the handle, not the prefix, so that a printed
   link survives a change — which means the URL alone cannot identify the
   mark, and a one-year immutable answer would strand the old one in caches.
   The api therefore hands out `?v=<prefix uuid>` and caches only a request
   naming the current version forever; anything else gets sixty seconds.
   Clients never assemble the URL, they use the `logoUrl` the api returns.
5. **Upload is two-phase**, because the first logo is chosen before the venue
   exists. `POST /issuers/logo` (session) stores the objects and records a
   pending row with a 15-minute expiry; `POST /issuers` and the logo-replacing
   route commit it and bind the prefix to the issuer. An uncommitted row and
   its objects are swept opportunistically on the next upload, the way
   `challenges` are swept on mint, so no cron is introduced.
6. **The bucket is private; a route serves it.** `GET /assets/:handle/logo/:variant`
   resolves the prefix from the issuer row against a fixed variant allowlist
   and never accepts a caller-supplied key. It answers an ETag and honours
   `if-none-match`.
7. **Absent configuration fails closed, and onboarding still works.** Without
   the `MEDIA_BUCKET` binding the upload route answers
   `501 media_not_configured`, exactly as the wallet platforms do without their
   secrets. A venue with no logo keeps today's appearance everywhere.

## Shape

D1 (`0008_venue_logo.sql`): `issuers.logo_prefix TEXT` nullable, and
`logo_uploads(id PK, session_token_hash, asset_prefix, status, created_at,
expires_at)`.

Routes: `POST /issuers/logo` (session, multipart, → `{ logoUploadId, expiresAt }`),
`POST /issuers/logo/commit` (session, → the updated issuer) for a venue that
already exists, and public `GET /assets/:handle/logo/:variant`.
`POST /issuers` accepts an optional `logoUploadId`.

Error codes: `media_not_configured` (501), `bad_upload` (400, malformed
multipart or a variant that fails signature, dimension or size checks),
`upload_not_found` (400, an id that is unknown, expired, committed, or belongs
to another session).

`PassBranding` gains `logoUrl: string | null`; the Google object gets `logo`,
the Apple builder pulls the three small variants from R2 and adds them to the
archive, and the web pass renders the master.

## Out of scope

Per-event artwork; the Apple icon; animated or non-PNG sources beyond what the
browser can decode onto a canvas; a public R2 custom domain.

## External gate

`wrangler r2 bucket create fuda-media` and the binding must exist before this
ships. Everything fails closed until then.
