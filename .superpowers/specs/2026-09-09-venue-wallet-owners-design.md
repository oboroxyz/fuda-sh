# Shared issuer wallet foundation

The approved scope is a MultiOwnable feasibility probe and durable design, while preserving the MVP dashboard and one issuer per wallet. Two co-owners control one issuer wallet; they do not create separate issuers. No live owner changes, registration transactions, production database writes, or additional staff UI are authorized by this task.

The probe uses the installed viem Coinbase Smart Account v1 implementation (the factory currently configured by fuda), two randomly generated throwaway EOA owners, and Base Sepolia RPC. It constructs the same undeployed account with each owner selected, signs a dashboard-shaped challenge, and checks both signatures with the API's actual chain verifier. Negative cases reject a changed challenge and an unwrapped owner's personal signature. Check the RPC chain ID and account code before and after verification. ERC-6492 validation may simulate deployment inside eth_call; it must not deploy the account onchain. Print public addresses and verification results only.

This proves the cryptographic account-identity assumption for initial multiple owners. It does not prove adding an owner to an existing deployed wallet, Base Account popup discovery, passkey/contract-owner nesting, session invalidation, or Ethereum Sepolia owner synchronization. These limits must remain explicit.

The durable decision keeps issuer wallet identity separate from owner credentials. Future co-owner login must verify a proof against the issuer wallet, rather than treating an owner's ordinary personal signature as that proof. ENS ownership remains the issuer wallet. Co-owners have full wallet control; restricted staff and automated keys are a different authorization path. Owner removal must invalidate affected sessions before future co-owner UI ships; the current 30-day bearer sessions do not do that.

Preserve existing edits in this checkout. Keep current frontend routes, SQL schema, API wire format, signer selection and session behavior unchanged. Do not create or enter a worktree, add dependencies, or commit unrelated work.
