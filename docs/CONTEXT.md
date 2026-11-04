# fuda

fuda issues membership rights as on-chain attestations and verifies them at a physical gate. This glossary fixes the words used across the specs, code, and UI so that one concept has one name.

It records the vocabulary of the product design, independently of what is built: a term stays here while the concept it names is part of the design, and leaves only when that concept is dropped. Absence of an implementation is never on its own a reason to remove an entry.

## Language

**Attestation chain**: The Base network a deployment reads, writes, and names in offchain signature domains. `CHAIN_ID` selects Base or Base Sepolia in the API, and `VITE_CHAIN_ID` selects the matching browser network. Both default to Base Sepolia when absent. ENS uses its own chain.

### The right

**Right**: A membership entitlement; the source of truth for what a member may do. It is either a signed EAS offchain attestation held by fuda or an on-chain EAS `Entitlement` attestation, as its Card's record decides. _Avoid_: Membership, entitlement (as a prose noun), pass, ticket, card

**Retired signer**: An offchain signing address retained in `OFFCHAIN_RETIRED_SIGNERS` after its private key is removed from the Worker. Its existing Rights remain verifiable. A compromised signer must be removed from the list and its legitimate Rights reissued. _Avoid_: Retired key, delegated key

**Card record**: Where a Card's Rights are recorded, fixed when the Card is created: `offchain` (the default) signs each Right with no transaction and no holder address, and `onchain` attests each Right publicly. _Avoid_: Mode, storage, chain type

**Card identity**: Who can use a Card's Rights, fixed when the Card is created: `none` (the default) means whoever shows one, `passkey` binds each Right to the passkey that claimed it, and `sensitive` binds each Right to a key of its own. _Avoid_: Identity level, KYC

**Identified pass**: An offchain Right on a Card with `passkey` identity. It attests the passkey's credential ID and public key at the Signed level with no holder address, needs an Account to claim, and is presented by answering a challenge in the app, so a copied QR does not admit. _Avoid_: Passkey pass, Secure pass

**Sensitive use**: The Card setting for employee badges and privacy-sensitive memberships: Card identity `sensitive`. Each Right attests a key unique to it, so one person's Rights are not linked across venues, and it has no Wallet pass, QR, backup file, Stamps or integrations. It rejects while the chain cannot be read. Entry logs keep only the Right UID, scan time and row id, with a daily purge after 30 days. A consumed Slot retains no entry time. It does not hide entry from the Issuer or the gate. _Avoid_: Private pass, Secure pass, +Private

**Member secret**: 32 random bytes a member's browser makes for Sensitive use, from which each Right's key derives. The server keeps only ciphertexts of it, one per passkey that supports PRF. _Avoid_: Recovery phrase, master key

**Vault**: One ciphertext per Account, sealed under a key from the Member secret, listing that member's Sensitive Rights and the salts of their keys. Only the member's device can open it. _Avoid_: Wallet, backup

**Pass**: A presentation of a Right — a Device wallet pass (`.pkpass` / Google Wallet object) or the browser-based pass page carrying the Right's QR. A Pass is not the Right, and lives in the Device wallet, never in the Crypto wallet. _Avoid_: Ticket, card, credential

**Pass update**: Wallet fetching a newer copy of an installed Pass, because fuda recorded a change and usually pushed a notice. It changes what the Pass shows, never the Right. _Avoid_: Sync

**Device wallet**: Apple Wallet or Google Wallet — the phone's OS-level container for Passes. A distribution and presentation channel only: it holds no keys, signs nothing, and knows nothing about the chain. Bearer and Signed Rights can have Passes; +Private Rights use the signing and discovery flow without a Pass. Say "Apple Wallet" / "Google Wallet" when the platform matters. _Avoid_: Wallet (bare), wallet app, mobile wallet

**Crypto wallet** (or **wallet**): Software that controls an Ethereum key and can sign — a passkey smart wallet (Base Account) or an EOA. It is what makes a Holder _the member's_: Signed and +Private members hold one; Bearer members do not until Activation. Bare "wallet" in this glossary always means this one, never the Device wallet. _Avoid_: Account (say Holder for the address), key, signer

