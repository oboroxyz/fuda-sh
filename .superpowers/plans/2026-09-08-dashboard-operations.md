# Dashboard Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make operator workflows injectable and prevent their delayed results from changing a replacement session.

**Architecture:** Preserve the existing action modules and admin member-load rules. Extract the view, bind operator dependencies in one adapter, and introduce one session-generation owner for local asynchronous completions. Task 1 is an extraction; Task 2 is an explicit behavior correction.

**Tech Stack:** TypeScript, Hono JSX DOM, Vitest, Vite+, pnpm.

**Spec:** `.superpowers/specs/2026-09-08-dashboard-operations-design.md`

## Global Constraints

- Keep URLs, API payloads, CSS, copy, and on-chain protocols unchanged.
- Keep admin and operator authorization distinct; operator sessions never load the admin member list.
- Preserve latest-load-wins for member rows and current-session 401 invalidation, even from a superseded member load.
- Session replacement and sign-out invalidate earlier operator completions, including navigation, errors, busy flags, logo updates, and claim emissions.
- Invalidation suppresses stale local completion; it cannot undo an already submitted HTTP write or chain transaction.
- Add no dependencies and do not modify lockfiles or create a new workspace package.

---

## Preparation and execution rules

Read AGENTS.md, `.agents/rules/start-of-task.md`, `.agents/rules/superpowers-policy.md`, `.agents/rules/frontend-design.md`, and the spec. This is a proposed plan, not authorization to start implementation. Once execution is requested, use the current checkout unless isolation was requested. Preserve existing README.md/package.json changes. Commit messages are English; do not create a branch automatically on main. Commit steps below apply only under the session's authorized Git workflow.

Read `App.tsx`, `app-actions.ts`, `app-state.ts`, `operator-sign-in.ts`, `ens-claim.ts`, and `app-controller.test.tsx`. Baseline on 2026-09-08: the selected four dash test files passed 39 tests. Rerun the narrow baseline if source content changed. Do not duplicate the hook harness in another test file.

### Task 1: Separate the view and inject operator operations

**Files:**

- Create: `apps/dash/src/AppView.tsx`
- Create: `apps/dash/src/operator-io.ts`
- Modify: `apps/dash/src/App.tsx`
- Modify: `apps/dash/src/app-controller.test.tsx`
- Modify imports: `apps/dash/src/app-view.test.tsx`

**Interfaces:**

- Consumes: existing `DesignIo`, `SignInOutcome`, `ClaimIo`, and API function types.
- Produces: `OperatorIo`, `DEFAULT_OPERATOR_IO`, `AppProps.operatorIo?: OperatorIo`.
- Moves: `AppView`, `AppViewProps` to their defining view file, unchanged.

- [ ] **Step 1: Add an operator callback test at the existing controller test surface.** Add the `operatorIo` parameter to `render` and pass it to `App`. The parameter is optional so every existing test remains intact. Import `OperatorIo` and `DEFAULT_OPERATOR_IO` from the new module. Add:

```ts
it('uses the operator sign-in dependency without loading admin members', async () => {
  const io = fixture()
  const operatorIo: OperatorIo = {
    ...DEFAULT_OPERATOR_IO,
    signIn: vi.fn().mockResolvedValue({
      issuer: { cards: [], ens: null, issuer: null, publicUrl: null },
      ok: true,
      token: 'operator-token',
    }),
  }
  render(io, 'system', operatorIo).onPasskey()
  await setTimeout(0)
  const view = render(io, 'system', operatorIo)
  expect(view.session.token).toBe('operator-token')
  expect(view.route).toBe('/new')
  expect(io.listMembers).not.toHaveBeenCalled()
  expect(operatorIo.signIn).toHaveBeenCalledOnce()
})
```

New render signature: `(io: DashIo, initialTheme: AppProps['initialTheme'] = 'system', operatorIo?: OperatorIo): AppViewProps`; its call is `App({ initialTheme, io, operatorIo })`.

- [ ] **Step 2: Run the new test and confirm failure.** Run `pnpm --filter dash test --run src/app-controller.test.tsx`. Expected failure: new module/prop does not exist. If it already exists when executing, inspect that work instead of overwriting it.

- [ ] **Step 3: Implement the concrete adapter using existing functions.** In `operator-io.ts`, import `checkHandle`, `checkCardSlug`, `claimVoucher`, `confirmEnsClaim`, `issuerMe`, `signInChallenge`, `signInVerify`, `signOut` from `api.ts`; `DEFAULT_DESIGN_IO`/`DesignIo` from `app-actions.ts`; `ENS_PAYMASTER_URL` from `config.ts`; `ClaimIo` from `ens-claim.ts`; `submitClaim` from `ens-submit.ts`; `signInWithPasskey`/`SignInOutcome` from `operator-sign-in.ts`; and the four wallet helpers from `wallet.ts`. Implement:

