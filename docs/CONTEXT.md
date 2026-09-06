# fuda

fuda issues membership rights as on-chain attestations and verifies them at a
physical gate. This glossary fixes the words used across the specs, code, and
UI so that one concept has one name.

## Language

### The right

**Right**:
A membership entitlement that lives on-chain as an EAS `Entitlement`
attestation; the source of truth for what a member may do.
_Avoid_: Membership, entitlement (as a prose noun), pass, ticket, card

**Pass**:
A presentation of a Right — a Device wallet pass (`.pkpass` / Google Wallet
object) or the browser-based pass page carrying the Right's QR. A Pass is not
the Right, and lives in the Device wallet, never in the Crypto wallet.
_Avoid_: Ticket, card, credential

**Device wallet**:
Apple Wallet or Google Wallet — the phone's OS-level container for Passes. A
distribution and presentation channel only: it holds no keys, signs nothing,
and knows nothing about the chain. Every level uses one; Bearer uses nothing
else. Say "Apple Wallet" / "Google Wallet" when the platform matters.
_Avoid_: Wallet (bare), wallet app, mobile wallet

**Crypto wallet** (or **wallet**):
Software that controls an Ethereum key and can sign — a passkey smart wallet
(Base Account) or an EOA. It is what makes a Holder _the member's_: Signed and
+Private members hold one; Bearer members do not until Activation. Bare
"wallet" in this glossary always means this one, never the Device wallet.
_Avoid_: Account (say Holder for the address), key, signer

**Wallet rail** (or **rail**):
How a Member holds signing keys — managed (fuda's initial key on an
unclaimed Claimable smart account), self-custody passkey, bring-your-own
EOA, or a compatible smart wallet. Orthogonal to the verification level:
choosing a rail never changes how a Right is verified.
_Avoid_: Custody mode, wallet type, login method

**Verification level** (or **level**):
The property baked into a Right at issuance that decides how it is verified.
There are two: Bearer and Signed. +Private is Signed with the privacy
extension on, not a third level — but the on-chain `level` field and the code
enumerate all three states (`bearer` / `signed` / `private`) because the gate
must tell them apart. Immutable for the life of the Right.
_Avoid_: Mode, tier (tier is the FREE/REGULAR/VIP/FOUNDER rank), type,
"three levels"

**Bearer**:
The level with no Crypto wallet and no app — a Pass in the Device wallet is
all the member has; the Right's QR alone admits, and a copy of the QR admits
too.

**Signed**:
The level where the member's own key must sign a one-time gate challenge —
possession of the key is proven at the door.

**+Private**:
Signed with the privacy extension: the Right is issued to a one-time stealth
address, so chain observers cannot link the Right to the member; the gate
challenge is the same as Signed. Unlinkability holds against chain observers,
not against the issuer or the gate operator. Written with the leading `+` to
mark it as an extension, and stored as `level = private` in code.
_Avoid_: Private (bare), anonymous, Native+, "the third level"