**Wallet rail** (or **rail**): How a Member holds signing keys — managed (fuda's initial key on an unclaimed Claimable smart account), self-custody passkey, bring-your-own EOA, or a compatible smart wallet. Orthogonal to the verification level: choosing a rail never changes how a Right is verified. _Avoid_: Custody mode, wallet type, login method

**Verification level** (or **level**): The property baked into a Right at issuance that decides how it is verified. There are two: Bearer and Signed. +Private is Signed with the privacy extension on, not a third level — but the on-chain `level` field and the code enumerate all three states (`bearer` / `signed` / `private`) because the gate must tell them apart. Immutable for the life of the Right. _Avoid_: Mode, tier (tier is the FREE/REGULAR/VIP/FOUNDER rank), type, "three levels"

**Bearer**: The level with no Crypto wallet and no app — a Pass in the Device wallet is all the member has; the Right's QR alone admits, and a copy of the QR admits too.

**Member write token**: A secret-derived credential used only to add a wrapped member-secret copy or write the encrypted Sensitive vault. The server stores its hash. It never travels with a claim, challenge, or presentation.

**Start over**: A fresh account passkey assertion clears Sensitive recovery data and local keys on the initiating device. It does not revoke old passes; the Issuer cancels them.

**Signed**: The level where the member's own key must sign a one-time gate challenge — possession of the key is proven at the door.

**+Private**: Signed with the privacy extension: the Right is issued to a one-time stealth address, so chain observers cannot link the Right to the member; the gate challenge is the same as Signed. Unlinkability holds against chain observers, not against the issuer or the gate operator. Written with the leading `+` to mark it as an extension, and stored as `level = private` in code. _Avoid_: Private (bare), anonymous, Native+, "the third level"

**Serial**: The `serial` field of a Right, reserved for reissue lineage (the predecessor Right's uid on a Level upgrade, merge, or recovery). Nothing else may use it.

### The people and addresses

**Member**: The person who holds a Right. Holding one takes no identity at fuda; a Member who signs in has an Account. _Avoid_: User, customer

**Account**: What a person signs in to: a set of passkeys, with no address and no email. As a Member, it keeps Passes and is optional, and it is unrelated to the Issuer's Member id. As an Operator, it owns Issuers. One account serves both. _Avoid_: Profile, wallet

**Holder**: The address a Right is attested to (`recipient`): an unclaimed Claimable smart account for Bearer, the member's wallet for Signed, a stealth address for +Private. A Holder is an address; a Member is a person. _Avoid_: Owner, recipient (in prose), member address

**Claimable smart account**: The smart account that holds a `standard` Right at a stable counterfactual address, known before deployment. **Unclaimed** while fuda's initial key controls it (so a Bearer Right can be issued before the member has any key); **claimed** once Activation puts the Member's key in control. The address never changes either way. _Avoid_: Counterfactual wallet (say "counterfactual" only of the address), custodial account, claim account

**Member id**: The issuer's persistent identifier for a Member, under which that Member's several Rights are grouped. For dual-use (a Private-access Right plus a companion Persistent-value Right) both Rights carry the same Member id — with correlation discipline: an Entry through the Private-access Right never auto-credits the companion Persistent-value Right. In the admin issuance path the Member id is operator-chosen free text; the generated member number (see naming) belongs to the self-serve path. _Avoid_: Representative address (say "the Signed Holder used as Member id"), username

**Issuer**: The party that attests a Right — the address in the EAS `attester` slot and the `issuer` field of every schema, made legitimate by an Issuer delegation. In the MVP the fuda signer attests for every Handle; from B1 each Venue's own wallet does. This is the name the specs, data model, EAS schemas, and ENS use for the organization that issues: an Issuer owns a Handle and an Issuer name, and Rights, Member numbers, and delegations are scoped to it. "Issuer" and "attester" name the same party — use Issuer in prose, `attester` only for the EAS field. _Avoid_: Venue (in specs, schemas, and code — that is the same organization seen from the shop floor, see Venue), Operator (that is a role in the dashboard, not an on-chain party), tenant, merchant

**Template** (or **verification template**): The issuer's per-use-case choice of how a Right is issued, picked at issuance time — `standard` (U1: Bearer, one-tap save, Activation later), `private` (U2: +Private from the start, passkey first), or `private + loyalty` (U3: a Private-access Right plus a Persistent-value Right, never correlated at the Gate). The issuer configures which templates are available and the default; an authorized Operator selects one at issuance, and a self-serve route binds the Handle to a template in advance so no per-member approval is needed. Members do not pick a level. A product-policy label — the Gate only ever sees the level. _Avoid_: Plan, tier, mode, pass template (that is a pass-design concept), "the member's choice"

**Private-access Right** and **Persistent-value Right**: The two Rights a `private + loyalty` (U3) issuance creates. The Private-access Right (+Private, fresh stealth Holder) admits without exposing a stable identity; the Persistent-value Right (Bearer or Signed, stable Holder — a Claimable smart account or the member's wallet) retains Stamps, balance, and history. Never correlated at the Gate: presenting the Private-access Right must not fetch the other, and an Entry through it must not auto-credit value — value actions are a separate, explicit interaction. _Avoid_: Loyalty card (bare), value Right, companion Right, "the two passes"

**Venue**: An organization that issues Rights to its members — the shop, club, or office as the member and its staff see it. A business-domain term, not a required UI label. Member-facing and operator-facing copy uses context-specific labels such as Profile, Name, Handle and Public page so it also fits companies and communities. Wherever the organization appears as a party in a spec, schema, column, EAS field, or ENS name, it is the Issuer: one Venue is one Issuer, and Venue never appears in the data model. From B1 it holds its own smart wallet and attests its Rights itself. _Avoid_: Issuer or Venue as generic UI labels, tenant, merchant, operator, shop

**Handle**: An Issuer's permanent identifier — the `/@handle` slug, shaped as a DNS/ENS label so it is also the Issuer's ENS label (`<issuer>.fuda.eth`) 1:1. _Avoid_: Slug, username, venue name, issuer name (that is the ENS name built from the Handle)

**Agent key**: A fuda-held owner key added to an Issuer's wallet so the api can issue on the Issuer's behalf when no human is present; the Issuer can remove it at any time. _Avoid_: Session key, API key, delegate key, service key

**Issuer delegation**: The `IssuerDelegation` attestation, referenced by a Right's `refUID`, that lets a gate decide whether the Right's Issuer is allowed to issue. _Avoid_: Whitelist, registry, permission

**Connected app**: A program built outside fuda — typically a browser-only Figma Make app — that an Operator registers in the dashboard and approves for one Issuer, after which it acts for that Issuer through the api with an access token (see `docs/specs/connected-apps.md`). It has a client ID and no secret, never creates an Issuer, and reaches no other Issuer's data. Only the account that registered it may approve it. _Avoid_: Integration (that is a Card's optional service), plugin, API client, partner

**MCP client**: A connected app that is an AI agent tool such as Claude Code, reaching fuda through the api's MCP server with a token bound to that server.

**Approval** (of a connected app): The Operator's consent, on fuda's consent page, that one connected app may act for one of their Issuers with a fixed set of scopes. It is held as an access token and ends when revoked from the dashboard, revoked by the app, or expired, or when the app is deleted. _Avoid_: Grant (in UI copy), authorization (in prose; that is the OAuth step), connection

**RPC fallback**: The API trying the public Base Sepolia endpoint after its preferred provider fails. It changes provider availability, not the Gate's admission rules. Contract reverts remain failures.

**Gate**: Whatever reads the chain and decides ADMIT or REJECT for a presented Right — fuda's api by default, but any verifier can be a Gate. _Avoid_: Scanner (that is the `apps/gate` device), verifier (in prose), door

**Issuer wallet**: The Crypto wallet through which an Issuer controls its assets and authorizes operations. Optional: an Issuer owned by an Account has none. Its identity is distinct from the people or credentials controlling it, and from a service signer acting on the Issuer's behalf. _Avoid_: Operator wallet (when referring to the shared organization identity), staff wallet

**Owner credential**: A key or wallet with full control of an Issuer wallet. Several owner credentials can control the same Issuer wallet; changing a credential does not create another Issuer. An Owner credential grants wallet control, not a limited operational role. _Avoid_: Operator (that is a person), Holder (that is the recipient of a Right)

### Entering

**Entry path** (or **path**): How a given entry was made: `qr` (a Bearer QR was scanned) or `signature` (a challenge was signed). Level says what a Right _is_; path says how it _got in_. _Avoid_: Mode, method, flow

**Level and path, never "mode":** a Right has a **level** (Bearer, Signed; +Private is a privacy extension of Signed) and an Entry has a **path** (`qr` or `signature`). "Mode" is not used for either. The api's `x-auth-mode` response header (`open` / `locked`) names the admin-auth state and keeps its name.

**Challenge**: The one-time string a Signed or +Private member signs to enter, bound to one Right and one nonce with a short lifetime. _Avoid_: Nonce (that is only the random part), token

**Slot**: The unit consumed on entry by a `SINGLE_USE` Right; consumed at most once. _Avoid_: Ticket, seat, use

**Entry**: One ADMIT of a Right at a Gate, recorded off-chain in the entry log. _Avoid_: Check-in, visit, scan

**Stamp**: One unit of a Venue's loyalty count for a Right, awarded under the Stamp policy configured for its Card. An Entry does not necessarily earn a Stamp. When a card holds its Card's goal, the shop can give the reward: a **redemption** takes the goal off the count, and the shop can also correct the count with an **adjustment** and a reason. Both are kept in an append-only ledger, so the count is credits plus the ledger and history stays. _Avoid_: Point, visit count, check-in

**Member number**: The random label every Right receives at issuance: 13 characters from the 28-character alphabet `23456789acdefghjkmnpqrtuvwxy` — 12 random plus one check character — stored canonical lowercase with no separators (`qj2yxphepdrka`) and shown upper-cased in `4-4-5` groups (`QJ2Y-XPHE-PDRKA`) on the Pass and dashboard. One per Right (a `private + loyalty` member has two unrelated numbers), unique per Issuer, never sequential. It is the ENS member label (`<member-no>.<issuer>.fuda.eth`, see `docs/specs/ens-naming.md`) and is not the Member id, which groups a Member's several Rights. _Avoid_: Member id, serial (that is the Right's lineage field), sequence number

**Qualification**: The external fact that makes a Member eligible for a Right (registered for the event, on the roster, paid) — read from a Qualification source before issuance is triggered. _Avoid_: Eligibility, entitlement (that is the Right), registration (one kind of Qualification)

**Integration** (of a Card): An optional external service an Issuer turns on for one Card, off by default and saved apart from the Card. A Card's integrations decide which Badge kinds its members may attach; the gate never reads them. _Avoid_: Plugin, add-on, feature flag, connector

**Badge**: A verified fact about the Member holding a Right, attached after issuance and naming the verifier that attested it. The `human` Badge claims one thing — that a unique person holds the Right — and more than one credential can prove it: World ID's proof of human or Japan's My Number Card. Which one answered is recorded for auditing and is never shown; the Badge names the claim, never the credential or the vendor. Advisory: a missing or failed Badge lookup never changes a gate decision. _Avoid_: Stamp (that is a loyalty credit, not a verified fact), Qualification (that is pre-issuance), credential

**Subject key**: The opaque value a verifier returns to identify the person behind a Badge within one `(verifier, scope)` pair and nowhere else — the whole of what fuda stores about that person. For the `human` Badge it is a World ID 4.0 uniqueness nullifier, scoped to the relying party and the action, and stable for the same person and action whichever of the accepted credentials proved it — the credential is not part of the derivation; that stability is what the one-person-one-Badge rule rests on, and it is confirmed by World's documentation and protocol source rather than by a device measurement (see [the World ID research notes](research/world-id-2026-09-26.md)). A verifier that can only return a globally stable identifier must have it hashed together with the scope before storage. _Avoid_: nullifier (that is one verifier's name for it), user id, pseudonym

