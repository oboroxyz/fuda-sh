---
name: verify-admission
description: Check that a SINGLE_USE fuda pass is admitted at most once and that reception never awards more stamps on a day than its daily limit, under every interleaving of concurrent gate scans, reception scans, retries, a limit change and midnight. Use before merging any change to admitSingleUse, recordReception, the verify or reception handlers, or the entry_log, slots, stamp_credits or reception_requests tables.
---

# Verify admission and stamp limits

Two promises, each with the harm if it breaks:

- **Single use.** A SINGLE_USE pass shows ADMIT at most once, across gate QR scans, signed admissions, reception scans and reception retries. If it breaks, one ticket gets two people in.
- **Daily cap.** The stamps booked to a Tokyo day never exceed the highest daily limit that was in force while that day was current. A retried reception request awards at most one stamp and replays the same receipt. If it breaks, a customer collects rewards faster than the shop allows.

The check is `apps/api/test/admission-interleavings.test.ts`. It cuts each request into the steps its handler takes. It enumerates every ordering of those steps across a few concurrent requests and runs each ordering against the real store functions on a fresh D1, inside workerd. Then it checks the promises against what D1 holds and what each request answered. This is a bounded exhaustive check of the real SQL, not a model of it.

Why this tool: the question is whether steps in some order break a rule. Each D1 batch commits atomically, so every way to get it wrong lives in the gaps between batches and the reads taken before them. Enumerating those orders against real D1 tests the code itself, with the repo's own test runner and nothing else to install. TLC (TLA+) would explore larger bounds over a hand-written model. It isn't used because a model can drift from the SQL without anyone noticing, while this check fails as soon as the SQL changes behavior.

## Run it

From the repository root, with Node 24.22 or later first on PATH:

```sh
cd apps/api && pnpm exec vp test test/admission-interleavings.test.ts
```

It takes about 7 seconds and also runs as part of `pnpm test`. A pass prints `Tests  3 passed (3)`. A failure prints the broken promise and the ordering that broke it, as step labels, for example:

```text
2 requests showed ADMIT for one SINGLE_USE pass
    after: gateA.admit → gateB.admit → desk.readReceipt → desk.record → deskRetry.readReceipt → deskRetry.record
```

## What each step is

Every label maps to code a reviewer can open. Code at commit `e753a8b` was checked against this table.

| Label | Code | Why it is one step |
| --- | --- | --- |
| `gateX.admit` | `admitSingleUse` in `apps/api/src/verify/admit.ts` (slot insert plus ADMIT row in one `db.batch`), then the REJECT `logEntry` on `ALREADY_USED` in `postV1Verify`, `apps/api/src/handlers/verify.ts` | A D1 batch is one transaction. The REJECT row is a separate statement that no promise reads. |
| `scanX.readReceipt` | `readReception(db, id)` at the top of `postV1IssuersMeReception`, `apps/api/src/handlers/reception.ts` | One read, before any write. |
| `scanX.readClock` | `const now = c.get('now')()` in the same handler, taken before `resolveVerdict`'s chain read | The day a stamp is booked to comes from this reading, not from commit time. |
| `scanX.record` | `recordReception`'s one `binding.batch([...])` in `apps/api/src/stamps/reception-store.ts`, with its entry, slot, credit, receipt and Sensitive statements | A D1 batch is one transaction, and its guards read inside it. |
| `raiseLimit(n)` | The single `INSERT … ON CONFLICT DO UPDATE` in `putV1IssuersMeCardsCardIdStamps`, `apps/api/src/handlers/reception.ts`, done in the test as an `UPDATE` of `daily_limit` | One statement. |
| `clock passes midnight` | The api clock crossing Tokyo midnight (`japanDay` in `apps/api/src/stamps/store.ts`) |  |

Signed admission (`postV1VerifySigned`) reaches the slot through the same `admitSingleUse`, so `gateX.admit` covers it too.

## Bounds and assumptions

Scenarios, all on one issuer and one membership card, with stamps enabled and a daily limit of 1:

1. Single use: two gate scans, one reception scan, and a retry of it with the same request id (180 orderings). Nothing moves the clock, so the clock reads are folded into the batches.
2. Daily cap: two reception scans with different request ids, midnight, and a raise to limit 2 (180 orderings).
3. Retry: a reception scan, its retry, and a second scan, all on one day (210 orderings).

Outside these bounds:

