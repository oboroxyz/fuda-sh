# fuda

fuda issues membership rights as on-chain attestations and verifies them at a physical gate. This glossary fixes the words used across the specs, code, and UI so that one concept has one name.

It records the vocabulary of the product design, independently of what is built: a term stays here while the concept it names is part of the design, and leaves only when that concept is dropped. Absence of an implementation is never on its own a reason to remove an entry.

## Language

### The right

**Right**: A membership entitlement; the source of truth for what a member may do. It is either a signed EAS offchain attestation held by fuda or an on-chain EAS `Entitlement` attestation, as its Card's record decides. _Avoid_: Membership, entitlement (as a prose noun), pass, ticket, card

**Card record**: Where a Card's Rights are recorded, fixed when the Card is created: `offchain` (the default) signs each Right with no transaction and no holder address, and `onchain` attests each Right publicly. _Avoid_: Mode, storage, chain type

**Pass**: A presentation of a Right — a Device wallet pass (`.pkpass` / Google Wallet object) or the browser-based pass page carrying the Right's QR. A Pass is not the Right, and lives in the Device wallet, never in the Crypto wallet. _Avoid_: Ticket, card, credential

**Device wallet**: Apple Wallet or Google Wallet — the phone's OS-level container for Passes. A distribution and presentation channel only: it holds no keys, signs nothing, and knows nothing about the chain. Bearer and Signed Rights can have Passes. Say "Apple Wallet" / "Google Wallet" when the platform matters. _Avoid_: Wallet (bare), wallet app, mobile wallet

**Crypto wallet** (or **wallet**): Software that controls an Ethereum key and can sign — a passkey smart wallet (Base Account) or an EOA. It is what makes a Holder _the member's_: Signed members hold one; Bearer members do not. Bare "wallet" in this glossary always means this one, never the Device wallet. _Avoid_: Account (say Holder for the address), key, signer