```ts
export interface OperatorIo {
  checkHandle: typeof checkHandle
  checkSlug: typeof checkCardSlug
  claim: (token: string) => ClaimIo
  design: DesignIo
  signIn: () => Promise<SignInOutcome>
  signOut: typeof signOut
}

export const DEFAULT_OPERATOR_IO: OperatorIo = {
  checkHandle,
  checkSlug: checkCardSlug,
  claim: (token) => ({
    confirmClaim: async (txHash) => await confirmEnsClaim(token, txHash),
    requestVoucher: async () => await claimVoucher(token),
    submitClaim,
  }),
  design: DEFAULT_DESIGN_IO,
  signIn: async () => await signInWithPasskey({
    challenge: signInChallenge,
    issuerMe,
    personalSign,
    provider: async () => await baseAccountProvider(ENS_PAYMASTER_URL),
    requestAccount,
    verify: signInVerify,
  }),
  signOut,
}
```

Bind `operatorIo = DEFAULT_OPERATOR_IO` in App props. Replace direct operator calls with this adapter, including the design IO passed to `submitDesign`/`applyLogo`, and add operatorIo to affected callback dependencies. Keep `DashIo` unchanged.

- [ ] **Step 4: Move the view by symbol, preserving its implementation.** Move `AppViewProps` and `AppView` from current App.tsx lines 61–197 with their view-only imports into `AppView.tsx`. Retain the JSX pragma. App imports the view. Update consumers found with `rg -n 'AppView' apps/dash/src`; do not leave a duplicate or re-export solely to avoid changing tests. Keep `operatorWith` in App for now.

- [ ] **Step 5: Verify extraction behavior.** Run `pnpm --filter dash test --run src/app-controller.test.tsx src/app-view.test.tsx src/app-actions.test.ts src/operator-sign-in.test.ts src/ens-claim.test.ts`. Expected: all existing tests and the injected operator test pass. Inspect the view diff for exact copy/classes/branch preservation.

- [ ] **Step 6: Record the independently reviewable extraction.** Under authorized Git workflow, stage only this task's files and commit with `refactor(dash): isolate view and operator dependencies`.

### Task 2: Give asynchronous completions a session owner

**Files:**

- Create: `apps/dash/src/session-generation.ts`
- Create: `apps/dash/src/session-generation.test.ts`
- Modify: `apps/dash/src/App.tsx`
- Modify: `apps/dash/src/app-controller.test.tsx`
- Modify: `docs/specs/pass-types-and-flows.md` (dashboard session behavior only)

**Interfaces:**

- Consumes: `OperatorIo` from Task 1 and existing `initialClaimState(ens): ClaimState`.
- Produces: `createSessionGeneration(): SessionGeneration` with capture/invalidate/isCurrent below.
- No HTTP or chain interface changes.

- [ ] **Step 1: Add a regression for stale sign-in.** Reuse the Task 1 render signature and import `SignInOutcome`:

```ts
it('does not restore an operator after a replacement admin session', async () => {
  const io = fixture()
  const pending = Promise.withResolvers<SignInOutcome>()
  const operatorIo: OperatorIo = {
    ...DEFAULT_OPERATOR_IO,
    signIn: () => pending.promise,
  }
  render(io, 'system', operatorIo).onPasskey()
  render(io, 'system', operatorIo).onToken('replacement')
  render(io, 'system', operatorIo)
  pending.resolve({
    issuer: { cards: [], ens: null, issuer: null, publicUrl: null },
    ok: true,
    token: 'old-operator',
  })
  await setTimeout(0)
  const view = render(io, 'system', operatorIo)
  expect(view.session.token).toBe('replacement')
  expect(view.session.operator).toBeNull()
  expect(view.signingIn).toBe(false)
  expect(view.route).not.toBe('/new')
})
```

Run `pnpm --filter dash test --run src/app-controller.test.tsx`. Expected before correction: old-operator replaces the admin session. If the regression does not reproduce, verify event ordering and actual behavior before changing the ownership policy.

- [ ] **Step 2: Test and implement generation identity.** Add the following test with Vitest imports and the new factory import:

```ts
it('invalidates every ticket from the previous session', () => {
  const generation = createSessionGeneration()
  const old = generation.capture()
  expect(generation.isCurrent(old)).toBe(true)
  generation.invalidate()
  expect(generation.isCurrent(old)).toBe(false)
  expect(generation.isCurrent(generation.capture())).toBe(true)
})
```