- More than four concurrent requests, more than one midnight, a lowered limit, or more than one limit change.
- `resolveVerdict` and the chain. Every request is taken to see a valid level-0 right with an ADMIT verdict, so revocation racing an admission isn't checked.
- Sensitive cards. The batch's Sensitive `UPDATE` runs but no scenario seeds a Sensitive card.
- Stamp redemption and adjustments (`stamp-ledger.ts`), the Attendance hook, the signed path's challenge, and venues other than the one seeded.
- D1 itself. The check relies on a batch being one transaction, which `apps/api/test/admit.test.ts` ("rolls back the first statement when the second fails") pins.

A pass means no ordering within these scenarios breaks a promise. It says nothing beyond them.

## Findings

**Finding 1: a stamp can be booked to the previous day under a limit raised after midnight.** Seen at `e753a8b`.

1. Daily limit 1. Scan A is recorded before midnight and takes the day's one stamp.
2. Scan B reads the clock before midnight (`scanB.readClock`), then waits on the chain read.
3. Midnight passes, and the operator raises the limit to 2.
4. Scan B records. Its `day` is the old day, from step 2, but the batch compares that day's count, 1, against the new limit, 2, and awards the stamp.
5. The old day ends with 2 stamps, though its limit was 1 for the whole day.

This needs a reception request in flight across midnight while the limit is raised, so it's rare. Fixing it is a product decision, and the product code is unchanged. Options include booking the stamp to the day of commit or recording the limit with the day. The test pins this finding exactly: every violation in the daily-cap scenario must have this shape, and there must be exactly `STALE_DAY_SCHEDULES` (14) of them. Any other violation fails the test. Once the finding is fixed, the count drops to 0. Then delete the two pinned lines and expect no violations, the same as in the other scenarios.

## When a change touches this code

The check covers these, as of the sync commit:

- `apps/api/src/verify/admit.ts`: `admitSingleUse`, `logEntry`, `admitAndHook`
- `apps/api/src/stamps/reception-store.ts`: `recordReception`, `readReception`
- `apps/api/src/stamps/store.ts`: `japanDay`
- `apps/api/src/handlers/verify.ts`: `postV1Verify`, from the clock read to the REJECT log
- `apps/api/src/handlers/verify-signed.ts`: `postV1VerifySigned`, its `admitAndHook` call
- `apps/api/src/handlers/reception.ts`: `postV1IssuersMeReception` and `putV1IssuersMeCardsCardIdStamps`
- The `entry_log`, `slots`, `stamp_credits`, `reception_requests` and `card_stamp_settings` tables under `apps/api/migrations/`

**Sync commit: `e753a8b6074329dc0a2bcdbe7b19f0ffeccd2414`.** To see whether the check needs another look:

```sh
git diff --stat e753a8b6074329dc0a2bcdbe7b19f0ffeccd2414 -- apps/api/src/verify/admit.ts apps/api/src/stamps apps/api/src/handlers/verify.ts apps/api/src/handlers/verify-signed.ts apps/api/src/handlers/reception.ts apps/api/migrations
```

When that shows changes:

1. Run the check.
2. Re-read the step table against the changed code. A new await between a read and the batch that uses it is a new step. A write split out of a batch is two steps. A new path that writes `slots`, `stamp_credits` or an ADMIT `entry_log` row is a new request kind. Find writers with `rg -n "insert\(slots\)|INTO slots|INTO stamp_credits|admitSingleUse|recordReception" apps/api/src`.
3. If the code's steps changed, change the step builders (`gateScan`, `receptionScan`, `raiseLimit`, `midnight`) to match, and update the expected schedule counts.
4. Move the sync commit in this file forward only after the table and the builders describe the code at the new commit.

## A real bug or a modelling error

When the check fails, read the ordering in the failure as a story about the code. Then ask whether the handlers can actually run their steps in that order:

- If they can, it's a real bug. Report it with the ordering in plain steps, as Finding 1 does. Don't weaken the promise, cut the scenario, or edit the expected violations to make it pass.
- If they can't, because the ordering puts two steps of one request in an order the handler doesn't allow or splits something D1 commits atomically, the step builders are wrong. Fix them to match the code.
- If the failure is a thrown error rather than a violation message, the seed or a schema change broke the harness. `seed` inserts the rows the store functions need: an issuer with `operatorAddress`, a membership card, stamp settings, and two members.

To prove the check still catches a break after editing it, break the real code on purpose, run it, and restore the file. For example, append `.onConflictDoNothing()` to the slot insert in `admitSingleUse` (the single-use scenario must fail with "2 requests showed ADMIT"), or change `< COALESCE(s.daily_limit, 1)` in `recordReception` to `< 1000` (the cap and retry scenarios must fail). Restore with `git checkout -- <file>` only when the file had no other edits.

Use `/pstack:maintain-formal-verification-skill` to bring this back in line after changes that skipped it.
