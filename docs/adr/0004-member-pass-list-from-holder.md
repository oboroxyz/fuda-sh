# ADR 0004: a member's pass list is derived from holder addresses, not from a fuda account

- **Status**: Accepted 2026-09-06. Implementation planned on the Graph
  integration branch (`/rights` in the member app is the seam); the
  activation half waits for the B1 P5 work.
- **Scope**: how the member app shows "my passes" across Bearer, Signed and
  +Private rights, and what identifies the member while doing so.
- **Numbering**: 0003 is taken by the Graph push/query lanes ADR on the same
  branch.

## Context

A right is a public EAS attestation whose `holder` is an address. A pass is a
presentation of that right (browser page, Google Wallet, Apple Wallet). The
member app already lists rights for a typed-in holder address by querying the
rights subgraph (`/rights`), and discovers +Private rights by scanning the
announcement log client-side with a passkey-derived viewing key (`/private`).

The missing piece is the list a member expects from a wallet: "everything I
hold", opened from one place, without typing an address. The obvious design,
a fuda account with a server-side session that owns a list of uids, would
make fuda the source of truth for what a member holds. That contradicts the
product rule that validity never leaves the chain, and it would give fuda a
table linking members to rights that the +Private design exists to avoid.

Bearer rights complicate this. Before activation, a Bearer right's holder is a
claimable smart account whose only owner is fuda; the member holds no key that
proves anything about it. What the member does hold is the pass URL (the uid)
they were handed at issuance.

## Decision

1. **The list is a function of holder addresses.** "My passes" for public
   rights (Bearer, Signed) is "every Entitlement whose `holder` is one of my
   addresses", read from the rights subgraph or EAS. There is no server-side
   session, account or per-member list; the api learns nothing new.
2. **A passkey supplies an address, not a login.** For Signed rights, and for
   Bearer rights after activation, the member app derives the holder address
   through the existing key rail (Base Account passkey or injected EOA) and
   queries by it. No signature is required to read: the data is public and
   the address is the only input.
3. **Unactivated Bearer rights are remembered on the device.** When a pass is
   claimed or opened in the member app, its uid and holder are stored in the
   browser's local storage. The list renders those rows next to the
   key-derived ones, and each row re-reads its live status from
   `GET /verify/:uid`. Losing the device loses the memory, exactly as a wallet
   app would; activation (P5) is the durable answer, because it moves the
   same holder under the member's passkey without changing its address.
4. **+Private stays on its own path.** Private rights are found by client-side
   viewing-key matching and are never queried by holder from a server. The app
   may show both lists on one screen, since it is the member's own device, but
   it never sends a request that contains a public holder and a stealth
   address together.
5. **Every row links its passes.** A public right's row carries the api's
   `passUrls` (web, Google, Apple) so the list is the bridge between the
   browser pass and the OS wallets. Private rights have no pass and link to
   the Signed entry flow instead.

## Consequences

- No new api routes, tables or secrets. The work is in the member app and in
  the sdk's Graph queries.
- The rights list is only as fresh as the subgraph; the per-row status
  re-read from the api keeps revocation honest even when the index lags, and
  the list degrades to the device-remembered rows if the Graph endpoint is
  unset or down.
- A member with several devices sees the union only after activation; until
  then each device shows what it claimed. This is stated on the list screen.
- The list shows public rights publicly: anyone who knows an address can build
  the same view. That is already true of the chain and is by design for
  Bearer and Signed rights.
- The apex origin never renders the list; it lives on the app origin with the
  passkey `rp.id`, like `/signed` and `/private`.
