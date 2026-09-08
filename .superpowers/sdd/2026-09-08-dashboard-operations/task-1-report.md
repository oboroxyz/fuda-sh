# Task 1 report: separate the dashboard view and operator operations

## Changes

- Added `apps/dash/src/AppView.tsx` and moved `AppView`/`AppViewProps` there without changing the view implementation.
- Added `apps/dash/src/operator-io.ts` with `OperatorIo` and `DEFAULT_OPERATOR_IO`, binding the existing API, design, claim, sign-in, sign-out, and wallet functions.
- Added optional `AppProps.operatorIo` and routed operator sign-in, sign-out, handle/slug checks, design submission, logo updates, and ENS claim setup through the injected adapter.
- Updated controller/view test imports and added the injected operator sign-in test proving admin member loading is not triggered.

## TDD RED/GREEN

RED:

```text
pnpm --filter dash test --run src/app-controller.test.tsx
Error: Cannot find module '/src/operator-io.ts' imported from .../apps/dash/src/app-controller.test.tsx
Test Files  1 failed (1)
Tests  no tests
```

GREEN:

```text
pnpm --filter dash test --run src/app-controller.test.tsx src/app-view.test.tsx
Test Files  2 passed (2)
Tests  25 passed (25)
```

## Verification

```text
pnpm --filter dash test --run src/app-controller.test.tsx src/app-view.test.tsx src/app-actions.test.ts src/operator-sign-in.test.ts src/ens-claim.test.ts
Test Files  5 passed (5)
Tests  48 passed (48)

pnpm exec vp lint apps/dash/src/App.tsx apps/dash/src/AppView.tsx apps/dash/src/operator-io.ts apps/dash/src/app-controller.test.tsx apps/dash/src/app-view.test.tsx
passed with no findings

pnpm exec vp check --no-fmt --no-lint apps/dash/src/App.tsx apps/dash/src/AppView.tsx apps/dash/src/operator-io.ts apps/dash/src/app-controller.test.tsx apps/dash/src/app-view.test.tsx
pass: Found no type errors in 3 files

pnpm exec vp fmt apps/dash/src/App.tsx apps/dash/src/AppView.tsx apps/dash/src/operator-io.ts apps/dash/src/app-controller.test.tsx apps/dash/src/app-view.test.tsx
Finished in 115ms on 5 files

git diff --check
passed
```

## Self-review

- `DashIo` remains unchanged and is still used only for admin operations.
- `AppView` has no duplicate or compatibility re-export; both view tests and controller tests import it from its defining file.
- The moved view implementation was compared against the original `App.tsx` block and is unchanged.
- Operator callback dependencies now include `operatorIo` where `useCallback` captures it.
- No plan/spec files or unrelated source files were changed.

## Concerns

- Full workspace verification is intentionally deferred to the controller, per the task brief.
- The type-check command reports the three production files it type-checks; test behavior is covered by the targeted Vitest suite above.