**Attendance**: The on-chain evidence of a public Right’s Entry. A Card has it on or off, and only an on-chain Card can have it on: a ticket starts on and a membership starts off. +Private Entries have no Attendance, so their visit history stays offchain. _Avoid_: Entry record, stamp, proof of attendance

### Changing a right

**Activation**: The Member taking control of a `standard` Right's Claimable smart account: their passkey (the default) or EOA is added as owner and fuda removes its initial owner — the account is now claimed. Not a validity change: the Right is fully valid and admitting before and after; what changes is who controls the Holder account. Same Holder address, uid, Pass, Stamps, and history; the level stays Bearer and the QR still admits, but the Member's key can now also answer a Signed challenge. Member-facing copy never says "activate" — it says **"Secure your pass"**. _Avoid_: Claim (the account is "claimed"; the act is Activation), upgrade, migration, enable/validate (nothing was invalid before)

**Claim key**: The random secret only the Bearer Member holds (delivered inside their own Pass, never in the QR) that authorizes Activation of that Right's Holder account. A bearer secret, not a key pair — the member-side counterpart of the Agent key. _Avoid_: Claim token, claim code, claim pass, secret, password

**Level upgrade**: Moving a Right to a higher level. Because a Right is immutable this is a revoke plus reissue whose successor carries the predecessor's uid in `serial`; the Holder does not move. _Avoid_: Activation, claim, conversion, claim-and-merge, migration