**Serial**:
The `serial` field of a Right, reserved for reissue lineage (the predecessor
Right's uid on a Level upgrade, merge, or recovery). Nothing else may use it.

### The people and addresses

**Member**:
The person who holds a Right. fuda has no identity for a Member beyond what
the issuer chose to record.
_Avoid_: User, customer, account

**Holder**:
The address a Right is attested to (`recipient`): an unclaimed Claimable
smart account for Bearer, the member's wallet for Signed, a stealth address
for +Private. A Holder is an address; a Member is a person.
_Avoid_: Owner, recipient (in prose), member address

**Claimable smart account**:
The smart account that holds a `standard` Right at a stable counterfactual
address, known before deployment. **Unclaimed** while fuda's initial key
controls it (so a Bearer Right can be issued before the member has any
key); **claimed** once Activation puts the Member's key in control. The
address never changes either way.
_Avoid_: Counterfactual wallet (say "counterfactual" only of the address),
custodial account, claim account

**Member id**:
The issuer's persistent identifier for a Member, under which that Member's
several Rights are grouped. For dual-use (a Private-access Right plus a
companion Persistent-value Right) both Rights carry the same Member id —
with correlation discipline: an Entry through the Private-access Right
never auto-credits the companion Persistent-value Right. In the admin
issuance path the Member id is operator-chosen free text; the generated
member number (see naming) belongs to the self-serve path.
_Avoid_: Representative address (say "the Signed Holder used as Member id"),
username

**Issuer**:
The party that attests a Right — the address in the EAS `attester` slot and
the `issuer` field of every schema, made legitimate by an Issuer delegation.
In the MVP the fuda signer attests for every Handle; from B1 each Venue's own
wallet does. This is the name the specs, data model, EAS schemas, and ENS
use for the organization that issues: an Issuer owns a Handle and an Issuer
name, and Rights, Member numbers, and delegations are scoped to it. "Issuer"
and "attester" name the same party — use Issuer in prose, `attester` only for
the EAS field.
_Avoid_: Venue (in specs, schemas, and code — that is the same organization
seen from the shop floor, see Venue), Operator (that is a role in the
dashboard, not an on-chain party), tenant, merchant

**Template** (or **verification template**):
The issuer's per-use-case choice of how a Right is issued, picked at
issuance time — `standard` (U1: Bearer, one-tap save, Activation later),
`private` (U2: +Private from the start, passkey first), or
`private + loyalty` (U3: a Private-access Right plus a Persistent-value
Right, never correlated at the Gate). The issuer configures which templates
are available and the default; an authorized Operator selects one at
issuance, and a self-serve route binds the Handle to a template in advance
so no per-member approval is needed. Members do not pick a level. A
product-policy label — the Gate only ever sees the level.
_Avoid_: Plan, tier, mode, pass template (that is a pass-design concept),
"the member's choice"

**Private-access Right** and **Persistent-value Right**:
The two Rights a `private + loyalty` (U3) issuance creates. The
Private-access Right (+Private, fresh stealth Holder) admits without
exposing a stable identity; the Persistent-value Right (Bearer or Signed,
stable Holder — a Claimable smart account or the member's wallet) retains
Stamps, balance, and history. Never correlated at the Gate: presenting the
Private-access Right must not fetch the other, and an Entry through it must
not auto-credit value — value actions are a separate, explicit interaction.
_Avoid_: Loyalty card (bare), value Right, companion Right, "the two
passes"

**Venue**:
An organization that issues Rights to its members — the shop, club, or
office as the member and its staff see it. The word for member-facing and
operator-facing copy and for describing the business. Wherever the
organization appears as a party in a spec, schema, column, EAS field, or ENS
name, it is the Issuer: one Venue is one Issuer, and Venue never appears in
the data model. From B1 it holds its own smart wallet and attests its Rights
itself.
_Avoid_: Issuer (in UI copy — say Venue), tenant, merchant, operator, shop

**Handle**:
An Issuer's permanent identifier — the `/@handle` slug, shaped as a DNS/ENS
label so it is also the Issuer's ENS label (`<issuer>.fuda.eth`) 1:1.
_Avoid_: Slug, username, venue name, issuer name (that is the ENS name built
from the Handle)

**Agent key**:
A fuda-held owner key added to an Issuer's wallet so the api can issue on
the Issuer's behalf when no human is present; the Issuer can remove it at any
time.
_Avoid_: Session key, API key, delegate key, service key

**Issuer delegation**:
The `IssuerDelegation` attestation, referenced by a Right's `refUID`, that
lets a gate decide whether the Right's Issuer is allowed to issue.
_Avoid_: Whitelist, registry, permission

**Gate**:
Whatever reads the chain and decides ADMIT or REJECT for a presented Right —
fuda's api by default, but any verifier can be a Gate.
_Avoid_: Scanner (that is the `apps/gate` device), verifier (in prose), door

### Entering

**Entry path** (or **path**):
How a given entry was made: `qr` (a Bearer QR was scanned) or `signature` (a
challenge was signed). Level says what a Right _is_; path says how it _got in_.
_Avoid_: Mode, method, flow

**Level and path, never "mode":** a Right has a **level** (Bearer, Signed;
+Private is a privacy extension of Signed) and an Entry has a **path** (`qr`
or `signature`). "Mode" is not used for either. The api's `x-auth-mode`
response header (`open` / `locked`) names the admin-auth state and keeps its
name.

**Challenge**:
The one-time string a Signed or +Private member signs to enter, bound to one
Right and one nonce with a short lifetime.
_Avoid_: Nonce (that is only the random part), token

**Slot**:
The unit consumed on entry by a SINGLE*USE Right; consumed at most once.
\_Avoid*: Ticket, seat, use

**Entry**:
One ADMIT of a Right at a Gate, recorded off-chain in the entry log.
_Avoid_: Check-in, visit, scan

**Stamp**:
One unit of a Venue's loyalty count for a Right — the number of that Right's
Entries, whatever their path. Display-only in B1; redemption is out of scope.
_Avoid_: Point, visit count, check-in

**Member number**:
The random label every Right receives at issuance: 13 characters from the
28-character alphabet `23456789acdefghjkmnpqrtuvwxy` — 12 random plus one
check character — stored canonical lowercase with no separators
(`qj2yxphepdrka`) and shown upper-cased in `4-4-5` groups
(`QJ2Y-XPHE-PDRKA`) on the Pass and dashboard. One per Right (a
`private + loyalty` member has two unrelated numbers), unique per Issuer,
never sequential. It is the ENS member label
(`<member-no>.<issuer>.fuda.eth`, see `docs/specs/naming.md`) and is not
the Member id, which groups a Member's several Rights.
_Avoid_: Member id, serial (that is the Right's lineage field), sequence
number

**Qualification**:
The external fact that makes a Member eligible for a Right (registered for
the event, on the roster, paid) — read from a Qualification source before
issuance is triggered.
_Avoid_: Eligibility, entitlement (that is the Right), registration (one kind
of Qualification)

**Sentinel**:
The agent that watches the live subgraph for abuse patterns (a leaked Bearer
QR) and drafts the countermeasure — a revoke the operator confirms.
_Avoid_: Monitor, bot, watchdog, guard

**Attendance**:
The on-chain `Attendance` attestation written after an Entry — the public,
composable evidence of entry that sponsor integrations consume.
_Avoid_: Entry record, stamp, proof of attendance

### Changing a right

**Activation**:
The Member taking control of a `standard` Right's Claimable smart account:
their passkey (the default) or EOA is added as owner and fuda removes its
initial owner — the account is now claimed. Not a validity change: the
Right is fully valid and admitting before and after; what changes is who
controls the Holder account. Same Holder address, uid, Pass, Stamps, and
history; the level stays Bearer and the QR still admits, but the Member's
key can now also answer a Signed challenge. Member-facing copy never says
"activate" — it says **"Secure your pass"**.
_Avoid_: Claim (the account is "claimed"; the act is Activation), upgrade,
migration, enable/validate (nothing was invalid before)

**Claim key**:
The random secret only the Bearer Member holds (delivered inside their own
Pass, never in the QR) that authorizes Activation of that Right's Holder
account. A bearer secret, not a key pair — the member-side counterpart of the
Agent key.
_Avoid_: Claim token, claim code, claim pass, secret, password

**Level upgrade**:
Moving a Right to a higher level. Because a Right is immutable this is a
revoke plus reissue whose successor carries the predecessor's uid in `serial`;
the Holder does not move.
_Avoid_: Activation, claim, conversion, claim-and-merge, migration

**Issuer name**:
The ENS subname for an Issuer (`<issuer>.fuda.eth`, label = Handle),
resolving to the address that attests Rights under that Handle —
offchain-first, onchain-claimable, and living and dying with the Issuer
delegation. Under it, each Right's Member number is a member label
(`<member-no>.<issuer>.fuda.eth`, see `docs/specs/naming.md`); Members as
people and Operators are never named. A name never makes an Issuer
legitimate.
_Avoid_: Venue name, ENS handle, username, member name (that names a Right,
not a person)

**Operator**:
A person acting for a Venue at the dashboard or the gate (floor staff). Not an
on-chain party, and never ENS-named (operator names deleted 2026-09-01).
_Avoid_: Staff, admin (that is fuda's API authorization), issuer

**Meta-address**:
The ERC-5564 spending + viewing public pair, derived locally from the
Member's PRF passkey, that the Member gives the Issuer to enable +Private
issuance — the only thing the Issuer ever learns. Every +Private Right
still lands on a fresh stealth address derived from it per issuance.
_Avoid_: Stealth address (that is the per-Right Holder), public key,
member address

**Announcement**:
The ERC-5564 log emitted when a +Private Right is issued, by which the Member
discovers the Right client-side. The only way a +Private Holder is ever
communicated.
_Avoid_: Notification, broadcast