**Wallet rail** (or **rail**): How a Member holds signing keys — managed (fuda's key on a fuda-owned smart account), self-custody passkey, bring-your-own EOA, or a compatible smart wallet. Orthogonal to the verification level: choosing a rail never changes how a Right is verified. _Avoid_: Custody mode, wallet type, login method

**Verification level** (or **level**): The property baked into a Right at issuance that decides how it is verified. There are two: Bearer and Signed. The on-chain `level` field and the code enumerate them as `bearer` / `signed` because the gate must tell them apart. Immutable for the life of the Right. _Avoid_: Mode, tier (tier is the FREE/REGULAR/VIP/FOUNDER rank), type

**Bearer**: The level with no Crypto wallet and no app — a Pass in the Device wallet is all the member has; the Right's QR alone admits, and a copy of the QR admits too.

**Signed**: The level where the member's own key must sign a one-time gate challenge — possession of the key is proven at the door.

**Serial**: The `serial` field of a Right, reserved for reissue lineage (the predecessor Right's uid on a Level upgrade, merge, or recovery). Nothing else may use it.

### The people and addresses

**Member**: The person who holds a Right. Holding one takes no identity at fuda; a Member who signs in has an Account. _Avoid_: User, customer

**Account**: What a Member signs in to: a set of passkeys and the Passes kept on them, with no address and no email. Optional, and unrelated to the Issuer's Member id. _Avoid_: Profile, wallet

**Holder**: The address a Right is attested to (`recipient`): a fuda-owned smart account for Bearer, the member's wallet for Signed. A Holder is an address; a Member is a person. _Avoid_: Owner, recipient (in prose), member address

**fuda-owned smart account**: The smart account that holds a `standard` Right at a stable counterfactual address, known before deployment. fuda's key controls it, so a Bearer Right can be issued before the member has any key; the member never takes control of it. _Avoid_: Counterfactual wallet (say "counterfactual" only of the address), custodial account, claim account, claimable account

**Member id**: The issuer's persistent identifier for a Member, under which that Member's several Rights are grouped. In the admin issuance path the Member id is operator-chosen free text; the generated member number (see naming) belongs to the self-serve path. _Avoid_: Representative address (say "the Signed Holder used as Member id"), username

**Issuer**: The party that attests a Right — the address in the EAS `attester` slot and the `issuer` field of every schema, made legitimate by an Issuer delegation. In the MVP the fuda signer attests for every Handle; from B1 each Venue's own wallet does. This is the name the specs, data model, EAS schemas, and ENS use for the organization that issues: an Issuer owns a Handle and an Issuer name, and Rights, Member numbers, and delegations are scoped to it. "Issuer" and "attester" name the same party — use Issuer in prose, `attester` only for the EAS field. _Avoid_: Venue (in specs, schemas, and code — that is the same organization seen from the shop floor, see Venue), Operator (that is a role in the dashboard, not an on-chain party), tenant, merchant

**Template** (or **verification template**): The issuer's per-use-case choice of how a Right is issued, picked at issuance time — `standard` (U1: Bearer, one-tap save), or, as a v2 design that is not built, `anonymous` (U4). The issuer configures which templates are available and the default; an authorized Operator selects one at issuance, and a self-serve route binds the Handle to a template in advance so no per-member approval is needed. Members do not pick a level. A product-policy label — the Gate only ever sees the level. _Avoid_: Plan, tier, mode, pass template (that is a pass-design concept), "the member's choice"

**Venue**: An organization that issues Rights to its members — the shop, club, or office as the member and its staff see it. A business-domain term, not a required UI label. Member-facing and operator-facing copy uses context-specific labels such as Profile, Name, Handle and Public page so it also fits companies and communities. Wherever the organization appears as a party in a spec, schema, column, EAS field, or ENS name, it is the Issuer: one Venue is one Issuer, and Venue never appears in the data model. From B1 it holds its own smart wallet and attests its Rights itself. _Avoid_: Issuer or Venue as generic UI labels, tenant, merchant, operator, shop

**Handle**: An Issuer's permanent identifier — the `/@handle` slug, shaped as a DNS/ENS label so it is also the Issuer's ENS label (`<issuer>.fuda.eth`) 1:1. _Avoid_: Slug, username, venue name, issuer name (that is the ENS name built from the Handle)

**Issuer delegation**: The `IssuerDelegation` attestation, referenced by a Right's `refUID`, that lets a gate decide whether the Right's Issuer is allowed to issue. _Avoid_: Whitelist, registry, permission

**Connected app**: A program built outside fuda — typically a browser-only Figma Make app — that an Operator registers in the dashboard and approves for one Issuer, after which it acts for that Issuer through the api with an access token (see `docs/specs/connected-apps.md`). It has a client ID and no secret, never creates an Issuer, and reaches no other Issuer's data. Only the account that registered it may approve it. _Avoid_: Integration (that is a Card's optional service), plugin, API client, partner

**MCP client**: A connected app that is an AI agent tool such as Claude Code, reaching fuda through the api's MCP server with a token bound to that server.

**Approval** (of a connected app): The Operator's consent, on fuda's consent page, that one connected app may act for one of their Issuers with a fixed set of scopes. It is held as an access token and ends when revoked from the dashboard, revoked by the app, or expired, or when the app is deleted. _Avoid_: Grant (in UI copy), authorization (in prose; that is the OAuth step), connection

**Gate**: Whatever reads the chain and decides ADMIT or REJECT for a presented Right — fuda's api by default, but any verifier can be a Gate. _Avoid_: Scanner (that is the `apps/gate` device), verifier (in prose), door

**Issuer wallet**: The Crypto wallet through which an Issuer controls its assets and authorizes operations. Its identity is distinct from the people or credentials controlling it, and from a service signer acting on the Issuer's behalf. _Avoid_: Operator wallet (when referring to the shared organization identity), staff wallet

**Owner credential**: A key or wallet with full control of an Issuer wallet. Several owner credentials can control the same Issuer wallet; changing a credential does not create another Issuer. An Owner credential grants wallet control, not a limited operational role. _Avoid_: Operator (that is a person), Holder (that is the recipient of a Right)

### Entering

**Entry path** (or **path**): How a given entry was made: `qr` (a Bearer QR was scanned) or `signature` (a challenge was signed). Level says what a Right _is_; path says how it _got in_. _Avoid_: Mode, method, flow

**Level and path, never "mode":** a Right has a **level** (Bearer, Signed) and an Entry has a **path** (`qr` or `signature`). "Mode" is not used for either. The api's `x-auth-mode` response header (`open` / `locked`) names the admin-auth state and keeps its name.

**Challenge**: The one-time string a Signed member signs to enter, bound to one Right and one nonce with a short lifetime. _Avoid_: Nonce (that is only the random part), token

**Slot**: The unit consumed on entry by a `SINGLE_USE` Right; consumed at most once. _Avoid_: Ticket, seat, use

**Entry**: One ADMIT of a Right at a Gate, recorded off-chain in the entry log. _Avoid_: Check-in, visit, scan

**Stamp**: One unit of a Venue's loyalty count for a Right, awarded under the Stamp policy configured for its Card. An Entry does not necessarily earn a Stamp; redemption is a separate action. _Avoid_: Point, visit count, check-in

**Member number**: The random label every Right receives at issuance: 13 characters from the 28-character alphabet `23456789acdefghjkmnpqrtuvwxy` — 12 random plus one check character — stored canonical lowercase with no separators (`qj2yxphepdrka`) and shown upper-cased in `4-4-5` groups (`QJ2Y-XPHE-PDRKA`) on the Pass and dashboard. One per Right, unique per Issuer, never sequential. It is the ENS member label (`<member-no>.<issuer>.fuda.eth`, see `docs/specs/ens-naming.md`) and is not the Member id, which groups a Member's several Rights. _Avoid_: Member id, serial (that is the Right's lineage field), sequence number