**Issuer name**: The ENS subname for an Issuer (`<issuer>.fuda.eth`, label = Handle), resolving to the Issuer's wallet — offchain-first and onchain-claimable. A claimed Issuer name follows registry ownership and expiry independently of Issuer delegation revocation. Under it, each Right's Member number is a member label (`<member-no>.<issuer>.fuda.eth`, see `docs/specs/ens-naming.md`); Members as people and Operators are never named. A name never makes an Issuer legitimate. _Avoid_: Venue name, ENS handle, username, member name (that names a Right, not a person)

**Operator**: A person acting for a Venue at the dashboard or the gate (floor staff). Signs in with an Account's passkey, or with a Crypto wallet for an Issuer that wallet owns. Not an on-chain party, and never ENS-named. _Avoid_: Staff, admin (that is fuda's API authorization), issuer

**Meta-address**: The ERC-5564 spending + viewing public pair, derived locally from the Member's PRF passkey, that the Member gives the Issuer to enable +Private issuance — the only thing the Issuer ever learns. Every +Private Right still lands on a fresh stealth address derived from it per issuance. _Avoid_: Stealth address (that is the per-Right Holder), public key, member address

**Announcement**: The ERC-5564 log emitted when a +Private Right is issued, by which the Member discovers the Right client-side. The only way a +Private Holder is ever communicated. _Avoid_: Notification, broadcast