Run the test once before creating the module (expected missing export/module). Then implement:

```ts
export interface SessionGeneration {
  capture: () => number
  invalidate: () => void
  isCurrent: (ticket: number) => boolean
}

export const createSessionGeneration = (): SessionGeneration => {
  let value = 0
  return {
    capture: () => value,
    invalidate: () => { value += 1 },
    isCurrent: (ticket) => ticket === value,
  }
}
```

- [ ] **Step 3: Integrate ownership before and after awaits.** App keeps one factory result via a lazy `useState(createSessionGeneration)`. Centralize session replacement in a local `replaceSession(next: SessionState): void` that invalidates synchronously, sets session, resets creating/createFailure/signingIn/signInError, and calls `setClaimState(initialClaimState(next.operator?.ens ?? null))`. Current-session unauthorized handling calls this with `unauthorizedSession(...)`; old-session errors are ignored. Unmount invalidates in effect cleanup.

Use this guard pattern for `onPasskey`, `onCreate`, `onCommitLogo`, and async check callbacks, with `generation` being the stable factory result:

```ts
const ticket = generation.capture()
const outcome = await submitDesign(operatorIo.design, token, mode, form, logo)
if (!generation.isCurrent(ticket)) {
  return
}
```

For stale logo completion return false; for stale availability checks return `'unknown'`. Check before state/error/busy updates and navigation. Passkey sign-in invalidates previous attempts before capturing its ticket; on success use `replaceSession` after checking the ticket. Sign-out snapshots the old token, immediately calls `replaceSession(signedOutSession())` and navigates home, then invokes remote signOut; its completion never clears a later session. Preserve remote API error handling and do not invent retries.

For ENS use `runClaim(operatorIo.claim(sessionToken), guardedEmit)` with:

```ts
const guardedEmit = (next: ClaimState): void => {
  if (generation.isCurrent(ticket)) {
    setClaimState(next)
  }
}
```

Do not change `runClaim` transaction semantics. Preserve admin `latestMembersLoad`: a current-session 401 ends the session even when its load is superseded. Add session tickets to list/issue/revoke completion paths too so reusing the same token after replacement cannot resurrect a previous session. Never invalidate merely on locale/theme change or on successful create/logo updates within one session.

- [ ] **Step 4: Extend deferred-promise coverage through App callbacks.** Use `Promise.withResolvers<Awaited<ReturnType<OperatorIo['signOut']>>>()` for delayed remote sign-out and the corresponding existing `DesignIo` method result types for create/logo. Reuse form/response fixtures from `app-actions.test.ts` within this repository. Each test starts an old operation, calls `onToken('replacement')`, resolves/rejects the old operation, flushes with `setTimeout(0)`, and asserts replacement token/operator/route and reset busy/error/claim state. Cover:

| Operation | Completion to control | Assertion |
| --- | --- | --- |
| create | success and session failure | no operator insertion, redirect, or replacement-session logout |
| logo | success and session failure | callback false, no replacement issuer mutation/logout |
| sign-out | delayed success | new session survives; old local state clears before completion |
| sign-in | success and failure | old attempt changes neither session nor error/busy state |
| ENS claim | delayed voucher/confirm and emitted failure | replacement claim state unchanged |
| current sign-in | issuer with claimed ENS view | rendered EnsClaim receives claimed state from initialClaimState |
| unmount | any pending operator success | no navigation after cleanup |

The concrete stale-sign-in test above is the template for temporal ordering. Exercise App's callbacks rather than testing only the generation counter. Keep current-operation success coverage and all existing admin 401/generation cases. Do not assert hook slot indices.

- [ ] **Step 5: Run the dash suite.** `pnpm --filter dash test --run`. Expected: every dash test passes, including the new ownership cases. Update the canonical flow spec to state that sign-out clears local state immediately and late old-session completions cannot overwrite it; describe no guarantee of remote transaction cancellation.

- [ ] **Step 6: Verify final content and record the correction.** Run root `pnpm check` and `pnpm test` once, plus `git diff --check`. Report any failures without modifying unrelated files to obtain a green result. Under authorized Git workflow, commit with `fix(dash): scope asynchronous completions to their session`.

## Completion

- [ ] Check each design constraint against the controller tests and diff.
- [ ] Remove this completed plan and its dashboard design after implementation and verification, per repository policy. Keep the independent issuer/Graph plans untouched.
- [ ] Report actual commands/results and remaining limitations. Reuse verification while checked source content is unchanged; artifact-only deletion needs `git diff --check`, not another full suite.
