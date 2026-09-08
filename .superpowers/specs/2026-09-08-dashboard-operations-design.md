# Dashboard operation ownership design

Status: proposed for review; implementation has not started.

## Decision

Separate the existing AppView from orchestration, inject operator workflows at their existing operation interfaces, and give asynchronous work a session-generation ticket. Keep `SessionState`, `DashIo`, `submitDesign`, `applyLogo`, `signInWithPasskey`, and `runClaim`. No state-management dependency or cross-app framework is needed.

The extraction is behavior preserving. A separate task corrects stale operator completions and initializes claim state from the issuer response. This correction is an explicit intended behavior change, not an incidental consequence of moving files.

## Constraints

- Keep URLs, API payloads, CSS, copy, and on-chain protocols unchanged.
- Keep admin and operator authorization distinct; operator sessions never load the admin member list.
- Preserve latest-load-wins for member rows and current-session 401 invalidation, even from a superseded member load.
- Session replacement and sign-out invalidate earlier operator completions, including navigation, errors, busy flags, logo updates, and claim emissions.
- Invalidation suppresses stale local completion; it cannot undo an already submitted HTTP write or chain transaction.
- Add no dependencies and do not modify lockfiles or create a new workspace package.

## File ownership and interfaces

`AppView.tsx` owns the existing `AppView`/`AppViewProps` and page selection. `App.tsx` composes the view and retains route/theme/locale wiring. Test imports move to the defining file; avoid a permanent re-export facade.

`operator-io.ts` exposes `OperatorIo` with `signIn: () => Promise<SignInOutcome>`, `signOut: typeof signOut`, `checkHandle: typeof checkHandle`, `checkSlug: typeof checkCardSlug`, `design: DesignIo`, and `claim: (token: string) => ClaimIo`. The default adapter binds current API/wallet functions. `AppProps` adds optional `operatorIo`; existing callers using `io: DashIo` continue working.

`session-generation.ts` exports `createSessionGeneration(): { capture: () => number; invalidate: () => void; isCurrent: (ticket: number) => boolean }`. App owns one instance for its mounted lifetime. Advance it synchronously on session replacement, sign-out intent, current-session unauthorized handling, and unmount. Starting a passkey sign-in also invalidates a previous sign-in attempt. Ticket checks gate asynchronous commits; retain member-load generation as a separate ordering rule.

Initialize/reset claim state with existing `initialClaimState`. Reset create/sign-in error and busy state when the session changes. After sign-out intent, clear local protected state immediately; an old remote sign-out completion must have no local effect. A boolean logo callback returns false when its completion is stale.

Within a live session, preserve operation behavior and existing failure mapping. Do not add automatic retries or claim transactions. `runClaim` still performs its existing sequence; guarding its emitted local state must not imply cancellation of remote work.

## Verification and acceptance

Use current controller tests through App and AppView callbacks, with injected operator IO and deferred promises. Cover old success and failure after token replacement, pending sign-out versus a new sign-in, stale sign-in, stale create, stale logo, stale claim emissions, and unmount. Verify a current operation still succeeds. Preserve all existing admin concurrency tests. Test that a claimed issuer response initializes the claimed view.

Success means these ownership rules are centralized and tested, not that App meets a line-count target. Update `docs/specs/pass-types-and-flows.md` with the durable session/claim behavior in the correction task. No ADR is needed for an internal extraction.