**Qualification**: The external fact that makes a Member eligible for a Right (registered for the event, on the roster, paid) — read from a Qualification source before issuance is triggered. _Avoid_: Eligibility, entitlement (that is the Right), registration (one kind of Qualification)

**Integration** (of a Card): An optional external service an Issuer turns on for one Card, off by default and saved apart from the Card. A Card's integrations decide which Badge kinds its members may attach; the gate never reads them. _Avoid_: Plugin, add-on, feature flag, connector

**Badge**: A verified fact about the Member holding a Right, attached after issuance and naming the verifier that attested it. The `human` Badge claims one thing — that a unique person holds the Right — and more than one credential can prove it: World ID's proof of human or Japan's My Number Card. Which one answered is recorded for auditing and is never shown; the Badge names the claim, never the credential or the vendor. Advisory: a missing or failed Badge lookup never changes a gate decision. _Avoid_: Stamp (that is a loyalty credit, not a verified fact), Qualification (that is pre-issuance), credential

**Subject key**: The opaque value a verifier returns to identify the person behind a Badge within one `(verifier, scope)` pair and nowhere else — the whole of what fuda stores about that person. For the `human` Badge it is a World ID 4.0 uniqueness nullifier, scoped to the relying party and the action, and stable for the same person and action whichever of the accepted credentials proved it — the credential is not part of the derivation; that stability is what the one-person-one-Badge rule rests on, and it is confirmed by World's documentation and protocol source rather than by a device measurement (see [the World ID research notes](research/world-id-2026-09-26.md)). A verifier that can only return a globally stable identifier must have it hashed together with the scope before storage. _Avoid_: nullifier (that is one verifier's name for it), user id, pseudonym

**Attendance**: The on-chain evidence of an on-chain Right’s Entry. An offchain Right has no Holder address to name, so its Entries stay in the entry log. _Avoid_: Entry record, stamp, proof of attendance

### Changing a right

**Level upgrade**: Moving a Right to a higher level. Because a Right is immutable this is a revoke plus reissue whose successor carries the predecessor's uid in `serial`; the Holder does not move. _Avoid_: Claim, conversion, claim-and-merge, migration

**Issuer name**: The ENS subname for an Issuer (`<issuer>.fuda.eth`, label = Handle), resolving to the Issuer's wallet — offchain-first and onchain-claimable. A claimed Issuer name follows registry ownership and expiry independently of Issuer delegation revocation. Under it, each Right's Member number is a member label (`<member-no>.<issuer>.fuda.eth`, see `docs/specs/ens-naming.md`); Members as people and Operators are never named. A name never makes an Issuer legitimate. _Avoid_: Venue name, ENS handle, username, member name (that names a Right, not a person)

**Operator**: A person acting for a Venue at the dashboard or the gate (floor staff). Not an on-chain party, and never ENS-named. _Avoid_: Staff, admin (that is fuda's API authorization), issuer
