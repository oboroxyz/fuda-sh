# Task 1 report: Defensive device pass memory

## Implementation

- Added `apps/app/src/pass-memory.ts` with the requested `PASS_MEMORY_KEY`, `PassMemoryEntry`, `PassMemoryStorage`, `readPassMemory`, and `rememberPass` interfaces.
- Reading is fail-soft across default `localStorage` property access, storage reads, JSON parsing, and validation. Payloads must be arrays of exact records with 32-byte UIDs, 20-byte holders, and finite non-negative timestamps; valid records are returned newest-first.
- Remembering prepends the new entry, removes an older matching UID case-insensitively, caps the result at 200 entries, writes once, and returns `[]` if reading or writing is blocked.
- Added `apps/app/src/pass-memory.test.ts` covering read validation, malformed JSON/entries, blocked default storage, prepend, case-insensitive deduplication, cap, and blocked writes.

## Self-review

- The implementation only touches the requested app files and does not leak storage exceptions.
- `readPassMemory` copies before sorting, so decoded input is not mutated.
- The write path uses the same explicit storage when supplied and accesses default storage inside the protected operation.
- `git diff --check` passed.

## TDD evidence

### RED 1

Command: `pnpm --filter app test -- src/pass-memory.test.ts`

Output: failed before running tests with `Error: Cannot find module './pass-memory.ts'`; this was the expected missing-production-module failure.

### GREEN 1

After implementing reading, the same command passed: `1` test file and `4` tests passed.

### RED 2

After adding append/deduplication/cap/write tests, the same command failed `4` tests with `TypeError: rememberPass is not a function`; the four read tests passed.

### GREEN 2 / final focused verification

Command: `pnpm --filter app test -- src/pass-memory.test.ts`

Output: `1` test file and `8` tests passed.

## Required verification

- `pnpm lint`: blocked by an unrelated existing workspace error: `packages/subgraphs/rights/tsconfig.json` cannot find the `vitest` type definition. No errors remained in the new files.
- `pnpm typecheck`: blocked by the same existing missing `vitest` type definition (and existing workspace diagnostics); the new implementation's diagnostics were resolved.

## Concerns

The repository-wide lint/typecheck baseline is currently red because the rights package references an unavailable `vitest` type definition. The focused app test suite passes.
