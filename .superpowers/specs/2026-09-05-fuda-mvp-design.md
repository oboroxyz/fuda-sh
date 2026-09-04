# fuda — MVP Implementation Spec

- **Status**: implementation-ready. This spec leaves zero design decisions to
  the implementer: every schema string, endpoint shape, table, derivation, and
  deploy step is pinned. Stretch work (sponsor integrations, distribution,
  pass customization) lives in sibling specs and attaches to the hooks defined
  here.

## What fuda is

fuda issues **membership rights as on-chain attestations** and verifies them at
a physical gate. A right lives on [EAS](https://attest.org) (Base Sepolia) as an
`Entitlement` attestation; the gate reads the chain directly — no fuda server
has to be trusted for the admit decision. Members hold their right at one of
two **verification levels** — Bearer or Signed — and Signed can carry the
**+Private** extension; the issuer chooses per right. Code and the on-chain
`level` field enumerate the three resulting states (`CONTEXT.md`):

- **Bearer** — no wallet, no app. The member gets a wallet pass (Apple/Google)
  with a QR code; the gate scans it and reads the chain. The right is issued to
  a counterfactual smart-wallet address the member can activate later.
- **Signed** — self-custody. The member's wallet (passkey smart wallet or EOA)
  signs a one-time gate challenge; possession of the key is proven at the door.
- **+Private** — Signed, unlinkable. The right is issued to a one-time **stealth
  address** (ERC-5564) and enters through the same signed challenge. On-chain
  observers cannot link the right to the member;
  the member discovers it by scanning announcements with a passkey-derived
  viewing key, entirely client-side.

The MVP loop demonstrated to judges:
**issue → wallet pass → gate verify (Bearer, Signed, +Private) → on-chain entry
evidence (Attendance attestation + stealth announcements)** — the last item is
the attach surface for the sponsor integrations.

## Stack and repo layout

- **Runtime**: Cloudflare Workers. API = [Hono](https://hono.dev) +
  [Drizzle](https://orm.drizzle.team) + D1 (SQLite). Frontends = Vite+ (`vp`) + hono/jsx
  (or React — implementer's familiarity wins; screens are specified below,
  framework is not load-bearing). Styling: plain Tailwind + daisyUI defaults —
  no custom design system, no i18n.
- **Chain access**: [viem](https://viem.sh). Crypto:
  `@noble/curves` (secp256k1), `@noble/hashes` (sha256, hkdf, keccak).
- **Workspace**: pnpm monorepo.

```
apps/
  api/    Cloudflare Worker — issuance, verification, passes, announcements
  app/    member app — Signed signing, +Private passkey + discovery
  dash/   operator dashboard — issue, revoke, member list
  gate/   scanner — QR camera scan → verify
packages/
  sdk/     shared types + input validation (valibot)
  stealth/ +Private crypto core (`@fuda/stealth`): derivation, stealth math, scan
  pass/    Apple .pkpass + Google Wallet pass builders (`@fuda/pass`)
docs/    this spec + sibling specs
```

### Toolchain (per app)

Pinned here like everything else — no toolchain decisions are left to the
build days. Lint and format run through **Vite+** (`vite-plus`), which ships
the Oxc lint/format engines inside one unified CLI — so dev, build, test,
lint, and format all run through a single toolchain, configured once at the
workspace root.

| Package        | Toolchain                                                                                                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`     | Hono + Drizzle on workerd. `wrangler dev` (local D1) / `wrangler deploy`; migrations: `drizzle-kit generate` → `wrangler d1 migrations apply`. Tests: `vp test` (Vitest) via `@cloudflare/vitest-pool-workers` (real D1 in workerd) |
| `apps/app`     | hono/jsx (tsx) + Tailwind v4 (`@tailwindcss/vite`) + daisyUI on the Vite+ pipeline: `vp dev` / `vp build && wrangler deploy` (static-assets Worker). Unit tests: `vp test`                                          |
| `apps/dash`    | Same Vite+ pipeline as `apps/app`                                                                                                                                                                                       |
| `apps/gate`    | No build step: a static `public/` directory served by a Worker (`wrangler dev` / `wrangler deploy`). Promote to the Vite+ pipeline only if the scanner outgrows a single page                                           |
| `packages/*`   | TypeScript source consumed directly through the workspace (`exports` point at `src/`, no build/publish step). Unit tests: `vp test`                                                                                     |
| Workspace root | pnpm monorepo (pnpm pinned via `packageManager`, Node provisioned by `devEngines.runtime`), TypeScript throughout, Node scripts run through `tsx`. Dev/build/test/lint/format: Vite+ (`vp`), configured once in the root `vite.config.ts` |

**Naming (binding):** two vocabularies, never mixed (see `CONTEXT.md`):
**level** = the verification level baked into a right at issuance —
`'bearer' | 'signed' | 'private'` in code (`members.level`, `/issue`
responses; the on-chain `uint8 level`); **path** = how an entry was made —
`'qr' | 'signature'` (`entry_log.path`, `/verify-signed` responses). A
+Private entry is a `signature`-path entry made with a stealth key (§7).
The word `mode` is not used for either concept (the `x-auth-mode`
response header is unrelated). The stealth package is `@fuda/stealth`. The
signed-verify endpoint is `/verify-signed`. The HKDF domain salt is
`fuda.sh/stealth/v1`.

---

## 1. On-chain foundation (EAS, Base Sepolia)

Fixed addresses (Base Sepolia predeploys + canonical singletons):

| Contract           | Address                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| EAS                | `0x4200000000000000000000000000000000000021`                             |
| SchemaRegistry     | `0x4200000000000000000000000000000000000020`                             |
| ERC-5564 Announcer | `0x55649E01B5Df198D18D95b5cc5051630cfD45564`                             |
| Chain / RPC        | Base Sepolia; `BASE_RPC_URL` secret, fallback `https://sepolia.base.org` |

Three schemas, registered once by `apps/api/scripts/register-schemas.ts`
(idempotent — schema UIDs are deterministic:
`keccak256(encodePacked(['string','address','bool'], [schema, resolver, revocable]))`
with `resolver = 0x0` and `revocable = true` for all three). The script prints
the UIDs; paste them into `wrangler.jsonc` `vars.EAS_SCHEMAS`.

**Schema versioning seam.** EAS schemas are immutable at the protocol level —
a revision is always a NEW schema UID coexisting with the old one. The MVP
therefore treats each configured schema as an **accepted-version set**
(`[{ uid, version }]`, one entry at launch) rather than a single UID, and
decodes through a per-version codec that upcasts to one canonical internal
type (`decodeEntitlementV1 → toCanonical`; the upcast is the identity function
for v1). Issuance always writes the newest version; verification accepts the
set — so a future v2 schema is added by appending a map entry and a codec,
with zero changes to gate logic. Multi-version machinery (deprecation
policies, refUID supersession chains, touch-time migration) is deliberately
NOT in the MVP; only this seam is.

**Entitlement** (the membership right):

```
address holder,address issuer,uint8 usageModel,uint8 tier,uint8 level,bytes32 serial,uint64 validFrom,uint64 validUntil,string metaURI
```

- `usageModel`: `0 = SINGLE_USE, 1 = MULTI_USE, 2 = METERED`; values `> 2`
  fail closed at the gate (`UNKNOWN_USAGE_MODEL`).
- `tier`: `0 = FREE, 1 = REGULAR, 2 = VIP, 3 = FOUNDER`.
- `level`: the verification level the right was issued at —
  `0 = bearer, 1 = signed, 2 = private`. **Binding at the gate (§6):** the
  QR path (`POST /verify`) admits only `level == 0`; any `level >= 1` right
  presented as a bare QR is `REJECT LEVEL_REQUIRED` — a photo or copied uid
  of a Signed/+Private pass never admits. `/verify-signed` accepts every
  level (an activated Bearer right entering by signature is a legitimate
  upgrade). Because the value lives in the attestation, any verifier — not
  only fuda's api — can enforce it. `/issue` sets it from the issuance level;
  it is never taken from the request.
- `validFrom`/`validUntil`: unix seconds; `0` = unbounded on that side.
- Attested with `recipient = holder`, `revocable = true`,
  `refUID = <the root IssuerDelegation UID>` (see below).

**IssuerDelegation** (who may issue — the gate only admits rights from
delegated issuers):

```
address issuer,bool active,string name
```

One root delegation is attested at setup time (issuer = the fuda signer,
`active = true`), its UID recorded in `wrangler.jsonc` as `DELEGATION_UID`. At
verify time the gate loads the Entitlement's `refUID`, checks it is a
non-revoked IssuerDelegation whose attester is the configured root
(`ISSUER_ADDRESS`), `active = true`, and whose `issuer` field equals the
Entitlement's attester. The delegation's schema is checked against the
IssuerDelegation **accepted-version set** (same seam as above), so an
Entitlement may reference a delegation attested under an older schema
version. Failure reasons: `NO_DELEGATION`,
`ISSUER_NOT_DELEGATED`, `DELEGATION_UNAVAILABLE` (RPC error → fail closed),
`DELEGATION_CONFIG_MISSING`.

**Attendance** (the entry record — the sponsor hook, see §8):

```
bytes32 rightUID,address holder,uint64 enteredAt,bytes32 slotId
```

Issuance is **synchronous**: `/issue` submits the attestation transaction and
waits for the receipt before responding (no write-behind queue in the MVP
— and for +Private the announcement needs the confirmed UID anyway, so
synchronous attest removes the deferred-announce dance entirely).

## 2. Data model (D1)

```sql
CREATE TABLE members (
  attestation_uid TEXT PRIMARY KEY,          -- 0x…64; one row per issued right
  member_id       TEXT NOT NULL DEFAULT '',  -- the member's persistent id: operator-chosen id (bearer), holder address (signed), optional representative id (private, '' if none); NOT unique — one member may hold many rights
  holder          TEXT,                      -- the attested address (bearer/signed); NULL for private rows — the stealth address is never stored (uid → chain if ever needed)
  level           TEXT NOT NULL,             -- 'bearer' | 'signed' | 'private' (mirror of the on-chain `level`)
  tier            INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'revoked'
  created_at      INTEGER NOT NULL           -- unix seconds
);
CREATE INDEX members_holder ON members(holder);
CREATE INDEX members_member_id ON members(member_id);

CREATE TABLE rate_limits (                    -- per-IP fixed-hourly-window budget (§3, day-1 middleware; MVP applies it to GET /announcements only)
  ip           TEXT NOT NULL,
  window_start INTEGER NOT NULL,             -- unix seconds, floor(now / 3600) * 3600
  count        INTEGER NOT NULL,
  PRIMARY KEY (ip, window_start)
);

CREATE TABLE challenges (
  nonce      TEXT PRIMARY KEY,               -- 0x + 32 hex (16 random bytes)
  uid        TEXT NOT NULL,                  -- the Entitlement uid this challenge is for
  created_at INTEGER NOT NULL,
  used_at    INTEGER                          -- NULL until consumed (one-time)
);

CREATE TABLE slots (                          -- SINGLE_USE consumption
  uid         TEXT NOT NULL,
  slot        TEXT NOT NULL,                  -- 'default' in the MVP
  consumed_at INTEGER NOT NULL,
  PRIMARY KEY (uid, slot)
);

CREATE TABLE entry_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  uid      TEXT NOT NULL,
  decision TEXT NOT NULL,                     -- 'ADMIT' | 'REJECT'
  reason   TEXT NOT NULL,                     -- see §6 reason table
  path     TEXT NOT NULL,                     -- 'qr' | 'signature' (entry path, not the right's level)
  at       INTEGER NOT NULL,
  attendance_uid TEXT                          -- written back after the Attendance attest lands
);

CREATE TABLE announcements (                  -- ERC-5564 log cache served to clients
  tx_hash           TEXT NOT NULL,
  log_index         INTEGER NOT NULL,
  block_number      INTEGER NOT NULL,
  scheme_id         INTEGER NOT NULL,
  stealth_address   TEXT NOT NULL,
  caller            TEXT NOT NULL,
  ephemeral_pub_key TEXT NOT NULL,
  metadata          TEXT NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE TABLE sync_state (                     -- announcements sync cursor
  key   TEXT PRIMARY KEY,                     -- 'announcements'
  value INTEGER NOT NULL
);
```

No Durable Objects anywhere in the MVP. SINGLE_USE consumption is a
D1 `INSERT OR IGNORE` on the `(uid, slot)` composite key — consumed iff
`meta.changes > 0`. Challenge one-time use is a conditional `UPDATE` (§5).

## 3. API endpoints

Base: `api.fuda.sh`. All bodies JSON. Errors are
`{ "error": "<snake_case_code>" }` with the listed status. A bigint-safe JSON
serializer is required (EAS values are uint64).

| Method + path                    | Auth      | Purpose                                                |
| -------------------------------- | --------- | ------------------------------------------------------ |
| `GET /health`                    | open      | liveness `{ ok: true }`                                |
| `POST /issue`                    | **admin** | issue an Entitlement (Bearer, Signed, +Private)        |
| `POST /revoke`                   | **admin** | revoke on-chain + mark member revoked                  |
| `GET /members`                   | **admin** | member list (≤200, newest first)                       |
| `GET /verify/:uid`               | open      | read-only verify — never consumes, not logged          |
| `POST /verify`                   | open      | gate admission — consumes SINGLE_USE, logs entry       |
| `POST /challenge`                | open      | mint a one-time signed-gate challenge                  |
| `POST /verify-signed`            | open      | challenge-response admission (Signed & +Private)       |
| `GET /pass/:uid`                 | open      | browser-based pass — all-OS fallback (no certs needed) |
| `GET /pass/:uid/apple.pkpass`    | open      | Apple wallet pass binary                               |
| `GET /pass/:uid/google`          | open      | `{ saveUrl }` for Google Wallet                        |
| `GET /announcements?fromBlock=N` | open      | cached ERC-5564 announcements                          |

**Admin auth**: `Authorization: Bearer <ADMIN_TOKEN>` (Worker secret).
Compare constant-time: SHA-256 both sides, `crypto.subtle.timingSafeEqual`.
When `ADMIN_TOKEN` is unset (local dev) admin routes are open and every
response carries `x-auth-mode: open`. Denied → `401 {error:'unauthorized'}`.

**Per-IP budget (day-1 middleware, applied to `GET /announcements` only in
the MVP)**: a shared middleware keyed on `CF-Connecting-IP`, fixed hourly
window (`floor(now / 3600) * 3600`) on the `rate_limits` table (§2):
**120 requests / hour / IP** by default; over budget →
`429 {error:'rate_limited'}`; missing client IP →
`400 {error:'client_ip_required'}`. **The gate routes (`POST /verify`,
`POST /challenge`, `POST /verify-signed`) are deliberately NOT budgeted**:
a venue's scanner and every member on the venue Wi-Fi share one NAT IP, and
the gate is already fail-closed on network loss — a budget there would stop
the door, not an attacker. Admin routes and `GET /health` are exempt. The
same middleware, with a tighter budget, gates the self-serve mint in the B1
spec — it is built once here. Turnstile is **not** in the MVP.

### POST /issue

Request (valibot-validated in `@fuda/sdk`). The level is derived from the
keys present, by this exact rule: `stealthMetaAddress` present → **+Private**
(`memberId` optional — the member's persistent/representative id, see below;
`holder` forbidden); else `holder` present → **Signed** (`memberId`
forbidden); else `memberId` present → **Bearer**; anything else (none, or
`holder` + `memberId`) → `400 bad_input`.

```jsonc
{
    "memberId": "alice", // Bearer: any non-empty string. +Private: optional representative id
    "holder": "0x…40", // Signed: the member's wallet address
    "stealthMetaAddress": "0x…132hex", // +Private: 66-byte meta-address (§7)
    "tier": 1, // optional, 0–3, default 0
    "usageModel": 1, // optional, 0–2, default 1 (MULTI_USE)
    "validFrom": 0,
    "validUntil": 0, // optional unix seconds
    "metaURI": "", // optional string
}
```

- **Bearer**: `holder = counterfactualAddress(memberId)` (§4).
- **Signed**: `holder = body.holder`, `member_id = holder`.
- **+Private**: `holder = NULL` in D1 (the stealth address is never stored —
  it is the attestation's recipient, reachable from the uid on chain if ever
  needed), `member_id = body.memberId ?? ''`. The optional `memberId` is the
  member's **persistent id** — for a dual-use member (a +Private access right
  plus a companion Signed value right, `private + loyalty` in the design
  record) it is the _same_ value as the Signed row's `member_id` (the
  representative address — or, for the B1 self-serve `private+loyalty`
  template, the loyalty right's generated member number), so `members_member_id`
  lists all of one member's rights. This links the private right to the member **in the issuer's own
  ledger** — the issuer already knows (it attested the right); on-chain
  unlinkability is unaffected (§15).
- Fields not taken from the request: `level` = `0` for Bearer, `1` for
  Signed, `2` for +Private (derived from which input key was supplied);
  `serial = bytes32(0)` in the MVP; `issuer` = the fuda signer address
  (informational — the gate's delegation check uses the attestation's
  attester, not this field).
- **`serial` is reserved for reissue lineage** (binding, even though the MVP
  never sets it): when a right is ever reissued (level upgrade, identity
  merge, recovery), the successor attestation carries the predecessor's uid
  in `serial`. `refUID` cannot serve this role — it is permanently occupied
  by the delegation chain (§1) — so lineage lives in `serial` by design.
  Verifiers ignore it today; nothing else may repurpose the field.
- **+Private**: decode the meta-address (reject non-`/^0x[0-9a-fA-F]{132}$/` →
  `400 {error:'bad_meta_address'}`), `generateStealthAddress` (§7), attest with
  `recipient = holder = stealthAddress`, then call the ERC-5564 Announcer:
  `announce(1, stealthAddress, ephemeralPubKey, metadata)` where
  `metadata = viewTag(1 byte) ‖ attestationUid(32 bytes)` (`0x` + 66 hex).
  **The response does not include the stealth address** — it is not needed by
  anyone on the operator side; discovery is the member's path
  (`/announcements` + client-side scan, §7).

Responses (200):

```jsonc
// bearer | signed
{
  "uid": "0x…64",
  "level": "bearer",
  "holder": "0x…40",
  "qr": "fuda:v1:0x…64",
  "passUrls": {
    "web": "https://api.fuda.sh/pass/0x…64",
    "google": "https://api.fuda.sh/pass/0x…64/google",
    "apple": "https://api.fuda.sh/pass/0x…64/apple.pkpass",
  },
}
// private
{ "uid": "0x…64", "level": "private", "announced": true, "announceTx": "0x…64" }
```

`passUrls` (same shape as the B1 self-serve response) is absolute URLs of the
§9 pass endpoints — always all three keys, even when a platform is
unconfigured (the endpoint then 501s; the dash shows the link anyway). The
private response deliberately carries **no** `passUrls`: discovery is the
member's path (§7) and the operator holds nothing to hand out.

Errors: `400 bad_input` (validation), `400 bad_meta_address`,
`501 no_signer` (SIGNER_PRIVATE_KEY unset), `502 chain_error` (attest tx
failed; nothing persisted).

### POST /revoke

`{ "uid": "0x…64" }` → on-chain `revoke(entitlementSchemaUid, uid)`, then
`UPDATE members SET status='revoked' WHERE attestation_uid = uid`. Response
`{ "revoked": true, "uid" }`. Errors: `400 bad_uid`, `501 no_signer`,
`502 chain_error` (revoke tx reverted or RPC failed — an unknown uid and an
already-revoked uid both revert on EAS and surface as `502 chain_error`;
the member row is left untouched. Idempotence is not required, matching
`/issue`).

### GET /members

`GET /members` → `200 { "members": [row…] }`, ≤200 rows, newest first
(`ORDER BY created_at DESC, attestation_uid`). Row shape (camelCase mirror
of §2):

```jsonc
{
    "uid": "0x…64",
    "memberId": "alice", // '' when none (private rows without a representative id)
    "holder": "0x…40", // null for private rows
    "level": "bearer", // 'bearer' | 'signed' | 'private'
    "tier": 1,
    "status": "active", // 'active' | 'revoked'
    "createdAt": 1757000000,
}
```

No pagination or filters in the MVP.

### GET /verify/:uid and POST /verify

`uid` must match `/^0x[0-9a-fA-F]{64}$/` → else `400 bad_uid`. `POST /verify`
takes `{ "qr": "fuda:v1:0x…64" }` (parse regex
`/^fuda:v1:(0x[0-9a-fA-F]{64})$/` → else `400 bad_qr`).

Both run the same chain-read verification (§6). `POST /verify` additionally:
enforces the level (`level >= 1` → `decision:'REJECT', reason:'LEVEL_REQUIRED'`
— **checked before slot consumption**, so a photo of a Signed pass cannot
burn its SINGLE_USE slot), consumes the SINGLE_USE slot on ADMIT (already
consumed → `decision:'REJECT', reason:'ALREADY_USED'`), appends to
`entry_log` (`path:'qr'`), and fires the Attendance hook (§8) on ADMIT.
**Logging rule (both action endpoints):** every decision-shaped response
(`decision: ADMIT | REJECT` with its `reason`) is appended to `entry_log`;
`4xx` input errors (`bad_uid`, `bad_qr`, `bad_input`) are not.
`GET /verify/:uid` reports the level but never rejects on it (read-only
preview: it answers "is this right valid?", not "may it enter by QR?").
Response:

```jsonc
{
    "decision": "ADMIT", // or "REJECT"
    "reason": "OK", // §6 reason table
    "entitlement": {
        "holder": "0x…",
        "issuer": "0x…",
        "usageModel": 1,
        "tier": 1,
        "level": 0,
        "validFrom": 0,
        "validUntil": 0,
        "schemaVersion": 1,
    },
    "delegation": { "issuer": "0x…", "active": true, "name": "fuda root" },
}
```

### POST /challenge and POST /verify-signed

`POST /challenge` `{ "uid": "0x…64" }` (uid must match
`/^0x[0-9a-fA-F]{64}$/` → else `400 bad_uid`; **no chain lookup** — a
challenge for a nonexistent or revoked uid is minted anyway and
`/verify-signed` step 1 rejects it later) → 16 random bytes → nonce
(`0x` + 32 hex), insert into `challenges`, respond
`{ "challenge": "fuda-gate:<uid>:<nonce>", "nonce": "0x…32hex" }`.

`POST /verify-signed` `{ "uid", "nonce", "signature" }` (`uid` as above →
`400 bad_uid`; `nonce` must match `/^0x[0-9a-fA-F]{32}$/` and `signature`
`/^0x[0-9a-fA-F]+$/` → else `400 bad_input`). **Every gate verdict is
`200`** — one response shape for the app: `{ decision, reason, path:
'signature', holder?, stage? }`; `stage` marks the two early stops
(`'entitlement'`, `'challenge'`), `holder` is present once the attestation
was decoded. Only input errors are `4xx`.

1. Chain verification (§6); not ADMIT →
   `200 { decision:'REJECT', reason, path:'signature', stage:'entitlement' }`.
2. Consume the challenge atomically (TTL **300 s**):
    ```sql
    UPDATE challenges SET used_at = ?now
    WHERE nonce = ? AND uid = ? AND used_at IS NULL AND created_at > ?now-300
    ```
    `changes = 0` →
    `200 { decision:'REJECT', reason:'BAD_CHALLENGE', path:'signature', holder, stage:'challenge' }`.
3. Verify key possession with viem
   `publicClient.verifyMessage({ address: holder, message: "fuda-gate:<uid>:<nonce>", signature })`
   — this **single call** covers EOA (ecrecover), deployed smart accounts
   (ERC-1271 `isValidSignature`), and undeployed ones (ERC-6492). The message
   is the plaintext challenge string, EIP-191 personal-sign. Fail →
   `200 { decision:'REJECT', reason:'BAD_SIGNATURE', path:'signature', holder }`.
4. Consume SINGLE_USE slot (after the signature check) — already used →
   `{ decision:'REJECT', reason:'ALREADY_USED', path:'signature', holder }`.
5. Fire the Attendance hook, respond
   `{ decision:'ADMIT', reason:'OK', path:'signature', holder }`.

Every verdict (steps 1–5, ADMIT and REJECT) is appended to `entry_log`
with `path:'signature'` (the logging rule above).

+Private admission is this same endpoint: the member recovers the stealth
address's private key client-side (§7) and signs the challenge with it —
`holder` is the stealth address, verification is the plain EOA path. **No new
gate machinery for +Private.**

### GET /announcements

Query `fromBlock` (default 0). Lazily syncs Announcer logs
(`event Announcement(uint256 indexed schemeId, address indexed stealthAddress,
address indexed caller, bytes ephemeralPubKey, bytes metadata)`) — **all
`schemeId == 1` announcements, no `caller` filter** (ERC-5564 puts the
filtering on the receiver's view tag; a caller allow-list would break the
moment a venue wallet issues in B1, and Base Sepolia's Announcer volume is
small) — in **≤1000-block chunks** (public Base
Sepolia RPCs cap `eth_getLogs` ranges), persisting the cursor to `sync_state`
after each chunk so partial progress survives. Scan floor = the deployment
block (a config var `ANNOUNCER_FROM_BLOCK`, set once at deploy time — a fresh
deployment has a shallow history). Response
`{ "announcements": [rows], "syncedTo": N }`, rows ordered by block ascending,
≤1000. RPC down with an empty cache → `502 {error:'rpc_unavailable'}`.

### GET /pass/:uid and /pass/:uid/…

See §9. The bare `GET /pass/:uid` web page depends on no platform secrets and
never 501s. Unconfigured wallet platform → `501 {error:'apple_not_configured'}`
/ `501 {error:'google_not_configured'}`. Unknown uid → `404 {error:'not_found'}`.

## 4. Bearer holder — counterfactual smart wallet

Bearer members have no wallet, but the Entitlement still needs a `holder`
address the member can later activate (ownership path to Signed without
reissuing — see the activation note below). Use the Coinbase Smart Wallet factory — deterministically deployed at
`0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a` on Base Sepolia — and its
`getAddress(bytes[] owners, uint256 nonce) view returns (address)`:

```ts
const nonce = BigInt(keccak256(toBytes(memberId))); // per-member nonce
const owners = [pad(fudaOwnerAddress, { size: 32 })]; // owner as 32-byte entry
const holder = await client.readContract({
    address: FACTORY,
    abi,
    functionName: "getAddress",
    args: [owners, nonce],
});
```

A pure CREATE2 computation via `eth_call` — nothing is deployed. `fudaOwner` =
the fuda signer address (config `ISSUER_ADDRESS`). The member later activates the
account by adding their own passkey owner; the address (and the attestation
pointing at it) never changes.

**Activation vs. level upgrade (binding vocabulary).** _Activation_ =
ownership transfer of the holder account (fuda deploys the account, adds the member's
passkey owner, removes itself). It changes nothing on the attestation:
`level` stays `0`, so the right keeps admitting by QR _and_ now also by
signature. _Level upgrade_ (`level 0 → 1`, closing the QR path) is a
different operation — the attestation is immutable, so it is a
revoke + reissue whose successor carries the predecessor uid in `serial`.
The MVP builds neither; **activation** ships in the B1 spec (`POST /claim`), the
reissue-based **level upgrade** is a Tokyo item (E1 `POST /upgrade`). This
is why the QR-copy hole is closed by `level` at issuance (§1), not by
activation.

**Bearer `memberId` uniqueness**: `memberId` is the CREATE2 nonce, so two
venues issuing to the same `memberId` string produce the same holder. The
admin path accepts operator strings as-is (demo convenience); the self-serve
path in B1 uses the generated member number (12 random characters from a
28-character alphabet, ~58 bits — revised 2026-09-04, prior: 16 random
bytes hex) and never collides.

## 5. QR + challenge formats (wire constants)

| Constant                          | Value                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pass/QR payload                   | `fuda:v1:<uid>` (uid = `0x` + 64 hex)                                                                                                                        |
| Challenge string (what is signed) | `fuda-gate:<uid>:<nonce>`                                                                                                                                    |
| Challenge nonce                   | `0x` + 32 hex (16 random bytes), TTL 300 s, one-time                                                                                                         |
| Announcement metadata             | `0x` + viewTag (2 hex) + uid (64 hex)                                                                                                                        |
| HKDF domain salt                  | `fuda.sh/stealth/v1` (UTF-8 bytes)                                                                                                                           |
| WebAuthn PRF eval input           | `prf: { eval: { first: utf8('fuda.sh/stealth/prf/v1') } }`                                                                                                   |
| WebAuthn `rp.id`                  | `'fuda.sh'` for every fuda passkey ceremony (member app on `app.fuda.sh` and the B1 `/@handle` landing on `fuda.sh` share one passkey → one `member_secret`) |

## 6. Gate verification (chain read) + reason table

`verifyUid(uid)`: `EAS.getAttestation(uid)` via `eth_call`, then in order:

| Check                                                                                                 | REJECT reason                                                                                     |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| attestation exists (`uid != 0`)                                                                       | `NOT_FOUND`                                                                                       |
| schema ∈ entitlement accepted-version set (§1) → decode via that version's codec, upcast to canonical | `WRONG_SCHEMA` (schema not in the set)                                                            |
| `revocationTime == 0`                                                                                 | `REVOKED`                                                                                         |
| `usageModel <= 2`                                                                                     | `UNKNOWN_USAGE_MODEL`                                                                             |
| `validFrom == 0 \|\| now >= validFrom`                                                                | `NOT_YET_VALID`                                                                                   |
| `validUntil == 0 \|\| now <= validUntil`                                                              | `EXPIRED`                                                                                         |
| delegation chain valid (§1)                                                                           | `NO_DELEGATION` / `ISSUER_NOT_DELEGATED` / `DELEGATION_UNAVAILABLE` / `DELEGATION_CONFIG_MISSING` |
| `level == 0` (QR endpoint `POST /verify` only; `/verify-signed` accepts every level)                  | `LEVEL_REQUIRED`                                                                                  |
| slot not consumed (SINGLE_USE, action endpoints only)                                                 | `ALREADY_USED`                                                                                    |
| challenge valid (signed endpoint only)                                                                | `BAD_CHALLENGE`                                                                                   |
| signature valid (signed endpoint only)                                                                | `BAD_SIGNATURE`                                                                                   |

All chain errors fail **closed** (REJECT), never open. The gate is an
online-check gate: network loss at the venue means no admissions (accepted
for the hackathon; offline-first is out of scope).

## 7. `@fuda/stealth` — the +Private crypto core

Dependency-free of chain libraries except `@noble/*` + viem utils. All
derivations HKDF-SHA256 with salt `utf8("fuda.sh/stealth/v1")`.

```ts
// derivation-source entropy → member secret (the convergence point — see
// "Derivation sources" below; the MVP ships the passkey-PRF source only)
deriveMemberSecret(entropy: Uint8Array): Uint8Array          // hkdf(sha256, entropy, SALT, utf8('member-secret'), 32)

// member secret → stealth key pair trees
deriveStealthKeys(memberSecret: Uint8Array): StealthKeys
//   spendPriv = hkdf(..., utf8('stealth-spend'), 32)  → scalar = (bytesToBigInt % (N-1)) + 1
//   viewPriv  = hkdf(..., utf8('stealth-view'), 32)   → same scalar mapping
//   public keys: 33-byte compressed secp256k1
//   metaAddress = spendPub ‖ viewPub = 0x + 132 hex (66 bytes)

// sender side (the API, at /issue)
generateStealthAddress(metaAddress: Hex, ephemeralPriv?: Uint8Array): {
  stealthAddress: Address        // publicKeyToAddress(spendPub + G·tweak)
  ephemeralPublicKey: Hex        // 33-byte compressed
  viewTag: number                // top byte of the shared-secret hash
}
//   shared = keccak256(ECDH(ephPriv, viewPub).toRawBytes(true))
//   tweak  = BigInt(shared) % N          (tweak == 0 throws — degenerate)

// receiver side (the member app)
checkAnnouncement(keys, announcement): boolean               // view-tag prefilter, then full ECDH match
recoverStealthPrivateKey(keys, ephemeralPublicKey): Hex      // (spendPriv + BigInt(shared) % N) % N
matchAnnouncements(keys, rows): DiscoveredPass[]             // { uid, stealthAddress, stealthPrivateKey }
buildAnnouncementMetadata(viewTag, uid): Hex                 // 0x + tag(2) + uid(64)
parseAnnouncementMetadata(hex): { viewTag, uid } | null      // regex /^0x[0-9a-fA-F]{66}$/
```

**Derivation sources.** Everything downstream of `member_secret` (key trees,
meta-address, stealth math, gate signing) is source-agnostic; only the entropy
entering `deriveMemberSecret` differs per root-key type. The MVP builds one
source and reserves a second as a seam:

1. **Passkey PRF (MVP, built).** The entropy is the WebAuthn `prf` extension
   output on a passkey created by the member app
   (`navigator.credentials.create` with `extensions: { prf: {} }`,
   `residentKey: 'required'`, `userVerification: 'required'`; some platforms
   only report PRF support at get time). The output is read with
   `navigator.credentials.get` passing the **pinned eval input**
   `extensions: { prf: { eval: { first: utf8('fuda.sh/stealth/prf/v1') } } }` —
   the PRF output is a function of this input, so it must never change. One
   passkey + one eval input → one deterministic `member_secret` → the same
   meta-address on every device that holds the passkey.
2. **EOA signature (seam only — documented, not built).** A member whose root
   key is a plain EOA (the bring-your-own-wallet rail) has no passkey; their
   entropy is `keccak256` of a `personal_sign` signature over the **pinned
   message** `fuda.sh/stealth/eoa/v1`. ECDSA nonces are deterministic per
   [RFC 6979](https://datatracker.ietf.org/doc/html/rfc6979), so the same key
    - same message reproduce the same signature — and therefore the same
      meta-address — on demand. **Raw ECDSA signers only**: ERC-1271 contract
      signers and non-deterministic MPC signers cannot use this source (their
      signatures are not reproducible); those members use the passkey source.
      Prior art for signature-derived stealth keys with deterministic replay
      recovery:
      [Fluidkey's technical walkthrough](https://docs.fluidkey.com/technical-documentation/technical-walkthrough/)
      and its open-source
      [stealth-account-kit](https://github.com/fluidkey/fluidkey-stealth-account-kit).

**ERC-5564 scheme 1** (secp256k1 with view tags) throughout; the announcer
call is `announce(1, stealthAddress, ephemeralPubKey, metadata)`.

## 8. Sponsor integration hooks (in core, always on)

Two on-chain exhaust streams exist specifically so sponsor tracks can attach
without touching the loop:

1. **Attendance attestations** (on-chain entry evidence). On every ADMIT (both
   `/verify` and `/verify-signed`), schedule on `waitUntil` (after the verdict
   is returned — a slow attestation must never slow the door):
   attest Attendance with `recipient = holder`, `refUID = uid`,
   `revocable = true`, `expirationTime = 0`, data
   `{ rightUID: uid, holder, enteredAt: now, slotId: bytes32(0) }`; write the
   resulting UID back to `entry_log.attendance_uid`. Errors swallowed (a lost
   record is acceptable; a failed admission is not). **Always on** — this is
   product surface, not an ops flag. Consumer: the Graph stretch spec's
   `Attendance` entities (subgraph + sentinel).
2. **ERC-5564 announcements** (The Graph feedstock). Every +Private issuance
   emits a canonical announcement (§3, §7). The Graph stretch spec replaces
   `GET /announcements`'s D1 cache with a subgraph query.

## 9. Passes for the Device wallet (`packages/pass`)

**Build order: browser-based pass first, Google second, Apple last** — the
browser-based pass
needs no external accounts or certificates and is the floor every device can
stand on; the Apple detached CMS signature is the fiddliest from-scratch
piece, so a slip degrades platform by platform instead of to no pass at all.

**Browser-based pass** (`GET /pass/:uid`, HTML — the all-OS fallback): a self-contained
page (inline SVG QR of `fuda:v1:<uid>`, no external assets) showing the tier
label, short holder, issue status, and an add-to-home-screen hint. On load it
calls `GET /verify/:uid` and renders the current state (a revoked right shows
REVOKED on its own pass page). This is what desktop browsers and every
non-Apple/Google OS get — and the demo's last-resort pass if both wallet
platform setups slip. Issue responses and dash link it alongside the wallet
buttons (`passUrls.web`).

**Google** (`GET /pass/:uid/google` → `{ saveUrl }`): build a GenericObject

```jsonc
{
    "id": "<issuerId>.<uid-without-0x>",
    "classId": "<GOOGLE_CLASS_ID>",
    "state": "ACTIVE",
    "cardTitle": {
        "defaultValue": { "language": "en-US", "value": "fuda membership" },
    },
    "header": {
        "defaultValue": { "language": "en-US", "value": "<tier label>" },
    },
    "barcode": {
        "type": "QR_CODE",
        "value": "fuda:v1:<uid>",
        "alternateText": "<uid[0:10]>",
    },
    "textModulesData": [
        {
            "id": "tier",
            "header": "Tier",
            "body": "<FREE|REGULAR|VIP|FOUNDER>",
        },
        { "id": "member", "header": "Member", "body": "<holder[0:6]…[-4:]>" },
    ],
}
```

sign an RS256 JWT `{ iss: <service-account email>, aud: 'google',
typ: 'savetowallet', iat, origins: ['https://app.fuda.sh'],
payload: { genericObjects: [object] } }` with the service-account key; saveUrl
= `https://pay.google.com/gp/v/save/<jwt>`.

**Apple** (`GET /pass/:uid/apple.pkpass`): a `.pkpass` = ZIP (store, no
compression) of:

- `pass.json` — `formatVersion: 1`, style **storeCard**; `passTypeIdentifier`,
  `teamIdentifier`, `organizationName`, `serialNumber: <uid>`, `description`;
  colors `foregroundColor: rgb(255,255,255)`, `backgroundColor: rgb(20,20,20)`,
  `labelColor: rgb(170,170,170)`;
  `barcodes: [{ format: 'PKBarcodeFormatQR', message: 'fuda:v1:<uid>', messageEncoding: 'iso-8859-1' }]`;
  storeCard fields: primary `{ key:'tier', label:'TIER', value }`, secondary
  `{ key:'member', label:'MEMBER', value: <short holder> }`, back
  `{ key:'uid', label:'Attestation', value: <uid> }`.
- `icon.png` (any placeholder icon).
- `manifest.json` — SHA-1 of every file.
- `signature` — detached PKCS#7/CMS SignedData over the manifest,
  RSASSA-PKCS1-v1_5 + SHA-256, signed with the Pass Type ID certificate,
  including the WWDR intermediate.

Secrets: Apple `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_CERT_PEM`,
`APPLE_KEY_PEM` (PKCS#8), `APPLE_WWDR_PEM` (all five or the endpoint 501s);
Google `GOOGLE_ISSUER_ID`, `GOOGLE_CLASS_ID`, `GOOGLE_SA_EMAIL`,
`GOOGLE_SA_KEY_PEM`.

## 10. Surfaces (screens + actions)

**apps/dash** (operator; prompts for the admin token, keeps it in memory):

1. _Members_ — table from `GET /members` (memberId, level, tier, status,
   uid; private rows show memberId + uid only — `holder` is NULL); per-row:
   revoke button (`POST /revoke`), pass links
   (web `/pass/:uid`, `/pass/:uid/apple.pkpass`, google saveUrl), QR display
   (`fuda:v1:<uid>`) for every level — a Signed/+Private QR is safe to show
   because the gate rejects it with `LEVEL_REQUIRED` (§6); the QR is the
   right's identifier, not its credential.
2. _Issue_ — level select (Bearer: memberId text input · Signed: holder address
   input · +Private: meta-address paste field + optional memberId), tier +
   usageModel selects,
   submit → `POST /issue` → show uid/QR (bearer/signed) or "announced —
   member discovers it in their app" (private).

**apps/gate** (scanner; no auth — it only calls open endpoints):

1. _Scan_ — camera via `BarcodeDetector` (`formats: ['qr_code']`), paste
   fallback. Input `0x…64` → `GET /verify/:uid` (read-only preview);
   `fuda:v1:…` → `POST /verify` (admission). Full-screen GREEN
   ADMIT / RED REJECT with reason, tier, short holder. **Three display
   states, not two:** the read-only preview path renders a distinct YELLOW
   "VALID — signature required" whenever `GET /verify/:uid` returns
   `decision:'ADMIT'` with `entitlement.level >= 1` — the right is valid but
   may not enter by QR, and staff must not read the preview as an admit
   (GET never rejects on level, §3).

**apps/app** (member):

1. _Signed gate_ — enter/scan their pass uid → `POST /challenge` → sign the
   challenge string with the connected wallet (Base Account SDK passkey wallet
   or any EOA via EIP-1193 `personal_sign`) → `POST /verify-signed` →
   full-screen ADMIT/REJECT.
2. _+Private_ — (a) create/load passkey with the PRF extension → derive +
   display the meta-address (copy button — handed to the operator out-of-band);
   (b) _Discover_ — fetch `GET /announcements`, run `matchAnnouncements`
   locally, list discovered passes (uid + stealth address); (c) _Enter_ — for
   a discovered pass, run the Signed-gate flow signing with
   `recoverStealthPrivateKey` (local viem account, no wallet prompt).

## 11. Failure modes (must be handled, not discovered)

- Gate network loss → requests fail → RED with a network error banner (fail
  closed, §6).
- Revoked right scanned → RED `REVOKED` (demo beat: revoke in dash, rescan).
- Second scan of a SINGLE_USE right → RED `ALREADY_USED`.
- Replayed/expired challenge → `BAD_CHALLENGE`; signature from the wrong key →
  `BAD_SIGNATURE`.
- `/issue` tx revert/RPC failure → `502 chain_error`, no member row persisted
  (the operator retries; idempotence is not required in the MVP). **Known
  consequence:** if the tx landed but the receipt wait timed out, the retry
  issues a second valid right to the same holder — accepted; the operator
  revokes the duplicate from dash.
- Announcements RPC down → `502 rpc_unavailable`; app shows "try again".
- Wallet pass endpoints without certs → 501 with a clear code; the browser-based pass
  (`GET /pass/:uid`) has no cert dependency and always works — the demo
  degrades Apple → Google → web, never to no pass.

## 12. Test plan

| Layer                                      | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Count   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Unit (`packages/stealth`)                  | derivation vectors (fixed PRF → fixed meta-address), stealth round-trip (generate → check → recover, recovered key controls the address), view-tag mismatch skips, metadata build/parse, degenerate tweak throws                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ~8      |
| Unit (`packages/pass`)                     | Google object shape + JWT claims; Apple pass.json fields + manifest hashes; QR message = `fuda:v1:<uid>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ~6      |
| Integration (browser-based pass)           | `GET /pass/:uid` renders the QR + status without platform secrets; revoked right shows REVOKED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | +2      |
| Unit (api helpers)                         | schema UID computation vs registry, Entitlement codec round-trip (incl. `level`), Attendance codec round-trip, QR parse, reason ordering (`LEVEL_REQUIRED` precedes `ALREADY_USED`); versioning seam: unknown UID → `WRONG_SCHEMA`, v1 decode → canonical upcast identity, delegation accepted-set lookup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ~10     |
| Integration (api, workerd + real D1)       | issue→verify ADMIT (bearer); revoke→REJECT; SINGLE_USE double-scan; signed-level right by QR → `LEVEL_REQUIRED` and its slot stays unconsumed; same holder issued twice → two rows; challenge happy path + replay + expiry + wrong-key (all verdicts `200`, REJECTs present in `entry_log`, `/challenge` for a bad uid → `400 bad_uid`); `GET /members` shape (newest first, private row `holder = null`); `/revoke` unknown uid → `502 chain_error`; `/issue` response carries `passUrls` (bearer/signed) and not for private; stealth issue→announce→/announcements→match→verify-signed with recovered key; delegation-missing REJECT; admin 401s; per-IP budget 429 on `GET /announcements` and NOT on `POST /verify`; +Private issue → member row has `holder = NULL`, `member_id` = the supplied representative id | ~21     |
| E2E (manual, scripted in the demo runbook) | Bearer, Signed and +Private on real phones at fuda.sh; gate preview of a Signed uid shows YELLOW "signature required", not GREEN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 3 flows |

Target: the integration suite runs in CI (`@cloudflare/vitest-pool-workers`)
and stays green from the first endpoint onward.

## 13. Deploy topology

- Cloudflare zone **`fuda.sh`**. Hosts: `app.fuda.sh` (member app),
  `api.fuda.sh`, `dash.fuda.sh` (issuer dashboard), `gate.fuda.sh`. One
  Worker per surface, routes in each app's `wrangler.jsonc`. The zone apex
  **`fuda.sh` = landing page**: during the event it is served by the member
  app Worker's `/` route (one static screen — what fuda is, the levels,
  links to the surfaces); a separate `apps/web` is post-event.
- **CORS** (api): allow origins `https://app.fuda.sh`, `https://dash.fuda.sh`,
  `https://gate.fuda.sh` + localhost dev ports — every frontend call is
  cross-origin in this topology.
- D1 database `fuda` bound to the api Worker; migrations via drizzle-kit.
- **Signer nonce management**: the shared signer key serves synchronous
  `/issue` attests, stealth announces, and `waitUntil` Attendance attests
  concurrently — create the account with viem's nonce manager
  (`privateKeyToAccount(key, { nonceManager })`) or two quick ADMITs collide
  nonces and the swallowed Attendance attests silently vanish.
- Secrets (api): `SIGNER_PRIVATE_KEY` (funded on Base Sepolia),
  `ADMIN_TOKEN`, `BASE_RPC_URL`, the five `APPLE_*`, the four `GOOGLE_*`.
- Vars (api): `EAS_ADDRESS`, `SCHEMA_REGISTRY_ADDRESS`, `EAS_SCHEMAS`
  (three accepted-version arrays, e.g.
  `{ "entitlement": [{ "uid": "0x…", "version": 1 }], … }` — §1 seam),
  `ISSUER_ADDRESS`, `DELEGATION_UID`, `ANNOUNCER_ADDRESS`,
  `ANNOUNCER_FROM_BLOCK`.
- One-time setup: fund the signer → run `register-schemas.ts` → attest the
  root IssuerDelegation → paste UIDs → **create the Google Wallet issuer
  account + a GenericClass matching `GOOGLE_CLASS_ID`** (objects referencing a
  non-existent class fail) and **request issuer publishing approval** (an
  unapproved issuer is in demo mode: only allow-listed test accounts can save
  the pass — add the demo phones' Google accounts as testers on day one so
  the demo works either way) → **request the Apple Pass Type ID certificate**
  (real lead time — start day one; Apple is sequenced last for this reason) →
  deploy → smoke: issue → scan → ADMIT.

## 14. Build order (9/4–9/14)

1. Workspace + `apps/api` skeleton + D1 schema (incl. `rate_limits` + the
   per-IP middleware) + `register-schemas.ts`.
2. Entitlement codec + `/issue` (bearer) + `/verify/:uid` + `/verify`
   (incl. the `level` check) + delegation check + `entry_log` + slots.
   **First ADMIT on chain.**
3. `apps/gate` scanner + `apps/dash` (members/issue/revoke) + the Bearer
   Attendance hook. The issue → ADMIT → revoke loop is demoable.
4. **Browser-based pass** `GET /pass/:uid` (the all-OS floor).
5. **Signed**: `/challenge` + `/verify-signed` + app signed-gate screen +
   Signed Attendance hook; a Signed right's QR scans `LEVEL_REQUIRED`.
6. **+Private**: `packages/stealth` + `/issue` stealth branch + announce +
   `/announcements` + app +Private screens (derive/discover/enter). **The
   full level ladder is demoable here — record it.**
7. B1 **P3a acquisition**: venue model, `/@handle` landing, abuse-gated
   self-serve issue (Turnstile on top of the day-1 per-IP budget),
   venue-branded pass. First product-complete vertical slice.
8. `packages/pass` **Google** pass + `/pass/:uid/google`, then B1 **P3b
   living pass**: member number, stamps, and live update/message.
9. B1 **venue-signed issuance** (venue Base Smart Wallet, per-venue
   `IssuerDelegation`, agent-key self-serve) — the depth beat; degrade to
   fuda-signed issuance if it slips.
10. Deploy all surfaces; run the complete regression and phone smoke; record
    the stable core demo once.
11. B1 P1 lock-screen relevance, Apple `.pkpass` (Google/web are accepted
    fallbacks), and B1 **Bearer activation** (`POST /claim`) only after the
    recorded core is stable.
12. Add at most one sponsor beat as time allows. The Graph enters the product
    demo only when it powers a real discovery/dashboard path. A
    simulation-only or architecture-only integration stays in
    partner-specific evidence.

The ladder (Bearer → Signed → +Private) is built before any B1 item: it is
what distinguishes fuda, and a slip at the venue flow must degrade to "a
complete protocol demo without the loyalty story", never the reverse. Steps
7–9 pull B1 into the event sequence even though it remains sibling scope
rather than part of the MVP protocol contract.

## 15. Out of scope (→ sibling stretch specs)

Pass design customization/templates + per-holder fields; anonymous self-serve
distribution (`/@handle` links, Turnstile — the per-IP budget itself is IN
scope, §3); venue-signed issuance (venue smart wallet, per-venue
`IssuerDelegation`, agent keys, paymaster) and Bearer activation
(`POST /claim`)
— both in the B1 spec; gas-sponsored _member_ transactions and the ERC-6538
meta-address registry; write-behind issuance queue (deliberately rejected:
offchain-first attestations would need a second uid space and an offchain
verify path at the gate); nullifier-based +Private gate (the stealth-key signature
reveals which right entered — unlinkability holds on-chain, not against the
gate operator; fixing that is the nullifier design, out of scope); offline
gate; lock-screen relevance; i18n; The Graph subgraph. Chainlink CRE is
dropped entirely (not a stretch item).
Also out of scope (future rails/fallbacks — the EIP-1193 EOA path at §10 and
the browser-based pass at §9 are IN scope): WalletConnect sessions for external mobile
wallets, hardware-wallet signing UX (e.g. Ledger clear signing), and
non-Apple/Google native wallet-pass formats (e.g. Samsung Wallet) — the web
pass is the deliberate catch-all until any of these earns its build.
Also out of scope: **level upgrade of an issued right** (`level 0 → 1` is a
revoke + reissue with `serial` lineage — §4; Tokyo scope) and any
**privacy of entry evidence** for Bearer/Signed rights: Attendance
attestations publish `(rightUID, holder, enteredAt)` on-chain by design
(the sponsor hook and the chain-truth stamp count depend on it); +Private
is the answer for members who need unlinkable entries. State this in the
demo, don't hide it. Two more accepted trade-offs, also to be stated:
**Bearer has no resistance to QR copying** — a photo of a level-0 pass
admits (MULTI_USE) by definition, and activation (§4) does not close that
path;
wanting it closed is the reason to issue at Signed. **+Private
unlinkability holds against chain observers, not against the issuer** —
the issuer attested the right and its own ledger (`members`) may carry the
member's persistent id next to the uid.

## 16. Acceptance criteria (demo-script form)

1. Operator issues a Bearer right in dash; the pass QR (browser-based pass
   as the floor; Google Wallet when the issuer account permits) scans GREEN
   at the gate; the Entitlement is visible on a Base Sepolia explorer.
2. Revoking in dash turns the same QR RED (`REVOKED`) within one rescan.
3. A SINGLE_USE right scans GREEN once, RED (`ALREADY_USED`) the second time.
4. A Signed member passes the gate by signing the challenge with a passkey
   smart wallet — and the same flow rejects a wrong-key signature
   (`BAD_SIGNATURE`) and a replayed nonce (`BAD_CHALLENGE`); the same
   right's bare QR scans RED (`LEVEL_REQUIRED`) — a photo of a Signed pass
   does not admit.
5. A +Private member: derives a meta-address from a passkey, is issued a right
   they discover via announcement scan (no server ever told them the address),
   and enters through `/verify-signed` with the recovered stealth key.
6. Every ADMIT produces an Attendance attestation on-chain referencing the
   right (`refUID`), visible on the explorer.
7. All integration tests green in CI; the loop runs on `fuda.sh` hosts.
