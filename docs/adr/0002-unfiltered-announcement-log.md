# ADR 0002: the api serves the whole ERC-5564 announcement log, unfiltered

- **Status**: Superseded by ADR 0003 on 2026-09-06. Preserved as the historical
  API-cache decision.
- **Scope**: how `GET /announcements` selects what it returns to a caller.

## Context

+Private rights are attested to one-time stealth addresses and announced
through the ERC-5564 Announcer. The member app must find its own
announcements. The api already indexes the Announcer log into D1
(`GET /announcements`) and could, in principle, narrow what it returns — by
caller (fuda's signer), by a member-supplied key, or by a server-side match.

## Decision

`GET /announcements` returns every scheme-1 announcement from
`ANNOUNCER_FROM_BLOCK` onward, identically to every caller, paged by block
number. The only parameter is `fromBlock`. Matching happens exclusively
client-side with the member's viewing key. The api never accepts a viewing
key, a meta-address, a member id or any other selector on this route, and
never applies a caller filter.

## Consequences

- The privacy property is the absence of a query: the api cannot learn which
  rows belong to which member because it is never told anything about the
  member. Adding a filter, even a harmless-looking one, would turn each
  request into a statement about the caller and is therefore forbidden by
  this decision.
- A caller allow-list on the Announcer's `caller` field would break the
  moment an issuer other than fuda's signer announces (the issuer-signed
  issuance path); the receiver's view tag is the filter ERC-5564 intends.
- Cost is bandwidth and budget: a full walk of a large log takes up to 50
  pages of 1000 rows and spends that many of the caller's 120 hourly
  requests. Base Sepolia's Announcer volume keeps this small; if it grows,
  the mitigation is a larger page or a longer window, never a filter.
- Unlinkability holds against chain observers and the api's log, not against
  the issuer, whose ledger carries the member id next to the uid.
