# Shared issuer wallet foundation Implementation Plan

> **For agentic workers:** Execute the two tasks inline with verification checkpoints using executing-plans. Work in this checkout as required by repository policy.

**Goal:** Establish and verify the shared issuer-wallet model without adding MVP UI or changing deployed account state.

**Architecture:** A read-only operational probe exercises viem's real Coinbase Smart Account signatures through fuda's existing ChainClient verifier. An ADR records the distinction between the issuer wallet and the credentials controlling it, and the unresolved conditions for shipping co-owner login.

**Tech Stack:** TypeScript, installed viem 2.56.3, tsx, Base Sepolia, Vite+.

**Spec:** `.superpowers/specs/2026-09-09-venue-wallet-owners-design.md`

## Global Constraints

- Preserve existing edits, current frontend routes, SQL schema, API wire format, signer selection and session behavior.
- No live owner changes, registration transactions or database writes.
- Use generated throwaway keys; never load or print a user's private key.
- Probe only Base Sepolia (84532), using the current Coinbase factory version 1.
- No new dependency or workspace.

### Task 1: Verify two owners against one wallet identity

**Files:** Create `apps/api/scripts/probe-venue-wallet.ts`; modify `apps/api/package.json` and the input type of `apps/api/src/chain/viem-chain.ts`.

**Interfaces:** The CLI `pnpm --filter api probe:venue-wallet` accepts optional `BASE_RPC_URL`. Success exits zero after every assertion; failure exits nonzero without printing the RPC URL or keys. It consumes the existing `ChainClient.verifyMessage` implementation.

- [ ] Implement the executable probe as an integration check. The test first constructs two accounts with identical `owners` and different `ownerIndex`, then asserts equal addresses and acceptance of both signatures. Negative assertions use a different message and a raw owner signature against the wallet address.

```ts
const wallets = await Promise.all(
  [0, 1].map((ownerIndex) => toCoinbaseSmartAccount({ client, owners, ownerIndex, nonce, version: '1' })),
)
assert.equal(wallets[0].address, wallets[1].address)
```

- [ ] Narrow `createViemChain`'s input to the five bindings it actually reads (`BASE_RPC_URL`, `SIGNER_PRIVATE_KEY`, `EAS_ADDRESS`, `FACTORY_ADDRESS`, `ANNOUNCER_ADDRESS`) so the Node probe can call the real verifier without fabricating a D1 binding. Change no executable verifier code.
- [ ] Run `pnpm --filter api probe:venue-wallet` against Base Sepolia and verify successful positive/negative checks and absent onchain bytecode before and after. Treat unavailable RPC as a failed probe, never as proof.
- [ ] Run lint/type/format checks. The CLI itself is the live integration test; do not add tests that merely assert the upstream SDK's own implementation.

### Task 2: Record the model and release conditions

**Files:** Create `docs/adr/0008-shared-issuer-wallet.md`; update `docs/specs/pass-types-and-flows.md`, `docs/runbook.md`, and terminology comments where needed.

**Interfaces:** No API or schema change. The specification links the ADR and states that owner management is not shipped. The runbook documents the exact command, input, outputs, and simulation limits.

- [ ] Record one issuer per wallet, multiple full co-owners, wallet-proof authentication, chain scope, session-removal requirements, and distinction from limited staff/hot-key delegation.
- [ ] Document current limitations without presenting future UI or revocation as implemented.
- [ ] Run `pnpm check` and `pnpm test` against final content; reuse existing unrelated failure evidence only when still applicable and report remaining failures accurately.
- [ ] Review the exact diff, preserve unrelated changes, and remove these completed temporary artifacts when the deliverable is verified.
